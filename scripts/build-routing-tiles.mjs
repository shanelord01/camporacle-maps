// Builds CampOracle's offline road routing (#79 in the app repo): Valhalla graph
// tiles for Australia from the Geofabrik extract of OpenStreetMap, cut into one
// .tar.gz per map region (every tile whose box meets the region's box), and adds
// each region's file to regions.json beside its map, so the app downloads the
// two together. Run after build-map-regions.mjs, into the same output folder.
//
// Needs Docker (the official Valhalla image) and about 8 GB of memory.
//
// Usage: node scripts/build-routing-tiles.mjs [--only nt,tas] [--out dir] [--work dir]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Pinned by tag and digest, and the same as the web planner's routing container (camporacle repo,
// web/routing/Dockerfile), so tiles and engine always match. Move both together.
const VALHALLA = 'ghcr.io/valhalla/valhalla:3.9.1@sha256:4fd114eb1d26b8fc2f43bcb3df234c1b63a0bf13c277405e5943d5361dc575de';
const EXTRACT = 'https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf';
// Valhalla's tile levels and their sizes in degrees: highways, arterials, local roads.
const LEVELS = { 0: 4, 1: 1, 2: 0.25 };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const root = join(import.meta.dirname, '..');
// Absolute, because Docker reads a relative -v source as a volume name.
const outDir = resolve(arg('out') ?? join(root, 'build', 'map-regions'));
const work = resolve(arg('work') ?? join(root, 'build', 'valhalla'));
const only = arg('only')?.split(',');
const regions = JSON.parse(readFileSync(join(root, 'scripts', 'data', 'map-regions.json'), 'utf8')).filter((r) => !only || only.includes(r.id));

mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

// 1. The extract and the graph.
const pbf = join(work, 'australia.osm.pbf');
if (!existsSync(pbf)) run('curl', ['-sSfL', '-o', pbf, EXTRACT]);
const tilesDir = join(work, 'tiles');
if (!existsSync(tilesDir)) {
  run('docker', [
    'run', '--rm', '-v', `${work}:/data`, VALHALLA, 'sh', '-c',
    [
      'valhalla_build_config --mjolnir-tile-dir /data/tiles --mjolnir-tile-extract /data/tiles.tar' +
        ' --mjolnir-admin /data/admins.sqlite --mjolnir-timezone /data/timezones.sqlite > /data/valhalla.json',
      'valhalla_build_timezones > /data/timezones.sqlite',
      'valhalla_build_admins -c /data/valhalla.json /data/australia.osm.pbf',
      'valhalla_build_tiles -c /data/valhalla.json /data/australia.osm.pbf',
    ].join(' && '),
  ]);
}

// 2. Every tile file with its box.
function tileBox(level, id) {
  const size = LEVELS[level];
  const cols = 360 / size;
  const row = Math.floor(id / cols);
  const col = id % cols;
  const x = -180 + col * size;
  const y = -90 + row * size;
  return [x, y, x + size, y + size];
}

const tiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.gph')) {
      const parts = relative(tilesDir, full).replace('.gph', '').split('/');
      const level = Number(parts[0]);
      if (!(level in LEVELS)) continue;
      tiles.push({ path: relative(tilesDir, full), box: tileBox(level, Number(parts.slice(1).join(''))) });
    }
  }
})(tilesDir);

const meets = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// 3. One archive per region, and its entry in regions.json.
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });

const manifestPath = join(outDir, 'regions.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { regions: [] };
for (const region of regions) {
  const mine = tiles.filter((t) => meets(t.box, region.bbox));
  const list = join(work, `${region.id}.list`);
  writeFileSync(list, mine.map((t) => t.path).join('\n'));
  const file = `${region.id}.routing.tar.gz`;
  const out = join(outDir, file);
  run('tar', ['-czf', out, '-C', tilesDir, '-T', list]);
  const unpacked = mine.reduce((sum, t) => sum + statSync(join(tilesDir, t.path)).size, 0);
  const entry = { file, bytes: statSync(out).size, unpacked, tiles: mine.length, sha256: await sha256(out) };
  const target = manifest.regions.find((r) => r.id === region.id);
  if (target) target.routing = entry;
  else manifest.regions.push({ ...region, routing: entry });
  console.log(`${region.id}: ${mine.length} tiles, ${(entry.bytes / 1e6).toFixed(0)} MB to download, ${(unpacked / 1e6).toFixed(0)} MB unpacked`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

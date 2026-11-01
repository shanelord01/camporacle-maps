// Cuts the offline map regions (#14) from a Protomaps daily build and writes
// what the app downloads: one PMTiles file per region at full detail (zoom
// 15), the label glyphs, and regions.json, the manifest the app reads
// (src/map/regions.ts). Regions are in scripts/data/map-regions.json, each a
// box that overlaps its neighbours a little so nothing at a border is missing.
//
// Needs the pmtiles CLI (brew install pmtiles). The output folder is what gets
// published, all files side by side, as a GitHub release.
//
// Usage: node scripts/build-map-regions.mjs [--build YYYYMMDD] [--only nt,tas] [--out dir]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_ZOOM = 15;
const BUILDS = 'https://build-metadata.protomaps.dev/builds.json';
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts';
// The fonts @protomaps/basemaps' layers ask for, and the ranges Australian
// labels use: Latin, Latin extended, combining marks, Cyrillic (some country
// names at low zoom) and punctuation.
const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '8192-8447'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const root = join(import.meta.dirname, '..');
const outDir = arg('out') ?? join(root, 'build', 'map-regions');
const only = arg('only')?.split(',');
const regions = JSON.parse(readFileSync(join(root, 'scripts', 'data', 'map-regions.json'), 'utf8')).filter((r) => !only || only.includes(r.id));

async function latestBuild() {
  const builds = await (await fetch(BUILDS)).json();
  return builds.at(-1).key.replace('.pmtiles', '');
}

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const build = arg('build') ?? (await latestBuild());
const source = `https://build.protomaps.com/${build}.pmtiles`;
mkdirSync(outDir, { recursive: true });

const manifest = { build, regions: [], glyphs: [] };
for (const region of regions) {
  const file = `${region.id}.pmtiles`;
  const path = join(outDir, file);
  console.log(`${region.name}: extracting from ${build}`);
  execFileSync('pmtiles', ['extract', source, path, `--bbox=${region.bbox.join(',')}`, `--maxzoom=${MAX_ZOOM}`], { stdio: 'inherit' });
  manifest.regions.push({ ...region, file, bytes: statSync(path).size, sha256: await sha256(path) });
}

for (const stack of FONTSTACKS) {
  for (const range of RANGES) {
    // Release files can't sit in folders, so each glyph file gets a flat name.
    const file = `glyphs-${stack.toLowerCase().replaceAll(' ', '-')}-${range}.pbf`;
    const response = await fetch(`${GLYPHS}/${encodeURIComponent(stack)}/${range}.pbf`);
    if (!response.ok) throw new Error(`${stack} ${range}: HTTP ${response.status}`);
    writeFileSync(join(outDir, file), Buffer.from(await response.arrayBuffer()));
    manifest.glyphs.push({ fontstack: stack, range, file });
  }
}

writeFileSync(join(outDir, 'regions.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.regions.length} regions and ${manifest.glyphs.length} glyph files to ${outDir}`);

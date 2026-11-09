// Uploads the Valhalla routing tiles as loose files to Cloudflare R2, for the CampOracle web planner's routing
// container, which fetches only the tiles a route crosses (camporacle repo, docs/adr/0004). Run after
// build-routing-tiles.mjs, from its work folder's tiles.
//
// Each build goes under routing/<build>/ (the build is the release's, osm-YYYYMMDD from regions.json), copying only
// tiles that differ from what is already there under that build. Then routing/current.json is pointed at it, last,
// so the container never sees half a build. Older builds are deleted, except the one before, which a container
// woken before the switch keeps using until it sleeps.
//
// Needs rclone, and the bucket's S3 credentials in the environment:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ROUTING_BUCKET (camporacle-routing-tiles).
// The access key needs Object Read and Write on that bucket only.
//
// Usage: node scripts/upload-routing-tiles.mjs [--tiles build/valhalla/tiles] [--manifest build/map-regions/regions.json] [--dry-run]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const root = join(import.meta.dirname, '..');
const tiles = resolve(arg('tiles') ?? join(root, 'build', 'valhalla', 'tiles'));
const manifest = JSON.parse(readFileSync(resolve(arg('manifest') ?? join(root, 'build', 'map-regions', 'regions.json')), 'utf8'));
const dryRun = process.argv.includes('--dry-run');

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const bucket = need('R2_ROUTING_BUCKET');
const build = `osm-${manifest.build}`;
if (!/^osm-[0-9]{8}$/.test(build)) throw new Error(`regions.json has no build date: ${manifest.build}`);

// rclone's remote "r2", configured from the environment so no config file holds the keys.
const env = {
  ...process.env,
  RCLONE_CONFIG_R2_TYPE: 's3',
  RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
  RCLONE_CONFIG_R2_ACCESS_KEY_ID: need('R2_ACCESS_KEY_ID'),
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: need('R2_SECRET_ACCESS_KEY'),
  RCLONE_CONFIG_R2_ENDPOINT: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  RCLONE_CONFIG_R2_NO_CHECK_BUCKET: 'true',
};
const rclone = (args, options = {}) =>
  execFileSync('rclone', [...args, ...(dryRun ? ['--dry-run'] : [])], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
const remote = (path) => `r2:${bucket}/${path}`;

// 1. The build's tiles. --checksum compares MD5 with R2's etag, so a run again after a failure copies only what's missing.
rclone(['copy', tiles, remote(`routing/${build}`), '--include', '*.gph', '--checksum', '--transfers', '32', '--stats-one-line', '--stats', '30s'], {
  stdio: 'inherit',
});

// 2. The pointer, last.
const pointer = join(mkdtempSync(join(tmpdir(), 'routing-')), 'current.json');
const previous = (() => {
  try {
    return JSON.parse(execFileSync('rclone', ['cat', remote('routing/current.json')], { env, encoding: 'utf8' })).build ?? null;
  } catch {
    return null;
  }
})();
writeFileSync(pointer, JSON.stringify({ build, uploaded: new Date().toISOString() }));
rclone(['copyto', pointer, remote('routing/current.json')]);

// 3. Builds older than the one before.
const builds = execFileSync('rclone', ['lsf', remote('routing/'), '--dirs-only'], { env, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.replace(/\/$/, ''))
  .filter((name) => /^osm-[0-9]{8}$/.test(name));
for (const old of builds) {
  if (old === build || old === previous) continue;
  console.log(`Deleting ${old}`);
  rclone(['purge', remote(`routing/${old}`)]);
}
console.log(`${dryRun ? 'Would point' : 'Pointed'} routing/current.json at ${build}${previous && previous !== build ? `, after ${previous}` : ''}`);

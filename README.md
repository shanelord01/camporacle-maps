# CampOracle maps

Offline map files for the CampOracle app, and the app's latest store versions.

## Offline map regions

Each release holds one PMTiles file per Australian state at full street detail (zoom 15), the Noto Sans label glyphs, and `regions.json`, the manifest the app reads. The app downloads them from the latest release without signing in.

`.github/workflows/map-regions.yml` builds a new release on the 2nd of each month: it takes the newest [Protomaps](https://protomaps.com) daily build of OpenStreetMap and cuts each state's box from `scripts/data/map-regions.json` with `scripts/build-map-regions.mjs`. Run it by hand from the Actions tab to publish a release now.

To build locally (needs Node and `brew install pmtiles`):

```bash
node scripts/build-map-regions.mjs --out build/map-regions
```

`--only nt,tas` cuts some states; `--build YYYYMMDD` picks a Protomaps build.

## Routing tiles

Each region also has `<id>.routing.tar.gz`: the [Valhalla](https://github.com/valhalla/valhalla) road graph tiles whose box meets the region's, listed under the region's `routing` in `regions.json`. The app unpacks them into one folder and routes trips on the phone with no signal. `scripts/build-routing-tiles.mjs` builds them in the same workflow, from the [Geofabrik](https://download.geofabrik.de/australia-oceania.html) extract of Australia, with the official Valhalla Docker image.

To build locally (needs Docker and about 8 GB of memory), after the map regions:

```bash
node scripts/build-routing-tiles.mjs --out build/map-regions
```

### Routing tiles for the web planner

The web planner at plan.camporacle.com.au routes in a Valhalla container that starts with no tiles and fetches each tile a route crosses from Cloudflare R2. `scripts/upload-routing-tiles.mjs` uploads the build's loose tiles to the `camporacle-routing-tiles` bucket under `routing/osm-YYYYMMDD/`, copying only tiles that changed, then points `routing/current.json` at that build and deletes builds older than the one before it. The workflow runs it after building the tiles, once these repository secrets are set: `R2_ACCOUNT_ID`, and `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from an R2 API token with Object Read and Write on that bucket only.

To upload by hand (needs `brew install rclone` and the same three values, plus `R2_ROUTING_BUCKET=camporacle-routing-tiles`, in the environment), after building the tiles:

```bash
node scripts/upload-routing-tiles.mjs --dry-run
node scripts/upload-routing-tiles.mjs
```

The Valhalla image is pinned by tag and digest to the same version as the web planner's container. Change the two together.

## Store versions

`app/version.json` holds the latest and minimum app versions on each store, one entry for iOS and one for Android. The app reads it at launch and at most every six hours to tell travellers a new version is out. Update it when a release is live on the App Store or Google Play, not when it is submitted, or travellers are sent to a store page that still has the old build.

The version stays 1.0.0 between releases, so each value can carry the native build number: `"1.0.0 (45)"` is the iOS build number or Android version code 45. A phone on a lower build sees `latest` as a new version it can install, and is made to update when it is below `minimum`. A value without a build number (`"1.0.0"`) ignores the build. Builds older than 43 also ignore it.

## Licences

See LICENSE. In short:

Map data © OpenStreetMap contributors, under the [Open Database Licence 1.0](https://www.openstreetmap.org/copyright). Noto Sans glyphs under the SIL Open Font Licence 1.1. The scripts and configuration are © Shane Lord, all rights reserved.

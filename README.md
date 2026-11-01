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

## Store versions

`app/version.json` holds the latest and minimum app versions on each store. The app reads it to tell travellers a new version is out. Update it when a release reaches the App Store or Google Play.

## Licences

Map data © OpenStreetMap contributors, under the [Open Database Licence 1.0](https://www.openstreetmap.org/copyright). Noto Sans glyphs under the SIL Open Font Licence 1.1.

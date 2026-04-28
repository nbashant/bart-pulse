# BART Track Live

A map-first live BART tracker built with Vite, React, TypeScript, official BART ETDs/advisories, and official BART GTFS route geometry.

## Run

```bash
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/`.

For a production-style local server:

```bash
npm run build
npm start
```

## BART API Access

The browser does not receive an API key. Vite and `server.mjs` proxy these local endpoints:

- `/api/bart/etd`
- `/api/bart/advisories`

Set `BART_API_KEY` in your shell to use your own BART API key:

```bash
BART_API_KEY=your_key_here npm run dev
```

If no key is provided, the server uses BART's public sample key. If live calls fail, the app falls back to demo mode and marks the feed as demo/offline instead of presenting simulated data as live.

## Deploy On Render

This repo includes `render.yaml` for a free Render web service.

Render settings:

```text
Build command: npm ci && npm run build
Start command: npm start
```

Set this environment variable in Render:

```text
BART_API_KEY=your_key_here
```

Render also sets `PORT` automatically. `server.mjs` serves the built app and keeps BART API calls behind `/api/bart/etd` and `/api/bart/advisories`, so the browser does not receive the API key.

## Data Sources

- Official BART ETD API: `https://api.bart.gov/api/etd.aspx`
- Official BART advisory API: `https://api.bart.gov/api/bsa.aspx`
- Official BART GTFS static feed: `https://www.bart.gov/dev/schedules/google_transit.zip`

Regenerate the static geometry module:

```bash
npm run generate:gtfs
```

The generated file is `src/data/gtfs.generated.ts`. It includes station coordinates, route metadata, stop sequences, segment timing, and simplified GTFS shape coordinates.

## Geometry And Inference

The map uses station latitude/longitude and GTFS route shapes projected through Web Mercator in `src/geometry`. Route rendering uses small display offsets so overlapping line segments remain readable while station markers stay on the actual projected station points.

BART does not expose a public vehicle-position feed through the legacy developer APIs used here. Train markers are inferred from:

- current ETDs,
- destination abbreviation,
- route color,
- route direction and station sequence,
- GTFS stop timing between stations,
- clustered time-to-destination signals from nearby stations.

`Leaving` is treated as zero minutes. Low-confidence inferred trains are softened visually; trains that cannot be placed on a known route segment are not rendered.

## Tests And Screenshots

```bash
npm run build
npm test
npm run screenshots
```

Screenshots are saved in:

```text
artifacts/screenshots
```

Playwright reports are saved in:

```text
playwright-report
test-results
```

The browser tests cover loading, demo/fallback data, refresh, every core line filter, station search, station selection, train selection, map pan/zoom/fit, advisory states, keyboard activation, Escape behavior, mobile layout, no-train/error/crowded scenarios, reduced motion, responsive resizing, and visual smoke checks.

## Demo Mode

Use `?demo=1` for deterministic demo data:

```text
http://127.0.0.1:5173/?demo=1
```

Useful scenarios:

- `?demo=1&scenario=no-trains`
- `?demo=1&scenario=crowded`
- `?demo=1&scenario=advisory-empty`
- `?demo=1&scenario=advisory-error`
- `?demo=1&scenario=long-advisory`
- `?demo=1&scenario=api-error`

Demo mode is intentionally labeled in the UI.

## Known Limitations

- Train positions are inferred, not official vehicle positions.
- ETD clustering can still merge or split trains when BART returns sparse or inconsistent estimates.
- The lightweight basemap is contextual art; route and station geometry come from GTFS.
- The Oakland Airport connector is intentionally excluded from the visible tracker because this app does not currently have useful live train positions for that connector.

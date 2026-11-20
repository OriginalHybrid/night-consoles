# Night Consoles

A growing collection of self-contained, large-format "night console" data interfaces built with HTML, CSS, Canvas, and WebGL. The project is a static site with no build step and no package manager required.

See [dashboards.md](dashboards.md) for a detailed reference to each dashboard, its views, and whether its data is live, baked, simulated, or synthetic.

## Consoles

| Console | Interface | Data displayed | Entry point |
| --- | --- | --- | --- |
| HELIX-9 | Genome Analysis | DNA structure, sequence, variants, proteins, 3D helix | `themes/genome-analysis.html` |
| LAPIDARY HEALTH | Preventive Lab | Blood panel, vitals, risk flags, anatomy, ECG | `themes/preventive-lab.html` |
| MARKET DECK | Market Data | Equities watchlist, candles, forecast, news, order book | `themes/market-data.html` |
| DECLINATION | Geomagnetic Field | IGRF-14 field lines, dip poles, solar wind, aurora | `themes/geomagnetic-field.html` |
| HARROW | Asteroid Operations | Hull EVA, Bennu ephemeris, DSN telemetry, stars | `themes/asteroid-operations.html` |
| TIDAL-3 | Neural Telemetry | Model DAG, loss, gradients, weights, inference | `themes/neural-telemetry.html` |
| GYRE WATCH | Storm Forecast | Storm track, pressure, wind, rain, forecast | `themes/storm-forecast.html` |
| SPOTFIRE | Wildfire Spread | Fire weather, terrain, spot fires, containment | `themes/wildfire-spread.html` |
| Live Flights | Flight Tracking | Regional AvioADSB aircraft, world map, flight ladder, altitude profile, 3D aircraft hologram | `themes/flight-tracking.html` |
| ISODOSE | Radiotherapy Planning | Isodose shells, DVH, VMAT arcs, constraints, optional MRI/CT/PET hologram | `themes/isodose.html` |

The root `index.html` is the animated preview index. Each console is a standalone page in `themes/`; new consoles can be added without changing the build setup.

## Requirements

- A modern browser with JavaScript enabled
- WebGL for the 3D DNA helix and flight hologram
- Python 3 or Node.js for a local static server

No install or build step is required. Three.js is vendored under `shared/vendor/`.

## Clone and run locally

```bash
git clone https://github.com/OriginalHybrid/night-consoles.git
cd night-consoles
```

Start a static server from the repository root.

### Python

```bash
python -m http.server 8123
```

On Windows, if `python` is not available:

```powershell
py -m http.server 8123
```

### Node.js

```bash
npx serve . -l 8123
```

Or:

```bash
npx http-server . -p 8123
```

Open:

```text
http://localhost:8123/
```

Do not open the files directly with `file://`. The consoles use ES modules, local JSON fetches, and canvas assets, so a local HTTP server is required.

## GitHub Pages

1. Push the repository to GitHub as `night-consoles`.
2. Open **Settings > Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Select the `main` branch and the `/ (root)` folder.
5. Save. The site will publish at:

```text
https://originalhybrid.github.io/night-consoles/
```

The repository includes `.nojekyll`, so the static folders and assets are served directly.

## Project layout

```text
index.html                 animated console index
themes/                    standalone console pages
assets/previews/           animated WebP preview loops for the index
assets/                    per-console images, geometry, and frame sequences
shared/                    shared CSS, canvas helpers, palettes, and vendored Three.js
shared/data/               baked fallback data and data notes
specs/                     reference captures, screenshots, and generation/verification scripts
```

## Data and network behavior

Several consoles attempt keyless live feeds and fall back to deterministic simulated data when a feed is unavailable:

- **Genome Analysis:** Ensembl REST and UCSC, with baked fallback and `?live=off`
- **Market Data:** CoinGecko and GDELT where available, with simulated equities and forecasts
- **Geomagnetic Field:** SWPC, USGS geomagnetism, and model data, with a model fallback
- **Asteroid Operations:** NASA DSN Now and NOAA SWPC, with baked Bennu, Horizons, NEO, and star data
- **Storm Forecast:** Maverick WX, NASA GIBS, and Open-Meteo, with scenario fallbacks
- **Wildfire Spread:** Open-Meteo, NWS alerts, and Kanari events, with authored scenario fallbacks
- **Live Flights:** AvioADSB regional live aircraft with a simulated global background, and callsign lookups from adsbdb; `?live=off` forces the baked dataset
- **Neural Telemetry:** deterministic simulated training telemetry
- **Preventive Lab:** baked mock patient data
- **Radiotherapy Planning:** procedural anatomy and dose model, with optional baked scan layers

All clinical, financial, and operational values are research/demo data. Nothing here is medical, investment, or operational advice.

## Live flights

`flight-tracking` calls AvioADSB directly from the browser. Anonymous limits are 1 request every 10 seconds and 100 requests per day, with 100 nm point queries. The world map remains simulated outside the selected region. No Worker or proxy is required.

## ISODOSE scan assets

`isodose` ships with the exact procedural head as the default view. The optional `HOLO BRAIN`, `SCAN SKULL`, and `EYES` toggles load or hide precomputed assets derived from open data. Drag the hero to orbit; use the wheel to zoom; double-click to reset.

- Brain surface: OpenNeuro `ds003563` (CC0), FreeSurfer pial surface.
- FDG PET: OpenNeuro `ds006917` (CC0), subject 004.
- Skull/eyes: Zenodo `3374839` cranial CT (CC BY 4.0).

Raw DICOM/NIfTI files are not committed. See `assets/isodose/README.md` for provenance, processing, and attribution. The scan layers are illustrative and are not medical software.

## Verification and regeneration

Check theme encoding:

```bash
node specs/_tests/scan-encoding.mjs
```

Regenerate the baked genome fallback:

```bash
node specs/_tests/make-helix-9-data.mjs
```

Additional generators for the baked data and assets live in `specs/_tests/`.

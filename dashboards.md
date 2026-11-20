# Night Consoles — Dashboard Reference

This document describes every console in the repository: what it is, which views it
provides, where its data comes from, and whether that data is live, baked, simulated,
or synthetic.

## Data labels used here

| Label | Meaning |
| --- | --- |
| **Live** | Fetched at runtime from a public, keyless API. A failed request leaves the baked or simulated value in place. |
| **Baked** | Generated ahead of time and committed under `shared/data/` or `assets/`. |
| **Simulated** | Deterministic generated telemetry produced by the page or a generator script. |
| **Synthetic** | Authored or procedurally invented content for the interface; it does not represent a real measurement. |

All clinical, financial, and operational values are research/demo data. Nothing here
is medical, investment, or operational advice.

## Summary

| Console | Entry point | Data mode | Primary sources |
| --- | --- | --- | --- |
| HELIX-9 Genome Analysis | `themes/genome-analysis.html` | Live + baked + simulated | Ensembl REST, UCSC API, baked GRCh38 window |
| LAPIDARY HEALTH Preventive Lab | `themes/preventive-lab.html` | Synthetic + mock | Baked patient panel, procedural ECG, frame loop |
| MARKET DECK Market Data | `themes/market-data.html` | Simulated + live | Baked OHLCV, CoinGecko, GDELT |
| DECLINATION Geomagnetic Field | `themes/geomagnetic-field.html` | Live + model | NOAA SWPC, USGS BOU, IGRF-14, OVATION |
| HARROW Asteroid Operations | `themes/asteroid-operations.html` | Live + baked + synthetic | NASA DSN Now, NOAA SWPC, JPL SBDB/Horizons, HYG, NASA Bennu mesh |
| TIDAL-3 Neural Telemetry | `themes/neural-telemetry.html` | Simulated (one real training run) | NumPy MLP run + deterministic CNN/Transformer simulation |
| GYRE WATCH Storm Forecast | `themes/storm-forecast.html` | Live + archive + model | MaverickWX/NHC/JTWC, NASA GIBS, Open-Meteo, Hurricane Ian 2022 archive |
| SPOTFIRE Wildfire Spread | `themes/wildfire-spread.html` | Authored scenario + live | Open-Meteo, NWS alerts, Kanari.io, authored Kestrel scenario |
| Live Flights Flight Tracking | `themes/flight-tracking.html` | Live region + simulated global | AvioADSB, adsbdb, Natural Earth, baked global flights |
| ISODOSE Radiotherapy Planning | `themes/isodose.html` | Procedural + optional real scans | SDF/dose model, OpenNeuro, Zenodo CT |

---

## HELIX-9 — Genome Analysis

**What it is:** A genome-analysis deck built around a Three.js DNA helix. It shows a
GRCh38 locus, base sequence, gene models, variants, coverage, conservation,
expression, protein annotations, and QC/log panels.

**Data**

- **Baked:** `shared/data/helix-9/genome.json` — a deterministic 201 bp window at
  `chr17:43,044,295-43,044,495`, with a five-variant demo set, gene models, coverage,
  conservation, expression, scores, QC, and log lines.
- **Live:** independent keyless requests to Ensembl REST for sequence, overlapping
  genes, and variants, plus UCSC `refGene` tracks. Successful responses replace that
  source and show `LIVE` or `PARTIAL`; failures keep the baked values.
- **Simulated/synthetic:** protein clusters, nerve filaments, some annotations, and
  all clinical labels are interface demo content.

**Views:** 3D helix viewport, sequence browser, variant table, gene/protein panels,
coverage and expression tracks, QC summary.

**Flags:** `?live=off` forces the deterministic baked dataset.

**Limitations:** Not a clinical or diagnostic tool. Ensembl and UCSC availability
depends on CORS and network access; variant interpretations are demo data.

---

## LAPIDARY HEALTH — Preventive Lab

**What it is:** A preventive-lab dashboard for a fictional patient, with a full-body
biomarker map, lab card board, metabolic budget, endocrine/micronutrient traces, and
a cardiac HUD.

**Data**

- **Synthetic/mock:** `shared/data/lapidary-health/health.json` contains the patient,
  vitals, CBC/LFT/KFT/glucose/lipid/thyroid/vitamin panels, urinalysis, organs,
  trends, and follow-up tasks. The patient, values, flags, and notes are invented.
- **Synthetic animation:** the ECG waveform is drawn procedurally on canvas; the
  cardiac loop uses 24 PNG frames in `assets/lapidary-health/heart2/`.
- **Baked reference ranges:** demo values only; real ranges vary by laboratory, age,
  and sex.

**Views:** anatomical marker map (front/side), cardiac HUD loop, ECG and SpO2
telemetry, biomarker cards, metabolic budget, endocrine trace, follow-up bench.

**Limitations:** Mock data for interface demonstration. Flags are UI states, not
diagnoses, and the dashboard is not a medical device.

---

## MARKET DECK — Market Data

**What it is:** A US-equities trading terminal with a watchlist, candlestick chart,
forecast cone, sector breadth, order book, crypto and commodity tapes, and event-risk
news.

**Data**

- **Simulated:** `shared/data/market-deck/market.json` — 14 tickers with 120 generated
  OHLCV points each, commodities/macro values, positions, risk metrics, breadth,
  sector moves, and fallback news. Prices, forecasts, order book, and analytics stay
  simulated unless a CORS-enabled stock provider is added.
- **Live:** CoinGecko simple-price quotes for the crypto tape, and GDELT DOC 2.0 for
  news headlines. Both are keyless and degrade to baked/simulated values on failure.

**Views:** watchlist and search, candlestick and volume charts, forecast/ensemble
panel, sector breadth, order book, commodities/crypto marquees, news dock, positions
and risk.

**Limitations:** No live stock prices. Forecasts are simulated. Not investment advice.

---

## DECLINATION — Geomagnetic Field

**What it is:** A geomagnetic observatory built around a blue Earth, IGRF-14 field
lines, magnetic dip poles, a declination table, and a solar-wind-driven aurora.

**Data**

- **Model/baked:** IGRF-14 coefficients and dip-pole history
  (`shared/data/declination/`), plus 260 RK4-traced field lines baked into the scene.
  Coefficient source: IAGA / NOAA NCEI `igrf14coeffs.txt`.
- **Live:** NOAA SWPC solar-wind speed and magnetic-field summaries, Kp, Dst, R/S/G
  scales and alerts, and the OVATION aurora probability; USGS Geomagnetism
  observatory BOU for H, D, Z, F.
- **Asset:** NASA Blue Marble equirectangular Earth texture.
- **Simulated:** the outer magnetosphere cage is a visual driver, not a full MHD
  simulation; the aurora ring falls back to Kp-derived geometry when OVATION fails.

**Views:** 3D Earth and field lines, dip poles, declination/ports table, magnetogram,
Kp/Dst storm panels, pole tracks, event log, aurora overlay.

**Flags:** `?sim=1` uses the baked snapshot; `?motion=off` freezes animation.

---

## HARROW — Asteroid Operations

**What it is:** A first-person helmet HUD on the fictional freighter HARROW,
station-keeping near asteroid Bennu. It combines a real Bennu shape and ephemeris
with a synthetic hull EVA, plate wear, and suit telemetry.

**Data**

- **Baked:** `shared/data/harrow/` contains the decimated NASA Bennu mesh, JPL SBDB
  physical/orbital data, JPL Horizons state samples, next NEO close approaches, HYG
  star catalogue, and baked DSN/SWPC fallbacks.
- **Live:** NASA DSN Now contacts and NOAA SWPC solar-wind/Kp summaries.
- **Synthetic:** the freighter, hull plates, thickness-loss readings, spiral EVA fit,
  suit temperatures, O2/CO2, and crew dialogue are clean-room inventions.

**Views:** helmet HUD, real star field and Bennu, hull plate scan, EVA spiral fit,
DSN contact list, NEO table, solar-wind environment, suit and hull telemetry.

**Limitations:** Position and operations are simulated. Bennu mesh: NASA Science /
VTAD (public domain), decimated to 1,419 vertices / 2,692 triangles. Stars: HYG v4.4,
CC BY-SA 4.0, Astronexus.

---

## TIDAL-3 — Neural Telemetry

**What it is:** A distributed neural-network workstation showing three model
architectures, a training DAG, forward/backward pulses, loss and gradient traces,
weight histograms, model disagreement, and inference telemetry.

**Data**

- **Baked:** `shared/data/tidal-3/models.json`.
- **Real:** MODEL-I (MLP 8-24-12-4) metrics, weights, and per-step series come from a
  real NumPy training run on synthetic 4-class data.
- **Simulated:** MODEL-II (CNN) and MODEL-III (Transformer) graphs, weights, and
  training curves are deterministic simulations with realistic decay and latency.
- **No network:** no external datasets, model downloads, GPU, or live feeds.

**Views:** model DAG, training charts, gradient and loss panels, weight histograms,
attention/inference sample, disagreement index, bottom timeline.

**Flags:** `?motion=off` freezes animation.

---

## GYRE WATCH — Storm Forecast

**What it is:** A storm-forecasting aerostat display with a plan-view satellite/radar
hero, official track and cone, wind radii, upper-air profiles, ensemble and
hodograph panels, and an aerostat status strip.

**Data**

- **Live:** MaverickWX active storms/manifests sourced from NOAA/NHC and JTWC; NASA
  GIBS GOES-East, GOES-West, and Himawari infrared imagery; Open-Meteo upper-air and
  surface weather at the aerostat.
- **Archive:** when no live storm or imagery is available, Hurricane Ian 2022 is shown
  from a NOAA/NASA GIBS VIIRS brightness-temperature reconstruction and labelled
  `ARCHIVE`.
- **Model/reconstruction:** RHI, ensemble, lightning, barograph, hodograph, and wind
  profiles are derived from storm intensity, wind radii, official forecast, and
  aerostat observations. They are labelled `MODEL` or `EST`, not measured radar.

**Views:** plan-view reflectivity, track/cone, wind radii, RHI, ensemble, lightning,
barographs, hodograph, wind profile, aerostat and data-link status.

**Flags:** `?sim=1` uses the archive only; `?motion=off` freezes animation.

**Note:** Infrared cloud-top brightness is mapped to a radar-like dBZ palette; it is
not measured radar reflectivity and is not for life-safety use.

---

## SPOTFIRE — Wildfire Spread

**What it is:** A motion-first wildfire-behaviour console built around the authored
Kestrel Fire training scenario, with terrain, active front, spot fires, containment,
resources, trigger clock, and an analyst log.

**Data**

- **Authored/synthetic:** `shared/data/spotfire/scenario.json` — 13 stages from
  13:20–16:20, wind shift at 15:00, spot fires, resources, trigger at 17:02 with a
  160-minute lead, and log entries. `terrain.json` is a 160 × 116 authored height/fuel
  grid, not a real DEM.
- **Live:** Open-Meteo current weather, 92-day history, soil moisture, and elevation
  (model grid); Open-Meteo air quality for PM2.5/PM10/AQI (model, not a sensor); NWS
  active alerts for the scenario point; Kanari.io 6-hour satellite thermal detections
  (CC BY 4.0).
- **Derived:** the Fosberg Fire Weather Index and Simard equilibrium moisture content
  are computed from live weather and scenario wind.

**Views:** 3D terrain and fire front, weather/fuel panel, fire behaviour, spot fires,
resources, trigger/clear-by clock, analyst log, data modal.

**Flags:** `?sim=1` uses the authored weather fallback; `?motion=off` freezes animation.

**Limitations:** No feed failure is replaced with invented thermal detections or
alerts; the page labels missing data. The scenario is training content.

---

## Live Flights — Flight Tracking

**What it is:** An airspace-operations console with a world map, regional live
aircraft, a flight ladder, selected-flight timeline, altitude profile, fleet mix, and
a 3D aircraft hologram.

**Data**

- **Live:** AvioADSB point queries for the selected 100 nm region, and adsbdb callsign
  lookups for route metadata. Both are keyless. Anonymous AvioADSB limits are 1 request
  every 10 seconds and 100 requests per day.
- **Simulated:** the global background is 110 deterministic flights across 8 regional
  presets plus a global view; only the selected region is replaced by live aircraft. Aircraft geometry,
  capacity, and range come from `assets/flight-tracking/aircraft-types.json`.
- **Baked assets:** airports, Natural Earth 50m land and admin boundaries, and a
  simplified India official-boundary overlay.

**Views:** world map, live/sim flight ladder, selected-flight route and timeline,
altitude profile, fleet mix, 3D aircraft hologram, ops log.

**Flags:** `?live=off` forces the baked dataset.

**Limitations:** Live coverage is region-limited by the free AvioADSB quota. The
global map and route/airport values are demo data.

---

## ISODOSE — Radiotherapy Planning

**What it is:** A radiotherapy treatment-planning workstation drawn as a
medical-physics figure: a translucent head with nested isodose shells, three VMAT
arcs, a dose-volume histogram, constraints, optimizer convergence, and optional real
MRI/CT/PET scan layers.

**Data**

- **Procedural/model:** the default head, organs, target, dose field, shells, beams,
  DVH, and optimizer loop are analytic/procedural models. The plan, patient, revision,
  and clinical values are synthetic.
- **Optional real assets:** `assets/isodose/brain.bin` from OpenNeuro `ds003563`
  (CC0, FreeSurfer pial surface); `pet.bin` from OpenNeuro `ds006917` (CC0, FDG PET);
  `skull.bin`, `eyes.bin`, and `lenses.bin` from the Zenodo `3374839` cranial CT
  (CC BY 4.0). They are illustrative layers, not a clinically registered study.
- **No live feeds:** all planning telemetry is generated in the page.

**Views:** 3D head and shells, DVH and detail inset, convergence plot, beam/arc
geometry, constraints, optimizer log, table, probe cursor, optional scan toggles.

**Entry points:** `themes/isodose.html`; the repository-root `isodose.html` redirects
there.

**Limitations:** Not medical software. The scan layers come from different open
subjects and are aligned for visual composition, not diagnosis or treatment planning.

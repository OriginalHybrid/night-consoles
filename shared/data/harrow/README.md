# HARROW data

HARROW is a fictional hull EVA. The hull, plate readings, spiral fit, and suit telemetry are a clean-room reconstruction. These files add real open data alongside the story.

| File | Source | License / terms | Notes |
|---|---|---|---|
| `bennu-mesh.json` | NASA Science — Bennu 3D Model (`Bennu_1_1.glb`) | Public domain (NASA) | Decimated real Bennu mesh, centered and scaled to 490 m. |
| `bennu.json` | JPL Small-Body Database (101955 Bennu) | NASA/JPL public data | Physical and orbital data. |
| `bennu-state.json` | JPL Horizons (101955, geocentric vectors) | NASA/JPL public data | Baked state samples, range, light time, radial velocity. |
| `horizons.json` | JPL Horizons API | NASA/JPL public data | Raw Horizons response for provenance. |
| `neo.json` | JPL Close Approach Data (CAD) | NASA/JPL public data | Next 90 days, distance ≤ 0.1 AU. |
| `stars.json` | HYG Database v4.4, Astronexus | CC BY-SA 4.0 | 12,495 stars, magnitude ≤ 6.8; real sky. |
| `dsn.json` | NASA DSN Now (`eyes.nasa.gov/dsn/data/dsn.json`) | NASA/JPL public data | Baked fallback; runtime refreshes live. |
| `env.json` | NOAA SWPC solar-wind summary | U.S. government public domain | Baked fallback; runtime refreshes live. |

## Attribution

- NASA/JPL — Bennu, Horizons, SBDB, CAD, DSN Now.
- NASA Science / VTAD — Bennu 3D model.
- NOAA SWPC — space weather.
- HYG Database by David Nash / Astronexus — CC BY-SA 4.0. If you redistribute `stars.json` or a derived star field, keep the attribution and share-alike terms.

## Refresh

Run:

```sh
node specs/_tests/make-harrow-data.mjs
```

The script downloads the public sources and rewrites these files. It is a build-time tool; the page never depends on JPL/CelesTrak CORS.

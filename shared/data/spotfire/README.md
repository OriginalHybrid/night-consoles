# SPOTFIRE - synthetic scene datasets

These files are **authored synthetic data**, not measurements. They drive the
terrain, Kestrel fire scenario and offline fallback for the SPOTFIRE theme.

- `terrain.json` - 160 x 116 normalised height and fuel grids for the fictional
  Kestrel block, plus Dry Creek, a service road, the Ridge 4 containment line
  and place labels. Not a real DEM.
- `terrain.csv` - an inspectable 2-cell sample of the same grid.
- `scenario.json` - 13 fifteen-minute stages (13:20-16:20 UTC), advancing fire
  front, wind shift at 15:00, four spots, resource states, trigger clocks and
  an analyst log. Fire behaviour is invented for training.
- `fallback.json` - authored weather, air quality and empty alert state used
  only when a live request fails or the page is opened with `?sim=1`.

The page fetches these live, keyless feeds at runtime:

- Open-Meteo forecast and 92-day history (weather, soil moisture, elevation)
- Open-Meteo Air Quality (PM2.5, PM10, EAQI, US AQI)
- NWS active alerts for the anchor point
- kanari.io 6-hour thermal detections (**Source: kanari.io**, CC BY 4.0)

Register with `node specs/_tests/make-spotfire-data.mjs`.

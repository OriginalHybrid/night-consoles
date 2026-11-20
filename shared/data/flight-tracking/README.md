# Flight tracking data

Fallback and global-background data for the `flight-tracking` theme.

## Files

- `flights.json` - 110 simulated global flights, 8 region presets, and the default region.
- `../../assets/flight-tracking/airports.json` - curated major-airport coordinates.
- `../../assets/flight-tracking/aircraft-types.json` - aircraft type, capacity, range, and geometry metadata for the 3D hologram.
- `../../assets/flight-tracking/world-50m.geojson` - Natural Earth 50m land.
- `../../assets/flight-tracking/borders-50m.geojson` - Natural Earth 50m admin boundaries.
- `../../assets/flight-tracking/india-official-simplified.geojson` - India official-boundary overlay, simplified from the DataMeet India composite.
- `../../specs/_tests/make-flight-tracking-data.mjs` - deterministic generator.

## Live data

The theme queries AvioADSB directly from the browser:

```text
https://avioadsb.org/v1/point/{lat}/{lon}/100
```

AvioADSB sends `Access-Control-Allow-Origin: *` and does not require a key.
Anonymous limits are 1 request every 10 seconds and 100 requests per day.
Point queries cover up to 100 nautical miles.

The global map remains simulated. Only the selected region is replaced with live
aircraft. `?live=off` forces the baked dataset.

Route metadata is looked up from:

```text
https://api.adsbdb.com/v0/callsign/{callsign}
```

Airport and route values are demo data. Live positions are attributed to
AvioADSB; land outlines are Natural Earth public-domain data.

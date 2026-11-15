# GYRE WATCH data

`fallback.json` is the archive storm used when no live tropical cyclone is available.
It reconstructs Hurricane Ian on 2022-09-27 from a NOAA/NASA GIBS VIIRS NOAA-20
brightness-temperature image. The image is in `assets/gyre-watch/ian-2022-ir.png`.

Live mode uses:

- MaverickWX `active.json` and per-storm manifests, sourced from NOAA/NHC and JTWC.
- NASA GIBS WMTS/WMS GOES-East, GOES-West, and Himawari IR imagery.
- Iowa Environmental Mesonet NEXRAD WMS where a live US radar view is available.
- Open-Meteo pressure-level data for the aerostat/sounding panels.

The fallback is explicitly labelled ARCHIVE and is not a live observation.
It also carries a baked Open-Meteo archive surface observation for
2022-09-27 18:00Z so SIM/offline mode has a populated airmass panel.

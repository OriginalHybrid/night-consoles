# SOUNDING — synthetic acoustic datasets

These files are **authored synthetic data**, not measurements. They drive the
echogram and sector-sonar panels of the SOUNDING theme.

- `echogram.json` — 720 pings x 280 bins over 1400 m (5 m bins), 0.25 s/ping.
  `sv_db` is relative backscatter in dB re 1 m-1. A bright surface layer, four
  thin wavy scattering layers, a rising biomass mass on the right, sparse fish
  schools and a rugged 1,280 m seafloor, with fine speckle throughout.
- `echogram.csv` — the same matrix, one row per ping/depth sample, for inspection.
- `sonar.json` — 600 frames at 10 Hz (60 s) for a 120-degree
  forward sector (214 deg centre, 8 km range), seven drifting contacts,
  and the paired edge series used by the cross-correlation readout (r = 0.978).

Regenerate with `node specs/_tests/make-sounding-data.mjs`.

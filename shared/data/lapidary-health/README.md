# LAPIDARY HEALTH data

Mock preventive-lab payload for the `lapidary-health` theme.

## Source

Clean-room mock data assembled from the requested full-body panel categories:
vitals, CBC, LFT, KFT, glucose, lipid, thyroid, vitamins, and urinalysis.
The patient, values, trends, and follow-up tasks are fictional.

## Files

- `health.json` — generated payload.
- `../../specs/_tests/make-lapidary-health-data.mjs` — deterministic generator.

## Notes

- Reference ranges are demo values; real ranges vary by laboratory, age, and sex.
- Flags are informational UI states, not diagnoses.
- The data is intentionally single-patient and cross-sectional, with short mock
  trend arrays for the endocrine/micronutrient trace.
- Featured cards: LDL, Vitamin D, Ferritin.

# ISODOSE scan assets

These files are optional layers for `themes/isodose.html`. The default scene uses only the procedural SDF anatomy; `HOLO BRAIN` and `SCAN SKULL` load these assets lazily.

## Files

- `brain.bin` — decimated FreeSurfer pial surface, 50,000 faces.
- `skull.bin` — decimated CT bone surface, 60,000 faces.
- `eyes.bin` — CT-assisted globe ellipsoids.
- `lenses.bin` — CT-assisted lens ellipsoids.
- `pet.bin` — 9,000 sparse FDG PET metabolic points.

## Sources and licenses

- **Brain surface:** OpenNeuro `ds003563`, subject `sub-yv98`, FreeSurfer pial surfaces. Dataset license: CC0.
  - OpenNeuro: https://openneuro.org/datasets/ds003563
- **FDG PET:** OpenNeuro `ds006917`, subject `sub-004`, `ses-nx`, FDG run 01. Dataset license: CC0.
  - OpenNeuro: https://openneuro.org/datasets/ds006917
- **Cranial CT:** “CT Dataset of a Human Head”, Hunold, Güllmar, Haueisen (2019), Zenodo record 3374839. License: CC BY 4.0.
  - Zenodo: https://zenodo.org/records/3374839
- **Segmentation / mesh extraction:** the committed meshes were extracted with Python, `nibabel`, `scikit-image`, and `trimesh`. The CT skull is a bone-threshold surface; the globes/lenses are CT-assisted ellipsoid fits.

## Processing

Run `specs/_tests/make-isodose-assets.py` with the source files in a local directory:

```bash
python specs/_tests/make-isodose-assets.py --src /path/to/isodose-assets --out assets/isodose
```

The script expects:

- `lh.pial`, `rh.pial`
- `PhantomCT.nii`
- `sub-004_ses-nx_trc-fdg_run-01_pet.nii.gz`

It transforms the CT surface through the NIfTI affine into patient coordinates, maps LPS to the ISODOSE frame (`x` left, `y` anterior, `z` superior, millimetres), applies a uniform scale so the skull proportions are preserved, decimates, and writes compact binary files.

## Important limitations

- The MRI brain and PET are from different open subjects than the CT skull. The layers are aligned to the ISODOSE reference frame for visual composition, not for clinical registration.
- The PET layer is a sparse illustrative metabolic field, not a quantitative SUV map.
- The CT globe/lens assets are CT-assisted ellipsoid fits, not raw organ segmentations.
- These assets are for a fictional interface study. They are not medical devices and must not be used for diagnosis, treatment planning, or clinical decisions.

## Attribution

If you reuse the rendered scene or assets, retain the dataset citations above and the Night Consoles/ISODOSE attribution.

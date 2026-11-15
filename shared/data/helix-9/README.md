# HELIX-9 data

Baked fallback payload for the `helix-9` genome-deck theme.

- 201 bp GRCh38 window at `chr17:43,044,295-43,044,495`.
- Deterministic sequence, five demo variants, gene models, coverage, conservation, expression, QC, and log lines.
- Deterministic generator: `specs/_tests/make-helix-9-data.mjs`.

## Live sources

The theme renders a Three.js organic DNA viewport with amber/cream strands, base-pair fibers, nucleotide spheres, protein clusters, nerve filaments, floating blobs, 3D labels, and a cinematic camera loop.

The theme loads the baked JSON first, then attempts keyless live requests:

- Ensembl REST sequence: `https://rest.ensembl.org/sequence/region/human/...`
- Ensembl REST genes: `https://rest.ensembl.org/overlap/region/human/...?feature=gene`
- Ensembl REST variants: `https://rest.ensembl.org/overlap/region/human/...?feature=variation`
- UCSC refGene: `https://api.genome.ucsc.edu/getData/track?genome=hg38;track=refGene;...`

Each source is independent. Successful responses replace that source and update
the top-level `LIVE / PARTIAL` state. Failures leave the baked values in place.
Use `?live=off` for deterministic screenshots or offline demos.

All variants, consequences, expression values, and clinical labels are demo data
for interface design. This is not a clinical or diagnostic tool.

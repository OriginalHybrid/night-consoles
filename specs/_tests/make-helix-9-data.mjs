import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shared/data/helix-9/genome.json');
const CHROM = '17';
const START = 43044295;
const END = 43044495;
const N = END - START + 1;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x48454C495839);
const round = (v, d = 2) => Number(v.toFixed(d));
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

function makeSequence(n) {
  const gc = 'GC';
  const at = 'AT';
  let s = '';
  for (let i = 0; i < n; i++) {
    const useGc = rnd() < 0.412;
    s += useGc ? gc[Math.floor(rnd() * 2)] : at[Math.floor(rnd() * 2)];
  }
  return s;
}
const sequence = makeSequence(N);
const baseAt = (pos) => sequence[pos - START];
const altFor = (ref) => {
  const all = 'ATGC';
  const idx = all.indexOf(ref);
  return all[(idx + 1 + Math.floor(rnd() * 3)) % 4];
};

const variantSpecs = [
  { pos: START + 37, gene: 'RND2', consequence: "3 prime UTR variant", impact: 'LOW', clinical: 'BENIGN', frequency: 0.412 },
  { pos: START + 74, gene: 'BRCA1', consequence: 'missense variant', impact: 'MODERATE', clinical: 'NOT REPORTED', frequency: 0.008 },
  { pos: START + 108, gene: 'BRCA1', consequence: 'synonymous variant', impact: 'LOW', clinical: 'BENIGN', frequency: 0.184 },
  { pos: START + 132, gene: 'BRCA1', consequence: 'stop gained', impact: 'HIGH', clinical: 'UNCERTAIN', frequency: 0.001 },
  { pos: START + 169, gene: 'BRCA1', consequence: 'intron variant', impact: 'MODIFIER', clinical: 'NOT REPORTED', frequency: 0.061 }
];

const variants = variantSpecs.map((v, i) => {
  const ref = baseAt(v.pos);
  return {
    id: 'rs' + String(187400000 + Math.floor(rnd() * 9999999)),
    pos: v.pos,
    ref,
    alt: altFor(ref),
    gene: v.gene,
    consequence: v.consequence,
    impact: v.impact,
    clinical: v.clinical,
    frequency: v.frequency,
    source: i % 2 ? 'dbSNP' : 'Ensembl',
    selected: i === 3
  };
});

const genes = [
  {
    name: 'RND2', id: 'ENSG00000108830', strand: 1, biotype: 'protein_coding',
    absStart: 43025210, absEnd: 43047509,
    segments: [[0, 19], [43, 62], [79, 97]],
    description: 'Rho family GTPase 2'
  },
  {
    name: 'BRCA1', id: 'ENSG00000012048', strand: -1, biotype: 'protein_coding',
    absStart: 43044295, absEnd: 43125483,
    segments: [[70, 91], [109, 135], [157, 200]],
    description: 'BRCA1 DNA repair associated'
  },
  {
    name: 'NBR2', id: 'ENSG00000266964', strand: 1, biotype: 'lncRNA',
    absStart: 43053340, absEnd: 43070000,
    segments: [[121, 143], [169, 200]],
    description: 'Neighbor of BRCA1 lncRNA'
  }
];

const coverage = Array.from({ length: N }, (_, i) => {
  const peak1 = 24 * Math.exp(-Math.pow((i - 82) / 21, 2));
  const peak2 = 18 * Math.exp(-Math.pow((i - 163) / 17, 2));
  return Math.max(4, Math.round(13 + peak1 + peak2 + rnd() * 9));
});

const conservation = Array.from({ length: N }, (_, i) => {
  const exon = (i >= 70 && i <= 91) || (i >= 109 && i <= 135) || (i >= 157 && i <= 200);
  return round(Math.max(0, Math.min(1, (exon ? 0.58 : 0.24) + Math.sin(i * 0.19) * 0.12 + rnd() * 0.2)), 3);
});

const expression = [
  { tissue: 'BREAST', tpm: 18.4 },
  { tissue: 'OVARY', tpm: 14.1 },
  { tissue: 'PROSTATE', tpm: 9.8 },
  { tissue: 'COLON', tpm: 7.2 },
  { tissue: 'LUNG', tpm: 5.6 },
  { tissue: 'LIVER', tpm: 2.1 }
];

const scores = { affinity: 0.84, toxicity: 0.12, binding: 0.91, rmsd: 2.4 };


const qc = {
  meanDepth: 31.4,
  gc: 0.412,
  q30: 0.941,
  mapq: 0.987,
  duplicate: 0.031,
  insert: 412
};

const log = [
  ['00:00', 'LOAD', 'GRCh38 reference window acquired'],
  ['00:01', 'MAP', '201 bp aligned to chr17'],
  ['00:02', 'CALL', '5 variants retained after filter'],
  ['00:03', 'ANNOT', 'BRCA1 transcript models projected'],
  ['00:04', 'QC', 'mean depth 31.4x / Q30 94.1%'],
  ['00:05', 'VIEW', 'helix camera locked to selected locus'],
  ['00:06', 'NOTE', 'research visualization / not clinical']
];

const genome = {
  sample: {
    id: 'HG-0427',
    assay: 'WGS 30x',
    build: 'GRCh38',
    locus: 'chr17:43,044,295-43,044,495',
    gene: 'BRCA1 / RND2',
    lab: 'HELIX-9 GENOME DECK',
    protocol: 'RESEARCH DEMO'
  },
  window: {
    chrom: CHROM,
    start: START,
    end: END,
    bp: N,
    sequence
  },
  genes,
  variants,
  coverage,
  conservation,
  expression,
  scores,
  qc,
  log
};

fs.writeFileSync(OUT, JSON.stringify(genome, null, 2) + '\n');
console.log('wrote ' + OUT + ' (' + N + ' bp, ' + variants.length + ' variants)');

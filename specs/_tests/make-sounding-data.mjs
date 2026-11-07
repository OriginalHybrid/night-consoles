// Generates the authored (synthetic) acoustic datasets for the SOUNDING theme.
// Deterministic: same seed -> same files. Nothing here is measured data.
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/Work/project-plans/uispace/shared/data/sounding';
fs.mkdirSync(OUT, { recursive: true });

let seed = 0x5eed1a7;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const n = (s) => (rnd() * 2 - 1) * s;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const smooth = (x) => x * x * (3 - 2 * x);

/* ---------------------------------------------------------------- echogram
   720 pings x 280 depth bins over 0-1400 m (5 m bins), 0.25 s/ping (180 s).
   Fine amber speckle: a bright surface layer, four thin wavy scattering
   layers, a rising biomass mass on the right, sparse fish schools and a
   rugged 1,280 m seafloor. Periodic in ping so the replay loops cleanly. */
const PINGS = 720, BINS = 280, DMAX = 1400, STEP = 0.25;
const TAU = Math.PI * 2;
const wig = (p, base, amp, cycles, phase) => base + amp * Math.sin(p / PINGS * TAU * cycles + (phase || 0));

const bottomAt = (p) => wig(p, 1282, 26, 2, .4) + 9 * Math.sin(p / PINGS * TAU * 9) + n(3);
const layers = [
  { d: (p) => wig(p, 180, 14, 3, 0.0), s: 16, w: 7, j: 2 },
  { d: (p) => wig(p, 420, 20, 2, 1.2), s: 12, w: 8, j: 2 },
  { d: (p) => wig(p, 630, 16, 3, 2.1), s: 18, w: 6, j: 2 },
  { d: (p) => wig(p, 810, 22, 2, 0.7), s: 10, w: 10, j: 3 }
];
const massP0 = 430, massP1 = 705;
const massRidge = (p) => {
  const t = clamp((p - massP0) / (massP1 - massP0), 0, 1);
  return 1290 - 1000 * Math.pow(t, .72) + 40 * Math.sin(t * 5) + n(3);
};
const schools = [
  { p: 120, d: 340, w: 8, hp: 18, s: 20 },
  { p: 250, d: 900, w: 12, hp: 14, s: 16 },
  { p: 640, d: 520, w: 9, hp: 16, s: 22 }
];

const pings = [];
for (let p = 0; p < PINGS; p++) {
  const bottom = bottomAt(p);
  const massOn = p > massP0 - 40 && p < massP1 + 12;
  const mr = massRidge(p);
  const massEnv = massOn ? Math.exp(-Math.pow((p - (massP0 + massP1) / 2) / 110, 2)) : 0;
  const sv = [];
  for (let k = 0; k < BINS; k++) {
    const d = (k + 0.5) * (DMAX / BINS);
    let v = -89 + n(2.8);
    /* sparse speckle cells through the water column */
    if (rnd() < 0.0035) v += 9 + rnd() * 14;
    /* surface layer */
    v += 20 * Math.exp(-((d - 10) ** 2) / (2 * 9 ** 2)) * (.75 + .5 * rnd());
    /* thin wavy scattering layers */
    for (const L of layers) {
      const ld = L.d(p);
      v += L.s * Math.exp(-((d - ld) ** 2) / (2 * L.w ** 2)) * (.55 + .5 * rnd());
    }
    /* fish schools */
    for (const S of schools) {
      v += S.s * Math.exp(-((d - S.d) ** 2) / (2 * S.w ** 2)) * Math.exp(-((p - S.p) ** 2) / (2 * S.hp ** 2));
    }
    /* the rising mass on the right */
    if (massOn) {
      v += 26 * massEnv * Math.exp(-((d - mr) ** 2) / (2 * 82 ** 2));
      v += 14 * massEnv * Math.exp(-((d - (mr + 80)) ** 2) / (2 * 170 ** 2));
      if (rnd() < 0.12 * massEnv) v += 8 + rnd() * 14;
    }
    /* seafloor + sub-bottom */
    if (d >= bottom) v = -18 + 3 * Math.sin(d * 0.3) + n(2.2) - Math.min(70, (d - bottom) * 2.6);
    sv.push(clamp(Math.round(v), -92, -16));
  }
  pings.push({ t: round(p * STEP, 2), bottom_m: round(bottom, 1), sv });
}

const depths = Array.from({ length: BINS }, (_, k) => round((k + 0.5) * (DMAX / BINS), 1));
const echoMeta = {
  synthetic: true, generated: new Date().toISOString().slice(0, 10),
  pings: PINGS, bins: BINS, depth_min_m: 0, depth_max_m: DMAX, bin_m: DMAX / BINS,
  ping_interval_s: STEP, duration_s: round(PINGS * STEP, 1),
  frequency_khz: 38, transducer: 'split-beam', sv_db: 'dB re 1 m-1',
  notes: 'Authored echo sounder field: bright surface layer, four scattering layers, a rising biomass mass (pings 430-705), sparse schools, rugged 1,280 m seafloor, fine speckle.'
};
fs.writeFileSync(path.join(OUT, 'echogram.json'), JSON.stringify({ meta: echoMeta, depths, pings }));

const csv = ['ping,time_s,depth_m,sv_db'];
for (let p = 0; p < PINGS; p++) for (let k = 0; k < BINS; k++) csv.push(`${p},${round(p * STEP, 2)},${depths[k]},${pings[p].sv[k]}`);
fs.writeFileSync(path.join(OUT, 'echogram.csv'), csv.join('\n') + '\n');

/* ---------------------------------------------------------------- sector sonar
   600 frames at 10 Hz (60 s). Six contacts drift; the sweep crosses the
   120-degree forward sector from 154 to 274 degrees (centre 214). */
const FRAMES = 600, HZ = 10, RANGE_KM = 8, SECTOR = 120, CENTRE = 214;
const tracks = Array.from({ length: 7 }, (_, i) => ({
  r0: 1.4 + rnd() * 5.6,
  b0: CENTRE - SECTOR / 2 + 6 + i * (SECTOR - 12) / 6 + n(3),
  dr: n(0.22), db: n(0.55),
  strength: -46 + rnd() * 14,
  size: 18 + rnd() * 78
}));

const frames = [];
for (let f = 0; f < FRAMES; f++) {
  const t = round(f / HZ, 1);
  const sweep = 154 + ((f % 120) / 120) * SECTOR;
  const contacts = tracks.map((c, i) => {
    const r = clamp(c.r0 + c.dr * Math.sin(t * 0.09 + i), 0.6, RANGE_KM * 0.96);
    const b = c.b0 + c.db * Math.sin(t * 0.06 + i * 1.7);
    const nearSweep = 1 - Math.min(1, Math.abs(((b - sweep + 540) % 360) - 180) / 60);
    return {
      range_km: round(r, 2), bearing_deg: round(b, 1),
      strength_db: round(c.strength + 6 * nearSweep + n(1.5), 1),
      size_m: round(c.size, 0)
    };
  }).filter((c) => c.bearing_deg > 154 && c.bearing_deg < 274);
  frames.push({ t, sweep_deg: round(sweep, 1), contacts });
}

/* paired edge series for the correlation panel (60 s, 10 Hz) */
const seriesA = [], seriesB = [];
for (let f = 0; f < FRAMES; f++) {
  const a = Math.sin(f * 0.11) + 0.45 * Math.sin(f * 0.037 + 1.1) + n(0.22);
  seriesA.push(round(a, 3));
  seriesB.push(round(0.94 * a + 0.18 * Math.sin(f * 0.02 + 0.4) + n(0.14), 3));
}
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const ma = mean(seriesA), mb = mean(seriesB);
let num = 0, da = 0, db = 0;
for (let i = 0; i < FRAMES; i++) { num += (seriesA[i] - ma) * (seriesB[i] - mb); da += (seriesA[i] - ma) ** 2; db += (seriesB[i] - mb) ** 2; }
const r = num / Math.sqrt(da * db);

const sonarMeta = {
  synthetic: true, generated: new Date().toISOString().slice(0, 10),
  frames: FRAMES, hz: HZ, duration_s: round(FRAMES / HZ, 1),
  range_km: RANGE_KM, sector_deg: SECTOR, centre_deg: CENTRE,
  frequency_khz: 26, tilt_deg: -2.0, heading_deg: CENTRE,
  intercept_km: 3.21, shelf_extent: '> 8 km all bearings',
  edges: [{ name: 'W · TALLOW', range_km: 20.1, bearing_deg: 270 }, { name: 'E · CAIRN', range_km: 19.8, bearing_deg: 90 }],
  correlation: { r: round(r, 4), lag_s: 0.0, n: FRAMES, n_eff: 44, window_min: 20 }
};
fs.writeFileSync(path.join(OUT, 'sonar.json'), JSON.stringify({
  meta: sonarMeta, frames, corr: { seriesA, seriesB }
}));

fs.writeFileSync(path.join(OUT, 'README.md'), `# SOUNDING — synthetic acoustic datasets

These files are **authored synthetic data**, not measurements. They drive the
echogram and sector-sonar panels of the SOUNDING theme.

- \`echogram.json\` — ${PINGS} pings x ${BINS} bins over ${DMAX} m (${DMAX / BINS} m bins), ${STEP} s/ping.
  \`sv_db\` is relative backscatter in dB re 1 m-1. A bright surface layer, four
  thin wavy scattering layers, a rising biomass mass on the right, sparse fish
  schools and a rugged 1,280 m seafloor, with fine speckle throughout.
- \`echogram.csv\` — the same matrix, one row per ping/depth sample, for inspection.
- \`sonar.json\` — ${FRAMES} frames at ${HZ} Hz (${FRAMES / HZ} s) for a ${SECTOR}-degree
  forward sector (${CENTRE} deg centre, ${RANGE_KM} km range), seven drifting contacts,
  and the paired edge series used by the cross-correlation readout (r = ${round(r, 3)}).

Regenerate with \`node specs/_tests/make-sounding-data.mjs\`.
`);

console.log('wrote', OUT);
console.log('echogram', PINGS * BINS, 'samples; sonar', FRAMES, 'frames; r =', round(r, 3));

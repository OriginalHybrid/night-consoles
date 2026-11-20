// Generates the deterministic DECLINATION model data:
//   shared/data/declination/model.json       IGRF-14 2025 coefficients, dip poles, ports, pole history
//   shared/data/declination/field-lines.json baked RK4 field-line cage for the hero canvas
//
// Source coefficients: IGRF-14 (IAGA / NOAA NCEI), igrf14coeffs.txt, 2024-11-18.
// This script has no network dependency; it reads the committed coefficient table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'shared/data/declination');
const RAW = path.join(DATA, 'igrf14coeffs.txt');
const DEG = Math.PI / 180;
const NMAX = 13;
const S = NMAX + 1;
const R_E = 6371.2;
const MODEL_YEAR = 2026.0;
const OUT_MODEL = path.join(DATA, 'model.json');
const OUT_LINES = path.join(DATA, 'field-lines.json');

const raw = fs.readFileSync(RAW, 'utf8').split(/\r?\n/);
const header = raw.find((l) => l.trim().startsWith('g/h')).trim().split(/\s+/);
const years = header.slice(3, -1).map(Number);
const svIndex = header.length - 1;

function parseCoefs() {
  const table = [];
  for (const line of raw) {
    const t = line.trim().split(/\s+/);
    if (t[0] !== 'g' && t[0] !== 'h') continue;
    const n = +t[1], m = +t[2];
    if (!(n >= 1 && n <= NMAX)) continue;
    const vals = t.slice(3).map(Number);
    table.push({ kind: t[0], n, m, vals });
  }
  return table;
}
const TABLE = parseCoefs();

function coefsForYear(year) {
  const g = Array.from({ length: NMAX + 1 }, () => new Float64Array(NMAX + 1));
  const h = Array.from({ length: NMAX + 1 }, () => new Float64Array(NMAX + 1));
  const idx = years.indexOf(year);
  if (idx >= 0) {
    for (const r of TABLE) (r.kind === 'g' ? g : h)[r.n][r.m] = r.vals[idx];
  } else {
    const base = years.indexOf(2025.0);
    const dt = year - 2025.0;
    for (const r of TABLE) {
      const v = r.vals[base] + (r.vals[svIndex] || 0) * dt;
      (r.kind === 'g' ? g : h)[r.n][r.m] = v;
    }
  }
  return { g, h };
}
const C2026 = coefsForYear(MODEL_YEAR);

const P = new Float64Array(S * S);
const DP = new Float64Array(S * S);
function legendre(theta) {
  const s = Math.sin(theta), c = Math.cos(theta);
  P.fill(0); DP.fill(0);
  P[0] = 1;
  P[S] = c; DP[S] = -s;
  P[S + 1] = s; DP[S + 1] = c;
  for (let n = 2; n <= NMAX; n++) {
    const ro = n * S, r1 = (n - 1) * S, r2 = (n - 2) * S;
    for (let m = 0; m <= n; m++) {
      let p, dp;
      if (m === n) {
        const f = Math.sqrt((2 * n - 1) / (2 * n));
        p = f * s * P[r1 + m - 1];
        dp = f * (c * P[r1 + m - 1] + s * DP[r1 + m - 1]);
      } else if (m === n - 1) {
        const f = Math.sqrt(2 * n - 1);
        p = f * c * P[r1 + m];
        dp = f * (-s * P[r1 + m] + c * DP[r1 + m]);
      } else {
        const A = 2 * n - 1, B = Math.sqrt((n - 1) * (n - 1) - m * m), C = Math.sqrt(n * n - m * m);
        p = (A * c * P[r1 + m] - B * P[r2 + m]) / C;
        dp = (A * (-s * P[r1 + m] + c * DP[r1 + m]) - B * DP[r2 + m]) / C;
      }
      P[ro + m] = p; DP[ro + m] = dp;
    }
  }
}

const FB = { bx: 0, by: 0, bz: 0, br: 0, b: 0 };
function fieldCart(x, y, z, coeff) {
  const r = Math.hypot(x, y, z);
  if (!(r > 0)) return FB;
  const st = Math.hypot(x, y) / r, ct = z / r;
  const ph = Math.atan2(y, x), cp = Math.cos(ph), sp = Math.sin(ph);
  legendre(Math.acos(clamp(ct, -1, 1)));
  let Br = 0, Bt = 0, Bp = 0;
  for (let n = 1; n <= NMAX; n++) {
    const rr = Math.pow(1 / r, n + 2), ro = n * S;
    for (let m = 0; m <= n; m++) {
      const cosM = Math.cos(m * ph), sinM = Math.sin(m * ph);
      const gv = coeff.g[n][m], hv = coeff.h[n][m];
      const c = gv * cosM + hv * sinM;
      Br += (n + 1) * rr * c * P[ro + m];
      Bt -= rr * c * DP[ro + m];
      if (m > 0) Bp += rr * m * (gv * sinM - hv * cosM) * P[ro + m] / (st || 1e-12);
    }
  }
  const erx = st * cp, ery = st * sp, erz = ct;
  const etx = ct * cp, ety = ct * sp, etz = -st;
  const epx = -sp, epy = cp, epz = 0;
  FB.bx = Br * erx + Bt * etx + Bp * epx;
  FB.by = Br * ery + Bt * ety + Bp * epy;
  FB.bz = Br * erz + Bt * etz + Bp * epz;
  FB.br = Br;
  FB.b = Math.hypot(FB.bx, FB.by, FB.bz);
  return FB;
}
function fieldAt(lat, lon, r, coeff) {
  const la = lat * DEG, lo = lon * DEG, cl = Math.cos(la);
  return fieldCart(cl * Math.cos(lo) * r, cl * Math.sin(lo) * r, Math.sin(la) * r, coeff);
}
function declination(lat, lon, coeff) {
  const la = lat * DEG, lo = lon * DEG;
  const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const b = fieldCart(p[0], p[1], p[2], coeff);
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const X = b.bx * north[0] + b.by * north[1] + b.bz * north[2];
  const Y = b.bx * east[0] + b.by * east[1] + b.bz * east[2];
  return Math.atan2(Y, X) / DEG;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function wrap180(d) { return ((d % 360) + 540) % 360 - 180; }
function n3(v) { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }
function llOf(p) { return [Math.asin(clamp(p[2], -1, 1)) / DEG, Math.atan2(p[1], p[0]) / DEG]; }
function tangentBasis(p) {
  const a = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = n3([p[1] * a[2] - p[2] * a[1], p[2] * a[0] - p[0] * a[2], p[0] * a[1] - p[1] * a[0]]);
  return [e1, [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]]];
}
function hTan(p, e1, e2, coeff) {
  const b = fieldCart(p[0], p[1], p[2], coeff);
  return [b.bx * e1[0] + b.by * e1[1] + b.bz * e1[2], b.bx * e2[0] + b.by * e2[1] + b.bz * e2[2]];
}
function refinePole(p0, coeff) {
  let p = n3(p0);
  for (let it = 0; it < 60; it++) {
    const [e1, e2] = tangentBasis(p), h0 = hTan(p, e1, e2, coeff), d = 1e-7;
    const ha = hTan(n3([p[0] + d * e1[0], p[1] + d * e1[1], p[2] + d * e1[2]]), e1, e2, coeff);
    const hb = hTan(n3([p[0] + d * e2[0], p[1] + d * e2[1], p[2] + d * e2[2]]), e1, e2, coeff);
    const a = (ha[0] - h0[0]) / d, b = (hb[0] - h0[0]) / d;
    const c = (ha[1] - h0[1]) / d, e = (hb[1] - h0[1]) / d;
    const det = a * e - b * c;
    if (!(Math.abs(det) > 1e-10)) break;
    let s1 = -(e * h0[0] - b * h0[1]) / det, s2 = -(-c * h0[0] + a * h0[1]) / det;
    const m = Math.hypot(s1, s2);
    if (m > .02) { s1 *= .02 / m; s2 *= .02 / m; }
    p = n3([p[0] + s1 * e1[0] + s2 * e2[0], p[1] + s1 * e1[1] + s2 * e2[1], p[2] + s1 * e1[2] + s2 * e2[2]]);
    if (m < 1e-12) break;
  }
  return p;
}
function findPole(coeff, north) {
  let best = null, bestH = Infinity;
  for (let la = north ? 55 : -89; la <= (north ? 89 : -55); la += 2) {
    for (let lo = -180; lo < 180; lo += 3) {
      const b = fieldAt(la, lo, 1, coeff);
      // horizontal magnitude from Cartesian: sqrt(|B|² - Br²)
      const hh = Math.sqrt(Math.max(0, b.b * b.b - b.br * b.br));
      if (hh < bestH) { bestH = hh; best = [Math.cos(la * DEG) * Math.cos(lo * DEG), Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG)]; }
    }
  }
  return refinePole(best, coeff);
}

const poles = {
  north: llOf(findPole(C2026, true)),
  south: llOf(findPole(C2026, false))
};

const PORTS = [
  ['ROTTERDAM', 51.95, 4.14], ['SINGAPORE', 1.29, 103.85], ['CAPE TOWN', -33.92, 18.42],
  ['VALPARAISO', -33.05, -71.62], ['BUENOS AIRES', -34.60, -58.38], ['NEW YORK', 40.70, -74.00],
  ['SAN FRANCISCO', 37.77, -122.42], ['TOKYO', 35.68, 139.69], ['SYDNEY', -33.87, 151.21],
  ['MUMBAI', 19.08, 72.88], ['DUBAI', 25.20, 55.27], ['HAMBURG', 53.55, 9.99],
  ['PANAMA', 8.98, -79.52], ['RIO DE JANEIRO', -22.91, -43.17], ['REYKJAVIK', 64.15, -21.94],
  ['HONOLULU', 21.31, -157.86], ['ANCHORAGE', 61.22, -149.90], ['WELLINGTON', -41.29, 174.78]
].map(([name, lat, lon]) => {
  const d26 = wrap180(declination(lat, lon, C2026));
  const d25 = wrap180(declination(lat, lon, coefsForYear(2025.0)));
  return { name, lat, lon, declination: +d26.toFixed(2), drift: +wrap180(d26 - d25).toFixed(2) };
});

const HISTORY_YEARS = [1900, 1925, 1950, 1975, 2000, 2025];
const poleHistory = { years: HISTORY_YEARS, north: [], south: [] };
for (const y of HISTORY_YEARS) {
  const c = coefsForYear(y);
  poleHistory.north.push(llOf(findPole(c, true)).map((v) => +v.toFixed(2)));
  poleHistory.south.push(llOf(findPole(c, false)).map((v) => +v.toFixed(2)));
}

// ---- field lines ---------------------------------------------------------------------------
const N_LINES = 260, R_MAX = 5.1, MAXN = 240, STEP = .028;
const S_M = (function seeds() {
  const n = 12000, ga = Math.PI * (3 - Math.sqrt(5)), cand = [], w = [];
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const z = 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - z * z), a = i * ga;
    const p = [r * Math.cos(a), r * Math.sin(a), z];
    const b = fieldCart(p[0], p[1], p[2], C2026);
    const v = Math.pow(Math.max(0, b.br), .82);
    cand.push(p); w.push(v); tot += v;
  }
  const out = []; let acc = 0, j = 0; const step = tot / N_LINES;
  for (let i = 0; i < n && j < N_LINES; i++) {
    acc += w[i];
    while (acc >= (j + .5) * step && j < N_LINES) { out.push(cand[i]); j++; }
  }
  return out;
})();
const B = { bx: 0, by: 0, bz: 0, br: 0, b: 0 };
function unitField(x, y, z, coeff, sign) {
  const b = fieldCart(x, y, z, coeff);
  const m = Math.hypot(b.bx, b.by, b.bz) || 1;
  return [b.bx / m * sign, b.by / m * sign, b.bz / m * sign];
}
function traceLine(seed) {
  const b0 = fieldCart(seed[0], seed[1], seed[2], C2026);
  const sign = b0.br >= 0 ? 1 : -1;
  let x = seed[0] * 1.001, y = seed[1] * 1.001, z = seed[2] * 1.001;
  const pts = [];
  let apex = 0, rmax = 1;
  for (let k = 0; k < MAXN; k++) {
    const r = Math.sqrt(x * x + y * y + z * z);
    pts.push([x, y, z]);
    const ds = STEP * Math.min(r, 2.4);
    const k1 = unitField(x, y, z, C2026, sign);
    const k2 = unitField(x + .5 * ds * k1[0], y + .5 * ds * k1[1], z + .5 * ds * k1[2], C2026, sign);
    const k3 = unitField(x + .5 * ds * k2[0], y + .5 * ds * k2[1], z + .5 * ds * k2[2], C2026, sign);
    const k4 = unitField(x + ds * k3[0], y + ds * k3[1], z + ds * k3[2], C2026, sign);
    const nx = x + ds / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const ny = y + ds / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    const nz = z + ds / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    const nr = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nr > rmax) { rmax = nr; apex = pts.length; }
    if (nr < 1 && pts.length > 8) {
      const t = (r - 1) / Math.max(1e-6, r - nr);
      pts.push([x + (nx - x) * t, y + (ny - y) * t, z + (nz - z) * t]);
      break;
    }
    if (nr > R_MAX) { pts.push([nx, ny, nz]); break; }
    x = nx; y = ny; z = nz;
  }
  if (pts.length < 4) return null;
  const lev = clamp(Math.round((Math.log(Math.max(1, b0.b)) - Math.log(20000)) / (Math.log(65000) - Math.log(20000)) * 5), 0, 5);
  return { p: pts.flatMap((p) => p.map((v) => +v.toFixed(4))), a: apex, l: lev, r: +rmax.toFixed(3) };
}
const lines = [];
for (const s of S_M) { const line = traceLine(s); if (line) lines.push(line); }

const model = {
  meta: {
    model: 'IGRF-14', epoch: 2025.0, sample_year: MODEL_YEAR, valid: '2025.0–2030.0',
    radius_km: R_E, source: 'IAGA / NOAA NCEI igrf14coeffs.txt (2024-11-18)',
    note: 'Internal geomagnetic field model. The extended field-line cage is a visual magnetosphere, not a full MHD simulation.'
  },
  coefficients: {
    maxDegree: NMAX,
    g: TABLE.filter((r) => r.kind === 'g').map((r) => [r.n, r.m, r.vals[years.indexOf(2025.0)], r.vals[svIndex]]),
    h: TABLE.filter((r) => r.kind === 'h').map((r) => [r.n, r.m, r.vals[years.indexOf(2025.0)], r.vals[svIndex]])
  },
  poles: { north: poles.north.map((v) => +v.toFixed(2)), south: poles.south.map((v) => +v.toFixed(2)) },
  ports: PORTS,
  poleHistory
};

fs.writeFileSync(OUT_MODEL, JSON.stringify(model));
fs.writeFileSync(OUT_LINES, JSON.stringify({ meta: { count: lines.length, source: model.meta.source, model: 'IGRF-14', sample_year: MODEL_YEAR }, lines }));
console.log('wrote', OUT_MODEL, fs.statSync(OUT_MODEL).size, 'bytes');
console.log('wrote', OUT_LINES, fs.statSync(OUT_LINES).size, 'bytes');
console.log('poles', model.poles);
console.log('ports', model.ports.map((p) => p.name + ' ' + p.declination).join(', '));

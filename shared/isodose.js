// scenescapes/isodose.js
//
// ISODOSE — Kellan Institute, Radiation Oncology, planning workstation 2 (channel 62).
// Spec: docs/specs/isodose.md. Lore: lib/fui/lore-content.js 'isodose'.
// Paradigm: a treatment-planning system drawn as a figure from a medical-physics paper.
// HALF B: the hero is a 3-D body — a head volume rendered in software on a 2-D canvas
// (perspective projection, per-face key + fill light, Fresnel translucency, back-face
// dimming, a painter's order) with the plan's isodose shells nested inside it. The 2-D
// chrome is a margin: a · the volume, b · the DVH, c · its detail at the limit,
// d · the optimiser's convergence; beams, constraints and the optimiser log below.
//
// ONE model drives every view:
//   1. ANATOMY — analytic signed-distance fields (skin, skull, globes, lenses, optic
//      nerves, chiasm, brainstem, parotids, and the target: a 3.1 cm³ cuff wrapped round
//      the left optic nerve with a 2.6-mm planning margin), meshed once by surface nets.
//   2. DOSE — dose(x) = S · (1 − β·N(x)) · [(1 − η)·C(x) + η·Σ wₐ·Kₐ(x)] · h(x).
//      Kₐ is arc a's kernel: a hard-edged beam as wide as the target's projection, swept
//      over the arc's gantry range (entrance/exit with 0.45 %/mm attenuation), jaws
//      fitted to the target; C is the conformal term (distance to the target), N the
//      nerve's avoidance term, h a 3 % hot spot. Per iteration S and β are SOLVED so that
//      coverage V95 and the nerve max land on the optimiser's trajectory; the isodose
//      shells are re-meshed from the same field on the beat; the DVH, every organ max
//      and mean, the pins, the table and the probe cursor read the same field.
//   3. OPTIMISER — iteration i: nerve max 54.0 + 0.4·0.95^(i − 2317) (54.40 → 54.38 →
//      54.36 … → 54.02 at the end of the loop: it converges on the limit and never
//      reaches it), coverage 96.0 + 0.8·0.95^(i − 2317), OBJ 0.0372 + 0.0040·0.95^(i −
//      2317), arc weights wobbling by ±1 %, conformity tightening slowly. MU from S·w.
//      REV 13 is the same field solved for coverage 98.6 % and a nerve max of 57.2.
//      Coverage is ONE number: the calibration lands the sampled V95 exactly on the
//      model's 0.1 % step, and every place that prints it reads the plan's V95.
//   4. GANTRY — three arcs (axial full arc, oblique couch 315 half arc, sagittal vertex
//      arc), their control points, MU/CP profiles and gantry angles.
//   5. CLOCK — one forward-only planning clock, 08:41:00 + u.
//
// Time: cycle u = 0 → 540 s on ACTIVE time (paused while hidden). MONEY SHOT every 9 s
// from u = 1.5: the arcs sweep a third of their range (a 6-s pass, eased, N_SUBS = [9, 3, 3] passes per arc; the three arcs staggered and
// landing together; all three peak near 8–10 °/s, ARC 1 was 75), the shells re-form in
// ARC 1's wake; at the end of the pass the iteration counter steps, the nerve max
// retypes through valid hundredths, the DVH redraws and the log prints the line.
// SECOND BEAT 1.9 s later: a constraint re-scores, one arc's MU retypes, and the camera
// pulls focus (a 5-s dolly in to the nerve, ×1.35; back out on the next second beat).
// The camera orbits at ≤ 0.4 °/s between. Log lines are 1.85–3.7 s apart. At u = 540
// (08:50:00) ONE plain cut returns to frame 1 — the plan is still not approvable when it
// does. Nothing blinks; the FAIL is a held colour.
// BREATHING: 0.4 s after each iterate lands, the plan is read structure by structure (REVIEW:
// one structure per 1.05 s, the selection linked across the volume, the pins, the DVH and the
// constraints table), and during a sweep each arc's MU/CP profile lights behind its gantry as
// its control points are computed.
// Every loop is named and registered; everything stops while the tab is hidden.
//
// XSS NOTE: every DOM node is built with createElement + textContent. No markup string
// is parsed into the DOM anywhere in this file.

// --- Boot ------------------------------------------------------------------

const NC = window.NIGHTCONSOLES || {};
const SLUG = 'isodose';
const PAL = Object.assign({
  bg: '#020806', panel: '#06100D', text: '#F5EFE0', dim: '#79BBB0',
  accent: '#FF4A3A', data: '#9DFEEB', cool: '#43AAEB', alarm: '#FF1500',
  iso95: '#FF9C10', iso80: '#FFE047', iso50: '#55DEA3', iso20: '#43AAEB',
  nerve: '#F5F5EC', k1: '#FFE256', k2: '#56A5FF', k3: '#FFA151'
}, (NC.PALETTES && NC.PALETTES.isodose) || {});
function applyPalette() {
  for (const [k, v] of Object.entries(PAL)) document.documentElement.style.setProperty('--p-' + k, v);
}
applyPalette();
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeRng() { return mulberry32((Math.random() * 0x100000000) >>> 0); }
// pop pass (2026-09-28): scene-side palette overrides — a near-black stage and a clean red target
// (applyPalette writes inline styles, so these must be set here, after it, to take effect)
const POP = { bg: '#020806', panel: '#06100D', accent: '#FF4A3A' };
for (const k in POP) document.documentElement.style.setProperty('--p-' + k, POP[k]);

if (new URLSearchParams(location.search).get('clean') === '1') {
  document.body.classList.add('clean-mode');
}

const rng = makeRng();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Canvas backing = CSS size × pixelRatio(): the live fit's ratio (screen px per CSS px of
// the fitted page), else devicePixelRatio; capped at 2.
const pixelRatio = () => Math.min(2, window.devicePixelRatio || 1);
function observeFitScale(onChange) {
  if (typeof MutationObserver !== 'function') return;
  const html = document.documentElement;
  let last = html.style.getPropertyValue('--scs-fit-scale');
  new MutationObserver(() => {
    const v = html.style.getPropertyValue('--scs-fit-scale');
    if (v !== last) { last = v; onChange(); }
  }).observe(html, { attributes: true, attributeFilter: ['style'] });
}

let chromeAutoHideTimer = null;
let gen = 1;                       // generation token: bumped on every hide and every show
const liveIntervals = new Map();   // loop name → { ms, fn, id }
const liveRafs = [];               // RAF loop records
const activeArcTimers = new Map(); // beat-chain name → { id, g } — ONE pending timeout per chain
const uiTimers = new Set();        // short one-shot UI timeouts; cleared when hidden
let booted = false, paused = false;


// --- Palette and type ----------------------------------------------------------

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')'; }
const C_TEXT = hexRgb(PAL.text), C_DIM = hexRgb(PAL.dim), C_ALARM = hexRgb(PAL.alarm), C_DATA = hexRgb(PAL.data);
const C_NERVE = hexRgb(PAL.nerve), C_TGT = hexRgb(POP.accent);
const C_SKIN = hexRgb(PAL.cool), C_ARC = hexRgb(PAL.k2), C_OAR = hexRgb('#C4E4DA'), C_DIM2 = hexRgb('#A9D2CA');
const SHELL_HEX = [PAL.iso95, PAL.iso80, PAL.iso50, PAL.iso20];
// colour roles: beam delivery (MU/CP) = k1 gold; beam geometry, skin and OARs = the family blue
const C_MU = hexRgb(PAL.k1);
// organs at risk within their limit (DVH curves, constraint bars, PASS chips) = iso50 green
const C_OKG = hexRgb(PAL.iso50);
const C_SHELL = SHELL_HEX.map(hexRgb);
const F_MONO = "'IBM Plex Mono', ui-monospace, monospace";
const F_SANS = 'Inter, system-ui, sans-serif';
function fMono(px, w) { return (w ? w + ' ' : '') + px.toFixed(1) + 'px ' + F_MONO; }
function fSans(px, w) { return (w ? w + ' ' : '') + px.toFixed(1) + 'px ' + F_SANS; }

// --- Small helpers -----------------------------------------------------------------

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function setText(id, s) { const n = typeof id === 'string' ? $(id) : id; if (n && n.textContent !== s) n.textContent = s; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function pad(n, w = 2) { return String(Math.floor(n)).padStart(w, '0'); }
function grp(n) { return Math.round(n).toLocaleString('en-US'); }
const HMS = (h, m, s) => h * 3600 + m * 60 + s;
function hms(s) { s = Math.floor(s); return pad(s / 3600) + ':' + pad((s % 3600) / 60) + ':' + pad(s % 60); }
function hm(s) { return hms(s).slice(0, 5); }
const DEG = Math.PI / 180;
function wrap360(d) { d %= 360; return d < 0 ? d + 360 : d; }
function sgnf(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }

// --- Loop registry (hide/show-safe) ------------------------------------------------

function named(name, fn) { return { [name]: function () { return fn(); } }[name]; }
function addRaf(name, fn, fps) {
  const rec = { name, id: 0, fn, fps, last: 0, running: false, g: 0 };
  const frame = (now) => {
    if (!rec.running || rec.g !== gen) return;
    rec.id = requestAnimationFrame(frame);
    const f = typeof rec.fps === 'function' ? rec.fps() : rec.fps;
    if (now - rec.last < 1000 / f - 2) return;
    rec.last = now;
    try { fn(now); } catch (e) { console.warn('[isodose] frame ' + name + ' failed:', e); rec.running = false; }
  };
  rec.start = () => { if (rec.running && rec.g === gen) return; cancelAnimationFrame(rec.id); rec.running = true; rec.g = gen; rec.id = requestAnimationFrame(frame); };
  rec.stop = () => { rec.running = false; cancelAnimationFrame(rec.id); };
  liveRafs.push(rec);
  return rec;
}
function every(name, ms, fn) { liveIntervals.set(name, { ms, fn, id: 0 }); }
function startLoops() {
  if (prefersReducedMotion) return;
  const g = gen;
  for (const [name, L] of liveIntervals) {
    if (L.id) continue;
    L.id = setInterval(named('loop:' + name, () => {
      if (g !== gen || paused) return;
      try { L.fn(); } catch (e) { console.warn('[isodose] loop ' + name + ' failed:', e); }
    }), L.ms);
  }
}
function stopLoops() { for (const L of liveIntervals.values()) { if (L.id) clearInterval(L.id); L.id = 0; } }
function beat(name, ms, fn) {
  if (prefersReducedMotion) return;
  const old = activeArcTimers.get(name);
  if (old) clearTimeout(old.id);
  const rec = { id: 0, g: gen };
  rec.id = setTimeout(named('beat:' + name, () => {
    if (activeArcTimers.get(name) === rec) activeArcTimers.delete(name);
    if (rec.g !== gen || paused) return;
    try { fn(); } catch (e) { console.warn('[isodose] beat ' + name + ' failed:', e); }
  }), Math.max(0, ms));
  activeArcTimers.set(name, rec);
}
function clearBeats() { for (const r of activeArcTimers.values()) clearTimeout(r.id); activeArcTimers.clear(); }
function later(ms, fn) {
  const g = gen;
  const id = setTimeout(named('ui', () => {
    uiTimers.delete(id);
    if (g !== gen) return;
    try { fn(); } catch (e) { console.warn('[isodose] ui timer failed:', e); }
  }), ms);
  uiTimers.add(id);
  return id;
}
function clearUi() { for (const id of uiTimers) clearTimeout(id); uiTimers.clear(); }

// --- Canvases: CSS size × pixelRatio(); ctx works in CSS pixels ------------------------
// Every canvas carries its own repaint hook and is observed on its own, so a canvas whose
// zone reflows without the root changing size re-fits and redraws alone; the root is
// observed too (the portrait pin arrives with no resize event).

const canvases = [];
let sizeObserver = null;
function mountCanvas(id, repaint) {
  const cv = typeof id === 'string' ? $(id) : id;
  if (!cv) return null;
  const rec = { cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1, repaint };
  rec.fit = () => {
    const r = cv.getBoundingClientRect();
    const dpr = pixelRatio();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === rec.w && h === rec.h && dpr === rec.dpr) return false;
    rec.w = w; rec.h = h; rec.dpr = dpr;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    rec.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  };
  rec.clear = () => { rec.ctx.setTransform(1, 0, 0, 1, 0, 0); rec.ctx.clearRect(0, 0, cv.width, cv.height); rec.ctx.setTransform(rec.dpr, 0, 0, rec.dpr, 0, 0); };
  rec.fit();
  canvases.push(rec);
  if (sizeObserver) sizeObserver.observe(cv);
  return rec;
}
function setRootMetrics() {
  const root = $('iso-root');
  if (!root) return;
  const r = root.getBoundingClientRect(), h = Math.round(r.height), w = Math.round(r.width);
  if (!(h > 0)) return;
  if (root.style.getPropertyValue('--rootH') !== h + 'px') root.style.setProperty('--rootH', h + 'px');
  root.classList.toggle('h-short', h <= 820);
  root.classList.toggle('h-xshort', h <= 680);
  root.classList.toggle('w-narrow', w < 1500);
}
setRootMetrics();
let resizeTimer = 0, canvasTimer = 0;
const rootBox = { key: '' };
const dirtyCanvases = new Set();
function rootKey() { const r = $('iso-root').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }
function scheduleResize(ms) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (booted) onResize(); }, ms); }
function refitDirty() {
  if (!booted) return;
  for (const c of canvases) {
    if (!dirtyCanvases.has(c.cv)) continue;
    if (c.fit() && c.repaint) { try { c.repaint(performance.now()); } catch (e) { console.warn('[isodose] repaint failed:', e); } }
  }
  dirtyCanvases.clear();
  measurePins();
}
window.addEventListener('resize', () => scheduleResize(160));
sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
  for (const e of entries) {
    if (e.target.id === 'iso-root') {
      const key = Math.round(e.contentRect.width) + 'x' + Math.round(e.contentRect.height);
      if (key !== rootBox.key) scheduleResize(120);
    } else {
      dirtyCanvases.add(e.target);
      clearTimeout(canvasTimer); canvasTimer = setTimeout(refitDirty, 90);
    }
  }
}) : null;

// =============================================================================
// STORY CLOCK — one forward-only planning clock: 08:41:00 + u (u on ACTIVE seconds)
// =============================================================================

const CYCLE = 540;
const CLOCK0 = HMS(8, 41, 0), SIGN_AT = HMS(9, 0, 0);
// One 9-s beat, from its sweep start: the three arcs pass (0 → 6.0 s, staggered starts, a common
// landing) · the CALC log line (+2.3) · a spare log slot for AUTOSAVE / PROJ (+4.15) · the climax,
// the iterate lands (+6.0) · the second beat (+7.9) · the next sweep (+9.0). Log lines are 1.85–3.7 s
// apart (never closer, never a silent stretch past 4 s); the 60th iterate lands 1 s before the cut.
const BEAT_DT = 9, MONEY_U0 = 1.5, SWEEP_S = 6.0, SETTLE_S = 1.3, DOLLY_S = 5.0;
const CALC_DT = 2.3, EXTRA_DT = 4.15, SECOND_DT = SWEEP_S + 1.9, SECOND_U0 = MONEY_U0 + SECOND_DT;
const N_BEAT = 60;
const CUT_DOWN = 0.5, CUT_UP = 0.6;
const act = { acc: 0, t0: performance.now(), running: true };
function activeSec() { return (act.acc + (act.running ? performance.now() - act.t0 : 0)) / 1000; }
function pauseClock() { if (!act.running) return; act.acc += performance.now() - act.t0; act.running = false; }
function resumeClock() { if (act.running) return; act.t0 = performance.now(); act.running = true; }
const cyc = { start: 0, n: 0, cutT0: -1e9, upT0: -1e9 };
let staticU = -1;                                   // reduced motion: one frozen instant
function uNow() { return staticU >= 0 ? staticU : activeSec() - cyc.start; }
function uClamped() { return clamp(uNow(), 0, CYCLE); }
function clockS() { return CLOCK0 + uClamped(); }
function sweepIndexAt(u) { return u < MONEY_U0 ? -1 : Math.min(N_BEAT - 1, Math.floor((u - MONEY_U0) / BEAT_DT)); }
function climaxU(k) { return MONEY_U0 + k * BEAT_DT + SWEEP_S; }
function itersDoneAt(u) { if (u < climaxU(0)) return 0; return Math.min(N_BEAT, Math.floor((u - climaxU(0)) / BEAT_DT) + 1); }

// =============================================================================
// OPTIMISER TRAJECTORY (model 3)
// =============================================================================

const ITER0 = 2317;
const RX = 66.0, LIMIT = 54.0;
const LEVELS = [0.95, 0.80, 0.50, 0.20];
const LEVEL_GY = LEVELS.map(l => RX * l);            // 62.7 · 52.8 · 33.0 · 13.2
const QD = 0.95;
function nerveOf(i) { return LIMIT + 0.4 * Math.pow(QD, i - ITER0); }
function covOf(i) { return 96.0 + 0.8 * Math.pow(QD, i - ITER0); }
function objOf(i) { return 0.0372 + 0.0040 * Math.pow(QD, i - ITER0); }
function lamOf(i) { return 4.0 - 0.35 * (1 - Math.pow(QD, Math.max(0, i - ITER0))); }
function weightsOf(i) {
  const w0 = 0.40 + 0.012 * Math.sin(0.37 * i + 0.2), w1 = 0.33 + 0.010 * Math.sin(0.29 * i + 1.9);
  return [w0, w1, 1 - w0 - w1];
}
function togoOf(i) {                                  // linear projection: iterations to 54.0 at the last step's rate
  const rate = nerveOf(i - 1) - nerveOf(i);
  return rate > 0 ? (nerveOf(i) - LIMIT) / rate : Infinity;
}

// =============================================================================
// ANATOMY (model 1) — mm; x = patient left, y = anterior, z = superior
// =============================================================================

function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
function sdEll(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function sdCap(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz); h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
function polyline(pts) {
  const seg = []; let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    seg.push([a[0], a[1], a[2], dx, dy, dz, len, s]); s += len;
  }
  return { pts, seg, len: s };
}
const NR = new Float64Array(8);                       // nearest(): [dist, s, cx, cy, cz, tx, ty, tz]
function nearest(pl, x, y, z) {
  let best = Infinity;
  for (const g of pl.seg) {
    const px = x - g[0], py = y - g[1], pz = z - g[2];
    let h = (px * g[3] + py * g[4] + pz * g[5]) / (g[6] * g[6]); h = h < 0 ? 0 : h > 1 ? 1 : h;
    const qx = px - g[3] * h, qy = py - g[4] * h, qz = pz - g[5] * h, d2 = qx * qx + qy * qy + qz * qz;
    if (d2 < best) { best = d2; NR[1] = g[7] + h * g[6]; NR[2] = g[0] + g[3] * h; NR[3] = g[1] + g[4] * h; NR[4] = g[2] + g[5] * h; NR[5] = g[3] / g[6]; NR[6] = g[4] / g[6]; NR[7] = g[5] / g[6]; }
  }
  NR[0] = Math.sqrt(best); return NR;
}
function pointAt(pl, s) {
  let g = pl.seg[pl.seg.length - 1];
  for (const q of pl.seg) if (s <= q[7] + q[6] + 1e-9) { g = q; break; }
  const h = clamp((s - g[7]) / g[6], 0, 1);
  return [g[0] + g[3] * h, g[1] + g[4] * h, g[2] + g[5] * h, g[3] / g[6], g[4] / g[6], g[5] / g[6]];
}

const NERVE_L = polyline([[30, 51.5, 4], [26.5, 44, 3.2], [22, 36.5, 2.2], [17, 29.5, 1.2], [11, 23.5, 0], [5.5, 19.5, -1]]);
const NERVE_R = polyline(NERVE_L.pts.map(p => [-p[0], p[1], p[2]]));
const R_NERVE = 2.3;
function sdSkin(x, y, z) {
  let d = sdEll(x, y, z, 0, -8, 26, 73, 94, 82);                        // cranium
  d = smin(d, sdEll(x, y, z, 0, 40, -22, 61, 55, 52), 22);                // midface
  d = smin(d, sdEll(x, y, z, 0, 22, -60, 56, 52, 34), 20);                // lower face
  d = smin(d, sdEll(x, y, z, 0, 60, -78, 38, 32, 22), 14);                // chin
  d = smin(d, sdCap(x, y, z, 0, 90, 8, 0, 106, -22, 7, 8.5), 9);          // nose ridge
  d = smin(d, sdEll(x, y, z, 0, 97, -27, 15, 11, 8), 7);                  // nose base
  d = smin(d, sdEll(x, y, z, 0, 88, -47, 22, 10, 11), 7);                 // lips
  d = smin(d, sdCap(x, y, z, 0, -8, -60, 0, -4, -160, 50, 50), 24);       // neck
  d = smin(d, sdEll(x, y, z, 74, -6, -4, 8, 16, 27), 6);                  // ears
  d = smin(d, sdEll(x, y, z, -74, -6, -4, 8, 16, 27), 6);
  d = smax(d, -sdEll(x, y, z, 31, 94, 5, 15, 8, 8), 6);                   // eye hollows
  d = smax(d, -sdEll(x, y, z, -31, 94, 5, 15, 8, 8), 6);
  return Math.max(d, -(z + 150));
}
const MANDIBLE = [[-50, -2, -28], [-52, 6, -66], [-36, 52, -84], [0, 74, -92], [36, 52, -84], [52, 6, -66], [50, -2, -28]];
function sdBone(x, y, z) {
  let d = sdEll(x, y, z, 0, -10, 28, 67, 88, 76);                        // vault
  d = smin(d, sdEll(x, y, z, 0, 46, -20, 50, 40, 32), 14);                // maxilla
  d = smin(d, sdCap(x, y, z, 52, 42, -8, 63, -4, -10, 7, 6), 8);          // zygomatic arches
  d = smin(d, sdCap(x, y, z, -52, 42, -8, -63, -4, -10, 7, 6), 8);
  let m = 1e9;
  for (let i = 0; i < MANDIBLE.length - 1; i++) { const a = MANDIBLE[i], b = MANDIBLE[i + 1]; m = Math.min(m, sdCap(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 11, 11)); }
  d = smin(d, m, 6);
  d = smax(d, -sdEll(x, y, z, 31, 72, 4, 17, 30, 16), 5);                // orbits
  d = smax(d, -sdEll(x, y, z, -31, 72, 4, 17, 30, 16), 5);
  d = smax(d, -sdEll(x, y, z, 0, 82, -16, 11, 18, 15), 4);                // nasal aperture
  for (let k = 0; k < 5; k++) {                                           // C1–C5
    const zc = -60 - 19 * k;
    d = Math.min(d, sdEll(x, y, z, 0, -18, zc, 21, 15, 9.5));
    d = Math.min(d, sdCap(x, y, z, 0, -24, zc, 0, -42, zc - 6, 6.5, 5.5));
  }
  return d;
}
const sdGlobeL = (x, y, z) => sdEll(x, y, z, 31, 63, 4, 11.5, 11.5, 11.5);
const sdGlobeR = (x, y, z) => sdEll(x, y, z, -31, 63, 4, 11.5, 11.5, 11.5);
const sdLensL = (x, y, z) => sdEll(x, y, z, 31, 73.6, 4, 4.4, 2.0, 4.4);
const sdLensR = (x, y, z) => sdEll(x, y, z, -31, 73.6, 4, 4.4, 2.0, 4.4);
function sdChiasm(x, y, z) {
  let d = sdCap(x, y, z, -6, 19.5, -1.2, 6, 19.5, -1.2, 3.3, 3.3);
  d = smin(d, sdCap(x, y, z, 6, 19.5, -1.2, 13, 8, -3.5, 2.8, 2.3), 2);
  return smin(d, sdCap(x, y, z, -6, 19.5, -1.2, -13, 8, -3.5, 2.8, 2.3), 2);
}
function sdBrainstem(x, y, z) {
  const d = sdCap(x, y, z, 0, 0, -4, 0, -10, -30, 12.5, 13.5);
  return smin(d, sdCap(x, y, z, 0, -10, -30, 0, -16, -62, 13.5, 9.5), 6);
}
const sdParotidL = (x, y, z) => smin(sdEll(x, y, z, 50, 6, -30, 12, 18, 20), sdEll(x, y, z, 46, 15, -52, 10, 14, 12), 6);
const sdParotidR = (x, y, z) => smin(sdEll(x, y, z, -50, 6, -30, 12, 18, 20), sdEll(x, y, z, -46, 15, -52, 10, 14, 12), 6);
// The target: a cuff round the left optic nerve at the orbital apex, open on one side
// (a hand round a rope), 2.6 mm clear of the nerve (the planning margin), 3.1 cm³.
const TGT = { sc: 17.5, L: 10.5, ra: 7.2, rb: 2.26, open: -70 * DEG, ap: 135 * DEG };
function sdTarget(x, y, z) {
  const R = nearest(NERVE_L, x, y, z);
  const tx = R[5], ty = R[6], tz = R[7];
  let qx = x - R[2], qy = y - R[3], qz = z - R[4];
  const along = qx * tx + qy * ty + qz * tz;          // non-zero only beyond the polyline's ends
  const s = R[1] + along; qx -= along * tx; qy -= along * ty; qz -= along * tz;
  let n1x = -tz * tx, n1y = -tz * ty, n1z = 1 - tz * tz; const l1 = Math.hypot(n1x, n1y, n1z); n1x /= l1; n1y /= l1; n1z /= l1;
  const n2x = ty * n1z - tz * n1y, n2y = tz * n1x - tx * n1z, n2z = tx * n1y - ty * n1x;
  const u = qx * n1x + qy * n1y + qz * n1z, v = qx * n2x + qy * n2y + qz * n2z;
  const rho = Math.hypot(u, v);
  let del = Math.atan2(v, u) - (TGT.open + Math.PI);
  del = Math.atan2(Math.sin(del), Math.cos(del));
  const px = Math.abs(rho * Math.sin(del)), py = rho * Math.cos(del);
  const sx = Math.sin(TGT.ap), sy = Math.cos(TGT.ap);
  const e = s - TGT.sc, taper = Math.sqrt(Math.max(0, 1 - (e / (TGT.L + 2)) ** 2));
  const rb = TGT.rb * (0.55 + 0.45 * taper);
  let d2 = (sy * px > sx * py) ? Math.hypot(px - sx * TGT.ra, py - sy * TGT.ra) : Math.abs(rho - TGT.ra);
  d2 -= rb;
  d2 += 0.45 * Math.sin(0.42 * s + 1.1) * Math.cos(2 * del + 0.6) + 0.3 * Math.sin(0.9 * s) * Math.sin(3 * del);
  const de = Math.abs(e) - TGT.L;
  return Math.hypot(Math.max(d2, 0), Math.max(de, 0)) + Math.min(Math.max(d2, de), 0);
}

// =============================================================================
// MESHING — surface nets on an SDF grid (+ relaxation, projection), tubes for nerves
// =============================================================================

function gridSDF(f, b0, b1, h) {
  const nx = Math.ceil((b1[0] - b0[0]) / h) + 1, ny = Math.ceil((b1[1] - b0[1]) / h) + 1, nz = Math.ceil((b1[2] - b0[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz); let n = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[n++] = f(b0[0] + i * h, b0[1] + j * h, b0[2] + k * h);
  return { val, nx, ny, nz, b0, h };
}
const CXO = [0, 1, 0, 1, 0, 1, 0, 1], CYO = [0, 0, 1, 1, 0, 0, 1, 1], CZO = [0, 0, 0, 0, 1, 1, 1, 1];
const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
const SNG = new Float64Array(8);
function surfaceNets(G, proj, relax) {
  const { val, nx, ny, nz, b0, h } = G;
  const sy = nx, sz = nx * ny, cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const CO = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz];
  const cell = new Int32Array(cnx * cny * cnz).fill(-1);
  const V = [];
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) {
    let base = j * sy + k * sz;
    for (let i = 0; i < cnx; i++, base++) {
      let m = 0;
      for (let c = 0; c < 8; c++) { const v = val[base + CO[c]]; SNG[c] = v; if (v < 0) m |= 1 << c; }
      if (m === 0 || m === 255) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = EA[e], b = EB[e], va = SNG[a], vb = SNG[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        ax += CXO[a] + t * (CXO[b] - CXO[a]); ay += CYO[a] + t * (CYO[b] - CYO[a]); az += CZO[a] + t * (CZO[b] - CZO[a]); cnt++;
      }
      cell[i + j * cnx + k * cnx * cny] = V.length / 3;
      V.push(b0[0] + (i + ax / cnt) * h, b0[1] + (j + ay / cnt) * h, b0[2] + (k + az / cnt) * h);
    }
  }
  const F = [];
  const cid = (i, j, k) => cell[i + j * cnx + k * cnx * cny];
  function quad(a, b, c, d, ox, oy, oz) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ax_ = V[3 * c] - V[3 * a], ay_ = V[3 * c + 1] - V[3 * a + 1], az_ = V[3 * c + 2] - V[3 * a + 2];
    const bx_ = V[3 * d] - V[3 * b], by_ = V[3 * d + 1] - V[3 * b + 1], bz_ = V[3 * d + 2] - V[3 * b + 2];
    const nx_ = ay_ * bz_ - az_ * by_, ny_ = az_ * bx_ - ax_ * bz_, nz_ = ax_ * by_ - ay_ * bx_;
    if (nx_ * ox + ny_ * oy + nz_ * oz < 0) { const t = b; b = d; d = t; }
    if (ax_ * ax_ + ay_ * ay_ + az_ * az_ <= bx_ * bx_ + by_ * by_ + bz_ * bz_) F.push(a, b, c, a, c, d); else F.push(a, b, d, b, c, d);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const va = val[i + j * sy + k * sz], vb = val[i + 1 + j * sy + k * sz];
    if ((va < 0) === (vb < 0)) continue;
    quad(cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k), va < 0 ? 1 : -1, 0, 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const va = val[i + j * sy + k * sz], vb = val[i + (j + 1) * sy + k * sz];
    if ((va < 0) === (vb < 0)) continue;
    quad(cid(i - 1, j, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i - 1, j, k), 0, va < 0 ? 1 : -1, 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const va = val[i + j * sy + k * sz], vb = val[i + j * sy + (k + 1) * sz];
    if ((va < 0) === (vb < 0)) continue;
    quad(cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k), 0, 0, va < 0 ? 1 : -1);
  }
  const P = new Float64Array(V);
  if (relax > 0) relaxMesh(P, F, relax, proj, h);
  return finalizeMesh(P, F);
}
function relaxMesh(P, F, iters, proj, h) {
  const nv = P.length / 3;
  const nb = Array.from({ length: nv }, () => new Set());
  for (let f = 0; f < F.length; f += 3) { const a = F[f], b = F[f + 1], c = F[f + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const Q2 = new Float64Array(P.length), lim = 0.35 * h, e = 0.25;
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < nv; v++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const u of nb[v]) { sx += P[3 * u]; sy += P[3 * u + 1]; sz += P[3 * u + 2]; n++; }
      if (!n) { Q2[3 * v] = P[3 * v]; Q2[3 * v + 1] = P[3 * v + 1]; Q2[3 * v + 2] = P[3 * v + 2]; continue; }
      Q2[3 * v] = P[3 * v] + 0.5 * (sx / n - P[3 * v]); Q2[3 * v + 1] = P[3 * v + 1] + 0.5 * (sy / n - P[3 * v + 1]); Q2[3 * v + 2] = P[3 * v + 2] + 0.5 * (sz / n - P[3 * v + 2]);
    }
    P.set(Q2);
    if (!proj) continue;
    for (let v = 0; v < nv; v++) {
      for (let s = 0; s < 2; s++) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], d = proj(x, y, z);
        const gx = (proj(x + e, y, z) - proj(x - e, y, z)) / (2 * e), gy = (proj(x, y + e, z) - proj(x, y - e, z)) / (2 * e), gz = (proj(x, y, z + e) - proj(x, y, z - e)) / (2 * e);
        const g2 = gx * gx + gy * gy + gz * gz; if (g2 < 0.04) break;
        let kx = d * gx / g2, ky = d * gy / g2, kz = d * gz / g2; const kl = Math.hypot(kx, ky, kz);
        if (kl > lim) { kx *= lim / kl; ky *= lim / kl; kz *= lim / kl; }
        P[3 * v] -= kx; P[3 * v + 1] -= ky; P[3 * v + 2] -= kz;
      }
    }
  }
}
function finalizeMesh(P, F) {
  const nv = P.length / 3, nf = F.length / 3;
  const px = new Float32Array(nv), py = new Float32Array(nv), pz = new Float32Array(nv);
  for (let v = 0; v < nv; v++) { px[v] = P[3 * v]; py[v] = P[3 * v + 1]; pz[v] = P[3 * v + 2]; }
  const fi = new Uint32Array(F), fn = new Float32Array(3 * nf), fc = new Float32Array(3 * nf);
  let vol = 0, cx = 0, cy = 0, cz = 0;
  for (let f = 0; f < nf; f++) {
    const a = fi[3 * f], b = fi[3 * f + 1], c = fi[3 * f + 2];
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a], vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    fn[3 * f] = nx / l; fn[3 * f + 1] = ny / l; fn[3 * f + 2] = nz / l;
    fc[3 * f] = (px[a] + px[b] + px[c]) / 3; fc[3 * f + 1] = (py[a] + py[b] + py[c]) / 3; fc[3 * f + 2] = (pz[a] + pz[b] + pz[c]) / 3;
    const tv = (px[a] * (py[b] * pz[c] - pz[b] * py[c]) - py[a] * (px[b] * pz[c] - pz[b] * px[c]) + pz[a] * (px[b] * py[c] - py[b] * px[c])) / 6;
    vol += tv; cx += tv * (px[a] + px[b] + px[c]) / 4; cy += tv * (py[a] + py[b] + py[c]) / 4; cz += tv * (pz[a] + pz[b] + pz[c]) / 4;
  }
  const em = new Map(), ev = [], ef = [];
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = fi[3 * f + e], b = fi[3 * f + (e + 1) % 3], lo = a < b ? a : b, hi = a < b ? b : a, key = lo * 1048576 + hi;
    const k = em.get(key);
    if (k === undefined) { em.set(key, ev.length / 2); ev.push(lo, hi); ef.push(f, -1); } else if (ef[2 * k + 1] < 0) ef[2 * k + 1] = f;
  }
  return {
    nv, nf, px, py, pz, fi, fn, fc, vol, cen: vol ? [cx / vol, cy / vol, cz / vol] : [0, 0, 0],
    ne: ev.length / 2, ev: new Uint32Array(ev), ef: new Int32Array(ef), az: null,
    sx: new Float32Array(nv), sy: new Float32Array(nv), sd: new Float32Array(nv), facing: new Uint8Array(nf), style: new Uint16Array(nf),
  };
}
function tubeMesh(pl, r, step, segs) {
  const P = [], F = [], rings = [];
  const n = Math.max(2, Math.round(pl.len / step) + 1);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const q = pointAt(pl, pl.len * i / (n - 1)), tx = q[3], ty = q[4], tz = q[5];
    let ux, uy, uz;
    if (!prev) { ux = -tz * tx; uy = -tz * ty; uz = 1 - tz * tz; } else { const d = prev[0] * tx + prev[1] * ty + prev[2] * tz; ux = prev[0] - d * tx; uy = prev[1] - d * ty; uz = prev[2] - d * tz; }
    const lu = Math.hypot(ux, uy, uz); ux /= lu; uy /= lu; uz /= lu; prev = [ux, uy, uz];
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
    const ring = [];
    for (let k = 0; k < segs; k++) { const a = 2 * Math.PI * k / segs, c = Math.cos(a) * r, sn = Math.sin(a) * r; ring.push(P.length / 3); P.push(q[0] + ux * c + wx * sn, q[1] + uy * c + wy * sn, q[2] + uz * c + wz * sn); }
    rings.push({ ring, c: [q[0], q[1], q[2]] });
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
    const a = rings[i].ring[k], b = rings[i].ring[(k + 1) % segs], c = rings[i + 1].ring[(k + 1) % segs], d = rings[i + 1].ring[k];
    F.push(a, d, c, a, c, b);
  }
  for (const end of [0, n - 1]) {
    const ci = P.length / 3, c = rings[end].c; P.push(c[0], c[1], c[2]);
    for (let k = 0; k < segs; k++) { const a = rings[end].ring[k], b = rings[end].ring[(k + 1) % segs]; if (end === 0) F.push(ci, b, a); else F.push(ci, a, b); }
  }
  return finalizeMesh(new Float64Array(P), F);
}

// =============================================================================
// DOSE FIELD (model 2)
// =============================================================================

let ISO = [21, 36.5, 2];
let PALM = [0, 0, 0];
const MU_ATT = 0.0045, SIG_N = 2.2, ETA = 0.40;
const ARCS = [
  { id: 1, couch: 0, dir: 1, start: 181, stop: 179, coll: 30, mu0: 212.4, avoid: [340, 50] },
  { id: 2, couch: 315, dir: -1, start: 160, stop: 40, coll: 15, mu0: 168.9 },
  { id: 3, couch: 270, dir: 1, start: 30, stop: 150, coll: 345, mu0: 141.7 },
];
for (const A of ARCS) {
  const c = A.couch * DEG;
  A.g = [Math.sin(c), 0, Math.cos(c)]; A.b0 = [0, 1, 0]; A.b1 = [Math.cos(c), 0, -Math.sin(c)];
  A.spanDeg = A.dir > 0 ? ((A.stop - A.start + 360) % 360 || 360) : ((A.start - A.stop + 360) % 360 || 360);
  A.span = A.spanDeg * DEG; A.lo = (A.dir > 0 ? A.start : A.stop) * DEG;
  A.cp = Math.floor(A.spanDeg / 2) + 1; A.w = 15; A.hz = 16; A.sg = 2.0;
  if (A.avoid) { A.avLo = A.avoid[0] * DEG; A.avSpan = wrap360(A.avoid[1] - A.avoid[0]) * DEG; A.live = A.span - A.avSpan; } else A.live = A.span;
}
const CP_TOTAL = ARCS.reduce((s, A) => s + A.cp, 0);
function ovl(lo, span, c, al) {                       // measure of [c − al, c + al] ∩ [lo, lo + span] on the circle
  const TWO = 2 * Math.PI; let cc = (c - lo) % TWO; if (cc < 0) cc += TWO; let m = 0;
  for (let sh = -TWO; sh <= TWO + 1e-9; sh += TWO) { const a = cc + sh - al, b = cc + sh + al, l = a > 0 ? a : 0, u = b < span ? b : span; if (u > l) m += u - l; }
  return m;
}
function arcK(A, px, py, pz) {
  const z = px * A.g[0] + py * A.g[1] + pz * A.g[2];
  const u = px * A.b0[0] + py * A.b0[1] + pz * A.b0[2], v = px * A.b1[0] + py * A.b1[1] + pz * A.b1[2];
  const r = Math.sqrt(u * u + v * v), phi = Math.atan2(v, u), r4 = r * r * r * r, w4 = A.w * A.w * A.w * A.w;
  const al = Math.asin(Math.min(1, A.w / Math.sqrt(Math.sqrt(r4 + w4))));
  const en = 1 + MU_ATT * r, ex = Math.max(0, 1 - MU_ATT * r);
  let fv = en * ovl(A.lo, A.span, phi, al) + ex * ovl(A.lo, A.span, phi + Math.PI, al);
  if (A.avoid) fv -= en * ovl(A.avLo, A.avSpan, phi, al) + ex * ovl(A.avLo, A.avSpan, phi + Math.PI, al);   // MLC closed over the avoidance sector
  fv /= A.live;
  const az = Math.abs(z); let L = 1 / (1 + Math.exp((az - A.hz) / A.sg)); const sc = 0.035 * Math.exp(-az / 35); if (L < sc) L = sc;
  return L * fv;
}
// Factor sets: per point, the parts of the field that do not depend on the optimiser.
function factorSet(n) { return { n, dT: new Float32Array(n), nn: new Float32Array(n), k1: new Float32Array(n), k2: new Float32Array(n), k3: new Float32Array(n), hot: new Float32Array(n) }; }
function fillFactors(Fs, i, x, y, z) {
  Fs.dT[i] = sdTarget(x, y, z);
  const dn = nearest(NERVE_L, x, y, z)[0];
  Fs.nn[i] = Math.exp(-dn * dn / (2 * SIG_N * SIG_N));
  const rx = x - ISO[0], ry = y - ISO[1], rz = z - ISO[2];
  Fs.k1[i] = arcK(ARCS[0], rx, ry, rz); Fs.k2[i] = arcK(ARCS[1], rx, ry, rz); Fs.k3[i] = arcK(ARCS[2], rx, ry, rz);
  const dx = x - PALM[0], dy = y - PALM[1], dz = z - PALM[2];
  Fs.hot[i] = 1 + 0.03 * Math.exp(-(dx * dx + dy * dy + dz * dz) / 32);
}
function unscaled(Fs, i, P) {
  const dT = Fs.dT[i]; let c = 1; if (dT > 0) { const q = dT / P.lam; c = 1 / (1 + q * q); }
  return (1 - P.beta * Fs.nn[i]) * ((1 - ETA) * c + ETA * (P.w[0] * Fs.k1[i] + P.w[1] * Fs.k2[i] + P.w[2] * Fs.k3[i])) * Fs.hot[i];
}
const ONE = factorSet(1);
function doseAt(P, x, y, z) { fillFactors(ONE, 0, x, y, z); return P.S * unscaled(ONE, 0, P); }

// Organ samples (1.0-mm sampling of each structure; the DVH is integrated over these).
const ORG = [
  { id: 'ptv', n: 1000, sdf: sdTarget, b0: [4, 18, -14], b1: [40, 56, 18] },
  { id: 'lon', n: 720, nerve: NERVE_L },
  { id: 'ron', n: 120, nerve: NERVE_R },
  { id: 'chi', n: 150, sdf: sdChiasm, b0: [-17, 4, -8], b1: [17, 24, 4] },
  { id: 'bst', n: 360, sdf: sdBrainstem, b0: [-16, -30, -74], b1: [16, 16, 12] },
  { id: 'lnl', n: 60, sdf: sdLensL, b0: [26, 71, -1], b1: [36, 76, 9] },
  { id: 'lnr', n: 60, sdf: sdLensR, b0: [-36, 71, -1], b1: [-26, 76, 9] },
  { id: 'pal', n: 260, sdf: sdParotidL, b0: [32, -14, -66], b1: [64, 32, -8] },
  { id: 'par', n: 260, sdf: sdParotidR, b0: [-64, -14, -66], b1: [-32, 32, -8] },
];
const ORGI = Object.fromEntries(ORG.map((o, i) => [o.id, i]));
function buildSamples() {
  const r = mulberry32(0x150d05e);
  for (const o of ORG) {
    const pts = new Float32Array(3 * o.n);
    if (o.nerve) {
      for (let i = 0; i < o.n; i++) {
        const q = pointAt(o.nerve, o.nerve.len * (i + 0.5) / o.n), rho = R_NERVE * 0.95 * Math.sqrt(r()), a = 2 * Math.PI * r();
        let ux = -q[5] * q[3], uy = -q[5] * q[4], uz = 1 - q[5] * q[5]; const lu = Math.hypot(ux, uy, uz); ux /= lu; uy /= lu; uz /= lu;
        const wx = q[4] * uz - q[5] * uy, wy = q[5] * ux - q[3] * uz, wz = q[3] * uy - q[4] * ux;
        const c = Math.cos(a) * rho, s = Math.sin(a) * rho;
        pts[3 * i] = q[0] + ux * c + wx * s; pts[3 * i + 1] = q[1] + uy * c + wy * s; pts[3 * i + 2] = q[2] + uz * c + wz * s;
      }
    } else {
      let i = 0, guard = 0;
      while (i < o.n && guard++ < 400000) {
        const x = lerp(o.b0[0], o.b1[0], r()), y = lerp(o.b0[1], o.b1[1], r()), z = lerp(o.b0[2], o.b1[2], r());
        if (o.sdf(x, y, z) < 0) { pts[3 * i] = x; pts[3 * i + 1] = y; pts[3 * i + 2] = z; i++; }
      }
      o.n = i;
    }
    o.pts = pts;
    o.F = factorSet(o.n);
    for (let i = 0; i < o.n; i++) fillFactors(o.F, i, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    o.dose = new Float32Array(o.n);
  }
}
// Solve S (coverage V95 of the PTV) and β (the nerve max) for the optimiser's targets.
// The PTV has 1,000 samples, so V95 moves in 0.1 % steps: the sample that must sit on 62.7 Gy
// is chosen by ROUNDING (a floor put the plan one sample — 0.1 % — above the model), and S is
// solved last against the final β, a hair above the level so float32 storage cannot drop it.
// The sampled V95 is then exactly the model's coverage to 0.1 %, for every iteration.
function calibrate(P, cov, nmax) {
  const T = ORG[ORGI.ptv], N = ORG[ORGI.lon], u = new Float64Array(T.n);
  const idx = clamp(Math.round((1 - cov) * T.n), 0, T.n - 1);
  const solveS = () => { for (let i = 0; i < T.n; i++) u[i] = unscaled(T.F, i, P); u.sort(); P.S = LEVEL_GY[0] * (1 + 2e-7) / u[idx]; };
  for (let it = 0; it < 8; it++) {
    solveS();
    let lo = 0, hi = 0.8;
    for (let b = 0; b < 32; b++) {
      const mid = (lo + hi) / 2; P.beta = mid; let mx = 0;
      for (let j = 0; j < N.n; j++) { const d = unscaled(N.F, j, P); if (d > mx) mx = d; }
      if (P.S * mx > nmax) lo = mid; else hi = mid;
    }
    P.beta = (lo + hi) / 2;
  }
  solveS();
}
// Coverage as printed anywhere: the plan's sampled V95 when the iterate has been computed; for the
// log's history lines (iterates before this session) the same model rounded the same way.
function covPrint(i) { const st = PLANS.get(i); return st ? st.org.cov : Math.round(10 * covOf(i)) / 10; }
function nervePrint(i) { const st = PLANS.get(i); return st ? st.org.lon.max : nerveOf(i); }
// Organ statistics + cumulative DVH (0–72 Gy, 0.5-Gy bins) from the same field.
const DVH_BINS = 145, DVH_STEP = 0.5;
const CURVES = [
  { id: 'ptv', name: 'PTV 66', orgs: ['ptv'] },
  { id: 'lon', name: 'L OPTIC NERVE', orgs: ['lon'] },
  { id: 'chi', name: 'CHIASM', orgs: ['chi'] },
  { id: 'bst', name: 'BRAINSTEM', orgs: ['bst'] },
  { id: 'ron', name: 'R OPTIC NERVE', orgs: ['ron'] },
  { id: 'lens', name: 'LENSES', orgs: ['lnl', 'lnr'] },
  { id: 'par', name: 'PAROTIDS', orgs: ['pal', 'par'] },
];
function organStats(P) {
  const st = {};
  for (const o of ORG) {
    let mx = 0, sum = 0, hot = 0;
    for (let i = 0; i < o.n; i++) { const d = P.S * unscaled(o.F, i, P); o.dose[i] = d; sum += d; if (d > mx) { mx = d; hot = i; } }
    const sorted = Float32Array.from(o.dose).sort();
    st[o.id] = { max: mx, mean: sum / o.n, sorted, hot: [o.pts[3 * hot], o.pts[3 * hot + 1], o.pts[3 * hot + 2]] };
  }
  let c = 0; const T = st.ptv.sorted; for (let i = 0; i < T.length; i++) if (T[i] >= LEVEL_GY[0]) c++;
  st.cov = 100 * c / T.length;
  st.curves = CURVES.map(cv => {
    const arrs = cv.orgs.map(id => st[id].sorted), n = arrs.reduce((s, a) => s + a.length, 0), out = new Float32Array(DVH_BINS);
    for (let b = 0; b < DVH_BINS; b++) { const d = b * DVH_STEP; let cnt = 0; for (const a of arrs) cnt += a.length - lowerBound(a, d); out[b] = 100 * cnt / n; }
    return out;
  });
  const pa = st.pal, pr = st.par;
  st.parMean = (pa.mean * pa.sorted.length + pr.mean * pr.sorted.length) / (pa.sorted.length + pr.sorted.length);
  return st;
}
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }

// Isodose shells: a grid of factors per shell (fixed in space), re-meshed on the beat.
const SHG = [{ half: 17, h: 1.7 }, { half: 26, h: 2.3 }, { half: 40, h: 3.2 }, { half: 64, h: 4.6 }];
const SH = [];
function buildShellGrids() {
  for (const g of SHG) {
    const n = Math.ceil(2 * g.half / g.h) + 1, N = n * n * n, b0 = [ISO[0] - g.half, ISO[1] - g.half, ISO[2] - g.half];
    const G = { n, nx: n, ny: n, nz: n, h: g.h, b0, F: factorSet(N), val: new Float32Array(N) };
    let i = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let ii = 0; ii < n; ii++, i++) fillFactors(G.F, i, b0[0] + ii * g.h, b0[1] + j * g.h, b0[2] + k * g.h);
    SH.push(G);
  }
}
function meshShell(s, P) {
  const G = SH[s], n = G.n, N = n * n * n, lvl = LEVEL_GY[s];
  for (let i = 0; i < N; i++) G.val[i] = lvl - P.S * unscaled(G.F, i, P);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === n - 1) G.val[i + j * n + k * n * n] = 1;
  }
  const m = surfaceNets(G, null, 1);
  m.az = new Float32Array(m.nf);                      // gantry azimuth (ARC 1 frame) of each face, for the re-form wipe
  for (let f = 0; f < m.nf; f++) m.az[f] = wrap360(Math.atan2(m.fc[3 * f] - ISO[0], m.fc[3 * f + 1] - ISO[1]) / DEG);
  return m;
}

// Plan state for iteration i — built as a small job over 4 steps (calibration and organs in the
// sweep-start timer; then shells 0–1, shell 2, shell 3 + anchors, one per hero frame) so no frame
// interval at the beat carries more than a few ms; the re-form trails the fan by REVEAL_LAG, so
// the new shells are complete before any of them is revealed.
const PLANS = new Map();
function planParams(i) { return { S: 70, beta: 0.1, lam: lamOf(i), w: weightsOf(i) }; }
function planJob(i) {
  const job = { i, step: 0, done: false, st: null };
  job.run = () => {
    if (job.done) return true;
    if (job.step === 0) {
      const P = planParams(i);
      calibrate(P, covOf(i) / 100, nerveOf(i));
      job.st = { i, P, org: organStats(P), shells: [null, null, null, null], vols: [0, 0, 0, 0] };
      job.step = 1; return false;
    }
    const S = job.st;
    if (job.step === 1) { S.shells[0] = meshShell(0, S.P); S.shells[1] = meshShell(1, S.P); job.step = 2; return false; }
    if (job.step === 2) { S.shells[2] = meshShell(2, S.P); job.step = 3; return false; }
    S.shells[3] = meshShell(3, S.P);
    S.vols = S.shells.map(m => Math.abs(m.vol) / 1000);
    S.mu = ARCS.map((A, a) => A.mu0 * (S.P.S * S.P.w[a]) / (BASE.S * BASE.w[a]));
    S.anch = shellAnchors(S);
    job.done = true; PLANS.set(i, S);
    for (const k of PLANS.keys()) if (k < i - 1 || k > i + 1) PLANS.delete(k);
    return true;
  };
  return job;
}
function planNow(i) { const cached = PLANS.get(i); if (cached) return cached; const j = planJob(i); while (!j.run()); return j.st; }
function shellAnchors(S) {
  const dirs = [[-0.25, 0.35, 0.9], [0, 0.5, -0.85], [0.1, 0.2, -1], [-0.2, -1, 0.55]];
  return S.shells.map((m, s) => {
    const d = dirs[s]; let best = -Infinity, bi = 0;
    for (let v = 0; v < m.nv; v++) { const q = (m.px[v] - ISO[0]) * d[0] + (m.py[v] - ISO[1]) * d[1] + (m.pz[v] - ISO[2]) * d[2]; if (q > best) { best = q; bi = v; } }
    return [m.px[bi], m.py[bi], m.pz[bi]];
  });
}
let BASE = { S: 70, w: [0.4, 0.33, 0.27] };
let REV13 = null;

// MU per control point: the optimiser's modulation (less where the beam runs along the nerve).
function muProfile(a, i, mu) {
  const A = ARCS[a], n = A.cp, out = new Float32Array(n), T = [-0.603, -0.788, -0.123];
  let sum = 0;
  for (let c = 0; c < n; c++) {
    const th = (A.lo / DEG + (A.spanDeg * c) / (n - 1)) * DEG;
    const sx = Math.cos(th) * A.b0[0] + Math.sin(th) * A.b1[0], sy = Math.cos(th) * A.b0[1] + Math.sin(th) * A.b1[1], sz = Math.cos(th) * A.b0[2] + Math.sin(th) * A.b1[2];
    const along = Math.abs(sx * T[0] + sy * T[1] + sz * T[2]);
    let v = 1 + 0.32 * Math.sin(3 * th + a * 1.7 + 0.05 * (i - ITER0)) + 0.18 * Math.sin(7 * th + a * 2.9 - 0.03 * (i - ITER0)) + 0.1 * Math.cos(13 * th + a);
    v *= 1 - 0.42 * along * along;
    out[c] = A.avoid && wrap360(th / DEG - A.avoid[0]) < wrap360(A.avoid[1] - A.avoid[0]) ? 0 : Math.max(0.12, v); sum += out[c];
  }
  for (let c = 0; c < n; c++) out[c] *= mu / sum;
  return out;
}

// =============================================================================
// SCENE MESHES + SURFACE STYLES
// =============================================================================

const M = {};
function buildAnatomy() {
  M.skin = surfaceNets(gridSDF(sdSkin, [-86, -114, -154], [86, 124, 120], 11), sdSkin, 2);
  M.bone = surfaceNets(gridSDF(sdBone, [-80, -106, -160], [80, 102, 114], 7), sdBone, 2);
  M.globeL = surfaceNets(gridSDF(sdGlobeL, [17, 49, -10], [45, 77, 18], 3.4), sdGlobeL, 1);
  M.globeR = surfaceNets(gridSDF(sdGlobeR, [-45, 49, -10], [-17, 77, 18], 3.4), sdGlobeR, 1);
  M.lensL = surfaceNets(gridSDF(sdLensL, [25, 70, -2], [37, 78, 10], 1.4), sdLensL, 1);
  M.lensR = surfaceNets(gridSDF(sdLensR, [-37, 70, -2], [-25, 78, 10], 1.4), sdLensR, 1);
  M.nerveL = tubeMesh(NERVE_L, R_NERVE, 2.2, 10);
  M.nerveR = tubeMesh(NERVE_R, R_NERVE, 2.2, 10);
  M.chiasm = surfaceNets(gridSDF(sdChiasm, [-19, 2, -9], [19, 26, 5], 2.0), sdChiasm, 1);
  M.brainstem = surfaceNets(gridSDF(sdBrainstem, [-18, -34, -78], [18, 18, 14], 4.2), sdBrainstem, 1);
  M.parL = surfaceNets(gridSDF(sdParotidL, [30, -16, -68], [66, 38, -6], 4.4), sdParotidL, 1);
  M.parR = surfaceNets(gridSDF(sdParotidR, [-66, -16, -68], [-30, 38, -6], 4.4), sdParotidR, 1);
  M.target = surfaceNets(gridSDF(sdTarget, [4, 18, -14], [40, 56, 18], 1.9), sdTarget, 2);
  ISO = M.target.cen.slice();
  // the palm of the cuff: the closed side at the cuff's centre
  const q = pointAt(NERVE_L, TGT.sc), tx = q[3], ty = q[4], tz = q[5];
  let n1x = -tz * tx, n1y = -tz * ty, n1z = 1 - tz * tz; const l1 = Math.hypot(n1x, n1y, n1z); n1x /= l1; n1y /= l1; n1z /= l1;
  const n2x = ty * n1z - tz * n1y, n2y = tz * n1x - tx * n1z, n2z = tx * n1y - ty * n1x;
  const pc = TGT.open + Math.PI, cc = Math.cos(pc), ss = Math.sin(pc);
  PALM = [q[0] + TGT.ra * (cc * n1x + ss * n2x), q[1] + TGT.ra * (cc * n1y + ss * n2y), q[2] + TGT.ra * (cc * n1z + ss * n2z)];
  // jaws and aperture fitted to the target's projection per arc (+ margins), as a TPS does
  for (const A of ARCS) {
    let zmax = 0, rmax = 0; const m = M.target;
    for (let v = 0; v < m.nv; v++) {
      const x = m.px[v] - ISO[0], y = m.py[v] - ISO[1], z = m.pz[v] - ISO[2];
      const za = Math.abs(x * A.g[0] + y * A.g[1] + z * A.g[2]), u = x * A.b0[0] + y * A.b0[1] + z * A.b0[2], w = x * A.b1[0] + y * A.b1[1] + z * A.b1[2];
      if (za > zmax) zmax = za; const r = Math.hypot(u, w); if (r > rmax) rmax = r;
    }
    A.hz = zmax + 4; A.w = rmax + 1; A.jaw = 2 * (zmax + 4); A.field = 2 * (rmax + 1);
  }
  for (const k of OUTER) { const m = M[k]; OUTER_C[k] = m.cen[0] || m.cen[1] ? m.cen : centroidOf(m); }
}
function centroidOf(m) { let x = 0, y = 0, z = 0; for (let v = 0; v < m.nv; v++) { x += m.px[v]; y += m.py[v]; z += m.pz[v]; } return [x / m.nv, y / m.nv, z / m.nv]; }
const OUTER = ['globeL', 'globeR', 'lensL', 'lensR', 'nerveR', 'brainstem', 'parL', 'parR'];
const OUTER_SURF = { globeL: 'globe', globeR: 'globe', lensL: 'lens', lensR: 'lens', nerveR: 'nerveR', brainstem: 'oar', parL: 'oar', parR: 'oar' };
const OUTER_C = {};
const INNER = ['chiasm', 'nerveL', 'target'];

const NS = 10, NA = 6, NSTYLE = NS * NA;
function styleSet(c, amax, bright) {
  const out = [];
  for (let s = 0; s < NS; s++) for (let a = 0; a < NA; a++) {
    const k = (0.28 + 0.9 * s / (NS - 1)) * bright;
    out.push('rgba(' + Math.min(255, Math.round(c[0] * k)) + ',' + Math.min(255, Math.round(c[1] * k)) + ',' + Math.min(255, Math.round(c[2] * k)) + ',' + (amax * (0.3 + 0.7 * a / (NA - 1))).toFixed(3) + ')');
  }
  return out;
}
const SURF = {
  skin: { c: C_SKIN, af: 0.05, ab: 0.028, fres: 1.4 },
  bone: { c: C_DATA, af: 0.07, ab: 0.035, fres: 1.1 },
  globe: { c: C_DATA, af: 0.2, ab: 0.07, fres: 1.2 },
  lens: { c: hexRgb('#BFD2C6'), af: 1, ab: 0, fres: 0 },
  nerveR: { c: C_DATA, af: 0.5, ab: 0, fres: 0.3 },
  oar: { c: C_OAR, af: 0.11, ab: 0.035, fres: 0.9 },
  chi: { c: hexRgb('#EEEBDD'), af: 1, ab: 0, fres: 0 },
  nerve: { c: C_NERVE, af: 1, ab: 0, fres: 0 },
  target: { c: C_TGT, af: 1, ab: 0, fres: 0, br: 1.15 },
  brain: { c: hexRgb('#66E6FF'), af: 0.065, ab: 0.018, fres: 1.7, br: 1.1 },
  scanBone: { c: C_DATA, af: 0.085, ab: 0.04, fres: 1.15, br: 1.05 },
  scanGlobe: { c: C_DATA, af: 0.2, ab: 0.07, fres: 1.2 },
  scanLens: { c: hexRgb('#BFD2C6'), af: 1, ab: 0, fres: 0 },
};
const SHELL_SURF = C_SHELL.map(c => ({ c, af: 0.34, ab: 0.13, fres: 0.8, br: 1.2 }));
for (const s of [...Object.values(SURF), ...SHELL_SURF]) { s.front = styleSet(s.c, s.af, s.br || 1); s.back = s.ab > 0 ? styleSet(s.c, s.ab, 0.7 * (s.br || 1)) : null; }
const SHELL_WAKE = C_SHELL.map(c => styleSet(c, 0.34, 1.4));
// The review's selection (REVIEW, below): each surface it can select has 4 levels, 0 = as drawn,
// 3 = selected (brighter, and the translucent organs denser); the levels step through its crossfade.
const LV_N = 4;
function levelSets(s) {
  const out = [{ front: s.front, back: s.back }];
  const afS = s.af >= 1 ? 1 : Math.min(0.9, s.af * 2.1), abS = s.ab * 1.5;
  for (let q = 1; q < LV_N; q++) {
    const k = q / (LV_N - 1), br = 1 + 0.3 * k;
    const bb = br * (s.br || 1);
    out.push({ front: styleSet(s.c, s.af + (afS - s.af) * k, bb), back: s.ab > 0 ? styleSet(s.c, s.ab + (abS - s.ab) * k, 0.7 * bb) : null });
  }
  return out;
}
for (const s of [SURF.target, SURF.nerve, SURF.nerveR, SURF.chi, SURF.oar, SURF.lens]) s.lv = levelSets(s);


// =============================================================================
// SCAN LAYERS ? real MRI/CT/PET assets, lazy-loaded and off by default
// =============================================================================

const SCAN = {
  brain: null, skull: null, eyes: null, lenses: null, pet: null,
  brainOn: false, skullOn: false, eyesOn: true
};

function meshFromBin(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'ISOB') throw new Error('bad mesh header');
  const version = dv.getUint16(4, true), kind = dv.getUint16(6, true);
  const nv = dv.getUint32(8, true), nf = dv.getUint32(12, true);
  if (version !== 1 || kind !== 0) throw new Error('unsupported mesh');
  let off = 16;
  const P = new Float64Array(nv * 3);
  const pos = new Float32Array(buf, off, nv * 3); P.set(pos); off += nv * 12;
  const F = new Uint32Array(nf * 3);
  F.set(new Uint32Array(buf, off, nf * 3));
  return finalizeMesh(P, Array.from(F));
}

function pointsFromBin(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'ISOP') throw new Error('bad point header');
  const version = dv.getUint16(4, true), kind = dv.getUint16(6, true);
  const n = dv.getUint32(8, true);
  if (version !== 1 || kind !== 1) throw new Error('unsupported points');
  const off = 12;
  return {
    pts: new Float32Array(buf, off, n * 3),
    val: new Float32Array(buf, off + n * 12, n)
  };
}

async function fetchAsset(path) {
  const res = await fetch(path + '?v=3', { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
  return res.arrayBuffer();
}

async function loadScanAsset(kind) {
  if (SCAN[kind]) return SCAN[kind];
  const base = '../assets/isodose/';
  if (kind === 'brain') SCAN.brain = meshFromBin(await fetchAsset(base + 'brain.bin'));
  else if (kind === 'skull') SCAN.skull = meshFromBin(await fetchAsset(base + 'skull.bin'));
  else if (kind === 'eyes') SCAN.eyes = meshFromBin(await fetchAsset(base + 'eyes.bin'));
  else if (kind === 'lenses') SCAN.lenses = meshFromBin(await fetchAsset(base + 'lenses.bin'));
  else if (kind === 'pet') SCAN.pet = pointsFromBin(await fetchAsset(base + 'pet.bin'));
  return SCAN[kind];
}

function scanButton(kind, on, state) {
  const btn = $(kind === 'brain' ? 'tg-brain' : kind === 'skull' ? 'tg-skull' : 'tg-eyes');
  if (!btn) return;
  btn.classList.toggle('busy', state === 'busy');
  btn.classList.toggle('fail', state === 'fail');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const b = btn.querySelector('b');
  if (b) b.textContent = state === 'busy' ? 'LOAD' : state === 'fail' ? 'ERR' : on ? 'ON' : 'OFF';
}

function toggleEyes() {
  SCAN.eyesOn = !SCAN.eyesOn;
  scanButton('eyes', SCAN.eyesOn);
  renderHero(performance.now());
}

async function toggleScan(kind) {
  const onKey = kind === 'brain' ? 'brainOn' : 'skullOn';
  if (SCAN[onKey]) { SCAN[onKey] = false; scanButton(kind, false); renderHero(performance.now()); return; }
  scanButton(kind, false, 'busy');
  try {
    if (kind === 'brain') { await Promise.all([loadScanAsset('brain'), loadScanAsset('pet')]); }
    else { await Promise.all([loadScanAsset('skull'), loadScanAsset('eyes'), loadScanAsset('lenses')]); }
    SCAN[onKey] = true;
    scanButton(kind, true);
    renderHero(performance.now());
  } catch (e) {
    console.warn('[isodose] scan asset failed:', e);
    SCAN[onKey] = false;
    scanButton(kind, false, 'fail');
    setTimeout(() => scanButton(kind, false), 2400);
  }
}

function wireScanToggles() {
  const b = $('tg-brain'), k = $('tg-skull'), e = $('tg-eyes');
  if (b) b.addEventListener('click', () => toggleScan('brain'));
  if (k) k.addEventListener('click', () => toggleScan('skull'));
  if (e) e.addEventListener('click', toggleEyes);
}


function resetView() {
  VIEW.az = 0; VIEW.el = 0; VIEW.zoom = 1; VIEW.manual = false;
  VIEW.baseAz = CAM.autoAz; VIEW.baseEl = CAM.autoEl;
  renderHero(performance.now());
}
function wireViewControls(rec) {
  if (!rec || !rec.cv) return;
  const cv = rec.cv;
  cv.style.cursor = 'grab';
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    if (!VIEW.manual) { VIEW.manual = true; VIEW.baseAz = CAM.autoAz; VIEW.baseEl = CAM.autoEl; }
    VIEW.dragging = true; VIEW.lastX = e.clientX; VIEW.lastY = e.clientY;
    cv.classList.add('dragging'); cv.style.cursor = 'grabbing';
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!VIEW.dragging) return;
    const dx = e.clientX - VIEW.lastX, dy = e.clientY - VIEW.lastY;
    VIEW.lastX = e.clientX; VIEW.lastY = e.clientY;
    VIEW.az -= dx * 0.38;
    VIEW.el = clamp(VIEW.el + dy * 0.32, -63, 63);
    renderHero(performance.now());
  });
  const end = (e) => {
    if (!VIEW.dragging) return;
    VIEW.dragging = false; cv.classList.remove('dragging'); cv.style.cursor = 'grab';
    if (cv.releasePointerCapture && e && e.pointerId != null) { try { cv.releasePointerCapture(e.pointerId); } catch (_) {} }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    VIEW.zoom = clamp(VIEW.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 2.5);
    renderHero(performance.now());
  }, { passive: false });
  cv.addEventListener('dblclick', resetView);
}

// =============================================================================
// CAMERA (a pure function of u: orbit ≤ 0.4 °/s, the focus pull on second beats)
// =============================================================================

const CAM = { eye: [0, 0, 0], R: [1, 0, 0], U: [0, 0, 1], F: [0, 1, 0], f: 1000, cx: 0, cy: 0, az: 18, el: 12, zoom: 0, pxmm: 3, look: [0, 0, 0], autoAz: 18, autoEl: 12 };
const VIEW = { az: 0, el: 0, zoom: 1, manual: false, dragging: false, lastX: 0, lastY: 0, baseAz: 18, baseEl: 12 };
const FOV = 20 * DEG;
const LOOK_W = [2, 8, 3];
function zoomAt(u) {
  if (u < SECOND_U0) return 0;
  const k = Math.min(N_BEAT - 1, Math.floor((u - SECOND_U0) / BEAT_DT));
  const p = smooth((u - (SECOND_U0 + k * BEAT_DT)) / DOLLY_S);
  return k % 2 === 0 ? p : 1 - p;
}
function setCamera(u, W, H) {
  const autoAz = 18 + 16 * Math.sin(2 * Math.PI * u / 270);
  const autoEl = 12 + 3 * Math.sin(2 * Math.PI * u / 540);
  CAM.autoAz = autoAz; CAM.autoEl = autoEl;
  const az = (VIEW.manual ? VIEW.baseAz : autoAz) + VIEW.az;
  const el = clamp((VIEW.manual ? VIEW.baseEl : autoEl) + VIEW.el, -75, 75);
  const z = zoomAt(u);
  const f = (H / 2) / Math.tan(FOV / 2);
  const pxW = Math.min((H - 18) / 222, (W * 0.64) / 238);
  // the focus pull: ×1.35 at its deepest, the look-at point moving 60 % of the way to the nerve,
  // so the dome, the face and the jaw stay in frame — the head still reads at thumbnail size
  const distW = f / pxW, distC = distW / 1.35;
  const lookC = [ISO[0] - 3, ISO[1] + 2, ISO[2] + 4], zl = 0.6 * z;
  const look = [lerp(LOOK_W[0], lookC[0], zl), lerp(LOOK_W[1], lookC[1], zl), lerp(LOOK_W[2], lookC[2], zl)];
  const dist = distW * Math.pow(distC / distW, z) * VIEW.zoom;
  const a = az * DEG, e = el * DEG;
  const dir = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  CAM.eye = [look[0] + dir[0] * dist, look[1] + dir[1] * dist, look[2] + dir[2] * dist];
  const Fv = [-dir[0], -dir[1], -dir[2]];
  const r0 = Fv[1], r1 = -Fv[0], rl = Math.hypot(r0, r1);
  CAM.R = [r0 / rl, r1 / rl, 0];
  CAM.U = [CAM.R[1] * Fv[2] - CAM.R[2] * Fv[1], CAM.R[2] * Fv[0] - CAM.R[0] * Fv[2], CAM.R[0] * Fv[1] - CAM.R[1] * Fv[0]];
  CAM.F = Fv; CAM.f = f; CAM.cx = W * 0.5; CAM.cy = H * 0.5; CAM.az = az; CAM.el = el; CAM.zoom = z; CAM.look = look;
  CAM.pxmm = f / dist; CAM.mag = distW / dist;
}
function projPt(x, y, z, out) {
  const dx = x - CAM.eye[0], dy = y - CAM.eye[1], dz = z - CAM.eye[2];
  const zc = dx * CAM.F[0] + dy * CAM.F[1] + dz * CAM.F[2], iz = CAM.f / zc;
  out[0] = CAM.cx + (dx * CAM.R[0] + dy * CAM.R[1] + dz * CAM.R[2]) * iz;
  out[1] = CAM.cy - (dx * CAM.U[0] + dy * CAM.U[1] + dz * CAM.U[2]) * iz;
  out[2] = zc;
  return out;
}
const PP = new Float64Array(3), PQ = new Float64Array(3), PR = new Float64Array(3);

// =============================================================================
// RENDERER — project, light, sort, batch
// =============================================================================

function project(m) {
  const ex = CAM.eye[0], ey = CAM.eye[1], ez = CAM.eye[2], R = CAM.R, U = CAM.U, F = CAM.F, f = CAM.f, cx = CAM.cx, cy = CAM.cy;
  for (let v = 0; v < m.nv; v++) {
    const dx = m.px[v] - ex, dy = m.py[v] - ey, dz = m.pz[v] - ez;
    const zc = dx * F[0] + dy * F[1] + dz * F[2], iz = f / zc;
    m.sx[v] = cx + (dx * R[0] + dy * R[1] + dz * R[2]) * iz;
    m.sy[v] = cy - (dx * U[0] + dy * U[1] + dz * U[2]) * iz;
    m.sd[v] = zc;
  }
}
const LK = (() => { const v = [0.45, 0.55, 0.7], l = Math.hypot(...v); return v.map(x => x / l); })();
const LF = (() => { const v = [-0.6, -0.2, -0.35], l = Math.hypot(...v); return v.map(x => x / l); })();
function classify(m, sp) {
  const ex = CAM.eye[0], ey = CAM.eye[1], ez = CAM.eye[2];
  for (let f = 0; f < m.nf; f++) {
    const nx = m.fn[3 * f], ny = m.fn[3 * f + 1], nz = m.fn[3 * f + 2];
    const vx = ex - m.fc[3 * f], vy = ey - m.fc[3 * f + 1], vz = ez - m.fc[3 * f + 2];
    const nd = nx * vx + ny * vy + nz * vz, front = nd > 0 ? 1 : 0, sg = front ? 1 : -1;
    const kd = sg * (nx * LK[0] + ny * LK[1] + nz * LK[2]), kf = sg * (nx * LF[0] + ny * LF[1] + nz * LF[2]);
    let I = 0.30 + 0.62 * (kd > 0 ? kd : 0) + 0.22 * (kf > 0 ? kf : 0); if (I > 1) I = 1;
    const cosv = Math.abs(nd) / Math.sqrt(vx * vx + vy * vy + vz * vz);
    const a = sp.fres > 0 ? 0.25 + 0.75 * Math.pow(1 - cosv, sp.fres) : 1;
    m.facing[f] = front;
    m.style[f] = Math.round(I * (NS - 1)) * NA + Math.round(a * (NA - 1));
  }
}
const CNT = new Int32Array(NSTYLE), OFF = new Int32Array(NSTYLE), ORD = new Int32Array(60000);
let hctx = null, wipeA0 = 181;                       // wipeA0: the angle ARC 1's pass (and so the re-form wipe) starts from
// mode 0: every face · 1: the old mesh ahead of the sweep · 2: the new mesh behind it (wake band brighter)
function drawBuckets(m, wantFront, strs, mode, p, cw, wake) {
  if (!strs || !m) return;
  const nb = wake ? 2 * NSTYLE : NSTYLE;
  const cnt = BCNT, off = BOFF;
  cnt.fill(0, 0, nb);
  const az = m.az, a0 = wipeA0, span = 358;
  for (let f = 0; f < m.nf; f++) {
    if (m.facing[f] !== wantFront) continue;
    let st = m.style[f] % NSTYLE;
    if (mode) {
      const g = (cw ? wrap360(az[f] - a0) : wrap360(a0 - az[f])) / span * N_SUBS[0];      // 1 = the far end of the sector ARC 1 covers this pass
      if (mode === 1 && g < p) continue;
      if (mode === 2) { if (p <= 1 && g >= p) continue; if (wake && g > p - 0.1 && g <= p) st += NSTYLE; }
    }
    FST[f] = st; cnt[st]++;
  }
  let acc = 0; for (let s = 0; s < nb; s++) { off[s] = acc; acc += cnt[s]; }
  for (let f = 0; f < m.nf; f++) {
    if (m.facing[f] !== wantFront) continue;
    if (mode) {
      const g = (cw ? wrap360(az[f] - a0) : wrap360(a0 - az[f])) / span * N_SUBS[0];
      if (mode === 1 && g < p) continue;
      if (mode === 2 && p <= 1 && g >= p) continue;
    }
    ORD[off[FST[f]]++] = f;
  }
  const ctx = hctx, fi = m.fi, sx = m.sx, sy = m.sy;
  let start = 0;
  for (let s = 0; s < nb; s++) {
    const c = cnt[s]; if (!c) continue;
    ctx.fillStyle = s >= NSTYLE ? wake[s - NSTYLE] : strs[s];
    ctx.beginPath();
    for (let q = start; q < start + c; q++) { const f = ORD[q], a = fi[3 * f], b = fi[3 * f + 1], d = fi[3 * f + 2]; ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[d], sy[d]); }
    ctx.fill();
    start += c;
  }
}
const BCNT = new Int32Array(2 * NSTYLE), BOFF = new Int32Array(2 * NSTYLE), FST = new Uint16Array(60000);
function drawOpaque(m, strs) {                       // opaque surface: fill + a same-colour 0.5-px stroke hides AA seams
  CNT.fill(0);
  let n = 0;
  for (let f = 0; f < m.nf; f++) if (m.facing[f]) { CNT[m.style[f]]++; n++; }
  if (!n) return;
  let acc = 0; for (let s = 0; s < NSTYLE; s++) { OFF[s] = acc; acc += CNT[s]; }
  for (let f = 0; f < m.nf; f++) if (m.facing[f]) ORD[OFF[m.style[f]]++] = f;
  const ctx = hctx; let start = 0;
  ctx.lineWidth = 0.5; ctx.lineJoin = 'round';
  for (let s = 0; s < NSTYLE; s++) {
    const c = CNT[s]; if (!c) continue;
    ctx.fillStyle = strs[s]; ctx.strokeStyle = strs[s]; ctx.beginPath();
    for (let q = start; q < start + c; q++) { const f = ORD[q], a = m.fi[3 * f], b = m.fi[3 * f + 1], d = m.fi[3 * f + 2]; ctx.moveTo(m.sx[a], m.sy[a]); ctx.lineTo(m.sx[b], m.sy[b]); ctx.lineTo(m.sx[d], m.sy[d]); }
    ctx.fill(); ctx.stroke();
    start += c;
  }
}
// Painter's sort for the interleaved opaque structures (the nerve runs through the cuff).
const DB = 128, BK = new Int32Array(DB + 1), BIN_F = new Int32Array(8000), BIN_M = new Uint8Array(8000), TMP_B = new Int32Array(8000), TMP_F = new Int32Array(8000), TMP_M = new Uint8Array(8000);
function drawInner() {
  const list = INNER.map(k => M[k]), surfs = [meshSurf('chiasm', SURF.chi), meshSurf('nerveL', SURF.nerve), meshSurf('target', SURF.target)];
  let zmin = Infinity, zmax = -Infinity;
  for (const m of list) for (let v = 0; v < m.nv; v++) { const d = m.sd[v]; if (d < zmin) zmin = d; if (d > zmax) zmax = d; }
  const sc = DB / Math.max(1e-6, zmax - zmin);
  BK.fill(0);
  let n = 0;
  list.forEach((m, mi) => {
    for (let f = 0; f < m.nf; f++) {
      if (!m.facing[f]) continue;
      const a = m.fi[3 * f], b = m.fi[3 * f + 1], c = m.fi[3 * f + 2];
      const bi = Math.min(DB - 1, Math.max(0, Math.floor((zmax - (m.sd[a] + m.sd[b] + m.sd[c]) / 3) * sc)));
      BK[bi + 1]++; TMP_B[n] = bi; TMP_F[n] = f; TMP_M[n] = mi; n++;
    }
  });
  for (let i = 1; i <= DB; i++) BK[i] += BK[i - 1];
  for (let q = 0; q < n; q++) { const o = BK[TMP_B[q]]++; BIN_F[o] = TMP_F[q]; BIN_M[o] = TMP_M[q]; }
  const ctx = hctx;
  let lastS = -1, lastM = -1, open = false;
  ctx.lineWidth = 0.5; ctx.lineJoin = 'round';
  for (let q = 0; q < n; q++) {
    const mi = BIN_M[q], m = list[mi], f = BIN_F[q], st = m.style[f];
    if (st !== lastS || mi !== lastM) {
      if (open) { ctx.fill(); ctx.stroke(); }
      const s = surfs[mi].front[st]; ctx.fillStyle = s; ctx.strokeStyle = s; ctx.beginPath(); open = true; lastS = st; lastM = mi;
    }
    const a = m.fi[3 * f], b = m.fi[3 * f + 1], c = m.fi[3 * f + 2];
    ctx.moveTo(m.sx[a], m.sy[a]); ctx.lineTo(m.sx[b], m.sy[b]); ctx.lineTo(m.sx[c], m.sy[c]);
  }
  if (open) { ctx.fill(); ctx.stroke(); }
}
function silhouette(m, style, lw) {
  if (!m) return;
  const ctx = hctx;
  ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath();
  for (let e = 0; e < m.ne; e++) {
    const f0 = m.ef[2 * e], f1 = m.ef[2 * e + 1];
    if (f1 < 0 || m.facing[f0] === m.facing[f1]) continue;
    if (m.fn[3 * f0] * m.fn[3 * f1] + m.fn[3 * f0 + 1] * m.fn[3 * f1 + 1] + m.fn[3 * f0 + 2] * m.fn[3 * f1 + 2] < 0.35) continue;   // folds, not outlines
    const a = m.ev[2 * e], b = m.ev[2 * e + 1];
    ctx.moveTo(m.sx[a], m.sy[a]); ctx.lineTo(m.sx[b], m.sy[b]);
  }
  ctx.stroke();
}

// --- the measured frame: an axis box with three back panes (mm) -----------------------
const BOX = [[-95, 95], [-176, 184], [-132, 130]];
const AXN = ['x · R→L', 'y · P→A', 'z · I→S'];
function drawBox(ctx) {
  const e = CAM.eye;
  const back = [e[0] > 0 ? 0 : 1, e[1] > 4 ? 0 : 1, e[2] > 1 ? 0 : 1];      // index of the far bound per axis
  const fillA = rgba(C_DIM, 0.035);
  for (let ax = 0; ax < 3; ax++) {
    const c = BOX[ax][back[ax]], u = (ax + 1) % 3, v = (ax + 2) % 3;
    const corner = (a, b) => { const p = [0, 0, 0]; p[ax] = c; p[u] = a; p[v] = b; return projPt(p[0], p[1], p[2], new Float64Array(3)); };
    const q0 = corner(BOX[u][0], BOX[v][0]), q1 = corner(BOX[u][1], BOX[v][0]), q2 = corner(BOX[u][1], BOX[v][1]), q3 = corner(BOX[u][0], BOX[v][1]);
    ctx.fillStyle = fillA; ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q3[0], q3[1]); ctx.closePath(); ctx.fill();
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? rgba(C_TEXT, 0.2) : rgba(C_TEXT, 0.12); ctx.lineWidth = major ? 0.9 : 0.7; ctx.beginPath();
      for (const [gAx, oAx] of [[u, v], [v, u]]) {
        for (let g = Math.ceil(BOX[gAx][0] / 10) * 10; g <= BOX[gAx][1]; g += 10) {
          if ((g % 50 === 0) !== major) continue;
          const p = [0, 0, 0], q = [0, 0, 0]; p[ax] = c; q[ax] = c; p[gAx] = g; q[gAx] = g; p[oAx] = BOX[oAx][0]; q[oAx] = BOX[oAx][1];
          projPt(p[0], p[1], p[2], PP); projPt(q[0], q[1], q[2], PQ); ctx.moveTo(PP[0], PP[1]); ctx.lineTo(PQ[0], PQ[1]);
        }
      }
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(C_DIM, 0.42); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q3[0], q3[1]); ctx.closePath(); ctx.stroke();
  }
  // tick labels on the floor's near edges and the back wall's vertical edge
  ctx.font = fMono(9); ctx.fillStyle = rgba(C_DIM2, 0.8); ctx.textBaseline = 'middle';
  const zf = BOX[2][back[2]], xn = BOX[0][1 - back[0]], yn = BOX[1][1 - back[1]];
  ctx.textAlign = 'center';
  for (let y = -150; y <= 150; y += 50) { projPt(xn, y, zf, PP); if (PP[1] < hero.h - 6 && PP[0] > 30 && PP[0] < hero.w - 30) ctx.fillText(String(y), PP[0], PP[1] + 9); }
  const xb = BOX[0][back[0]], yb = BOX[1][back[1]];
  ctx.textAlign = 'right';
  for (let z = -100; z <= 100; z += 50) { projPt(xb, yb, z, PP); if (PP[1] > 40 && PP[1] < hero.h - 30 && PP[0] > 24) ctx.fillText(String(z), PP[0] - 5, PP[1]); }
  projPt(xn, 175, zf, PP); ctx.textAlign = 'right'; if (PP[1] < hero.h - 6) ctx.fillText(AXN[1] + ' MM', Math.min(PP[0] - 6, hero.w - 12), PP[1] + 9);
  projPt(xb, yb, 125, PP); ctx.textAlign = 'left'; if (PP[1] > 40) ctx.fillText(AXN[2] + ' MM', PP[0] + 5, PP[1] + 8);
}

// --- arcs: rings with gantry ticks, the three fans, the sweep ---------------------------
const RING_R = 100;
// Each arc's pass inside the sweep: staggered starts, one landing at SWEEP_S; the gantry
// eases in and out along a trapezoidal velocity profile (cosine ramps over 20 % at either
// end), so ARC 1's 358° revolution in 6.0 s peaks at 1.25 × its 60 °/s mean (≈ 75 °/s) and
// the two 120° arcs near 30 °/s.
const ARC_T0 = [0.0, 0.6, 1.2], ARC_T1 = [SWEEP_S, SWEEP_S, SWEEP_S], RAMP = 0.2;
function easeArc(p) {
  p = clamp(p, 0, 1);
  if (p > 1 - RAMP) return 1 - easeArc(1 - p);
  const V = 1 / (1 - RAMP);
  return p < RAMP ? V * (p / 2 - (RAMP / (2 * Math.PI)) * Math.sin(Math.PI * p / RAMP)) : V * (RAMP / 2 + (p - RAMP));
}
function arcProgress(a, ts) { return clamp((ts - ARC_T0[a]) / (ARC_T1[a] - ARC_T0[a]), 0, 1); }
// cosmetic 10-05: the gantries were too fast (ARC 1: 358° in 6 s = 60 °/s mean, ~75 peak; ARC 2 / 3: 120° in 5.4 / 4.8 s =
// 22 / 25 mean, ~28 / 31 peak). Same 6-s pass and easing, but a pass now delivers only 1/N_SUB of every arc and the gantry
// carries on from where it stopped (N_SUB passes cover an arc, then it travels back): 3× slower (ARC 1 ~25 peak, ARC 2 / 3 ~9–10).
// The CP counter, the MU/CP cursor, the arc trail, the CW/CCW label and the shells' re-form wipe all follow the gantry.
// cosmetic 10-05 (fix): ARC 1 (358°) was still ~24 °/s at N_SUB = 3; it is now cut in 9 (~40° a pass), so all three gantries
// move ~7–9 °/s. N_SUBS[a] = passes per arc for ARC a+1; each arc turns round after its own N passes.
const N_SUBS = [9, 3, 3];
function passFwd(k, a) { return Math.floor(k / N_SUBS[a]) % 2 === 0; }
const REVEAL_LAG = 0.18;                               // s: the re-formed shells trail ARC 1's fan
function revealAt(ts) { return easeArc(arcProgress(0, ts - REVEAL_LAG)); }
function cpDoneAt(ts, k) { let n = 0; for (let a = 0; a < 3; a++) n += Math.round(((k % N_SUBS[a]) + easeArc(arcProgress(a, ts))) / N_SUBS[a] * ARCS[a].cp); return n; }   // control points through the gantries' position in the arcs
function gantryAt(A, u) {
  const k = sweepIndexAt(u);
  if (k < 0) return { th: A.start, p: 0, pe: 0, k: -1, live: false, fwd: true, a0: A.start, sgn: A.dir, sp: 0 };
  const a = A.id - 1, t = u - (MONEY_U0 + k * BEAT_DT), p = arcProgress(a, t), fwd = passFwd(k, a);
  const pe = easeArc(p), sp = A.spanDeg / N_SUBS[a];
  const sgn = fwd ? A.dir : -A.dir, a0 = wrap360((fwd ? A.start : A.stop) + sgn * sp * (k % N_SUBS[a]));   // where this pass starts
  return { th: wrap360(a0 + sgn * sp * pe), p, pe, k, live: p > 0 && p < 1, fwd, a0, sgn, sp, t1: ARC_T1[a] };
}
function ringPt(A, thDeg, r, out) {
  const t = thDeg * DEG, c = Math.cos(t), s = Math.sin(t);
  return projPt(ISO[0] + r * (c * A.b0[0] + s * A.b1[0]), ISO[1] + r * (c * A.b0[1] + s * A.b1[1]), ISO[2] + r * (c * A.b0[2] + s * A.b1[2]), out);
}
function drawArcs(ctx, u) {
  // the three ring labels are fixed on their rings; the gantry readouts keep clear of them too
  ctx.font = fMono(9.5);
  const ringLbl = ARCS.map((A) => {
    const q = ringPt(A, A.id === 1 ? 270 : A.id === 2 ? wrap360(A.lo / DEG + A.spanDeg / 2) : A.stop, RING_R + 12, new Float64Array(3));
    const t = 'ARC ' + A.id + ' · ' + (A.dir > 0 ? 'CW ' : 'CCW ') + A.start + '→' + A.stop, w = ctx.measureText(t).width;
    keepOut.push([q[0] - w / 2 - 3, q[1] - 8, w + 6, 16]);
    return { t, x: q[0], y: q[1] };
  });
  ARCS.forEach((A, ai) => {
    const G = gantryAt(A, u);
    const N = Math.max(24, Math.round(A.spanDeg / 4));
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C_ARC, 0.6); ctx.beginPath();
    for (let i = 0; i <= N; i++) { ringPt(A, A.lo / DEG + A.spanDeg * i / N, RING_R, PP); if (i === 0) ctx.moveTo(PP[0], PP[1]); else ctx.lineTo(PP[0], PP[1]); }
    ctx.stroke();
    const tAfter = G.k >= 0 ? u - (MONEY_U0 + G.k * BEAT_DT) - G.t1 : 99;
    if (G.live || (tAfter >= 0 && tAfter < SETTLE_S)) {      // the part of the arc delivered in this sweep
      const n2 = Math.max(2, Math.round(N * G.pe / N_SUBS[ai]));
      ctx.strokeStyle = rgba(C_ARC, 0.85 * (G.live ? 1 : 1 - tAfter / SETTLE_S)); ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= n2; i++) { ringPt(A, G.a0 + G.sgn * G.sp * G.pe * i / n2, RING_R, PP); if (i === 0) ctx.moveTo(PP[0], PP[1]); else ctx.lineTo(PP[0], PP[1]); }
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(C_ARC, 0.5); ctx.lineWidth = 0.75; ctx.beginPath();
    for (let dg = 0; dg < 360; dg += 10) {
      const rel = wrap360(dg - A.lo / DEG); if (rel > A.spanDeg) continue;
      ringPt(A, dg, RING_R, PP); ringPt(A, dg, RING_R + (dg % 30 === 0 ? 6 : 3), PQ);
      ctx.moveTo(PP[0], PP[1]); ctx.lineTo(PQ[0], PQ[1]);
    }
    ctx.stroke();
    // arc label on its ring
    ctx.font = fMono(9.5); ctx.fillStyle = rgba(C_ARC, 0.85); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ringLbl[ai].t, ringLbl[ai].x, ringLbl[ai].y);
    // the fan: the beam from the source through the isocentre, thin, fading past the target
    const t = G.th * DEG, c = Math.cos(t), s = Math.sin(t);
    const sd = [c * A.b0[0] + s * A.b1[0], c * A.b0[1] + s * A.b1[1], c * A.b0[2] + s * A.b1[2]];
    const pd = [-s * A.b0[0] + c * A.b1[0], -s * A.b0[1] + c * A.b1[1], -s * A.b0[2] + c * A.b1[2]];
    const src = projPt(ISO[0] + RING_R * sd[0], ISO[1] + RING_R * sd[1], ISO[2] + RING_R * sd[2], new Float64Array(3));
    const far = 1.0 * RING_R, wf = A.w * (1 + far / RING_R);
    const e1 = projPt(ISO[0] - far * sd[0] + wf * pd[0], ISO[1] - far * sd[1] + wf * pd[1], ISO[2] - far * sd[2] + wf * pd[2], PQ);
    const e1x = e1[0], e1y = e1[1];
    const e2 = projPt(ISO[0] - far * sd[0] - wf * pd[0], ISO[1] - far * sd[1] - wf * pd[1], ISO[2] - far * sd[2] - wf * pd[2], PR);
    const aF = G.live ? 0.16 : 0.10;
    const gr = ctx.createLinearGradient(src[0], src[1], (e1x + e2[0]) / 2, (e1y + e2[1]) / 2);
    gr.addColorStop(0, rgba(C_ARC, aF)); gr.addColorStop(0.55, rgba(C_ARC, aF * 0.8)); gr.addColorStop(1, rgba(C_ARC, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(src[0], src[1]); ctx.lineTo(e1x, e1y); ctx.lineTo(e2[0], e2[1]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C_ARC, G.live ? 0.9 : 0.6); ctx.lineWidth = 0.75; ctx.setLineDash([3, 3]);
    projPt(ISO[0], ISO[1], ISO[2], PP);
    ctx.beginPath(); ctx.moveTo(src[0], src[1]); ctx.lineTo(PP[0], PP[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(C_ARC, G.live ? 1 : 0.7); ctx.beginPath(); ctx.arc(src[0], src[1], G.live ? 2.6 : 2, 0, Math.PI * 2); ctx.fill();
    if (G.live || ai === 0) {
      // the gantry readout takes the first corner round its source that the probe box, the
      // pins, the header plates and the other readouts leave clear (its last corner first)
      const gt = 'G ' + G.th.toFixed(1) + '°';
      ctx.font = fMono(9.5); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const gw = ctx.measureText(gt).width + 7, gh = 14;
      const cands = [[src[0] + 4, src[1] - 15], [src[0] + 4, src[1] + 2], [src[0] - 4 - gw, src[1] - 15], [src[0] - 4 - gw, src[1] + 2]];
      const order = [A.lblC || 0, 0, 1, 2, 3];
      let pick = -1;
      for (const c of order) {
        const q = cands[c];
        if (q[0] < 2 || q[1] < 2 || q[0] + gw > hero.w - 2 || q[1] + gh > hero.h - 2) continue;
        if (keepOut.some(r => q[0] < r[0] + r[2] && q[0] + gw > r[0] && q[1] < r[1] + r[3] && q[1] + gh > r[1])) continue;
        pick = c; break;
      }
      if (pick >= 0) {
        A.lblC = pick; const q = cands[pick];
        keepOut.push([q[0] - 2, q[1] - 2, gw + 4, gh + 4]);
        ctx.fillStyle = 'rgba(2,8,6,0.72)'; ctx.fillRect(q[0], q[1], gw, gh);
        ctx.fillStyle = rgba(C_ARC, G.live ? 0.95 : 0.6); ctx.fillText(gt, q[0] + 3, q[1] + 7);
      }
    }
  });
}
// Rectangles (hero CSS px) that canvas readouts must not sit under or over: the probe box,
// the visible pins, the header plates and the legend (+ the ring labels and the readouts
// already placed, added by drawArcs); rebuilt every frame before the arcs.
const keepOut = [];
function buildKeepOut() {
  keepOut.length = 0;
  if (probe.box) keepOut.push([probe.box[0] - 3, probe.box[1] - 3, probe.box[2] + 6, probe.box[3] + 6]);
  for (const p of PINS) if (p.vis && p.ys >= 0 && p.w) keepOut.push([p.x - 2, p.ys - 2, p.w + 4, p.h + 4]);
  for (const r of plateRects) keepOut.push(r);
}
function drawIso(ctx) {
  const L = 7;
  ctx.strokeStyle = rgba(C_TEXT, 0.75); ctx.lineWidth = 0.9; ctx.beginPath();
  for (const d of [[L, 0, 0], [0, L, 0], [0, 0, L]]) {
    projPt(ISO[0] - d[0], ISO[1] - d[1], ISO[2] - d[2], PP); projPt(ISO[0] + d[0], ISO[1] + d[1], ISO[2] + d[2], PQ);
    ctx.moveTo(PP[0], PP[1]); ctx.lineTo(PQ[0], PQ[1]);
  }
  ctx.stroke();
}
function drawTriad(ctx, W, H) {
  const ox = W - 48, oy = H - 44, L = 24;
  ctx.font = fMono(9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [[1, 0, 0, 'L'], [0, 1, 0, 'A'], [0, 0, 1, 'S']].forEach(([x, y, z, t]) => {
    const dx = x * CAM.R[0] + y * CAM.R[1] + z * CAM.R[2], dy = -(x * CAM.U[0] + y * CAM.U[1] + z * CAM.U[2]);
    ctx.strokeStyle = rgba(C_TEXT, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * L, oy + dy * L); ctx.stroke();
    ctx.fillStyle = rgba(C_TEXT, 0.75); ctx.fillText(t, ox + dx * (L + 8), oy + dy * (L + 8));
  });
  ctx.fillStyle = rgba(C_TEXT, 0.6); ctx.beginPath(); ctx.arc(ox, oy, 1.6, 0, Math.PI * 2); ctx.fill();
}
function drawScale(ctx, W, H) {
  projPt(ISO[0], ISO[1], ISO[2], PP);
  const px10 = 10 * CAM.f / PP[2], x0 = Math.round(W * 0.5 - px10 / 2), y0 = H - 16;
  ctx.strokeStyle = rgba(C_TEXT, 0.7); ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px10, y0); ctx.lineTo(x0 + px10, y0 - 4); ctx.stroke();
  ctx.font = fMono(9.5); ctx.fillStyle = rgba(C_TEXT, 0.7); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('10 MM AT ISO', x0 + px10 / 2, y0 - 5);
}

// --- probe cursor: a 3-D point on or near the nerve, reading the live field ----------
const probe = { pts: [], i: 0, from: [0, 0, 0], to: [0, 0, 0], t0: -1e9, dose: 0, p: [0, 0, 0], box: null };
function buildProbePoints() {
  const r = mulberry32((rng() * 4294967296) >>> 0);
  for (const s of [9, 14, 17, 20, 23, 27, 32, 12, 19, 25]) {
    const q = pointAt(NERVE_L, s), off = 1.1 * r(), a = 2 * Math.PI * r();
    probe.pts.push([q[0] + off * Math.cos(a) * 0.6, q[1] + off * Math.sin(a) * 0.6, q[2] + off * Math.sin(a)]);
  }
  probe.from = probe.pts[0].slice(); probe.to = probe.pts[0].slice(); probe.p = probe.pts[0].slice();
}
function probeTick() {
  probe.i = (probe.i + 1) % probe.pts.length;
  probe.from = probe.p.slice(); probe.to = probe.pts[probe.i].slice(); probe.t0 = performance.now();
}
// placeProbe runs before the arcs are drawn (so the gantry readouts can keep clear of its
// box); drawProbe paints it after them.
function placeProbe(ctx, now) {
  const t = smooth((now - probe.t0) / 1400);
  for (let k = 0; k < 3; k++) probe.p[k] = lerp(probe.from[k], probe.to[k], t);
  const st = curPlan(); if (!st) { probe.box = null; return; }
  if (t >= 1 || probe.dose === 0) probe.dose = doseAt(st.P, probe.p[0], probe.p[1], probe.p[2]);
  projPt(probe.p[0], probe.p[1], probe.p[2], PP);
  probe.x = PP[0]; probe.y = PP[1];
  ctx.font = fMono(9.5);
  probe.lbl = 'PROBE · L OPTIC NERVE · ' + probe.dose.toFixed(2) + ' GY';
  probe.lbl2 = '(' + probe.p[0].toFixed(1) + ', ' + probe.p[1].toFixed(1) + ', ' + probe.p[2].toFixed(1) + ') MM';
  probe.tw = Math.max(ctx.measureText(probe.lbl).width, ctx.measureText(probe.lbl2).width);
  probe.lx = probe.x - 34 - probe.tw; probe.ly = probe.y - 46;
  probe.box = [probe.lx - 4, probe.ly - 7, probe.tw + 12, 27];
}
function drawProbe(ctx) {
  if (!probe.box) return;
  const x = probe.x, y = probe.y, lx = probe.lx, ly = probe.ly, tw = probe.tw;
  ctx.strokeStyle = rgba(C_TEXT, 0.85); ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
  ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11); ctx.stroke();
  ctx.font = fMono(9.5); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = rgba(C_TEXT, 0.5); ctx.lineWidth = 0.75; ctx.beginPath(); ctx.moveTo(x - 8, y - 8); ctx.lineTo(lx + tw + 8, ly + 13); ctx.stroke();
  ctx.fillStyle = 'rgba(2,8,6,0.78)'; ctx.fillRect(probe.box[0], probe.box[1], probe.box[2], probe.box[3]);
  ctx.fillStyle = rgba(C_TEXT, 0.92); ctx.fillText(probe.lbl, lx, ly);
  ctx.fillStyle = rgba(C_DIM2, 1); ctx.fillText(probe.lbl2, lx, ly + 12);
}

// =============================================================================
// REVIEW — after every iterate lands, the plan is read structure by structure
// =============================================================================
// 0.4 s after an iterate lands, Nandita reads it down the constraints table ("54.38. The chiasm
// re-scores and passes. The brainstem passes. The lenses pass."), and last the PTV's coverage.
// The TPS links the selection across the views: the structure brightens in the volume, its pin
// and leader line are lit, its DVH curve is drawn heavier and its constraint row is highlighted.
// One structure every 1.05 s (8 in 8.4 s), done before the next iterate lands. Until the first
// iterate of the cycle lands, her eye stays on the L optic nerve (the hair she has been staring at
// for forty minutes). Reading changes no number: the rows keep their scores (one row re-scores
// per second beat, as before). A pure function of u: it pauses while hidden, restarts with the
// cycle, and reduced motion holds one instant of it.
const REVIEW = ['lon', 'ron', 'chi', 'bst', 'lnl', 'lnr', 'par', 'ptv'];
const REV_LEAD = 0.4, REV_STEP = 1.05, REV_FADE = 0.3;
const REV_CURVE = { ptv: 0, lon: 1, chi: 2, bst: 3, ron: 4, lnl: 5, lnr: 5, par: 6 };
const REV_OF_MESH = { target: 'ptv', nerveL: 'lon', nerveR: 'ron', chiasm: 'chi', brainstem: 'bst', lensL: 'lnl', lensR: 'lnr', parL: 'par', parR: 'par' };
const rev = { cur: null, prev: null, up: 1, shown: undefined, key: '' };
function reviewAt(u) {
  const u0 = climaxU(0) + REV_LEAD;
  if (u < u0) { rev.cur = REVIEW[0]; rev.prev = null; rev.up = 1; return rev; }
  const ph = (u - u0) % BEAT_DT;
  const j = Math.floor(ph / REV_STEP);
  rev.cur = j < REVIEW.length ? REVIEW[j] : null;
  rev.prev = j >= 1 && j <= REVIEW.length ? REVIEW[j - 1] : null;
  rev.up = smooth((ph - j * REV_STEP) / REV_FADE);
  return rev;
}
function revLevel(id) { return id == null ? 0 : id === rev.cur ? rev.up : id === rev.prev ? 1 - rev.up : 0; }
function curveLevel(k) {                              // both lenses share one DVH curve, so it stays lit across them
  let v = 0;
  if (rev.cur != null && REV_CURVE[rev.cur] === k) v += rev.up;
  if (rev.prev != null && REV_CURVE[rev.prev] === k) v += 1 - rev.up;
  return Math.min(1, v);
}
function meshSurf(key, base) {                        // the style sets a mesh is drawn with at its review level
  const q = base.lv ? Math.round(revLevel(REV_OF_MESH[key]) * (LV_N - 1)) : 0;
  return q ? base.lv[q] : base;
}
// the selection in the DOM (the constraint row and the pin), toggled only when it moves on
function applyReview() {
  if (rev.shown === rev.cur) return;
  rev.shown = rev.cur;
  for (const C of CONS) if (C.row) C.row.classList.toggle('sel', C.id === rev.cur);
  for (const p of PINS) if (p.node) p.node.classList.toggle('rv', p.rev != null && p.rev === rev.cur);
}

// =============================================================================
// PLAN DISPLAY STATE — the iterate on screen, the one being revealed
// =============================================================================

const disp = { i: ITER0, st: null, next: null, job: null, jobI: -1, lastK: -99 };
function curPlan() { return disp.st; }
let hero = null;
function heroFps() { if (VIEW.dragging) return 50; const u = uNow(); const k = sweepIndexAt(u); const t = k >= 0 ? u - (MONEY_U0 + k * BEAT_DT) : 99; return (t >= 0 && t < SWEEP_S + 0.3) || (zoomAt(u) > 0.01 && zoomAt(u) < 0.99) ? 50 : 30; }
function selectedShell(u) { return Math.floor(u / 27) % 3 === 2 ? 2 : 0; }

function drawPet(ctx) {
  if (!SCAN.brainOn || !SCAN.pet) return;
  const pts = SCAN.pet.pts, val = SCAN.pet.val, n = val.length;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    projPt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], PP);
    if (PP[2] <= 0) continue;
    const v = val[i];
    if (v < 0.18) continue;
    const s = 1.0 + 2.4 * v;
    ctx.globalAlpha = 0.18 + 0.5 * v;
    ctx.fillStyle = v > 0.72 ? '#FFD25A' : v > 0.42 ? '#FF9C42' : '#52E3FF';
    ctx.fillRect(PP[0] - s * 0.5, PP[1] - s * 0.5, s, s);
  }
  ctx.restore();
}
function renderHero(now) {
  if (!hero || !hero.w) return;
  const W = hero.w, H = hero.h, u = uClamped();
  hctx = hero.ctx;
  hero.clear();
  setCamera(u, W, H);
  reviewAt(u); applyReview();
  const st = disp.st; if (!st) return;
  // the re-form: during a sweep, the new iterate's shells appear behind the fans
  const k = sweepIndexAt(u), ts = k >= 0 ? u - (MONEY_U0 + k * BEAT_DT) : -1;
  const sweeping = ts >= 0 && ts < SWEEP_S && disp.next && disp.next.i === disp.i + 1;
  const settling = !sweeping && ts >= SWEEP_S && ts < SWEEP_S + SETTLE_S && disp.i === ITER0 + k + 1;
  // the re-form follows ARC 1's eased gantry angle, REVEAL_LAG behind its fan, and completes as the pass lands
  const pw = sweeping ? revealAt(ts) : settling ? 1 + 0.12 * (ts - SWEEP_S) / SETTLE_S : 0, cw = passFwd(k, 0);
  if (k >= 0) wipeA0 = gantryAt(ARCS[0], u).a0;
  const oldS = st.shells, newS = sweeping ? disp.next.shells : null;
  for (const key in M) project(M[key]);
  if (SCAN.brainOn && SCAN.brain) project(SCAN.brain);
  if (SCAN.skullOn && SCAN.skull) { project(SCAN.skull); if (SCAN.eyes) project(SCAN.eyes); if (SCAN.lenses) project(SCAN.lenses); }
  for (let s = 0; s < 4; s++) { project(oldS[s]); if (newS) project(newS[s]); }
  classify(M.skin, SURF.skin); classify(M.bone, SURF.bone);
  for (const kk of OUTER) classify(M[kk], SURF[OUTER_SURF[kk]]);
  classify(M.chiasm, SURF.chi); classify(M.nerveL, SURF.nerve); classify(M.target, SURF.target);
  for (let s = 0; s < 4; s++) { classify(oldS[s], SHELL_SURF[s]); if (newS) classify(newS[s], SHELL_SURF[s]); }
  if (SCAN.brainOn && SCAN.brain) classify(SCAN.brain, SURF.brain);
  if (SCAN.skullOn && SCAN.skull) { classify(SCAN.skull, SURF.scanBone); if (SCAN.eyes) classify(SCAN.eyes, SURF.scanGlobe); if (SCAN.lenses) classify(SCAN.lenses, SURF.scanLens); }
  const ctx = hctx;
  drawBox(ctx);
  drawBuckets(M.skin, 0, SURF.skin.back, 0);
  if (SCAN.skullOn && SCAN.skull) drawBuckets(SCAN.skull, 0, SURF.scanBone.back, 0); else drawBuckets(M.bone, 0, SURF.bone.back, 0);
  if (SCAN.brainOn && SCAN.brain) drawBuckets(SCAN.brain, 0, SURF.brain.back, 0);
  projPt(ISO[0], ISO[1], ISO[2], PP); const isoD = PP[2];
  const behind = [], front = [];
  for (const kk of OUTER) { const c = OUTER_C[kk]; projPt(c[0], c[1], c[2], PQ); (PQ[2] > isoD ? behind : front).push([kk, PQ[2]]); }
  behind.sort((a, b) => b[1] - a[1]); front.sort((a, b) => b[1] - a[1]);
  const drawOuter = (kk) => {
    if ((!SCAN.eyesOn || SCAN.skullOn) && (kk === 'globeL' || kk === 'globeR' || kk === 'lensL' || kk === 'lensR')) return;
    const s = SURF[OUTER_SURF[kk]], L = meshSurf(kk, s);
    if (s.af >= 1) drawOpaque(M[kk], L.front); else { drawBuckets(M[kk], 0, L.back, 0); drawBuckets(M[kk], 1, L.front, 0); }
    if (s === SURF.globe) silhouette(M[kk], rgba(C_DATA, 0.34), 0.7);            // the eye reads as an eye
  };
  for (const [kk] of behind) drawOuter(kk);
  if (SCAN.skullOn && SCAN.eyesOn && SCAN.eyes) {
    drawBuckets(SCAN.eyes, 0, SURF.scanGlobe.back, 0); drawBuckets(SCAN.eyes, 1, SURF.scanGlobe.front, 0);
    silhouette(SCAN.eyes, rgba(C_DATA, 0.3), 0.6);
    if (SCAN.lenses) drawOpaque(SCAN.lenses, SURF.scanLens.front);
  }
  const sel = selectedShell(u);
  for (let s = 3; s >= 0; s--) {
    const SS = SHELL_SURF[s];
    if (sweeping) { drawBuckets(oldS[s], 0, SS.back, 1, pw, cw); drawBuckets(newS[s], 0, SS.back, 2, pw, cw); }
    else drawBuckets(oldS[s], 0, SS.back, 0);
    const glow = disp.reT0 ? clamp(1 - (now - disp.reT0) / 2600, 0, 1) : 0;
    const lw = s === sel ? 1 : 0.7, a = s === sel ? 1 : 0.72 + 0.28 * glow;
    if (s === sel) { ctx.shadowColor = rgba(C_SHELL[s], 0.9); ctx.shadowBlur = 8; }
    silhouette(sweeping && pw > 0.5 ? newS[s] : oldS[s], rgba(C_SHELL[s], a), lw);
    ctx.shadowBlur = 0;
  }
  drawInner();
  if (SCAN.brainOn && SCAN.brain) {
    drawBuckets(SCAN.brain, 1, SURF.brain.front, 0);
    silhouette(SCAN.brain, rgba(hexRgb('#66E6FF'), 0.24), 0.45);
    drawPet(ctx);
  }
  for (let s = 0; s < 4; s++) {
    const SS = SHELL_SURF[s];
    if (sweeping) { drawBuckets(oldS[s], 1, SS.front, 1, pw, cw); drawBuckets(newS[s], 1, SS.front, 2, pw, cw, SHELL_WAKE[s]); }
    else if (settling) drawBuckets(oldS[s], 1, SS.front, 2, pw, cw, SHELL_WAKE[s]);
    else drawBuckets(oldS[s], 1, SS.front, 0);
  }
  for (const [kk] of front) drawOuter(kk);
  if (SCAN.skullOn && SCAN.skull) drawBuckets(SCAN.skull, 1, SURF.scanBone.front, 0); else drawBuckets(M.bone, 1, SURF.bone.front, 0);
  drawBuckets(M.skin, 1, SURF.skin.front, 0);
  silhouette(M.skin, rgba(C_SKIN, 0.75), 1);
  if (SCAN.skullOn && SCAN.skull) silhouette(SCAN.skull, rgba(C_DATA, 0.18), 0.7); else silhouette(M.bone, rgba(C_DATA, 0.14), 0.7);
  placeProbe(ctx, now);
  buildKeepOut();
  drawArcs(ctx, u);
  drawIso(ctx);
  drawProbe(ctx);
  layoutPins(W, H);
  drawLeaders(ctx);
  drawTriad(ctx, W, H);
  drawScale(ctx, W, H);
}

// =============================================================================
// PINS — marginalia with leader lines, in two columns beside the head
// =============================================================================

const PINS = [
  { id: 'nerve', side: 'R', hero: true, col: C_NERVE, anchor: () => curPlan().org.lon.hot },
  { id: 'tgt', side: 'R', col: C_TGT, anchor: () => PALM },
  { id: 's95', side: 'R', col: C_SHELL[0], anchor: () => curPlan().anch[0] },
  { id: 'lens', side: 'R', col: C_OKG, anchor: () => [31, 75.2, 4] },
  { id: 's50', side: 'R', col: C_SHELL[2], anchor: () => curPlan().anch[2], narrowHide: true },
  { id: 's20', side: 'L', col: C_SHELL[3], anchor: () => curPlan().anch[3] },
  { id: 'chi', side: 'L', col: C_OKG, anchor: () => [0, 19.5, -1.2] },
  { id: 'ron', side: 'L', col: C_OKG, anchor: () => [-17, 29.5, 1.2], narrowHide: true },
  { id: 'bst', side: 'L', col: C_OKG, anchor: () => [0, -8, -24] },
  { id: 'par', side: 'L', col: C_OKG, anchor: () => [49, 8, -36], narrowHide: true },
];
const PIN = Object.fromEntries(PINS.map(p => [p.id, p]));
for (const [id, r] of [['nerve', 'lon'], ['tgt', 'ptv'], ['lens', 'lnl'], ['chi', 'chi'], ['ron', 'ron'], ['bst', 'bst'], ['par', 'par']]) PIN[id].rev = r;
function buildPins() {
  const root = $('h-pins');
  for (const p of PINS) {
    const n = el('div', 'pin' + (p.side === 'R' ? ' r' : '') + (p.hero ? ' hero-pin' : ''));
    n.style.setProperty('--pc', rgba(p.col, 0.8)); n.style.setProperty('--pch', rgba(p.col, 1));
    p.t = el('span', 'pt'); p.v = el('span', 'pv');
    n.append(p.t, p.v); root.appendChild(n);
    p.node = n; p.x = 0; p.y = 0; p.ys = -1; p.w = 0; p.h = 0; p.vis = true; p.shown = true; p.ax = 0; p.ay = 0;
  }
}
function pinVal(p, parts) {                           // parts: [[text, cls], …] — rebuilt only when the text changes
  const key = parts.map(q => q[0]).join('');
  if (p.key === key) return;
  p.key = key;
  while (p.v.firstChild) p.v.removeChild(p.v.firstChild);
  for (const [t, cls] of parts) { if (cls) p.v.appendChild(el(cls === 'b' ? 'b' : 'span', cls === 'b' ? null : cls, t)); else p.v.appendChild(document.createTextNode(t)); }
}
function refreshPins() {
  const st = curPlan(); if (!st) return;
  const o = st.org, sc = scored;
  setText(PIN.nerve.t, 'L OPTIC NERVE · OAR');
  pinVal(PIN.nerve, [['MAX ', 'l'], [shownNerve(), 'b'], [' GY · LIMIT 54.0', 'l']]);
  setText(PIN.tgt.t, 'PTV 66 · TARGET');
  pinVal(PIN.tgt, [[(Math.abs(M.target.vol) / 1000).toFixed(2) + ' cm³ · ', 'l'], ['V95 ' + o.cov.toFixed(1) + ' %']]);
  setText(PIN.s95.t, 'ISODOSE 95 % · 62.7 GY');
  pinVal(PIN.s95, [[st.vols[0].toFixed(2) + ' cm³ · ', 'l'], ['CI ' + (st.vols[0] / (Math.abs(M.target.vol) / 1000)).toFixed(2)]]);
  setText(PIN.s50.t, 'ISODOSE 50 % · 33.0 GY');
  pinVal(PIN.s50, [[st.vols[2].toFixed(1) + ' cm³ · ', 'l'], ['R50 ' + (st.vols[2] / (Math.abs(M.target.vol) / 1000)).toFixed(1)]]);
  setText(PIN.s20.t, 'ISODOSE 20 % · 13.2 GY');
  pinVal(PIN.s20, [[st.vols[3].toFixed(1) + ' cm³', 'l']]);
  setText(PIN.lens.t, 'L LENS · OAR');
  pinVal(PIN.lens, [['MAX ', 'l'], [sc.lnl.toFixed(1)], [' GY · LIMIT 7.0', 'l']]);
  setText(PIN.chi.t, 'CHIASM · OAR');
  pinVal(PIN.chi, [['MAX ', 'l'], [sc.chi.toFixed(1)], [' GY · LIMIT 54.0', 'l']]);
  setText(PIN.ron.t, 'R OPTIC NERVE · OAR');
  pinVal(PIN.ron, [['MAX ', 'l'], [sc.ron.toFixed(1)], [' GY · LIMIT 54.0', 'l']]);
  setText(PIN.bst.t, 'BRAINSTEM · OAR');
  pinVal(PIN.bst, [['MAX ', 'l'], [sc.bst.toFixed(1)], [' GY · LIMIT 54.0', 'l']]);
  setText(PIN.par.t, 'PAROTIDS · OAR');
  pinVal(PIN.par, [['MEAN ', 'l'], [sc.par.toFixed(1)], [' GY · LIMIT 26.0', 'l']]);
  measurePins();
}
let legH = 80, capL = 48, capR = 48;
const plateRects = [];                                // the hero's DOM plates (header · status · legend), hero px
function measurePins() {
  for (const p of PINS) { p.w = p.node.offsetWidth; p.h = p.node.offsetHeight; }
  const lg = $('h-leg'); if (lg) legH = lg.offsetHeight;
  const cap = document.querySelector('#hero .h-cap'), stp = document.querySelector('#hero .h-st');
  plateRects.length = 0;
  for (const n of [cap, stp, lg]) if (n && n.offsetWidth) plateRects.push([n.offsetLeft - 2, n.offsetTop - 2, n.offsetWidth + 4, n.offsetHeight + 4]);
  capL = Math.max(48, cap ? cap.offsetTop + cap.offsetHeight + 7 : 48);     // the pin columns start below the plates
  capR = Math.max(48, stp ? stp.offsetTop + stp.offsetHeight + 7 : 48);
}
function layoutPins(W, H) {
  const narrow = W < 1100, root = $('iso-root');
  const legT = H - (legH + 24), botR = H - 64;
  for (const side of ['L', 'R']) {
    const list = [];
    for (const p of PINS) {
      if (p.side !== side) continue;
      const a = p.anchor(); projPt(a[0], a[1], a[2], PP); p.ax = PP[0]; p.ay = PP[1];
      p.vis = !(p.id === 'lens' && !SCAN.eyesOn) && !(narrow && p.narrowHide) && p.ax > 8 && p.ax < W - 8 && p.ay > 8 && p.ay < H - 8 && !(root.classList.contains('h-xshort') && p.narrowHide);
      if (p.vis) list.push(p);
    }
    list.sort((a, b) => a.ay - b.ay);
    const top = side === 'L' ? capL : capR, bot = side === 'L' ? legT : botR, gap = 7;
    let y = top;
    for (const p of list) { let ty = clamp(p.ay - p.h / 2, top, bot - p.h); if (ty < y) ty = y; p.y = ty; y = ty + p.h + gap; }
    let over = y - gap - bot;
    for (let q = list.length - 1; q >= 0 && over > 0; q--) { const p = list[q]; const lim = q === 0 ? top : list[q - 1].y + list[q - 1].h + gap; const mv = Math.min(over, p.y - lim); p.y -= Math.max(0, mv); over = (list[list.length - 1].y + list[list.length - 1].h) - bot; }
    for (const p of list) {
      p.x = side === 'L' ? 14 : W - 14 - p.w;
      p.ys = p.ys < 0 ? p.y : p.ys + (p.y - p.ys) * 0.25;
    }
  }
  for (const p of PINS) {
    if (p.vis !== p.shown) { p.node.classList.toggle('off', !p.vis); p.shown = p.vis; }
    const tr = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.ys) + 'px)';
    if (p.tr !== tr) { p.node.style.transform = tr; p.tr = tr; }
  }
}
function drawLeaders(ctx) {
  for (const p of PINS) {
    if (!p.vis || p.ys < 0) continue;
    const lv = revLevel(p.rev);                        // the structure under review has its leader lit
    const yL = p.ys + Math.min(p.h / 2, 14), xL = p.side === 'L' ? p.x + p.w : p.x, xE = p.side === 'L' ? xL + 16 : xL - 16;
    ctx.strokeStyle = rgba(p.col, (p.hero ? 0.9 : 0.55) + 0.4 * lv); ctx.lineWidth = (p.hero ? 1 : 0.75) + 0.6 * lv;
    ctx.beginPath(); ctx.moveTo(xL, yL); ctx.lineTo(xE, yL); ctx.lineTo(p.ax, p.ay); ctx.stroke();
    ctx.fillStyle = rgba(p.col, 0.95); ctx.beginPath(); ctx.arc(p.ax, p.ay, (p.hero ? 2.6 : 2) + 1.1 * lv, 0, Math.PI * 2); ctx.fill();
  }
}

// =============================================================================
// LEGEND · STATUS
// =============================================================================

const legRows = [];
function buildLegend() {
  const root = $('h-leg');
  root.appendChild(el('div', 'lt', 'ISODOSE · % OF 66.0 GY'));
  for (let s = 0; s < 4; s++) {
    const r = el('div', 'lr'), sw = el('i');
    sw.style.background = rgba(C_SHELL[s], 0.75);
    r.append(sw, el('span', null, (LEVELS[s] * 100).toFixed(0) + ' %'), el('span', 'v', LEVEL_GY[s].toFixed(1) + ' GY'), el('span', 'v', '—'));
    root.appendChild(r); legRows.push(r);
  }
  const lx = el('div', 'lx');
  const sw = (c) => { const i = el('i'); i.style.background = c; return i; };
  lx.append(sw(rgba(C_TGT, 1)), document.createTextNode('PTV   '), sw(rgba(C_NERVE, 1)), document.createTextNode('L OPTIC NERVE   '), sw(rgba(C_OAR, 0.8)), document.createTextNode('OAR'));
  root.appendChild(lx);
}
function refreshLegend() {
  const st = curPlan(); if (!st) return;
  const sel = selectedShell(uClamped());
  for (let s = 0; s < 4; s++) {
    setText(legRows[s].children[3], st.vols[s].toFixed(s < 2 ? 2 : 1) + ' cm³');
    legRows[s].classList.toggle('sel', s === sel);
  }
}
function tickCalc() {
  const u = uClamped(), k = sweepIndexAt(u), ts = k >= 0 ? u - (MONEY_U0 + k * BEAT_DT) : -1;
  const bar = $('h-bar');
  if (ts >= 0 && ts < SWEEP_S) {
    const cp = cpDoneAt(ts, k);                             // control points delivered by the three staggered passes
    setText('h-calc', 'DOSE CALC · ARC 1–3 · CP ' + pad(cp, 3) + '/' + CP_TOTAL);
    setText('h-calc2', 'ITER ' + grp(ITER0 + k + 1) + ' · GRADIENT STEP · 2.0-MM GRID');
    bar.style.width = (100 * cp / CP_TOTAL).toFixed(1) + '%';
  } else {
    const nextU = k < 0 ? MONEY_U0 : (k + 1 < N_BEAT ? MONEY_U0 + (k + 1) * BEAT_DT : CYCLE);
    const left = Math.max(0, nextU - u), done = itersDoneAt(u);
    setText('h-calc', 'OPTIMISER · ITER ' + grp(ITER0 + done + 1) + ' IN ' + left.toFixed(1) + ' s');
    setText('h-calc2', 'VMAT · 3 ARCS · ' + CP_TOTAL + ' CP · 2° SPACING');
    bar.style.width = (clamp(1 - left / (BEAT_DT - SWEEP_S), 0, 1) * 100).toFixed(1) + '%';
  }
}
function tickView() {
  setText('h-view', 'VIEW AZ ' + CAM.az.toFixed(1) + '° · EL ' + CAM.el.toFixed(1) + '° · ×' + (CAM.mag || 1).toFixed(2) + (CAM.zoom > 0.5 ? ' · FOCUS L OPTIC NERVE' : ''));
}

// =============================================================================
// b · DVH · c · DETAIL · d · CONVERGENCE (the figure's right margin)
// =============================================================================

let dvhCv = null, detCv = null, conCv = null;
const dvh = { from: null, to: null, t0: -1e9, dur: 900, dirty: true, cur: { d: 51.8, v: 6.1, fromD: 51.8, toD: 51.8, t0: -1e9 }, ghost: null };
const CURVE_STY = [
  { c: C_TGT, w: 1.6, dash: [] }, { c: C_NERVE, w: 1.8, dash: [] }, { c: C_OKG, w: 1.1, dash: [] }, { c: C_SKIN, w: 1.1, dash: [] },
  { c: C_OKG, w: 1, dash: [4, 3] }, { c: C_SKIN, w: 1, dash: [2, 2] }, { c: C_OKG, w: 1.1, dash: [6, 3] },
];
const CURVE_LBL_V = [52, 34, 64, 44, 80, 90, 18];
function dvhCurves(now) {
  const p = smooth((now - dvh.t0) / dvh.dur);
  if (!dvh.from || p >= 1) return dvh.to;
  return dvh.to.map((c, k) => { const o = new Float32Array(DVH_BINS); for (let b = 0; b < DVH_BINS; b++) o[b] = lerp(dvh.from[k][b], c[b], p); return o; });
}
function dvhRect(W, H) { return { x0: 40, x1: W - 16, y0: 12, y1: H - 24 }; }
function paintDvh(now) {
  if (!dvhCv || !dvh.to) return;
  const c = dvhCv.ctx, W = dvhCv.w, H = dvhCv.h, R = dvhRect(W, H);
  dvhCv.clear();
  const X = d => R.x0 + (R.x1 - R.x0) * d / 72, Y = v => R.y1 - (R.y1 - R.y0) * v / 100;
  c.strokeStyle = rgba(C_DIM, 0.28); c.lineWidth = 1; c.beginPath();
  for (let d = 0; d <= 70; d += 10) { c.moveTo(Math.round(X(d)) + 0.5, R.y0); c.lineTo(Math.round(X(d)) + 0.5, R.y1); }
  for (let v = 0; v <= 100; v += 20) { c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  c.stroke();
  c.strokeStyle = rgba(C_TEXT, 0.1); c.beginPath();
  for (let d = 2; d < 72; d += 2) { if (d % 10 === 0) continue; c.moveTo(Math.round(X(d)) + 0.5, R.y0); c.lineTo(Math.round(X(d)) + 0.5, R.y1); }
  for (let v = 5; v < 100; v += 5) { if (v % 20 === 0) continue; c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  c.stroke();
  // the forbidden side of the nerve's limit, hatched only where the nerve lives (0–10 % volume,
  // panel c's window) — the PTV's shoulder beyond 54 Gy is where the target must be
  const hy0 = Y(10), hh = Y(0) - Y(10);
  c.save(); c.beginPath(); c.rect(X(LIMIT), hy0, R.x1 - X(LIMIT), hh); c.clip();
  c.strokeStyle = rgba(C_ALARM, 0.16); c.lineWidth = 1; c.beginPath();
  for (let x = X(LIMIT) - hh; x < R.x1; x += 7) { c.moveTo(x, hy0 + hh); c.lineTo(x + hh, hy0); }
  c.stroke(); c.restore();
  c.font = fMono(9.5); c.fillStyle = rgba(C_DIM2, 1); c.textAlign = 'center'; c.textBaseline = 'top';
  for (let d = 0; d <= 70; d += 10) c.fillText(String(d), X(d), R.y1 + 4);
  c.textAlign = 'right'; c.fillText('GY', R.x1, R.y1 + 13 > H - 10 ? R.y1 + 4 : R.y1 + 13);
  c.textBaseline = 'middle';
  for (let v = 0; v <= 100; v += 20) c.fillText(v + (v === 100 ? ' %' : ''), R.x0 - 5, Y(v));
  // isodose levels on the dose axis
  for (let s = 0; s < 4; s++) {
    const x = X(LEVEL_GY[s]);
    c.strokeStyle = rgba(C_SHELL[s], 0.9); c.lineWidth = 2; c.beginPath(); c.moveTo(x, R.y1 - 5); c.lineTo(x, R.y1); c.stroke();
    c.strokeStyle = rgba(C_SHELL[s], 0.22); c.lineWidth = 1; c.beginPath(); c.moveTo(x + 0.5, R.y0); c.lineTo(x + 0.5, R.y1 - 5); c.stroke();
  }
  // the limit
  const xl = X(LIMIT);
  c.strokeStyle = rgba(C_ALARM, 0.8); c.lineWidth = 1; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(xl + 0.5, R.y0); c.lineTo(xl + 0.5, R.y1); c.stroke(); c.setLineDash([]);
  c.font = fMono(9.5); c.fillStyle = rgba(C_ALARM, 0.95); c.textAlign = 'right'; c.textBaseline = 'top';
  c.fillText('LIMIT 54.0', xl - 4, R.y0 + 2);
  const curves = dvhCurves(now);
  // detail window (c)
  c.strokeStyle = rgba(C_TEXT, 0.5); c.lineWidth = 0.75; c.strokeRect(X(53) + 0.5, Y(10) + 0.5, X(55) - X(53), Y(0) - Y(10));
  c.font = fSans(9.5, 700); c.fillStyle = rgba(C_TEXT, 0.8); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('c', X(54), Y(10) - 2);
  for (let k = curves.length - 1; k >= 0; k--) {
    const cv = curves[k], S = CURVE_STY[k], lv = curveLevel(k);   // the structure under review: its curve heavier
    c.strokeStyle = rgba(S.c, (k < 2 ? 0.95 : 0.8) + 0.2 * lv); c.lineWidth = S.w + 1.1 * lv; c.setLineDash(S.dash); c.beginPath();
    for (let b = 0; b < DVH_BINS; b++) { const x = X(b * DVH_STEP), y = Y(cv[b]); if (b === 0) c.moveTo(x, y); else c.lineTo(x, y); if (cv[b] <= 0) break; }
    c.stroke(); c.setLineDash([]);
  }
  // V95 on the PTV
  const st = curPlan();
  if (st) {
    const x = X(LEVEL_GY[0]), y = Y(st.org.cov);
    c.fillStyle = rgba(C_TGT, 1); c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba(C_TGT, 0.8); c.lineWidth = 0.75; c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x - 26, y + 18); c.stroke();
    c.font = fMono(9.5); c.fillStyle = rgba(C_TEXT, 0.95); c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillText('V95 ' + st.org.cov.toFixed(1) + ' %', x - 28, y + 20);
  }
  // cursor on the nerve curve
  const cu = dvh.cur, pc = smooth((now - cu.t0) / 1200);
  cu.d = lerp(cu.fromD, cu.toD, pc);
  const nv = curves[1], b = clamp(cu.d / DVH_STEP, 0, DVH_BINS - 1), b0 = Math.floor(b), fr = b - b0;
  cu.v = lerp(nv[b0], nv[Math.min(DVH_BINS - 1, b0 + 1)], fr);
  const cx = X(cu.d), cy = Y(cu.v);
  c.strokeStyle = rgba(C_TEXT, 0.45); c.lineWidth = 0.75; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(cx, R.y1); c.lineTo(cx, cy); c.lineTo(R.x0, cy); c.stroke(); c.setLineDash([]);
  c.strokeStyle = rgba(C_TEXT, 0.95); c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 3.5, 0, Math.PI * 2); c.stroke();
  // direct curve labels, last: each on a plate, placed where no curve runs through it
  const L = dvhLabelLayout(c, W, H, R, X, Y);
  c.font = fMono(9.5); c.textAlign = 'left'; c.textBaseline = 'middle';
  for (const lb of L) {
    const S = CURVE_STY[lb.k];
    if (lb.lead) { c.strokeStyle = rgba(S.c, 0.5); c.lineWidth = 0.75; c.beginPath(); c.moveTo(lb.ax, lb.y + 0.5); c.lineTo(lb.side > 0 ? lb.x - 3 : lb.x + lb.w + 3, lb.y + 0.5); c.stroke(); }
    c.fillStyle = 'rgba(2,8,6,0.86)'; c.fillRect(lb.x - 3, lb.y - 6, lb.w + 6, 12);
    c.fillStyle = rgba(S.c, 0.95); c.fillText(CURVES[lb.k].name, lb.x, lb.y);
    const lv = curveLevel(lb.k); if (lv > 0.02) { c.fillStyle = rgba(S.c, 0.9 * lv); c.fillRect(lb.x - 3, lb.y + 6, lb.w + 6, 1); }
  }
}
// Keep-out placement of the seven DVH curve labels. Every volume level from 6 to 94 % is tried
// on both sides of the label's own curve. In that level's text band each curve occupies one
// x-interval (a cumulative DVH is monotone), and the limit line, the LIMIT and V95 labels, panel
// c's window and the labels already placed occupy others; the label takes the nearest free gap,
// with a 1-px leader along its level when it had to slide past other curves. The layout is
// computed from the target curves (it holds through a redraw), prefers each label's previous
// place, and is recomputed only when the plan or the canvas size changes.
const dvhLbl = { key: '', to: null, list: [], prev: {}, wid: {} };
function dvhLabelLayout(c, W, H, R, X, Y) {
  const st = curPlan(), key = W + 'x' + H + ':' + (st ? st.org.cov : 0);
  if (dvhLbl.to === dvh.to && dvhLbl.key === key) return dvhLbl.list;
  dvhLbl.to = dvh.to; dvhLbl.key = key;
  const cvs = dvh.to, ppv = (R.y1 - R.y0) / 100, half = 7;
  c.font = fMono(9.5);
  for (const C of CURVES) if (!dvhLbl.wid[C.name]) dvhLbl.wid[C.name] = Math.ceil(c.measureText(C.name).width);
  const xAt = (cv, v) => {                            // screen x where the curve falls to v %
    if (cv[0] <= v) return X(0);
    for (let b = 1; b < DVH_BINS; b++) if (cv[b] <= v) { const f = (cv[b - 1] - v) / Math.max(1e-9, cv[b - 1] - cv[b]); return X((b - 1 + f) * DVH_STEP); }
    return X((DVH_BINS - 1) * DVH_STEP);
  };
  const rects = [];                                   // [x, y, w, h] obstacles besides the curves
  const xl = X(LIMIT);
  rects.push([xl - 2, R.y0, 5, R.y1 - R.y0]);
  const lw = Math.ceil(c.measureText('LIMIT 54.0').width);
  rects.push([xl - 6 - lw, R.y0, lw + 4, 13]);
  rects.push([X(53) - 2, Y(10) - 14, X(55) - X(53) + 4, Y(0) - Y(10) + 16]);
  if (st) {
    const x = X(LEVEL_GY[0]), y = Y(st.org.cov), vw = Math.ceil(c.measureText('V95 ' + st.org.cov.toFixed(1) + ' %').width);
    rects.push([x - 30 - vw, y + 13, vw + 4, 14]); rects.push([x - 28, y - 4, 32, 24]);
  }
  const levels = [];
  for (let v = 6; v <= 94; v += 2) {
    const y = Y(v); if (y - half < R.y0 + 1 || y + half > R.y1 - 7) continue;
    const vHi = v + half / ppv, vLo = v - half / ppv;
    levels.push({ v, y, iv: cvs.map((cv, k) => [xAt(cv, vHi) - (k === 1 ? 4.5 : 2.5), xAt(cv, vLo) + (k === 1 ? 4.5 : 2.5)]) });
  }
  const out = [], ORDER = [1, 0, 5, 4, 2, 3, 6];
  for (const k of ORDER) {
    const w = dvhLbl.wid[CURVES[k].name], pref = CURVE_LBL_V[k], prev = dvhLbl.prev[k];
    let best = null;
    for (const L of levels) {
      const ivs = L.iv.slice();
      for (const r of rects) if (r[1] < L.y + half && r[1] + r[3] > L.y - half) ivs.push([r[0], r[0] + r[2]]);
      ivs.sort((p, q) => p[0] - q[0]);
      const xa = xAt(cvs[k], L.v);
      const free = (x0) => { const x1 = x0 + w + 6; if (x0 < R.x0 + 2 || x1 > R.x1 - 1) return false; for (const iv of ivs) if (iv[0] < x1 && iv[1] > x0) return false; return true; };
      for (const side of [1, -1]) {
        let x = null;
        if (side > 0) { const cand = [xa + 5, ...ivs.filter(iv => iv[1] + 1 > xa + 5).map(iv => iv[1] + 1)].sort((p, q) => p - q); for (const x0 of cand) if (free(x0)) { x = x0; break; } }
        else { const cand = [xa - 5 - w - 6, ...ivs.filter(iv => iv[0] - 1 - w - 6 < xa - 5 - w - 6).map(iv => iv[0] - 1 - w - 6)].sort((p, q) => q - p); for (const x0 of cand) if (free(x0)) { x = x0; break; } }
        if (x == null) continue;
        const slide = side > 0 ? x - (xa + 5) : (xa - 5 - w - 6) - x;
        const cost = Math.abs(L.v - pref) + 0.12 * slide + (side < 0 ? 10 : 0) + (prev && prev.v === L.v && prev.side === side ? -15 : 0);
        if (!best || cost < best.cost) best = { k, v: L.v, y: L.y, side, cost, x: x + 3, w, ax: side > 0 ? xa + 1.5 : xa - 1.5, lead: slide > 2 };
      }
    }
    if (!best) { const y = Y(pref), xa = xAt(cvs[k], pref); best = { k, v: pref, y, side: 1, x: Math.min(xa + 8, R.x1 - w - 4), w, ax: xa, lead: false }; }
    dvhLbl.prev[k] = { v: best.v, side: best.side };
    const bx = best.x - 3;
    rects.push([bx - 1, best.y - half, best.w + 8, 2 * half]);
    if (best.lead) { const e = best.side > 0 ? bx : bx + best.w + 6; rects.push([Math.min(best.ax, e), best.y - 1.5, Math.abs(e - best.ax), 3]); }
    out.push(best);
  }
  dvhLbl.list = out;
  return out;
}
function paintDetail(now) {
  if (!detCv || !disp.st) return;
  const c = detCv.ctx, W = detCv.w, H = detCv.h, st = disp.st;
  detCv.clear();
  const R = { x0: 34, x1: W - 10, y0: 8, y1: H - 20 }, D0 = 53, D1 = 55, VMAX = 10;
  const X = d => R.x0 + (R.x1 - R.x0) * (d - D0) / (D1 - D0), Y = v => R.y1 - (R.y1 - R.y0) * v / VMAX;
  c.strokeStyle = rgba(C_TEXT, 0.1); c.lineWidth = 1; c.beginPath();
  for (let d = D0; d <= D1 + 1e-9; d += 0.1) { c.moveTo(Math.round(X(d)) + 0.5, R.y0); c.lineTo(Math.round(X(d)) + 0.5, R.y1); }
  for (let v = 0; v <= VMAX; v += 1) { c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  c.stroke();
  c.strokeStyle = rgba(C_DIM, 0.45); c.beginPath();
  for (let d = D0; d <= D1 + 1e-9; d += 0.5) { c.moveTo(Math.round(X(d)) + 0.5, R.y0); c.lineTo(Math.round(X(d)) + 0.5, R.y1); }
  for (let v = 0; v <= VMAX; v += 5) { c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  c.stroke();
  c.save(); c.beginPath(); c.rect(X(LIMIT), R.y0, R.x1 - X(LIMIT), R.y1 - R.y0); c.clip();
  c.strokeStyle = rgba(C_ALARM, 0.13); c.beginPath();
  for (let x = X(LIMIT) - (R.y1 - R.y0); x < R.x1; x += 7) { c.moveTo(x, R.y1); c.lineTo(x + (R.y1 - R.y0), R.y0); }
  c.stroke(); c.restore();
  c.font = fMono(9); c.fillStyle = rgba(C_DIM2, 1); c.textAlign = 'center'; c.textBaseline = 'top';
  for (let d = D0; d <= D1 + 1e-9; d += 0.5) { const t = d.toFixed(1), hw = c.measureText(t).width / 2; c.fillText(t, clamp(X(d), hw + 1, W - hw - 1), R.y1 + 4); }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = 0; v <= VMAX; v += 5) c.fillText(v + ' %', R.x0 - 4, Y(v));
  const xl = X(LIMIT);
  c.strokeStyle = rgba(C_ALARM, 0.85); c.setLineDash([4, 3]); c.beginPath(); c.moveTo(xl + 0.5, R.y0); c.lineTo(xl + 0.5, R.y1); c.stroke(); c.setLineDash([]);
  const tail = (sorted, col, w, dash) => {
    const n = sorted.length; c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash); c.beginPath();
    let first = true;
    for (let d = D0; d <= D1 + 1e-9; d += 0.01) {
      const v = 100 * (n - lowerBound(sorted, d)) / n; const x = X(d), y = Y(Math.min(VMAX, v));
      if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
    }
    c.stroke(); c.setLineDash([]);
  };
  if (dvh.ghost) tail(dvh.ghost, rgba(C_NERVE, 0.35), 1, [2, 2]);
  tail(st.org.lon.sorted, rgba(C_NERVE, 0.95), 1.6, []);
  // the hair: max − limit
  const mx = shownNerveNum(), xm = X(mx), yh = Y(VMAX * 0.62);
  c.strokeStyle = rgba(C_TEXT, 0.85); c.lineWidth = 1; c.beginPath();
  c.moveTo(xl, yh); c.lineTo(xm, yh); c.moveTo(xl + 4, yh - 3); c.lineTo(xl, yh); c.lineTo(xl + 4, yh + 3); c.moveTo(xm - 4, yh - 3); c.lineTo(xm, yh); c.lineTo(xm - 4, yh + 3); c.stroke();
  c.strokeStyle = rgba(C_NERVE, 0.5); c.setLineDash([2, 2]); c.beginPath(); c.moveTo(xm + 0.5, yh + 4); c.lineTo(xm + 0.5, R.y1); c.stroke(); c.setLineDash([]);
  c.font = fMono(10); c.fillStyle = rgba(C_TEXT, 0.95); c.textAlign = 'left'; c.textBaseline = 'bottom';
  c.fillText('Δ ' + (mx - LIMIT).toFixed(2) + ' GY', Math.min(xm + 6, R.x1 - 70), yh - 4);
  c.font = fMono(9.5); c.fillStyle = rgba(C_NERVE, 0.9); c.textBaseline = 'top';
  c.fillText('MAX ' + mx.toFixed(2), Math.min(xm + 6, R.x1 - 70), yh + 6);
}
function paintConv() {
  if (!conCv || !disp.st) return;
  const c = conCv.ctx, W = conCv.w, H = conCv.h, i = disp.i;
  conCv.clear();
  const I0 = i - 36, I1 = i + 24, V0 = 53.8, V1 = 57.4;
  const R = { x0: 36, x1: W - 10, y0: 8, y1: H - 20 };
  const X = j => R.x0 + (R.x1 - R.x0) * (j - I0) / (I1 - I0), Y = v => R.y1 - (R.y1 - R.y0) * (v - V0) / (V1 - V0);
  c.strokeStyle = rgba(C_TEXT, 0.1); c.lineWidth = 1; c.beginPath();
  for (let v = 54; v <= 57.4; v += 0.25) { c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  for (let j = Math.ceil(I0 / 2) * 2; j <= I1; j += 2) { c.moveTo(Math.round(X(j)) + 0.5, R.y0); c.lineTo(Math.round(X(j)) + 0.5, R.y1); }
  c.stroke();
  c.strokeStyle = rgba(C_DIM, 0.45); c.beginPath();
  for (let v = 54; v <= 57; v += 1) { c.moveTo(R.x0, Math.round(Y(v)) + 0.5); c.lineTo(R.x1, Math.round(Y(v)) + 0.5); }
  for (let j = Math.ceil(I0 / 10) * 10; j <= I1; j += 10) { c.moveTo(Math.round(X(j)) + 0.5, R.y0); c.lineTo(Math.round(X(j)) + 0.5, R.y1); }
  c.stroke();
  c.font = fMono(9); c.fillStyle = rgba(C_DIM2, 1); c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = 54; v <= 57; v += 1) c.fillText(v.toFixed(0), R.x0 - 4, Y(v));
  // iteration ticks: kept inside the canvas, and skipped where the LIMIT label below the line sits
  const lmw = c.measureText('LIMIT 54.0').width, lmY = Y(LIMIT) + 2;
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let j = Math.ceil(I0 / 20) * 20; j <= I1; j += 20) {
    const t = grp(j), hw = c.measureText(t).width / 2, x = clamp(X(j), hw + 1, W - hw - 1);
    if (x + hw > R.x1 - lmw - 3 && R.y1 + 4 < lmY + 12) continue;
    c.fillText(t, x, R.y1 + 4);
  }
  c.strokeStyle = rgba(C_ALARM, 0.85); c.setLineDash([4, 3]); c.beginPath(); c.moveTo(R.x0, Y(LIMIT) + 0.5); c.lineTo(R.x1, Y(LIMIT) + 0.5); c.stroke();
  c.strokeStyle = rgba(C_DIM2, 0.6); c.beginPath(); c.moveTo(R.x0, Y(57.2) + 0.5); c.lineTo(R.x1, Y(57.2) + 0.5); c.stroke(); c.setLineDash([]);
  c.font = fMono(9); c.fillStyle = rgba(C_DIM2, 1); c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('REV 13 · 57.2', R.x1, Y(57.2) - 2);
  c.fillStyle = rgba(C_ALARM, 0.9); c.textBaseline = 'top'; c.fillText('LIMIT 54.0', R.x1, Y(LIMIT) + 2);
  // history
  c.strokeStyle = rgba(C_NERVE, 0.8); c.lineWidth = 1.2; c.beginPath();
  for (let j = I0; j <= i; j++) { const x = X(j), y = Y(nerveOf(j)); if (j === I0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.stroke();
  c.fillStyle = rgba(C_NERVE, 0.9);
  for (let j = I0; j <= i; j++) { c.beginPath(); c.arc(X(j), Y(nerveOf(j)), j === i ? 2.8 : 1.3, 0, Math.PI * 2); c.fill(); }
  // linear projection at the last step's rate: always about 19 iterations away
  const togo = togoOf(i), jEnd = i + togo;
  c.strokeStyle = rgba(C_TEXT, 0.6); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(X(i), Y(nerveOf(i))); c.lineTo(X(Math.min(I1, jEnd)), Y(LIMIT + (nerveOf(i) - LIMIT) * (1 - Math.min(1, (Math.min(I1, jEnd) - i) / togo)))); c.stroke(); c.setLineDash([]);
  // the projection's label sits above the current iterate's level, right of its dot and marker
  // line, where neither the history (left of the dot) nor the projection (below it) runs
  const pl = 'PROJ ' + grp(Math.round(jEnd)), yb = Math.max(R.y0 + 11, Y(nerveOf(i)) - 8);
  c.fillStyle = rgba(C_TEXT, 0.9); c.font = fMono(9.5); c.textBaseline = 'bottom';
  const pw = c.measureText(pl).width;
  if (R.x1 - pw >= X(i) + 6) { c.textAlign = 'right'; c.fillText(pl, R.x1, yb); } else { c.textAlign = 'left'; c.fillText(pl, X(i) + 6, yb); }
  c.strokeStyle = rgba(C_TEXT, 0.35); c.beginPath(); c.moveTo(X(i) + 0.5, R.y0); c.lineTo(X(i) + 0.5, R.y1); c.stroke();
}
function dvhCursorTick() {
  const st = curPlan(); if (!st) return;
  const cu = dvh.cur, opts = [44.5, 49.8, 52.3, 53.6, 46.9, 38.2, 51.1, 53.9];
  cu.fromD = cu.d; cu.toD = opts[(cu.n = ((cu.n || 0) + 1) % opts.length)]; cu.t0 = performance.now(); dvh.dirty = true;
  later(1250, () => { setText('d-cur', 'CURSOR · L OPTIC NERVE · D ' + cu.toD.toFixed(1) + ' GY · V ' + cu.v.toFixed(1) + ' %'); });
}
function paintFigure(now) {
  const animating = now - dvh.t0 < dvh.dur + 50 || now - dvh.cur.t0 < 1300;
  if (!animating && !dvh.dirty) return;
  dvh.dirty = false;
  paintDvh(now);
}

// =============================================================================
// TOP STRIP · TWEENED RETYPES (valid intermediates only)
// =============================================================================

const tweens = new Map();
function retype(key, node, from, to, dec, dur, fmt) {
  const q = Math.pow(10, dec);
  const steps = Math.round(Math.abs(to - from) * q);
  if (steps === 0) { setText(node, fmt(to)); tweens.delete(key); return; }
  tweens.set(key, { node, from, to, q, t0: performance.now(), dur: Math.min(dur, 160 * steps + 200), fmt });
}
function tickTweens(now) {
  for (const [k, t] of tweens) {
    const p = clamp((now - t.t0) / t.dur, 0, 1);
    const v = Math.round(lerp(t.from, t.to, p) * t.q) / t.q;
    setText(t.node, t.fmt(v));
    if (p >= 1) tweens.delete(k);
  }
}
let nerveShown = nerveOf(ITER0);
function shownNerve() { return nerveShown.toFixed(2); }
function shownNerveNum() { return nerveShown; }
function tickClock() {
  const c = Math.floor(clockS());                      // the clock and the countdown share one whole second
  setText('t-clock', hms(c));
  const left = SIGN_AT - c;                            // so clock + T− is always 09:00:00
  setText('t-left', 'T−' + pad(left / 60) + ':' + pad(left % 60) + ' · ONCOLOGIST');
}
let covShown = 0;                                     // the coverage on the top strip (retypes start from it)
function paintTop(st, animate) {
  const i = st.i, now = performance.now();
  if (animate) {
    retype('iter', $('t-iter'), i - 1, i, 0, 400, v => grp(v));
    retype('cov', $('t-cov'), covShown, st.org.cov, 1, 500, v => v.toFixed(1) + '%');
    retype('obj', $('t-obj'), objOf(i - 1), objOf(i), 4, 600, v => 'OBJ ' + v.toFixed(4));
    const t0 = now, from = nerveOf(i - 1), to = st.org.lon.max;
    tweens.set('nerveShown', { node: { textContent: '' }, from, to, q: 100, t0, dur: 700, fmt: v => { nerveShown = v; return String(v); } });
  } else {
    setText('t-iter', grp(i)); setText('t-nerve', st.org.lon.max.toFixed(2)); setText('t-cov', st.org.cov.toFixed(1) + '%'); setText('t-obj', 'OBJ ' + objOf(i).toFixed(4));
    nerveShown = st.org.lon.max;
  }
  covShown = st.org.cov;
  setText('d-sub', 'ITER ' + grp(i) + ' · 1.0 MM SAMPLING');
  const pj = grp(Math.round(i + togoOf(i)));
  setText('d-proj', 'LINEAR PROJ 54.0 AT ITER ' + pj); setText('d-proj-n', 'PROJ 54.0 @ ' + pj);
  setText('h-iso', 'ISO (' + ISO.map(v => v.toFixed(1)).join(', ') + ') MM · CT 1.0 MM · 212 SLICES');
}

// =============================================================================
// B · BEAMS — three arcs, MU/CP profiles, the gantry live during a sweep
// =============================================================================

// MU and W are held in tenths (the table's resolution) so every column closes on its TOTAL row.
const beams = { rows: [], muT: [0, 0, 0], muShown: [0, 0, 0], wT: [0, 0, 0], prof: [null, null, null], cvs: [] };
const NULLN = { textContent: '' };                    // tween target for tweens that paint several cells
function buildBeams() {
  const tbl = $('b-tbl');
  const hd = el('div', 'tr th');
  for (const [t, cls] of [['ARC', ''], ['DIR', ''], ['GANTRY', ''], ['COUCH', 'r'], ['COLL', 'r'], ['CP', 'r'], ['MU', 'r'], ['W', 'r'], ['MU / CP · GANTRY', '']]) hd.appendChild(el('span', cls, t));
  tbl.appendChild(hd);
  ARCS.forEach((A, a) => {
    const r = el('div', 'tr');
    const cells = [el('span', 'nm', 'ARC ' + A.id), el('span', null, A.dir > 0 ? 'CW' : 'CCW'), el('span', null, A.start + ' → ' + A.stop), el('span', 'r', A.couch + '°'), el('span', 'r', A.coll + '°'), el('span', 'r', String(A.cp)), el('span', 'r', '—'), el('span', 'r', '—')];
    const wrap = el('span', 'pf'); wrap.style.position = 'relative'; wrap.style.height = '100%'; wrap.style.minHeight = '14px'; wrap.style.display = 'block';
    const cv = document.createElement('canvas'); cv.style.position = 'absolute'; cv.style.inset = '0'; cv.style.width = '100%'; cv.style.height = '100%';
    wrap.appendChild(cv);
    r.append(...cells, wrap); tbl.appendChild(r);
    beams.rows.push({ r, mu: cells[6], w: cells[7] });
    beams.cvs.push(mountCanvas(cv, () => paintProfile(a)));
  });
  const ft = el('div', 'tr');
  ft.append(el('span', 'dim', 'TOTAL'), el('span'), el('span', 'dim', '3 ARCS'), el('span'), el('span'), el('span', 'r', String(CP_TOTAL)), el('span', 'r m', '—'), el('span', 'r', '100.0%'), (() => { const sp = el('span', 'dim', 'AVOID 340–050'); sp.appendChild(el('span', 'opt', ' · ARC 1 · JAWS +4 MM')); return sp; })());
  tbl.appendChild(ft); beams.total = ft.children[6];
}
// One arc's MU retypes (second beat); the TOTAL is always the sum of the MU on screen.
function commitArc(a, st, animate) {
  const to = Math.round(st.mu[a] * 10), from = beams.muT[a];
  beams.muT[a] = to;
  const show = (v) => { beams.muShown[a] = v; setText(beams.rows[a].mu, (v / 10).toFixed(1)); setText(beams.total, (beams.muShown.reduce((q, x) => q + x, 0) / 10).toFixed(1)); return ''; };
  if (animate && to !== from) {
    tweens.set('mu' + a, { node: NULLN, from, to, q: 1, t0: performance.now(), dur: Math.min(900, 160 * Math.abs(to - from) + 200), fmt: show });
    beams.rows[a].r.classList.add('hot'); later(1800, () => beams.rows[a].r.classList.remove('hot'));
  } else { tweens.delete('mu' + a); show(to); }
  beams.prof[a] = muProfile(a, st.i, st.mu[a]);
  paintProfile(a);
}
// The optimiser's arc weights, all three at once (climax): rounded by largest remainder to 0.1 %,
// so the W column always sums to its TOTAL of 100.0 %; a retype moves one tenth at a time from
// one arc to another, so every intermediate row also sums to 100.0 %.
function wTenths(w) {
  const raw = w.map(x => x * 1000), t = raw.map(Math.floor);
  const order = [0, 1, 2].sort((p, q) => (raw[q] - t[q]) - (raw[p] - t[p]));
  for (let k = 0, rest = 1000 - t[0] - t[1] - t[2]; k < rest && k < 3; k++) t[order[k]] += 1;
  return t;
}
function paintW(t) { for (let a = 0; a < 3; a++) setText(beams.rows[a].w, (t[a] / 10).toFixed(1) + '%'); }
function commitW(st, animate) {
  const to = wTenths(st.P.w), from = beams.wT.slice(), steps = [], cur = from.slice();
  beams.wT = to;
  for (let guard = 0; guard < 400; guard++) {
    let g = -1, r = -1;
    for (let a = 0; a < 3; a++) { if (cur[a] > to[a] && g < 0) g = a; if (cur[a] < to[a] && r < 0) r = a; }
    if (g < 0 || r < 0) break;
    cur[g]--; cur[r]++; steps.push(cur.slice());
  }
  if (!animate || !steps.length || from[0] + from[1] + from[2] !== 1000) { tweens.delete('w'); paintW(to); return; }
  tweens.set('w', { node: NULLN, from: 0, to: steps.length, q: 1, t0: performance.now(), dur: Math.min(900, 160 * steps.length + 200), fmt: (v) => { paintW(v > 0 ? steps[v - 1] : from); return ''; } });
}
function paintProfile(a) {
  const R = beams.cvs[a]; if (!R || !beams.prof[a]) return;
  const c = R.ctx, W = R.w, H = R.h, A = ARCS[a], pr = beams.prof[a];
  R.clear();
  let mx = 0; for (let i = 0; i < pr.length; i++) if (pr[i] > mx) mx = pr[i];
  const n = pr.length, bw = W / n, bwd = Math.max(0.6, bw - 0.4), u = uClamped();
  const G = gantryAt(A, u);
  const rel = A.dir > 0 ? wrap360(G.th - A.start) : wrap360(A.start - G.th);
  const x = clamp(rel / A.spanDeg, 0, 1) * W;
  // the dose calculation's progress through this arc: the control points the pass has computed are
  // lit behind the gantry cursor (from the end the pass started at); the whole profile as it lands,
  // fading as the pass settles
  const tAfter = G.k >= 0 ? u - (MONEY_U0 + G.k * BEAT_DT) - G.t1 : 99;
  const o = G.live ? 1 : tAfter >= 0 && tAfter < SETTLE_S ? 1 - smooth(tAfter / SETTLE_S) : 0;
  const x0 = clamp((A.dir > 0 ? wrap360(G.a0 - A.start) : wrap360(A.start - G.a0)) / A.spanDeg, 0, 1) * W;   // where this pass started
  const lo = Math.min(x0, x), hi = Math.max(x0, x), lit = (i) => o > 0.01 && (i + 0.5) * bw >= lo && (i + 0.5) * bw < hi;
  if (o > 0.01 && hi > lo) { c.fillStyle = rgba(C_MU, 0.1 * o); c.fillRect(lo, 0, hi - lo, H - 1); }
  c.fillStyle = rgba(C_MU, 0.85);
  for (let i = 0; i < n; i++) { if (lit(i)) continue; const h = (H - 3) * pr[i] / mx; c.fillRect(i * bw, H - h, bwd, h); }
  if (o > 0.01) { c.fillStyle = rgba(C_MU, 0.85 + 0.15 * o); for (let i = 0; i < n; i++) { if (!lit(i)) continue; const h = (H - 3) * pr[i] / mx; c.fillRect(i * bw, H - h, bwd, h); } }
  c.strokeStyle = rgba(C_DIM, 0.5); c.lineWidth = 1; c.beginPath(); c.moveTo(0, H - 0.5); c.lineTo(W, H - 0.5); c.stroke();
  c.strokeStyle = rgba(C_ARC, G.live ? 1 : 0.6); c.lineWidth = G.live ? 1.5 : 1; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
  if (G.live) {                                        // the readout takes whichever side of the cursor it fits
    c.font = fMono(9); c.fillStyle = rgba(C_TEXT, 0.95); c.textBaseline = 'top';
    const tx = G.th.toFixed(1) + '°', tw = c.measureText(tx).width;
    if (x + 4 + tw <= W - 1) { c.textAlign = 'left'; c.fillText(tx, x + 4, 0); } else { c.textAlign = 'right'; c.fillText(tx, Math.max(tw + 1, x - 4), 0); }
  }
}
function paintBeamsLive() { const k = sweepIndexAt(uClamped()); if (k >= 0 || beams.wasLive) { for (let a = 0; a < 3; a++) paintProfile(a); beams.wasLive = k >= 0 && (uClamped() - (MONEY_U0 + k * BEAT_DT)) < SWEEP_S + 0.2; } }

// =============================================================================
// C · CONSTRAINTS — 7 OAR, scored against the live field; the nerve FAIL is held
// =============================================================================

const CONS = [
  { id: 'lon', name: 'L OPTIC NERVE', metric: 'MAX', lim: 54.0, dec: 2 },
  { id: 'ron', name: 'R OPTIC NERVE', metric: 'MAX', lim: 54.0, dec: 1 },
  { id: 'chi', name: 'CHIASM', metric: 'MAX', lim: 54.0, dec: 1 },
  { id: 'bst', name: 'BRAINSTEM', metric: 'MAX', lim: 54.0, dec: 1 },
  { id: 'lnl', name: 'L LENS', metric: 'MAX', lim: 7.0, dec: 1 },
  { id: 'lnr', name: 'R LENS', metric: 'MAX', lim: 7.0, dec: 1 },
  { id: 'par', name: 'PAROTIDS', metric: 'MEAN', lim: 26.0, dec: 1 },
];
const scored = {};
function valueOf(st, id) { return id === 'par' ? st.org.parMean : st.org[id].max; }
function buildConstraints() {
  const tbl = $('c-tbl');
  const hd = el('div', 'tr th');
  for (const [t, cls] of [['OAR', ''], ['METRIC', ''], ['LIMIT', 'r'], ['REV 13', 'r'], ['REV 14', 'r'], ['DOSE / LIMIT', ''], ['STATUS', 'r']]) hd.appendChild(el('span', cls, t));
  tbl.appendChild(hd);
  for (const C of CONS) {
    const r = el('div', 'tr');
    const bar = el('span', 'bar'), fill = el('i'), tick = el('u');
    bar.append(fill, tick);
    C.cur = el('span', 'r cur', '—'); C.pill = el('span', 'pill', '—'); C.fill = fill; C.row = r;
    const stc = el('span', 'st'); stc.appendChild(C.pill);
    r.append(el('span', 'nm', C.name), el('span', null, C.metric), el('span', 'r', '≤ ' + C.lim.toFixed(1)), el('span', 'r dim', REV13 ? valueOf(REV13, C.id).toFixed(1) : '—'), C.cur, bar, stc);
    tbl.appendChild(r);
  }
}
function scoreRow(C, st, animate, keepText) {
  const v = valueOf(st, C.id), prev = scored[C.id];
  scored[C.id] = v;
  if (keepText) { /* the nerve's number follows the shared nerve tween */ }
  else if (animate && prev != null) retype('c' + C.id, C.cur, prev, v, C.dec, 700, x => x.toFixed(C.dec));
  else setText(C.cur, v.toFixed(C.dec));
  const fail = v > C.lim;
  C.fill.style.width = clamp(v / C.lim / 1.1 * 100, 0, 100).toFixed(1) + '%';
  setText(C.pill, fail ? 'FAIL' : 'PASS');
  C.pill.className = 'pill ' + (fail ? 'fail' : 'pass');
  C.row.classList.toggle('fail', fail);
}
function scoreSummary() {
  const nf = CONS.filter(C => scored[C.id] > C.lim).length;
  setText('c-sub', (CONS.length - nf) + ' PASS · ' + nf + ' FAIL · SCORED ' + hms(clockS()));
}

// =============================================================================
// D · OPTIMISER LOG — fixed slots, rotating (no DOM growth)
// =============================================================================

const LOG_N = 11;
const logS = { slots: [], rows: [] };
function buildLog() {
  const root = $('l-lines');
  for (let i = 0; i < LOG_N; i++) {
    const n = el('div', 'ln'), ts = el('span', 'ts'), tg = el('span', 'tg'), tx = el('span', 'tx'), tl = el('span', 'tl');
    n.append(ts, tg, tx, tl); root.appendChild(n);
    logS.slots.push({ n, ts, tg, tx, tl });
  }
  layoutLog();
}
// Rows fill the slots oldest → newest (the newest is the last slot). When the box is too short
// for all 11 (1366 × 630 and phones), the OLDEST slots are hidden and the rest move up, so the
// line a beat has just printed is always on screen, and the header counts what is visible.
function layoutLog() {
  const root = $('l-lines'); if (!root) return;
  const H = root.clientHeight, lh = Math.max(13, Math.min(20, (H - 4) / LOG_N));
  const fit = clamp(Math.floor((H - 4) / lh), 1, LOG_N), skip = LOG_N - fit;
  logS.fit = fit;
  logS.slots.forEach((s, i) => {
    const j = i - skip, on = j >= 0;
    s.n.style.top = (2 + (on ? j : 0) * lh) + 'px'; s.n.style.lineHeight = lh + 'px';
    s.n.style.opacity = on ? '' : '0'; s.n.style.visibility = on ? '' : 'hidden';
  });
  logSub();
}
function logSub() {
  const last = logS.rows[logS.rows.length - 1];
  if (last) setText('l-sub', 'LAST ' + hms(last.t) + ' · ' + Math.min(logS.rows.length, logS.fit || LOG_N) + ' SHOWN');
}
function pushLog(t, tag, text, cls, tail) {
  logS.rows.push({ t, tag, text, cls, tail: tail || '' });
  while (logS.rows.length > LOG_N) logS.rows.shift();
  const off = LOG_N - logS.rows.length;
  logS.slots.forEach((s, i) => {
    const r = logS.rows[i - off];
    if (!r) { setText(s.ts, ''); setText(s.tg, ''); setText(s.tx, ''); setText(s.tl, ''); s.n.className = 'ln'; return; }
    setText(s.ts, hms(r.t)); setText(s.tg, r.tag); setText(s.tx, r.text); setText(s.tl, r.tail);
    s.n.className = 'ln' + (r.cls ? ' ' + r.cls : '');
  });
  const sl = logS.slots[LOG_N - 1]; sl.n.classList.add('new'); later(2200, () => sl.n.classList.remove('new'));
  logSub();
}
function iterLine(i) { return 'ITER ' + grp(i) + ' · NERVE ' + nervePrint(i).toFixed(2) + ' · COV ' + covPrint(i).toFixed(1); }
function iterTail(i) { return '· OBJ ' + objOf(i).toFixed(4) + ' · ▼' + (nerveOf(i - 1) - nerveOf(i)).toFixed(3); }
function seedLog() {
  logS.rows.length = 0;
  pushLog(CLOCK0 - 212, 'SYS', 'REV 13 · L OPTIC NERVE 57.2 · REJECTED', 'sys');
  pushLog(CLOCK0 - 147, 'SYS', 'SIGN-OFF 09:00 · ONCOLOGIST · PENDING', 'sys');
  for (let m = 8; m >= 0; m--) pushLog(CLOCK0 - 9 * m, 'OPT', iterLine(ITER0 - m), m === 0 ? 'alm' : '', iterTail(ITER0 - m));
}

// =============================================================================
// BEATS — one story timeline per 9-min cycle (ONE pending timer: 'story')
// =============================================================================

const TL = [];
let tlIdx = 0;
function buildTimeline() {
  TL.length = 0;
  for (let k = 0; k < N_BEAT; k++) {
    const kk = k, u0 = MONEY_U0 + k * BEAT_DT;
    TL.push({ u: u0, fn: () => sweepStart(kk) });
    TL.push({ u: u0 + CALC_DT, fn: () => calcLine(kk) });
    TL.push({ u: climaxU(k), fn: () => climax(kk) });
    if (u0 + SECOND_DT < CYCLE - CUT_DOWN) TL.push({ u: u0 + SECOND_DT, fn: () => secondBeat(kk) });
  }
  // the spare slot of a beat (+4.15 s: 1.85 s after the CALC line, 1.85 s before the climax)
  for (let k = 6; k < N_BEAT; k += 10) TL.push({ u: MONEY_U0 + k * BEAT_DT + EXTRA_DT, fn: () => pushLog(clockS(), 'SYS', 'AUTOSAVE · REV 14 · ITER ' + grp(disp.i) + ' · 3.4 MB', 'sys') });
  for (const k of [3, 23, 43]) TL.push({ u: MONEY_U0 + k * BEAT_DT + EXTRA_DT, fn: () => pushLog(clockS(), 'PROJ', 'LINEAR · 54.0 AT ITER ' + grp(Math.round(disp.i + togoOf(disp.i))) + ' · ' + Math.round(togoOf(disp.i)) + ' ITER', 'sys') });
  TL.push({ u: CYCLE - CUT_DOWN, fn: cutStart });
  TL.push({ u: CYCLE, fn: cycleRestart, restart: true });
  TL.sort((p, q) => p.u - q.u || (p.restart ? 1 : 0) - (q.restart ? 1 : 0));
}
function scheduleNext() {
  const u = uNow();
  while (tlIdx < TL.length && TL[tlIdx].u < u - 2 && !TL[tlIdx].restart) tlIdx++;
  if (tlIdx >= TL.length) tlIdx = TL.length - 1;
  const ev = TL[tlIdx];
  beat('story', Math.max(0, (ev.u - u) * 1000), () => {
    tlIdx += 1;
    ev.fn();
    scheduleNext();
  });
}
// MONEY SHOT, part 1: the arcs start their sweep; the optimiser's next iterate is computed
// (a 2-frame job) and its shells are revealed behind the fans as they pass.
function sweepStart(k) {
  const i = ITER0 + k + 1;
  disp.job = planJob(i); disp.jobI = i;
  disp.job.run();
}
function calcLine(k) {                                 // printed 2.3 s into the pass (the log keeps a 1.85–3.7-s cadence)
  pushLog(clockS(), 'CALC', 'ARC 1–3 · ' + CP_TOTAL + ' CP · ITER ' + grp(ITER0 + k + 1) + ' · ' + (passFwd(k, 0) ? 'CW' : 'CCW') + ' PASS', 'sys');
}
// MONEY SHOT, part 2 (the climax): the iterate lands.
function climax(k) {
  const i = ITER0 + k + 1;
  const st = disp.next && disp.next.i === i ? disp.next : planNow(i);
  const old = disp.st;
  dvh.from = old ? old.org.curves : null; dvh.to = st.org.curves; dvh.t0 = performance.now(); dvh.dirty = true;
  dvh.ghost = old ? old.org.lon.sorted : null;
  disp.st = st; disp.i = i; disp.next = null;
  paintTop(st, true);
  commitW(st, true);
  scoreRow(CONS[0], st, false, true); scoreSummary();
  pushLog(clockS(), 'OPT', iterLine(i), 'alm', iterTail(i));
  refreshLegend();
  refreshPins();
  PIN.nerve.node.classList.add('lit'); later(3400, () => PIN.nerve.node.classList.remove('lit'));
  const dl = $('t-delta'); setText(dl, '▼' + (nerveOf(i - 1) - nerveOf(i)).toFixed(3)); dl.classList.add('on'); later(4200, () => dl.classList.remove('on'));
  setText(PIN.nerve.t, 'L OPTIC NERVE · OAR · ▼' + (nerveOf(i - 1) - nerveOf(i)).toFixed(2) + ' GY'); later(4200, () => setText(PIN.nerve.t, 'L OPTIC NERVE · OAR'));
  disp.reT0 = performance.now();
  paintDetail(performance.now()); paintConv();
}
// SECOND BEAT: a constraint re-scores, one arc's MU retypes, the camera pulls focus.
const RESCORE = ['chi', 'bst', 'lnl', 'ron', 'par', 'lnr'];
function secondBeat(k) {
  const st = curPlan(); if (!st) return;
  const C = CONS.find(c => c.id === RESCORE[k % RESCORE.length]);
  scoreRow(C, st, true); scoreSummary();
  C.row.classList.add('rs'); later(2400, () => C.row.classList.remove('rs'));
  const a = k % 3;
  commitArc(a, st, true);
  refreshPins();
  // the MU note rides in the line's tail, which narrow roots drop (the score itself always fits)
  pushLog(clockS(), 'SCORE', C.name + ' · ' + C.metric + ' ' + scored[C.id].toFixed(C.dec) + ' / ' + C.lim.toFixed(1) + ' · ' + (scored[C.id] > C.lim ? 'FAIL' : 'PASS'), 'sys', '· ARC ' + (a + 1) + ' ' + (beams.muT[a] / 10).toFixed(1) + ' MU');
}

// =============================================================================
// THE CUT — at 08:50:00 one plain 1.1-s dip to the background returns to frame 1
// =============================================================================

let cutShown = -1;
function cutOpacity() {
  const a = activeSec();
  if (cyc.upT0 >= cyc.cutT0) { const t = a - cyc.upT0; return t >= 0 && t < CUT_UP ? 1 - smooth(t / CUT_UP) : 0; }
  const d = a - cyc.cutT0;
  return d >= 0 ? smooth(d / CUT_DOWN) : 0;
}
function paintCut() {
  const o = Math.round(cutOpacity() * 100) / 100;
  if (o === cutShown) return;
  cutShown = o;
  const n = $('iso-cut'); if (n) n.style.opacity = String(o);
}
function cutStart() { cyc.cutT0 = activeSec(); paintCut(); }
function cycleRestart() {
  cyc.start = activeSec(); cyc.n += 1; cyc.upT0 = activeSec();
  tlIdx = 0;
  initCycle();
}
function initCycle() {
  const st = planNow(ITER0);
  disp.st = st; disp.i = ITER0; disp.next = null; disp.job = null;
  dvh.from = null; dvh.to = st.org.curves; dvh.t0 = -1e9; dvh.ghost = null; dvh.dirty = true;
  for (let a = 0; a < 3; a++) commitArc(a, st, false);
  commitW(st, false);
  for (const C of CONS) scoreRow(C, st, false);
  scoreSummary();
  tweens.clear();
  paintTop(st, false);
  seedLog();
  refreshLegend(); refreshPins();
  tickClock(); tickCalc();
  paintDetail(performance.now()); paintConv();
}

// =============================================================================
// LOOP BODIES
// =============================================================================

let nervePinShown = '';
function heroFrame(now) {
  // finish the pending plan job (frame 2 of the re-mesh) before drawing
  if (disp.job && !disp.job.done) { if (disp.job.run()) { disp.next = disp.job.st; } }
  else if (disp.job && disp.job.done && (!disp.next || disp.next.i !== disp.job.i) && disp.job.i === disp.i + 1) disp.next = disp.job.st;
  tickTweens(now);
  if (shownNerve() !== nervePinShown) {                 // ONE tween drives every place the nerve max is printed
    nervePinShown = shownNerve();
    pinVal(PIN.nerve, [['MAX ', 'l'], [nervePinShown, 'b'], [' GY · LIMIT 54.0', 'l']]);
    setText('t-nerve', nervePinShown); setText(CONS[0].cur, nervePinShown);
  }
  renderHero(now);
  paintCut();
}
function figureFrame(now) {
  const u = uClamped();
  reviewAt(u);
  const key = rev.cur + ':' + rev.prev + ':' + Math.round(rev.up * 2);   // 3 repaints per review step
  if (key !== rev.key) { rev.key = key; dvh.dirty = true; }
  paintFigure(now);
  if (now - dvh.t0 < dvh.dur + 60) paintDetail(now);
  paintBeamsLive();
}

// =============================================================================
// LAYOUT · BOOT
// =============================================================================

function onResize() {
  setRootMetrics();
  rootBox.key = rootKey();
  for (const c of canvases) c.fit();
  layoutLog();
  measurePins();
  renderAll(performance.now());
}
function renderAll(now) {
  renderHero(now);
  dvh.dirty = true; paintDvh(now); paintDetail(now); paintConv();
  for (let a = 0; a < 3; a++) paintProfile(a);
}
function grain() {
  const c = document.createElement('canvas'); c.width = 180; c.height = 180;
  const x = c.getContext('2d'), img = x.createImageData(180, 180), r = mulberry32(0x1d05e);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.floor(r() * 255); img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  try { $('iso-root').style.setProperty('--grain', 'url(' + c.toDataURL('image/png') + ')'); } catch (_) { /* no grain */ }
}
function bootScene() {
  if (booted) return;
  booted = true;
  buildAnatomy();
  buildSamples();
  buildShellGrids();
  const P0 = planParams(ITER0); calibrate(P0, covOf(ITER0) / 100, nerveOf(ITER0)); BASE = { S: P0.S, w: P0.w.slice() };
  const P13 = { S: 70, beta: 0.05, lam: 4.6, w: [0.42, 0.34, 0.24] }; calibrate(P13, 0.986, 57.2);
  REV13 = { org: organStats(P13) };
  buildProbePoints();
  setRootMetrics();
  hero = mountCanvas('h-cv', (now) => { measurePins(); renderHero(now || performance.now()); });
  wireViewControls(hero);
  dvhCv = mountCanvas('d-cv', (now) => { dvh.dirty = true; paintDvh(now || performance.now()); });
  detCv = mountCanvas('z-cv', (now) => paintDetail(now || performance.now()));
  conCv = mountCanvas('c-cv', paintConv);
  buildPins(); buildLegend(); buildBeams(); buildConstraints(); buildLog(); buildTimeline(); wireScanToggles();
  const eyesQ = new URLSearchParams(location.search).get('eyes');
  if (eyesQ === 'off') setTimeout(toggleEyes, 500);
  const scanQ = new URLSearchParams(location.search).get('scan');
  if (scanQ === 'brain' || scanQ === 'skull' || scanQ === 'all') {
    setTimeout(() => {
      if (scanQ === 'brain' || scanQ === 'all') toggleScan('brain');
      if (scanQ === 'skull' || scanQ === 'all') toggleScan('skull');
    }, 700);
  }
  cyc.start = activeSec();
  if (prefersReducedMotion) staticU = climaxU(0) + 1.4;   // one still instant: the first iterate has landed and settled, the camera is wide
  initCycle();
  if (prefersReducedMotion) {
    // One populated, still frame at 08:41:08: iteration 2,318 has landed, the fans are parked, the camera is wide.
    const st = planNow(ITER0 + 1); disp.st = st; disp.i = st.i;
    pushLog(CLOCK0 + MONEY_U0 + CALC_DT, 'CALC', 'ARC 1–3 · ' + CP_TOTAL + ' CP · ITER ' + grp(st.i) + ' · CW PASS', 'sys');
    paintTop(st, false); commitW(st, false); scoreRow(CONS[0], st, false); pushLog(CLOCK0 + climaxU(0), 'OPT', iterLine(st.i), 'alm', iterTail(st.i));
    scoreSummary(); refreshLegend(); refreshPins(); tickClock(); tickCalc();
    dvh.to = st.org.curves; dvh.from = null; dvh.ghost = null;
  }
  measurePins();
  renderAll(performance.now());
  grain();
  rootBox.key = rootKey();
  if (sizeObserver) sizeObserver.observe($('iso-root'));
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("10px 'IBM Plex Mono'"), document.fonts.load('600 10px Inter')])
      .then(() => { if (!booted) return; measurePins(); layoutLog(); renderAll(performance.now()); })
      .catch(() => { /* first paint stands */ });
  }

  addRaf('hero', heroFrame, heroFps);
  addRaf('figure', figureFrame, 24);
  every('clock', 1000, tickClock);
  every('calc', 250, tickCalc);
  every('view', 600, tickView);
  every('cursor', 2800, dvhCursorTick);
  every('probe', 3700, probeTick);
  every('legend', 1500, refreshLegend);
  if (!prefersReducedMotion) {
    for (const r of liveRafs) r.start();
    startLoops();
    scheduleNext();
    if (document.hidden) pauseScene();
  }

  wireShareButton();
  wireFullscreenButton();
  initChromeAutoHide();
  observeFitScale(() => scheduleResize(160));
}

// --- Visibility: every loop stops when hidden and restarts once when visible -----------
function pauseScene() {
  if (paused) return;
  paused = true;
  gen += 1;
  pauseClock();
  for (const r of liveRafs) r.stop();
  stopLoops();
  clearBeats();
  clearUi();
}
function resumeScene() {
  if (!paused) return;
  paused = false;
  gen += 1;
  resumeClock();
  for (const n of document.querySelectorAll('#iso-root .hot, #iso-root .lit, #iso-root .rs')) n.classList.remove('hot', 'lit', 'rs');
  tickClock(); tickCalc();
  for (const r of liveRafs) r.start();
  startLoops();
  scheduleNext();
}
document.addEventListener('visibilitychange', () => {
  if (prefersReducedMotion || !booted) return;
  if (document.hidden) pauseScene(); else resumeScene();
});

// --- Site chrome wiring (from terra-7.js) ----------------------------------------------

function wireFullscreenButton() {
  // nav.js wires #btn-fullscreen (capture phase, webkit fallback); nothing to add here.
}

function wireShareButton() {
  const btn = document.getElementById('btn-share');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const url = location.origin + location.pathname;
    const title = 'ISODOSE — Scenescapes';
    const text = 'Nested isodose shells around a red target, pulling back from a white nerve one iteration at a time.';
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); } catch (_) { /* user cancel */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        const original = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (_) { /* clipboard blocked */ }
    }
  });
}

function initChromeAutoHide() {
  const top = document.getElementById('chrome-top');
  const bot = document.getElementById('chrome-bottom');
  if (!top || !bot) return;
  function show() {
    top.classList.remove('hidden');
    bot.classList.remove('hidden');
    if (chromeAutoHideTimer) clearTimeout(chromeAutoHideTimer);
    chromeAutoHideTimer = setTimeout(() => {
      // Don't hide if mouse is currently over the chrome (PREV/NEXT/BROWSE/LORE).
      if (top.matches(':hover') || bot.matches(':hover')) return;
      top.classList.add('hidden');
      bot.classList.add('hidden');
    }, 1500);
  }
  document.addEventListener('mousemove', show, { passive: true });
  document.addEventListener('touchstart', show, { passive: true });
  document.addEventListener('keydown', show);
  top.addEventListener('mouseleave', show);
  bot.addEventListener('mouseleave', show);
  top.addEventListener('mouseenter', () => { if (chromeAutoHideTimer) clearTimeout(chromeAutoHideTimer); });
  bot.addEventListener('mouseenter', () => { if (chromeAutoHideTimer) clearTimeout(chromeAutoHideTimer); });
  show();
}

// --- Teardown -------------------------------------------------------------------------
window.addEventListener('beforeunload', () => {
  try { stopLoops(); clearBeats(); clearUi(); } catch (_) { /* unloading */ }
  for (const r of liveRafs) try { r.stop(); } catch (_) { /* unloading */ }
  if (sizeObserver) try { sizeObserver.disconnect(); } catch (_) { /* unloading */ }
});


// --- Start -------------------------------------------------------------------
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootScene, { once: true }); else bootScene();

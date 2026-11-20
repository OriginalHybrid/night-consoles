/* ============================================================================
   Night Consoles — shared behaviour + canvas toolkit (clean-room, original code)
   Exposes window.U. Every theme page links this file and calls U.page(name).
   ========================================================================== */
(function (g) {
  'use strict';
  const U = g.U = {};
  const NS = g.NIGHTCONSOLES = g.NIGHTCONSOLES || {};
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------ tiny helpers */
  U.$ = (s, r) => (r || document).querySelector(s);
  U.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  U.pad = (n, w = 2) => String(n).padStart(w, '0');
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  U.rnd = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  U.pick = (arr, r) => arr[Math.floor((r ? r() : Math.random()) * arr.length) % arr.length];
  U.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ------------------------------------------------------------ page bootstrap */
  U.palette = function (name) {
    const p = (NS.PALETTES || {})[name];
    if (!p) return;
    const root = document.documentElement.style;
    root.setProperty('--bg', p.bg); root.setProperty('--panel', p.panel);
    root.setProperty('--text', p.text); root.setProperty('--dim', p.dim);
    root.setProperty('--accent', p.accent); root.setProperty('--data', p.data);
    root.setProperty('--cool', p.cool || p.data); root.setProperty('--alarm', p.alarm);
  };

  U.page = function (name, opts = {}) {
    U.palette(name);
    document.body.dataset.theme = name;
    // ambient overlay layers. opts.scan === false keeps the CRT scanlines off a
    // page whose hero artwork must not be crossed by horizontal lines.
    if (!document.querySelector('.u-vignette')) {
      const layers = [];
      if (opts.scan !== false) {
        const scan = document.createElement('div'); scan.className = 'u-scan';
        layers.push(scan);
      }
      const vig = document.createElement('div'); vig.className = 'u-vignette';
      const noise = document.createElement('div'); noise.className = 'u-noise';
      layers.push(vig, noise);
      document.body.append(...layers);
    }
    // live clocks
    U.$$('[data-clock]').forEach((el) => U.clock(el, el.dataset.clock));
    // seed any [data-seed] counters
    U.$$('[data-rnd]').forEach((el) => {
      const r = U.rnd(parseInt(el.dataset.rnd || '7', 10));
      el.textContent = (el.dataset.rnd || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) > 0 ? U.pick(el.dataset.rnd.split('|'), r) : '';
    });
    U.startTicker();
    return U;
  };

  U.clock = function (el, tz) {
    const tick = () => {
      const now = new Date();
      let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      if (tz) {
        const off = tz === 'UTC' ? -now.getTimezoneOffset() : 0;
        const t = new Date(now.getTime() + off * 60000);
        h = t.getHours(); m = t.getMinutes(); s = t.getSeconds();
      }
      el.textContent = U.pad(h) + ':' + U.pad(m) + ':' + U.pad(s);
    };
    tick(); setInterval(tick, 1000);
  };

  /* rolling odometer-style number */
  U.odometer = function (el, value, digits = 6) {
    const s = Math.abs(Math.round(value)).toString().padStart(digits, '0');
    el.innerHTML = s.split('').map((d) => '<span class="u-od">' + d + '</span>').join('');
  };

  /* ------------------------------------------------------------ status badges */
  U.src = function (state, label) {
    const span = document.createElement('span');
    span.className = 'u-src ' + state;
    span.innerHTML = '<i></i>' + (label || state.toUpperCase());
    return span;
  };
  U.setSrc = function (el, state, label) {
    if (!el) return;
    el.className = 'u-src ' + state;
    el.innerHTML = '<i></i>' + (label || state.toUpperCase());
  };

  /* ------------------------------------------------------------ live fetch */
  U.fetchJSON = async function (url, opts = {}) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: opts.headers || {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(to); }
  };

  /* Wire a live dataset with graceful degradation:
     U.live({ source, url, parse, fallback }) -> { data, state } */
  U.live = async function (cfg) {
    try {
      const raw = await U.fetchJSON(cfg.url, cfg.opts);
      const data = cfg.parse ? cfg.parse(raw) : raw;
      return { data, state: 'live', source: cfg.source };
    } catch (e) {
      return { data: cfg.fallback(), state: 'degraded', source: cfg.source, error: String(e) };
    }
  };

  /* ------------------------------------------------------------ ticker */
  U.startTicker = function () {
    if (U._ticker) return;
    U._ticker = setInterval(() => {
      U.$$('[data-tick]').forEach((el) => {
        const mode = el.dataset.tick;
        if (mode === 'clock') return;
        const base = parseFloat(el.dataset.base || '0');
        const drift = parseFloat(el.dataset.drift || '0.01');
        const v = base + (Math.random() - .5) * drift;
        el.dataset.base = v.toFixed(4);
        const dec = parseInt(el.dataset.dec || '1', 10);
        el.textContent = (dec < 0 ? U.fmt(v, -dec) : v.toFixed(dec)) + (el.dataset.suffix || '');
      });
      // blinking cells / logs
      U.$$('[data-log]').forEach((log) => U.pushLog(log));
    }, 1400);
  };

  const LOG_LINES = {
    default: [
      'heartbeat ok — bus a nominal', 'queue depth within band', 'calibration drift corrected',
      'telemetry frame accepted', 'watchdog reset requested', 'buffer flushed to archive',
      'link margin stable', 'sensor array nominal', 'clock sync acquired', 'packet loss 0.00%'
    ]
  };
  U.pushLog = function (log) {
    const t = new Date();
    const line = document.createElement('div');
    const hot = Math.random() < .2;
    const alarm = Math.random() < .06;
    if (hot) line.className = 'u-hot';
    if (alarm) line.className = 'u-alarm';
    const tag = alarm ? 'ALARM' : hot ? 'NOTE ' : 'EVT  ';
    line.innerHTML = '<time>' + U.pad(t.getHours()) + ':' + U.pad(t.getMinutes()) + ':' + U.pad(t.getSeconds()) +
      '</time><span class="u-tag">' + tag + '</span><span class="u-msg">' + U.pick(LOG_LINES.default) + '</span>';
    log.appendChild(line);
    while (log.children.length > (parseInt(log.dataset.max || '9', 10))) log.removeChild(log.firstChild);
  };

  /* ------------------------------------------------------------ canvas engine */
  U.canvas = function (sel, draw, opts = {}) {
    const wrap = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!wrap) return null;
    const c = document.createElement('canvas');
    wrap.appendChild(c);
    const ctx = c.getContext('2d');
    let w = 0, h = 0, raf = 0, frame = 0, last = 0;
    const fps = opts.fps || 0;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + 'px'; c.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const loop = (ts) => {
      raf = requestAnimationFrame(loop);
      if (fps && ts - last < 1000 / fps) return;
      last = ts; frame++;
      ctx.clearRect(0, 0, w, h);
      try { draw(ctx, w, h, ts / 1000, frame); } catch (e) { /* keep the ambient loop alive */ }
    };
    raf = requestAnimationFrame(loop);
    return { canvas: c, ctx, stop: () => { cancelAnimationFrame(raf); ro.disconnect(); }, get size() { return { w, h }; } };
  };

  /* deterministic background fill */
  U.draw = {};
  const D = U.draw;
  D.grid = function (ctx, w, h, color, step = 26, alpha = .5) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
    ctx.stroke(); ctx.restore();
  };

  D.crosshair = function (ctx, x, y, r, color, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * .3, 0); ctx.moveTo(r * .3, 0); ctx.lineTo(r, 0);
    ctx.moveTo(0, -r); ctx.lineTo(0, -r * .3); ctx.moveTo(0, r * .3); ctx.lineTo(0, r); ctx.stroke(); ctx.restore();
  };

  D.rings = function (ctx, cx, cy, radii, color, opts = {}) {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = opts.alpha ?? .5;
    radii.forEach((r, i) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.lineWidth = i === opts.hotIndex ? 1.6 : 1;
      if (i === opts.hotIndex) { ctx.globalAlpha = .95; } else { ctx.globalAlpha = opts.alpha ?? .5; }
      ctx.stroke();
      if (opts.ticks) {
        const n = opts.ticks;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + (opts.rot || 0);
          const r1 = r - 2, r2 = r + (k % 5 === 0 ? 5 : 2);
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
        }
      }
    });
    ctx.restore();
  };

  D.sweep = function (ctx, cx, cy, r, color, angle, trail = 1.2) {
    ctx.save();
    const grd = ctx.createConicGradient ? ctx.createConicGradient(angle - trail, cx, cy) : null;
    if (grd) {
      grd.addColorStop(0, 'transparent'); grd.addColorStop(.8, color); grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd; ctx.globalAlpha = .18;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = color; ctx.globalAlpha = .85; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r); ctx.stroke();
    ctx.restore();
  };

  D.wave = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0, n = opts.n || 140, amp = opts.amp || h * .22;
    const base = opts.base || h * .5, freq = opts.freq || 1.4, speed = opts.speed || .8;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = opts.width || 1; ctx.globalAlpha = opts.alpha || .9;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const env = Math.sin((i / n) * Math.PI);
      const y = base + Math.sin(i * .16 * freq + t * speed) * amp * env +
        Math.sin(i * .53 * freq - t * 1.7) * amp * .28 * env;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // trailing echo
    ctx.globalAlpha *= .25;
    ctx.translate(0, opts.echo || 6); ctx.stroke(); ctx.restore();
  };

  D.ecg = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0; ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.globalAlpha = .95;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const p = ((x + t * 90) % 220) / 220;
      let y = h * .5;
      if (p < .08) y -= Math.sin(p / .08 * Math.PI) * h * .10;
      else if (p > .12 && p < .16) y += Math.sin((p - .12) / .04 * Math.PI) * h * .30;
      else if (p > .16 && p < .2) y -= Math.sin((p - .16) / .04 * Math.PI) * h * .35;
      else if (p > .2 && p < .26) y += Math.sin((p - .2) / .06 * Math.PI) * h * .08;
      else if (p > .36 && p < .5) y -= Math.sin((p - .36) / .14 * Math.PI) * h * .16;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  };

  D.particles = function (ctx, w, h, color, opts = {}) {
    const r = U.rnd(opts.seed || 9); const n = opts.n || 60; const t = opts.t || 0;
    ctx.save(); ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x0 = r() * w, y0 = r() * h, sp = .2 + r() * .9, sz = .5 + r() * 1.8;
      const x = (x0 + Math.cos(t * sp + i) * 12 + w) % w;
      const y = (y0 + Math.sin(t * sp * .7 + i * 1.7) * 10 + h) % h;
      ctx.globalAlpha = .15 + r() * .6;
      ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  D.globe = function (ctx, cx, cy, r, color, opts = {}) {
    const t = opts.t || 0, rot = opts.rot || t * .18;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .28;
    for (let i = 1; i < 6; i++) { // latitudes
      const yy = cy - r + (i / 6) * 2 * r;
      const rr = Math.sqrt(Math.max(0, r * r - (yy - cy) * (yy - cy)));
      ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * .28, 0, 0, TAU); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) { // longitudes
      const a = rot + (i / 8) * Math.PI;
      const rx = Math.abs(Math.cos(a)) * r;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, r, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = .9; ctx.strokeStyle = opts.hot || color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    if (opts.pins) {
      const rnd = U.rnd(opts.seed || 21);
      ctx.fillStyle = opts.hot || color;
      for (let i = 0; i < opts.pins; i++) {
        const a = rnd() * TAU, b = Math.acos(2 * rnd() - 1);
        const px = cx + r * Math.sin(b) * Math.cos(a + rot), py = cy + r * Math.cos(b);
        if (Math.cos(a + rot) > -.2) { ctx.beginPath(); ctx.arc(px, py, 1.4, 0, TAU); ctx.fill(); }
      }
    }
    ctx.restore();
  };

  D.orbits = function (ctx, cx, cy, r, color, opts = {}) {
    const t = opts.t || 0; const rnd = U.rnd(opts.seed || 4);
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = .35;
    const n = opts.n || 4;
    for (let i = 1; i <= n; i++) {
      const rr = r * (i / n);
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * (opts.squash || .42), (opts.tilt || 0) + i * .18, 0, TAU); ctx.stroke();
      const a = t * (.5 + i * .18) + rnd() * TAU;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * (opts.squash || .42);
      ctx.fillStyle = i === opts.hotIndex ? (opts.hot || color) : color; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.arc(px, py, i === opts.hotIndex ? 2.4 : 1.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  D.starfield = function (ctx, w, h, color, opts = {}) {
    D.particles(ctx, w, h, color, { seed: opts.seed || 3, n: opts.n || 120, t: opts.t || 0 });
  };

  D.terrain = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0, layers = opts.layers || 5;
    ctx.save();
    for (let L = 0; L < layers; L++) {
      const r = U.rnd((opts.seed || 11) + L * 31);
      const base = h * (.35 + L * .1);
      ctx.strokeStyle = color; ctx.globalAlpha = .18 + L * .11; ctx.lineWidth = 1;
      ctx.beginPath();
      const pts = 40;
      for (let i = 0; i <= pts; i++) {
        const x = (i / pts) * w;
        const y = base + Math.sin(i * .4 + t * .25 + L) * 10 + (r() - .5) * 26 * (1 - L / layers);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  D.flow = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0, n = opts.n || 26; const r = U.rnd(opts.seed || 8);
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = .35; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const x0 = r() * w, y0 = r() * h;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      let x = x0, y = y0;
      for (let s = 0; s < 18; s++) {
        const a = Math.sin(x * .012 + t * .3) + Math.cos(y * .015 - t * .2) + i;
        x += Math.cos(a) * 7; y += Math.sin(a) * 7; ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  D.hexgrid = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0, s = opts.size || 16;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let y = 0, row = 0; y < h + s; y += s * .87, row++) {
      for (let x = 0; x < w + s; x += s * 1.5) {
        const ox = x + (row % 2 ? s * .75 : 0);
        const on = Math.sin(ox * .05 + t + y * .03) > .55;
        ctx.globalAlpha = on ? .55 : .14;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * TAU / 6;
          const px = ox + Math.cos(a) * s * .52, py = y + Math.sin(a) * s * .52;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
  };

  D.radialTicks = function (ctx, cx, cy, rIn, rOut, color, n = 60, t = 0) {
    ctx.save(); ctx.strokeStyle = color;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * .05;
      const hot = Math.sin(i * 1.7 + t) > .8;
      ctx.globalAlpha = hot ? .95 : .35; ctx.lineWidth = hot ? 1.6 : 1;
      const r1 = hot ? rIn : rIn + 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.stroke();
    }
    ctx.restore();
  };

  D.cascade = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0;
    ctx.save(); ctx.fillStyle = color;
    const cx = w / 2, cy = h * .55;
    for (let i = 0; i < 46; i++) {
      const a = i * 2.4 + t * .6, rr = (i / 46) * Math.min(w, h) * .42;
      const x = cx + Math.cos(a) * rr * (1 + Math.sin(t + i) * .06);
      const y = cy + Math.sin(a * 1.3) * rr * .55;
      ctx.globalAlpha = .15 + (i / 46) * .7;
      ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 2));
    }
    ctx.globalAlpha = .5;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, 12 + i * 9 + Math.sin(t * 2 + i) * 2, 0, TAU);
      ctx.strokeStyle = color; ctx.globalAlpha = .35 - i * .03; ctx.stroke();
    }
    ctx.restore();
  };

  D.contour = function (ctx, w, h, color, opts = {}) {
    const t = opts.t || 0; const r = U.rnd(opts.seed || 5);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    const cx = w * (opts.cx || .5), cy = h * (opts.cy || .5);
    for (let k = 1; k <= 7; k++) {
      ctx.globalAlpha = .12 + k * .05;
      ctx.beginPath();
      const radii = 8;
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * TAU;
        const rr = (k * Math.min(w, h) * .055) * (1 + Math.sin(a * radii + k + t * .2) * .16 + (r() - .5) * .05);
        const x = cx + Math.cos(a) * rr * (opts.sx || 1.5), y = cy + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  };

  D.ladder = function (ctx, w, h, color, opts = {}) {
    const rows = opts.rows || 8, t = opts.t || 0;
    ctx.save(); ctx.font = '9px ' + (U.css('--mono') || 'monospace');
    for (let i = 0; i < rows; i++) {
      const y = (i + .7) * (h / rows);
      const hot = i === (opts.hot || 2);
      ctx.strokeStyle = color; ctx.globalAlpha = hot ? .9 : .28;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * (.55 + Math.sin(t + i) * .03), y); ctx.stroke();
      ctx.globalAlpha = hot ? 1 : .4;
      ctx.fillStyle = hot ? (opts.hotColor || color) : color;
      ctx.fillRect(w * .55, y - 3, w * .4, hot ? 2 : 1);
      ctx.fillStyle = color; ctx.globalAlpha = .5;
      ctx.fillText('T-' + U.pad(rows - i), 2, y - 3);
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ procedural planet
     Value-noise sphere sampled on a lat/lon grid: continents, deserts, ice,
     cloud deck, limb glow and terminator. Deterministic for a given seed, so
     every frame of the rotation is reproducible.
     3D noise keeps the field continuous across the date line.
  ------------------------------------------------------------------------- */
  const _earthCache = {};
  const _h3 = (x, y, z, s) => {
    let n = (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647) ^ (s * 1013904223);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const _n3 = (x, y, z, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const c000 = _h3(xi, yi, zi, s), c100 = _h3(xi + 1, yi, zi, s);
    const c010 = _h3(xi, yi + 1, zi, s), c110 = _h3(xi + 1, yi + 1, zi, s);
    const c001 = _h3(xi, yi, zi + 1, s), c101 = _h3(xi + 1, yi, zi + 1, s);
    const c011 = _h3(xi, yi + 1, zi + 1, s), c111 = _h3(xi + 1, yi + 1, zi + 1, s);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };

  /* 8-slot surface palette: deep ocean → shelf → lowland → midland → arid → tundra → ice */
  const EARTH_PAL = new Uint8Array([
     7, 16,  9,
    14, 30, 15,
    24, 48, 24,
    52, 78, 34,
    74,104, 46,
   140,120, 62,
   104,118, 88,
   206,218,194
  ]);

  /* Pre-baked equirectangular surface: palette index, RGB and cloud density per texel.
     Domain-warped fBm keeps coastlines from reading as round blobs; a separable
     blur then softens the mask so the sphere samples as a continuous surface. */
  D.earthField = function (seed) {
    const key = 'globe:' + seed;
    if (_earthCache[key]) return _earthCache[key];
    const gw = 512, gh = 256, n = gw * gh;
    const raw = new Float32Array(n);
    const bio = new Float32Array(n);
    const cld = new Float32Array(n);

    for (let j = 0; j < gh; j++) {
      const lat = ((j + .5) / gh - .5) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat), alat = Math.abs(lat);
      for (let i = 0; i < gw; i++) {
        const lon = ((i + .5) / gw) * Math.PI * 2 - Math.PI;
        const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);

        /* low-frequency warp bends the continental field */
        const wx = _n3(px * 2.05 + 11, py * 2.05 + 3, pz * 2.05 + 7, seed + 401) - .5;
        const wy = _n3(px * 2.05 + 23, py * 2.05 + 17, pz * 2.05 + 5, seed + 409) - .5;
        const wz = _n3(px * 2.05 + 31, py * 2.05 + 29, pz * 2.05 + 13, seed + 419) - .5;
        const qx = px + wx * .62, qy = py + wy * .62, qz = pz + wz * .62;

        let v = 0, amp = 1, tot = 0, f = 1.35;
        for (let o = 0; o < 5; o++) {
          v += _n3(qx * f + 13, qy * f + 7, qz * f + 3, seed + o * 31) * amp;
          tot += amp; amp *= .52; f *= 2.05;
        }
        v /= tot;

        let b = 0; amp = 1; tot = 0; f = 2.6;
        for (let o = 0; o < 3; o++) {
          b += _n3(px * f + 5, py * f + 9, pz * f + 1, seed + 71 + o * 17) * amp;
          tot += amp; amp *= .55; f *= 2.3;
        }
        bio[j * gw + i] = b / tot;

        /* cloud deck: zonal streaks, denser at the equator and the westerlies */
        let c = 0; amp = 1; tot = 0; f = 2.7;
        for (let o = 0; o < 5; o++) {
          c += _n3(px * f + 21, py * f * 1.9 + 2, pz * f + 13, seed + 133 + o * 23) * amp;
          tot += amp; amp *= .58; f *= 2.2;
        }
        c /= tot;
        const band = .55 + .45 * Math.abs(Math.cos(lat * 3.1));
        const dry = Math.max(0, .34 - Math.abs(alat - .42) * 1.5);
        cld[j * gw + i] = (c * band) - dry * .18;

        /* polar ice drifts a little with the noise field */
        const iceEdge = 1.29 + (b - .5) * .16;
        raw[j * gw + i] = v + (alat > iceEdge ? (alat - iceEdge) * .55 : 0);
      }
    }

    /* separable blur (longitude wraps) so the mask has no hard texel edges */
    const tmp = new Float32Array(n), land = new Float32Array(n);
    for (let j = 0; j < gh; j++) {
      const row = j * gw;
      for (let i = 0; i < gw; i++) {
        const a = row + (i === 0 ? gw - 1 : i - 1);
        const c0 = row + i;
        const b = row + (i === gw - 1 ? 0 : i + 1);
        tmp[c0] = (raw[a] + raw[c0] * 2 + raw[b]) * .25;
      }
    }
    for (let j = 0; j < gh; j++) {
      const up = (j === 0 ? 0 : j - 1) * gw, cu = j * gw, dn = (j === gh - 1 ? gh - 1 : j + 1) * gw;
      for (let i = 0; i < gw; i++) {
        land[cu + i] = (tmp[up + i] + tmp[cu + i] * 2 + tmp[dn + i]) * .25;
      }
    }

    const tex = new Uint8Array(n);
    const rgb = new Uint8Array(n * 3);
    for (let j = 0; j < gh; j++) {
      const lat = ((j + .5) / gh - .5) * Math.PI;
      const alat = Math.abs(lat);
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const v = land[k], b = bio[k];
        let idx;
        if (alat > 1.365) idx = 7;
        else if (v < .530) idx = v < .484 ? 0 : (v < .509 ? 1 : 2);
        else if (alat > 1.205) idx = 6;
        else if (b > .585 && alat < 1.1) idx = 5;
        else idx = v > .572 ? 4 : 3;
        tex[k] = idx;
        const p = idx * 3;
        rgb[k * 3] = EARTH_PAL[p];
        rgb[k * 3 + 1] = EARTH_PAL[p + 1];
        rgb[k * 3 + 2] = EARTH_PAL[p + 2];
      }
    }

    const F = { gw, gh, tex, rgb, cld };
    _earthCache[key] = F;
    return F;
  };

  const _globeBuf = {};
  function globeBuf(R) {
    const size = Math.max(8, Math.round(R * 2));
    if (_globeBuf[size]) return _globeBuf[size];
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g2 = c.getContext('2d');
    _globeBuf[size] = { c, g2, img: g2.createImageData(size, size), size };
    return _globeBuf[size];
  }

  D.earth = function (ctx, cx, cy, R, opts = {}) {
    const t = opts.t || 0;
    const rot = opts.rot != null ? opts.rot : t * 0.05;
    const F = D.earthField(opts.seed || 17);
    const gw = F.gw, gh = F.gh, tex = F.tex, rgbT = F.rgb, cldA = F.cld;
    const B = globeBuf(R), size = B.size, half = size / 2, data = B.img.data;

    const spin = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const rad = Math.PI / 180;
    const LX = -.44, LY = .40, LZ = .80, AMB = .16, DIFF = .95;

    for (let y = 0; y < size; y++) {
      const ny = -(y + .5 - half) / R;
      for (let x = 0; x < size; x++) {
        const nx = (x + .5 - half) / R;
        const o = (y * size + x) * 4;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) { data[o + 3] = 0; continue; }
        const nz = Math.sqrt(1 - d2);

        const lat = Math.asin(ny);
        const v = (lat + Math.PI / 2) / Math.PI;
        let u = (Math.atan2(nx, nz) + spin) / (Math.PI * 2) + .5;
        u -= Math.floor(u);

        /* bilinear sample of the surface texture */
        const fx = u * gw - .5, fy = v * gh - .5;
        let x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const x1 = (x0 + 1) % gw;
        x0 = ((x0 % gw) + gw) % gw;
        let y1 = y0 + 1; if (y1 >= gh) y1 = gh - 1;
        if (y0 < 0) y0 = 0;
        const k00 = y0 * gw + x0, k10 = y0 * gw + x1, k01 = y1 * gw + x0, k11 = y1 * gw + x1;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;

        let r = rgbT[k00 * 3] * w00 + rgbT[k10 * 3] * w10 + rgbT[k01 * 3] * w01 + rgbT[k11 * 3] * w11;
        let g = rgbT[k00 * 3 + 1] * w00 + rgbT[k10 * 3 + 1] * w10 + rgbT[k01 * 3 + 1] * w01 + rgbT[k11 * 3 + 1] * w11;
        let b = rgbT[k00 * 3 + 2] * w00 + rgbT[k10 * 3 + 2] * w10 + rgbT[k01 * 3 + 2] * w01 + rgbT[k11 * 3 + 2] * w11;

        const lam = nx * LX + ny * LY + nz * LZ;
        let sh = AMB + DIFF * (lam > 0 ? lam : 0);
        if (sh > 1.1) sh = 1.1;
        r *= sh; g *= sh; b *= sh;

        /* sun glint on open water */
        if (tex[k00] < 3 && lam > 0) {
          const spec = lam * lam;
          const gl = spec * spec * spec * spec * 90;
          r += gl; g += gl; b += gl * .78;
        }

        /* wispy cloud deck */
        const c0 = cldA[k00] * w00 + cldA[k10] * w10 + cldA[k01] * w01 + cldA[k11] * w11;
        if (c0 > .572) {
          let a = (c0 - .572) / .20;
          if (a > 1) a = 1;
          a = a * a * (3 - 2 * a) * .47;
          const cs = sh * 202;
          r += (cs - r) * a; g += (cs * 1.03 - g) * a; b += (cs * .96 - b) * a;
        }

        const rim = 1 - nz;
        const dk = 1 - rim * rim * .30;
        r *= dk; g *= dk; b *= dk;

        const ea = Math.min(1, (1 - Math.sqrt(d2)) * R * 1.7);
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255 * ea;
      }
    }
    B.g2.putImageData(B.img, 0, 0);

    /* axial tilt: the body, its graticule and its pins rotate as one */
    const TILT = opts.tilt || 0;
    const tilted = TILT !== 0;
    if (tilted) {
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(TILT); ctx.translate(-cx, -cy);
    }
    ctx.drawImage(B.c, cx - R, cy - R, R * 2, R * 2);

    /* graticule */
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(232,221,181,.6)'; ctx.lineWidth = 1;
    for (let k = 1; k < 6; k++) {
      const yy = cy - R + (k / 6) * 2 * R;
      const rr = Math.sqrt(Math.max(0, R * R - (yy - cy) * (yy - cy)));
      ctx.globalAlpha = .07;
      ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * .2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const a = spin + k * Math.PI / 6;
      const rx = Math.abs(Math.cos(a)) * R;
      ctx.globalAlpha = .04 + .08 * Math.abs(Math.cos(a));
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, R, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    /* surface markers, drawn with a dark backing plate for legibility */
    if (opts.markers && opts.markers.length) {
      ctx.save();
      ctx.font = '600 8px ' + (U.css('--mono') || 'monospace');
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      opts.markers.forEach((m) => {
        const la = m.lat * rad, lo = m.lon * rad + spin;
        const px = Math.cos(la) * Math.cos(lo), py = Math.sin(la), pz = Math.cos(la) * Math.sin(lo);
        if (pz <= .05) return;
        const x = cx + R * px, y = cy - R * py;
        const a = .32 + .68 * pz;
        const col = m.hot ? (U.css('--alarm') || '#D4533E') : (U.css('--accent') || '#C97F3A');
        ctx.globalAlpha = a;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, y - 4.5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4.5); ctx.lineTo(x - 4, y); ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = a * .35;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
        if (opts.labels !== false) {
          ctx.globalAlpha = a;
          const label = m.code, lw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(6,8,3,.78)';
          ctx.fillRect(x + 9, y - 10, lw + 6, 13);
          ctx.strokeStyle = col; ctx.globalAlpha = a * .4;
          ctx.strokeRect(x + 9, y - 10, lw + 6, 13);
          ctx.globalAlpha = a; ctx.fillStyle = col;
          ctx.fillText(label, x + 12, y - 3);
        }
      });
      ctx.restore();
    }

    if (tilted) ctx.restore();

    /* atmosphere limb */
    const atmo = ctx.createRadialGradient(cx, cy, R * .955, cx, cy, R * 1.24);
    atmo.addColorStop(0, 'rgba(206,196,128,0)');
    atmo.addColorStop(.10, 'rgba(212,196,130,.30)');
    atmo.addColorStop(.42, 'rgba(186,172,116,.10)');
    atmo.addColorStop(1, 'rgba(160,146,96,0)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.26, 0, Math.PI * 2); ctx.fillStyle = atmo; ctx.fill();

    ctx.strokeStyle = 'rgba(236,226,180,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    /* compass ring */
    if (opts.ring !== false) {
      const rr = R * (opts.ringScale || 1.2);
      ctx.save();
      ctx.strokeStyle = 'rgba(232,221,181,.5)'; ctx.lineWidth = 1;
      ctx.globalAlpha = .14;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 72; k++) {
        const a = TILT + k * Math.PI / 36, long = k % 6 === 0;
        ctx.globalAlpha = long ? .44 : .16;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (rr - (long ? 7 : 3)), cy + Math.sin(a) * (rr - (long ? 7 : 3)));
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        ctx.stroke();
      }
      ctx.font = '8px ' + (U.css('--mono') || 'monospace');
      ctx.fillStyle = 'rgba(232,221,181,.75)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cards = opts.cards || [['N', '90°'], ['E', '0°'], ['S', '90°'], ['W', '180°']];
      if (opts.cardinals !== false) cards.forEach((c, i) => {
        const a = TILT - Math.PI / 2 + i * Math.PI / 2;
        const x = cx + Math.cos(a) * (rr + 14), y = cy + Math.sin(a) * (rr + 14);
        ctx.globalAlpha = .8;
        ctx.fillText(c[0], x, y - 5);
        ctx.globalAlpha = .4;
        ctx.fillText(c[1], x, y + 5);
      });
      ctx.restore();
    }
  };


  /* ------------------------------------------------------------ small DOM builders */
  U.row = function (label, value, cls) {
    return '<div class="u-spread"><span class="u-lab">' + label + '</span><span class="u-num ' + (cls || '') + '">' + value + '</span></div>';
  };
  U.logLine = function (time, tag, msg, cls) {
    return '<div class="' + (cls || '') + '"><time>' + time + '</time><span class="u-tag">' + tag + '</span><span class="u-msg">' + msg + '</span></div>';
  };
})(window);

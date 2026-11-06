/* ============================================================================
   uispace — page shell + visualization presets (clean-room, original code)
   U.shell(cfg) builds the app chrome from a compact scene description.
   ========================================================================== */
(function (g) {
  'use strict';
  const U = g.U;
  if (!U) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const pack = (o) => encodeURIComponent(JSON.stringify(o || {}));
  const unpack = (s) => { try { return JSON.parse(decodeURIComponent(s)); } catch (e) { return {}; } };

  U.shell = function (cfg) {
    const meta = cfg.meta || [];
    const foot = cfg.footer || [];
    const headCells = meta.map((m) => '<div class="u-cell' + (m.hide ? ' u-hide-sm' : '') + '">' +
      (m.r2 ? '<span class="u-r2">' + m.r2 + '</span>' : '') +
      (m.r1 ? '<span class="u-r1">' + m.r1 + '</span>' : '') + '</div>').join('');

    const colHTML = (col) => {
      const auto = col.panels.map((p) => (p && p.fill === false) ? 'auto' : 'minmax(0,1fr)').join(' ');
      const rows = ' style="grid-template-rows:' + (col.rows || auto) + '"';
      const cls = 'u-stack' + (col.cls ? ' ' + col.cls : '');
      return '<section class="' + cls + '"' + rows + '>' + col.panels.map(panelHTML).join('') + '</section>';
    };

    const panelHTML = (p) => {
      if (!p) return '';
      const cls = ['u-plate', 'u-notch', p.fill !== false ? 'u-fill' : '', p.hot ? 'u-hot' : '', p.cls || ''].filter(Boolean).join(' ');
      const head = '<div class="u-head">' + (p.title ? '<b>' + p.title + '</b>' : '') +
        (p.tag ? ' <span class="u-dim">/ ' + p.tag + '</span>' : '') +
        (p.src ? '<span style="margin-left:auto" class="u-src ' + p.src + '"><i></i>' + (p.srcLabel || p.src.toUpperCase()) + '</span>' : '') +
        '</div>';
      const body = p.canvas
        ? '<div class="u-canvas-wrap" data-viz="' + p.canvas + '" data-opts="' + pack(p.canvasOpts) + '"></div>' +
          (p.overlay || '')
        : '<div class="u-body' + (p.tight ? ' u-tight' : '') + (p.scroll ? ' u-scroll' : '') + '">' + (p.body || '') + '</div>';
      const foot = p.foot ? '<div class="u-foot">' + p.foot + '</div>' : '';
      return '<div class="' + cls + '"' + (p.id ? ' data-plate="' + p.id + '"' : '') + '>' + head + body + foot + '</div>';
    };

    const mainCls = 'u-main ' + (cfg.mainClass || ('u-cols-' + (cfg.cols || []).length));
    const app = document.createElement('div');
    app.className = 'u-app';
    app.innerHTML =
      '<header class="u-top u-rule-pattern">' +
        '<div class="u-brand"><i></i>' + esc(cfg.brand || 'UISPACE') + '<small>' + esc(cfg.brandSub || 'FUI') + '</small></div>' +
        (cfg.subtitle ? '<div class="u-cell"><span class="u-r1">' + cfg.subtitle + '</span><span class="u-r2">' + (cfg.subtitleSub || '') + '</span></div>' : '') +
        headCells +
        '<div class="u-cell u-grow"></div>' +
        '<div class="u-cell u-hide-sm"><span class="u-r2">LOCAL</span><span class="u-r1 u-mono" data-clock="local">--:--:--</span></div>' +
        '<div class="u-cell"><span class="u-r2">STATUS</span><span class="u-r1"><span class="u-pill ' + (cfg.statusCls || 'u-ok') + '"><span class="u-dot"></span>' + (cfg.status || 'NOMINAL') + '</span></span></div>' +
      '</header>' +
      '<main class="' + mainCls + '">' + (cfg.cols || []).map(colHTML).join('') + '</main>' +
      '<footer class="u-bot">' + foot.map((f) => '<div class="u-cell' + (f.hide ? ' u-hide-sm' : '') + '"><span class="u-r2 ' + (f.cls || '') + '">' + f.text + '</span></div>').join('') + '<div class="u-cell u-grow"></div><div class="u-cell"><span class="u-r2 u-dim">' + esc(cfg.sign || 'uispace · a clean-room FUI study') + '</span></div></footer>';
    document.body.innerHTML = '';
    document.body.appendChild(app);

    // initialise canvases
    U.$$('[data-viz]').forEach((el) => {
      const kind = el.dataset.viz;
      const fn = U.viz.resolve(kind);
      if (fn) U.canvas(el, (ctx, w, h, t, f) => fn(ctx, w, h, t, f, unpack(el.dataset.opts), el), { fps: { wave: 24, cascade: 30, sonar: 24, particles: 20 }[kind] || 18 });
    });
    if (cfg.after) cfg.after(app);
    U.page(cfg.name);
    return app;
  };

  /* ------------------------------------------------------------ viz presets */
  const V = U.viz = {};
  V.resolve = function (kind) {
    const [base, sub] = String(kind).split(':');
    if (V[base]) return (ctx, w, h, t, f, o, el) => V[base](ctx, w, h, t, f, o, el, sub);
    return null;
  };
  const C = (n) => U.css(n);

  V.globe = (ctx, w, h, t, f, o, el, sub) => {
    const cx = w * .5, cy = h * .48, R = Math.min(w, h) * (o.r || .32);
    U.draw.grid(ctx, w, h, C('--cool'), 34, .07);
    const halo = ctx.createRadialGradient(cx, cy, R * .9, cx, cy, R * 1.5);
    halo.addColorStop(0, C('--accent') + '44'); halo.addColorStop(.6, C('--accent') + '0e'); halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    U.draw.globe(ctx, cx, cy, R, C('--accent'), { t, rot: t * .05, pins: o.pins || 12, seed: o.seed || 5, hot: C('--data') });
    U.draw.radialTicks(ctx, cx, cy, R * 1.1, R * 1.2, C('--dim'), 72, t);
    U.draw.crosshair(ctx, cx, cy, R * 1.32, C('--dim'), t * .1);
    if (sub === 'atmo') { U.draw.particles(ctx, w, h, C('--data'), { t, n: 40, seed: 4 }); }
  };

  V.orbit = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--cool'), 30, .06);
    U.draw.orbits(ctx, w * .5, h * .5, Math.min(w, h) * .42, C('--accent'), { t, n: o.n || 5, hotIndex: o.hot ?? 2, hot: C('--data'), squash: o.squash || .5, seed: o.seed || 6 });
    U.draw.radialTicks(ctx, w * .5, h * .5, Math.min(w, h) * .03, Math.min(w, h) * .06, C('--dim'), 40, t);
    if (o.stars !== false) U.draw.starfield(ctx, w, h, C('--cool'), { t, seed: 9, n: 90 });
  };

  V.wave = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--dim'), o.step || 32, .07);
    const n = o.lanes || 3;
    for (let i = 0; i < n; i++) {
      U.draw.wave(ctx, w, h, i === 0 ? C('--accent') : i === 1 ? C('--data') : C('--cool'), {
        t: t + i * .8, base: h * (.28 + i * .22), amp: h * (o.amp || .14), freq: 1.1 + i * .3, alpha: i ? .5 : .95
      });
    }
    if (o.ecg) U.draw.ecg(ctx, w, h * .9, C('--data'), { t });
  };

  V.sonar = (ctx, w, h, t, f, o) => {
    const cx = w * .5, cy = h * .5, R = Math.min(w, h) * .46;
    U.draw.grid(ctx, w, h, C('--cool'), 30, .07);
    U.draw.rings(ctx, cx, cy, [R * .25, R * .5, R * .75, R], C('--accent'), { alpha: .22, ticks: 72, rot: t * .05 });
    U.draw.sweep(ctx, cx, cy, R, o.color ? C(o.color) : C('--accent'), t * 1.1, 1.4);
    const r = U.rnd(o.seed || 13);
    ctx.save(); ctx.fillStyle = o.color ? C(o.color) : C('--data');
    for (let i = 0; i < (o.contacts || 9); i++) {
      const a = r() * Math.PI * 2, rr = (0.2 + r() * .8) * R, px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      ctx.globalAlpha = .5 + r() * .5;
      ctx.beginPath(); ctx.arc(px, py, 1.6 + r() * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    U.draw.crosshair(ctx, cx, cy, R * 1.05, C('--dim'), 0);
  };

  V.cascade = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--alarm'), 26, .06);
    U.draw.cascade(ctx, w, h, C('--accent'), { t });
    U.draw.particles(ctx, w, h, C('--data'), { t, n: 40, seed: 3 });
  };

  V.ecg = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--dim'), 22, .08);
    U.draw.ecg(ctx, w, h, C(o.color ? o.color : '--data'), { t });
    const r = U.rnd(o.seed || 21);
    ctx.save(); ctx.fillStyle = C('--accent');
    for (let i = 0; i < 22; i++) { ctx.globalAlpha = .2 + r() * .6; ctx.fillRect((i / 22) * w, r() * h, 2, 2); }
    ctx.restore();
  };

  V.hex = (ctx, w, h, t, f, o) => {
    U.draw.hexgrid(ctx, w, h, C('--accent'), { t, size: o.size || 16 });
    if (o.flow !== false) U.draw.flow(ctx, w, h, C('--data'), { t, n: 14, seed: 2 });
  };

  V.flow = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--dim'), 28, .06);
    U.draw.flow(ctx, w, h, C('--accent'), { t, n: o.lines || 30, seed: o.seed || 8 });
    U.draw.particles(ctx, w, h, C('--data'), { t, n: 30, seed: 12 });
  };

  V.contour = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--dim'), 30, .07);
    U.draw.contour(ctx, w, h, C('--accent'), { t, seed: o.seed || 5, cx: o.cx || .5, cy: o.cy || .5, sx: o.sx || 1.5 });
    if (o.quakes) {
      const r = U.rnd(o.seed || 3); ctx.fillStyle = C('--alarm');
      for (let i = 0; i < 14; i++) { ctx.globalAlpha = .5 + r() * .5; ctx.beginPath(); ctx.arc(r() * w, r() * h, 1 + r() * 2, 0, Math.PI * 2); ctx.fill(); }
    }
  };

  V.terrain = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--accent'), 24, .06);
    U.draw.terrain(ctx, w, h, o.color ? C(o.color) : C('--accent'), { t, seed: o.seed || 12, layers: o.layers || 6 });
    const r = U.rnd(o.seed || 41);
    ctx.save();
    for (let i = 0; i < (o.pins || 6); i++) {
      const x = (.08 + r() * .84) * w, y = (.3 + r() * .55) * h;
      ctx.strokeStyle = C('--data'); ctx.fillStyle = C('--data'); ctx.globalAlpha = .7;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 10, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  V.ladder = (ctx, w, h, t, f, o) => {
    U.draw.ladder(ctx, w, h, C('--accent'), { t, rows: o.rows || 8, hot: o.hot ?? 2, hotColor: C('--alarm') });
    U.draw.grid(ctx, w, h, C('--dim'), 40, .05);
  };

  V.matrix = (ctx, w, h, t, f, o) => {
    const r = U.rnd(o.seed || 17); const cols = Math.floor(w / 14);
    ctx.save(); ctx.font = '10px ' + C('--mono'); ctx.fillStyle = C(o.color ? o.color : '--accent');
    for (let i = 0; i < cols; i++) {
      const x = i * 14 + 4, speed = .4 + r() * 1.4, len = 4 + Math.floor(r() * 12);
      const head = ((t * speed * 20 + r() * h) % (h + 200)) - 100;
      for (let k = 0; k < len; k++) {
        const y = head - k * 11; if (y < 0 || y > h) continue;
        ctx.globalAlpha = Math.max(0, .55 - k / len * .5);
        ctx.fillText(String.fromCharCode(0x30A0 + Math.floor(r() * 80)), x, y);
      }
    }
    ctx.restore();
  };

  V.particles = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--cool'), 40, .05);
    U.draw.particles(ctx, w, h, C('--accent'), { t, n: o.n || 90, seed: o.seed || 9 });
    U.draw.crosshair(ctx, w * .5, h * .5, Math.min(w, h) * .4, C('--dim'), t * .2);
  };

  V.scope = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--cool'), 18, .08);
    U.draw.wave(ctx, w, h, C('--data'), { t, base: h * .5, amp: h * .3, n: 220, freq: o.freq || 3.2, speed: 2.2, alpha: .95 });
    U.draw.wave(ctx, w, h, C('--accent'), { t: t * 1.3, base: h * .5, amp: h * .1, n: 220, freq: 6, speed: 1.2, alpha: .5 });
    ctx.save(); ctx.strokeStyle = C('--accent'); ctx.globalAlpha = .35;
    ctx.beginPath(); ctx.moveTo(0, h * .5); ctx.lineTo(w, h * .5); ctx.stroke(); ctx.restore();
  };

  V.helix = (ctx, w, h, t, f, o) => {
    const r = U.rnd(o.seed || 3); ctx.save(); ctx.lineWidth = 1.1;
    const n = o.n || 46, cx = w * .5;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * h, ph = i * .42 + t * 1.1;
      const x1 = cx + Math.sin(ph) * w * .16, x2 = cx + Math.sin(ph + Math.PI) * w * .16;
      ctx.strokeStyle = C('--accent'); ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.fillStyle = i % 4 === 0 ? C('--alarm') : C('--data'); ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.arc(x1, y, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x2, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  V.cells = (ctx, w, h, t, f, o) => {
    const r = U.rnd(o.seed || 6); ctx.save();
    for (let i = 0; i < (o.n || 42); i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 14;
      ctx.strokeStyle = C('--accent'); ctx.globalAlpha = .18 + r() * .3;
      ctx.beginPath(); ctx.arc(x, y, rad + Math.sin(t + i) * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C('--data'); ctx.globalAlpha = .12 + r() * .2;
      ctx.beginPath(); ctx.arc(x + (r() - .5) * 4, y + (r() - .5) * 4, rad * .32, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  V.bars = (ctx, w, h, t, f, o) => {
    const r = U.rnd(o.seed || 8); const n = o.n || 48;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const v = .15 + Math.abs(Math.sin(i * .5 + t * (o.speed || 1.2) + r() * 3)) * .8;
      const x = (i / n) * w, bh = v * h * (o.height || .8);
      ctx.fillStyle = i % 7 === 0 ? C('--data') : C('--accent');
      ctx.globalAlpha = .35 + v * .55;
      ctx.fillRect(x + 1, h - bh, Math.max(1, w / n - 2), bh);
    }
    ctx.restore();
  };

  V.radar = (ctx, w, h, t, f, o) => {
    const cx = w * .5, cy = h * .52, R = Math.min(w, h) * .4;
    U.draw.grid(ctx, w, h, C('--dim'), 26, .05);
    U.draw.rings(ctx, cx, cy, [R * .33, R * .66, R], C('--accent'), { alpha: .25, ticks: 48 });
    const n = o.points || 7, r = U.rnd(o.seed || 11), pts = [];
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const v = .35 + Math.abs(Math.sin(t * .8 + i + r())) * .6;
      const x = cx + Math.cos(a) * R * v, y = cy + Math.sin(a) * R * v;
      pts.push([x, y]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.strokeStyle = C('--data'); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = C('--data'); ctx.globalAlpha = .1; ctx.fill();
    ctx.globalAlpha = .9; pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
  };

  V.map = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--cool'), 22, .1);
    // abstract dot-matrix continents (deterministic; not a real coastline)
    const r = U.rnd(o.seed || 23), step = o.step || 9;
    ctx.save();
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const v = Math.sin(x * .012 + r() * .2) + Math.cos(y * .018 - r() * .3) + Math.sin((x + y) * .006);
      if (v > .9) { ctx.fillStyle = C('--cool'); ctx.globalAlpha = .22; ctx.fillRect(x, y, 1.4, 1.4); }
    }
    ctx.restore();
    // track arcs
    const q = U.rnd(o.seed || 31);
    ctx.save(); ctx.strokeStyle = C('--accent'); ctx.globalAlpha = .5;
    for (let i = 0; i < (o.tracks || 5); i++) {
      const x1 = q() * w, y1 = q() * h, x2 = q() * w, y2 = q() * h;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 40, x2, y2); ctx.stroke();
    }
    ctx.restore();
    // contacts
    const p = U.rnd(o.seed || 37);
    ctx.save(); ctx.fillStyle = o.pinColor ? C(o.pinColor) : C('--data');
    for (let i = 0; i < (o.pins || 12); i++) {
      const x = p() * w, y = p() * h;
      ctx.globalAlpha = .75;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .25; ctx.beginPath(); ctx.arc(x, y, 4 + Math.sin(t * 2 + i) * 1.5, 0, Math.PI * 2); ctx.strokeStyle = ctx.fillStyle; ctx.stroke();
    }
    ctx.restore();
  };

  V.spiral = (ctx, w, h, t, f, o) => {
    const cx = w * .5, cy = h * .5; ctx.save(); ctx.strokeStyle = C('--accent'); ctx.lineWidth = 1;
    for (let arm = 0; arm < (o.arms || 3); arm++) {
      ctx.beginPath();
      for (let i = 0; i < 220; i++) {
        const a = i * .09 + t * .12 + arm * (Math.PI * 2 / (o.arms || 3));
        const rr = i * (Math.min(w, h) * .0021);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.globalAlpha = .35 + arm * .15; ctx.stroke();
    }
    ctx.restore();
    U.draw.particles(ctx, w, h, C('--data'), { t, n: 26, seed: 14 });
  };

  V.gridpulse = (ctx, w, h, t, f, o) => {
    const cell = o.cell || 22; const r = U.rnd(o.seed || 19);
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
      const v = Math.sin(x * .02 + t) + Math.cos(y * .017 - t * .7) + r() * .3;
      if (v > .7) { ctx.fillStyle = C('--accent'); ctx.globalAlpha = .12 + (v - .7) * .5; ctx.fillRect(x + 1, y + 1, cell - 3, cell - 3); }
    }
    U.draw.grid(ctx, w, h, C('--dim'), cell, .05);
  };

  V.scan = (ctx, w, h, t, f, o) => {
    U.draw.grid(ctx, w, h, C('--cool'), 20, .09);
    const y = (t * 40 % h);
    const grd = ctx.createLinearGradient(0, y - 40, 0, y);
    grd.addColorStop(0, 'transparent'); grd.addColorStop(1, C('--accent') + '55');
    ctx.fillStyle = grd; ctx.fillRect(0, y - 40, w, 40);
    ctx.strokeStyle = C('--accent'); ctx.globalAlpha = .8;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    U.draw.particles(ctx, w, h, C('--data'), { t, n: 30, seed: 7 });
  };
})(window);

import * as THREE from 'three';

(function () {
  const canvas = document.getElementById('holo-canvas');
  const stage = document.getElementById('holo-stage');
  if (!canvas || !stage) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(4.2, 3.1, 7.4);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();
  scene.add(root);

  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x52e3ff,
    transparent: true,
    opacity: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x52e3ff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending
  });
  const accentEdge = new THREE.LineBasicMaterial({
    color: 0xc1ff37,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });

  const grid = new THREE.GridHelper(12, 24, 0x358954, 0x0a2c18);
  grid.position.y = -1.15;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  root.add(grid);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.35, 2.4, 72),
    new THREE.MeshBasicMaterial({ color: 0x52e3ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.14;
  root.add(ring);

  const scanGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-3.2, 0, 0),
    new THREE.Vector3(3.2, 0, 0)
  ]);
  const scan = new THREE.Line(scanGeo, new THREE.LineBasicMaterial({ color: 0xc1ff37, transparent: true, opacity: 0.34 }));
  scan.position.y = -1.1;
  root.add(scan);

  const particleGeo = new THREE.BufferGeometry();
  const particlePos = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) {
    particlePos[i * 3] = (Math.random() - 0.5) * 9;
    particlePos[i * 3 + 1] = (Math.random() - 0.5) * 4;
    particlePos[i * 3 + 2] = (Math.random() - 0.5) * 7;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  root.add(new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0x52e3ff, size: 0.025, transparent: true, opacity: 0.48 })));

  let plane = null;
  let typeCode = '';
  let colorCode = 0x52e3ff;
  let rotation = 0;
  let dragging = false;
  let lastX = 0;
  let detail = null;

  function addSolid(geo) {
    const mesh = new THREE.Mesh(geo, fillMat);
    plane.add(mesh);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), edgeMat);
    plane.add(wire);
  }

  function fuselageGeometry(len, radius) {
    const profile = [];
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const z = -len / 2 + t * len;
      let r;
      if (t < 0.14) {
        const k = t / 0.14;
        r = radius * (0.035 + 0.965 * Math.sin(k * Math.PI / 2));
      } else if (t > 0.86) {
        const k = (t - 0.86) / 0.14;
        r = radius * Math.sqrt(Math.max(0, 1 - k * k));
      } else {
        r = radius * (1 - 0.055 * Math.sin((t - 0.14) / 0.72 * Math.PI));
      }
      profile.push(new THREE.Vector2(Math.max(0.001, r), z));
    }
    const geo = new THREE.LatheGeometry(profile, 40);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function wingGeometry(sign, span, rootChord, tipChord, sweep, dihedral, thickness, rootZ) {
    const S = 26, C = 12;
    const pos = [], idx = [];
    const stride = (C + 1) * 2;
    const at = (i, j, bottom) => i * stride + j * 2 + (bottom ? 1 : 0);
    for (let i = 0; i <= S; i++) {
      const u = i / S;
      const x = sign * span * u;
      const y = dihedral * u;
      const z = rootZ - sweep * u;
      const chord = rootChord * (1 - u) + tipChord * u;
      for (let j = 0; j <= C; j++) {
        const v = j / C;
        const zz = z + chord * (0.5 - v);
        const th = thickness * (0.35 + 0.65 * Math.sin(Math.PI * v)) * (1 - u * 0.35);
        pos.push(x, y + th / 2, zz);
        pos.push(x, y - th / 2, zz);
      }
    }
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < C; j++) {
        const a = at(i, j, false), b = at(i, j + 1, false), c = at(i + 1, j, false), d = at(i + 1, j + 1, false);
        const a2 = at(i, j, true), b2 = at(i, j + 1, true), c2 = at(i + 1, j, true), d2 = at(i + 1, j + 1, true);
        idx.push(a, c, b, b, c, d);
        idx.push(a2, b2, c2, b2, d2, c2);
      }
      const a = at(i, 0, false), c = at(i + 1, 0, false), a2 = at(i, 0, true), c2 = at(i + 1, 0, true);
      idx.push(a, a2, c, a2, c2, c);
      const b = at(i, C, false), d = at(i + 1, C, false), b2 = at(i, C, true), d2 = at(i + 1, C, true);
      idx.push(b, d, b2, b2, d, d2);
    }
    for (let j = 0; j < C; j++) {
      const a = at(S, j, false), b = at(S, j + 1, false), a2 = at(S, j, true), b2 = at(S, j + 1, true);
      idx.push(a, b, a2, a2, b, b2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function finGeometry(height, rootChord, tipChord, sweep, thickness, rootZ) {
    const S = 22, C = 10;
    const pos = [], idx = [];
    const stride = (C + 1) * 2;
    const at = (i, j, right) => i * stride + j * 2 + (right ? 1 : 0);
    for (let i = 0; i <= S; i++) {
      const u = i / S;
      const y = height * u;
      const z = rootZ - sweep * u;
      const chord = rootChord * (1 - u) + tipChord * u;
      for (let j = 0; j <= C; j++) {
        const v = j / C;
        const zz = z + chord * (0.5 - v);
        const th = thickness * (0.35 + 0.65 * Math.sin(Math.PI * v)) * (1 - u * 0.3);
        pos.push(-th / 2, y, zz);
        pos.push(th / 2, y, zz);
      }
    }
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < C; j++) {
        const a = at(i, j, false), b = at(i, j + 1, false), c = at(i + 1, j, false), d = at(i + 1, j + 1, false);
        const a2 = at(i, j, true), b2 = at(i, j + 1, true), c2 = at(i + 1, j, true), d2 = at(i + 1, j + 1, true);
        idx.push(a, c, b, b, c, d);
        idx.push(a2, b2, c2, b2, d2, c2);
      }
      const a = at(i, 0, false), c = at(i + 1, 0, false), a2 = at(i, 0, true), c2 = at(i + 1, 0, true);
      idx.push(a, a2, c, a2, c2, c);
      const b = at(i, C, false), d = at(i + 1, C, false), b2 = at(i, C, true), d2 = at(i + 1, C, true);
      idx.push(b, d, b2, b2, d, d2);
    }
    for (let j = 0; j < C; j++) {
      const a = at(S, j, false), b = at(S, j + 1, false), a2 = at(S, j, true), b2 = at(S, j + 1, true);
      idx.push(a, b, a2, a2, b, b2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function engineGeometry(len, radius) {
    const profile = [];
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const z = -len / 2 + t * len;
      const r = radius * (0.78 + 0.28 * Math.sin(t * Math.PI) - 0.08 * t);
      profile.push(new THREE.Vector2(Math.max(0.01, r), z));
    }
    const geo = new THREE.LatheGeometry(profile, 28);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function buildPlane(info, code) {
    if (plane) {
      root.remove(plane);
      plane.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    plane = new THREE.Group();
    root.add(plane);

    const wide = /^(B77|B78|B76|B74|A33|A35|A38)/.test(code) || (info && info.wingspanM > 50);
    const len = wide ? 6.1 : 4.8;
    const radius = wide ? 0.33 : 0.24;
    const span = wide ? 3.05 : 2.35;
    const engines = info && info.engines === 4 ? 4 : 2;

    addSolid(fuselageGeometry(len, radius));

    const rootChord = wide ? 1.35 : 1.0;
    const tipChord = wide ? 0.42 : 0.34;
    const sweep = wide ? 0.82 : 0.66;
    const dihedral = wide ? 0.13 : 0.09;
    const wingRootZ = 0.18;
    const tipZ = wingRootZ - sweep;
    [-1, 1].forEach((sign) => {
      addSolid(wingGeometry(sign, span, rootChord, tipChord, sweep, dihedral, 0.075, wingRootZ));
      addSolid(finGeometry(wide ? 0.38 : 0.3, tipChord, tipChord * 0.42, 0.14, 0.035, 0).translate(sign * span, dihedral, tipZ));
    });

    addSolid(finGeometry(wide ? 1.0 : 0.78, wide ? 0.92 : 0.72, 0.28, wide ? 0.48 : 0.38, 0.06, -len / 2 + 0.75));

    [-1, 1].forEach((sign) => {
      addSolid(wingGeometry(sign, wide ? 1.05 : 0.82, 0.62, 0.24, 0.2, 0.035, 0.05, -len / 2 + 0.55));
    });

    const engineOffsets = engines === 4 ? [-0.66, -0.28, 0.28, 0.66] : [-0.36, 0.36];
    engineOffsets.forEach((x) => {
      const ex = x * span;
      addSolid(engineGeometry(wide ? 0.92 : 0.72, wide ? 0.17 : 0.13).translate(ex, wide ? -0.32 : -0.25, 0.18));
      const pylon = new THREE.BoxGeometry(0.055, 0.07, 0.26);
      pylon.translate(ex, wide ? -0.19 : -0.15, 0.12);
      addSolid(pylon);
    });

    if (colorCode === 0xff1500) {
      edgeMat.color.setHex(0xff5a4a);
      accentEdge.color.setHex(0xff1500);
    } else {
      edgeMat.color.setHex(0x7ff4ff);
      accentEdge.color.setHex(0xc1ff37);
    }
    plane.rotation.y = rotation;
    plane.scale.setScalar(wide ? 0.82 : 0.9);
    return plane;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null || value === '' ? '--' : value;
  }

  function update(next) {
    detail = next;
    const f = next && next.flight;
    const info = next && next.info;
    const route = next && next.route;
    const counts = next && next.counts || {};
    if (!f) {
      setText('holo-state', 'SELECT A FLIGHT');
      setText('holo-type', 'NO AIRCRAFT');
      setText('holo-model', '--');
      setText('holo-callsign', '--');
      setText('holo-status', '--');
      setText('holo-pax', '--');
      setText('holo-range', '--');
      setText('holo-reg', '--');
      setText('holo-alt', '--');
      setText('holo-spd', '--');
      setText('holo-eta', '--');
      setText('holo-from', '--');
      setText('holo-to', '--');
      setText('holo-live', counts.live || 0);
      setText('holo-sim', counts.sim || 0);
      setText('holo-air', counts.air || 0);
      setText('holo-gnd', counts.ground || 0);
      if (!plane || typeCode !== '') { typeCode = ''; colorCode = 0x52e3ff; buildPlane(null, ''); }
      return;
    }

    const code = (f.type || '').toUpperCase();
    const color = next.status === 'EMERG' ? 0xff1500 : 0x52e3ff;
    if (!plane || code !== typeCode || color !== colorCode) {
      typeCode = code;
      colorCode = color;
      buildPlane(info, code);
    }

    setText('holo-state', next.status || 'SELECTED');
    setText('holo-type', info ? info.manufacturer + ' ' + info.model : (code || 'UNKNOWN TYPE'));
    setText('holo-model', code || '--');
    setText('holo-callsign', f.callsign);
    setText('holo-status', next.status || '--');
    setText('holo-pax', info && info.capacity ? info.capacity : '--');
    setText('holo-range', info && info.rangeKm ? Math.round(info.rangeKm).toLocaleString('en-US') + ' KM' : '--');
    setText('holo-reg', f.registration || '--');
    setText('holo-alt', f.altitude != null ? Math.round(f.altitude).toLocaleString('en-US') + ' FT' : '--');
    setText('holo-spd', f.speed != null ? Math.round(f.speed) + ' KT' : '--');
    setText('holo-eta', route && route.eta ? Math.round(route.eta) + ' MIN' : '--');
    setText('holo-from', route ? (route.estimated ? '~' : '') + route.from : '--');
    setText('holo-to', route ? (route.estimated ? '~' : '') + route.to : '--');
    setText('holo-live', counts.live || 0);
    setText('holo-sim', counts.sim || 0);
    setText('holo-air', counts.air || 0);
    setText('holo-gnd', counts.ground || 0);
  }

  function resize() {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotation += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
    if (plane) plane.rotation.y = rotation;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const len = Math.max(4.5, Math.min(14, camera.position.length() + e.deltaY * 0.004));
    camera.position.setLength(len);
    camera.lookAt(0, 0, 0);
  }, { passive: false });

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('flight:selected', (e) => update(e.detail));
  if (window.__flightSelected) update(window.__flightSelected);

  resize();
  buildPlane(null, '');
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (plane && !dragging) {
      rotation += dt * 0.32;
      plane.rotation.y = rotation;
    }
    if (plane) plane.position.y = Math.sin(now / 900) * 0.035;
    scan.position.y = -1.1 + (Math.sin(now / 1300) + 1) * 1.1;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

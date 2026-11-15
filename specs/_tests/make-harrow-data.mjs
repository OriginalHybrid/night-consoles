// Build-time data baker for themes/harrow.html.
//
// Sources:
//   JPL SBDB, CAD, Horizons  (NASA/JPL public data; no browser CORS -> bake)
//   NASA DSN Now             (live-capable; snapshot fallback)
//   NOAA SWPC                (live-capable; snapshot fallback)
//   HYG Database v4.4        (CC BY-SA 4.0, Astronexus)
//   NASA Science Bennu GLB   (public domain)
//
// Usage: node specs/_tests/make-harrow-data.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve('D:/Work/project-plans/uispace');
const OUT = path.join(ROOT, 'shared/data/harrow');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, name.endsWith('mesh.json') ? 0 : 2), 'utf8');
const json = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'uispace-harrow-data/1.0' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.json();
};

// --- JPL SBDB + close approaches + DSN + SWPC ------------------------------------------------
const sbdb = await json('https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=101955&full-prec=1');
write('bennu.json', sbdb);

const cad = await json('https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B90&dist-max=0.1&sort=dist');
write('neo.json', cad);

const dsn = await json('https://eyes.nasa.gov/dsn/data/dsn.json');
write('dsn.json', dsn);

const mag = await json('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json');
const speed = await json('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json');
const kp = await json('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
write('env.json', { mag, speed, kp });

// --- JPL Horizons state vectors --------------------------------------------------------------
const horizonsUrl = "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='101955'&EPHEM_TYPE='VECTORS'&CENTER='500@399'&START_TIME='2026-11-08'&STOP_TIME='2026-11-10'&STEP_SIZE='1d'&REF_PLANE='ECLIPTIC'&OUT_UNITS='KM-S'";
const horizons = await json(horizonsUrl);
write('horizons.json', horizons);
const text = horizons.result || '';
const block = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE')).trim().split(/\r?\n/).filter(Boolean);
const samples = [];
for (let i = 0; i + 3 < block.length; i += 4) {
  const epoch = block[i].split('= A.D.')[1]?.trim() || null;
  const pos = block[i + 1].match(/X\s*=\s*([-+0-9.E]+)\s+Y\s*=\s*([-+0-9.E]+)\s+Z\s*=\s*([-+0-9.E]+)/);
  const vel = block[i + 2].match(/VX\s*=\s*([-+0-9.E]+)\s+VY\s*=\s*([-+0-9.E]+)\s+VZ\s*=\s*([-+0-9.E]+)/);
  const lt = block[i + 3].match(/LT\s*=\s*([-+0-9.E]+)\s+RG\s*=\s*([-+0-9.E]+)\s+RR\s*=\s*([-+0-9.E]+)/);
  if (!pos || !vel) continue;
  samples.push({ epoch, pos: [+pos[1], +pos[2], +pos[3]], vel: [+vel[1], +vel[2], +vel[3]], light_time_s: lt ? +lt[1] : null, range_km: lt ? +lt[2] : null, radial_velocity_km_s: lt ? +lt[3] : null });
}
write('bennu-state.json', { meta: { source: 'JPL Horizons — 101955 Bennu, geocentric vectors, ecliptic J2000', retrieved: new Date().toISOString(), command: '101955', center: '500@399', units: 'km, km/s' }, samples });

// --- HYG v4.4 real stars ---------------------------------------------------------------------
const hygGz = Buffer.from(await (await fetch('https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz')).arrayBuffer());
const hyg = zlib.gunzipSync(hygGz).toString('utf8');
const lines = hyg.split(/\r?\n/);
const hdr = lines.shift().split(',').map((x) => x.replace(/^"|"$/g, ''));
const ix = (n) => hdr.indexOf(n);
const cols = { ra: ix('ra'), dec: ix('dec'), mag: ix('mag'), ci: ix('ci'), proper: ix('proper'), bf: ix('bf') };
const parseCsv = (line) => {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
};
const stars = [];
for (const line of lines) {
  if (!line) continue;
  const f = parseCsv(line);
  const m = +f[cols.mag];
  if (!isFinite(m) || m > 6.8) continue;
  const ra = +f[cols.ra], dec = +f[cols.dec];
  if (!isFinite(ra) || !isFinite(dec)) continue;
  stars.push({ ra: +ra.toFixed(5), dec: +dec.toFixed(5), mag: +m.toFixed(2), ci: f[cols.ci] ? +f[cols.ci] : 0, n: f[cols.proper] || f[cols.bf] || '' });
}
stars.sort((a, b) => a.mag - b.mag);
write('stars.json', { meta: { source: 'HYG Database v4.4 (Astronexus)', license: 'CC BY-SA 4.0', credit: 'HYG Database by David Nash / Astronexus', count: Math.min(14000, stars.length), limit: 6.8, fields: 'ra hours, dec degrees, mag, ci B-V' }, stars: stars.slice(0, 14000) });

// --- NASA Bennu GLB -> compact mesh ----------------------------------------------------------
const glbUrl = 'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/b/Bennu_1_1.glb';
const glb = Buffer.from(await (await fetch(glbUrl)).arrayBuffer());
let off = 12, gltf = null, bin = null;
while (off < glb.length) {
  const len = glb.readUInt32LE(off), type = glb.readUInt32LE(off + 4);
  const data = glb.subarray(off + 8, off + 8 + len);
  if (type === 0x4E4F534A) gltf = JSON.parse(data.toString('utf8'));
  if (type === 0x004E4942) bin = data;
  off += 8 + len;
}
const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const compRead = { 5120: (o) => bin.readInt8(o), 5121: (o) => bin.readUInt8(o), 5122: (o) => bin.readInt16LE(o), 5123: (o) => bin.readUInt16LE(o), 5125: (o) => bin.readUInt32LE(o), 5126: (o) => bin.readFloatLE(o) };
const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const accessor = (ai) => {
  const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView];
  const n = comps[a.type], stride = bv.byteStride || n * compBytes[a.componentType];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), arr = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) arr.push(compRead[a.componentType](base + i * stride + c * compBytes[a.componentType]));
  return arr;
};
const prim = gltf.meshes[0].primitives[0];
const pos = accessor(prim.attributes.POSITION), nrm = accessor(prim.attributes.NORMAL), idx = accessor(prim.indices);
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], pos[i + c]); mx[c] = Math.max(mx[c], pos[i + c]); }
const center = mn.map((v, c) => (v + mx[c]) / 2), ext = mx.map((v, c) => v - mn[c]), scale = 490 / Math.max(...ext);
const verts = [], normals = [];
for (let i = 0; i < pos.length; i += 3) verts.push(+((pos[i] - center[0]) * scale).toFixed(2), +((pos[i + 1] - center[1]) * scale).toFixed(2), +((pos[i + 2] - center[2]) * scale).toFixed(2));
for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; normals.push(+(nrm[i] / l).toFixed(3), +(nrm[i + 1] / l).toFixed(3), +(nrm[i + 2] / l).toFixed(3)); }
write('bennu-mesh.json', { meta: { source: 'NASA Science — Bennu 3D Model (Bennu_1_1.glb)', credit: 'NASA VTAD', license: 'Public domain (NASA)', note: 'Decimated NASA Bennu model, centered and scaled to a 490 m mean diameter.', vertices: verts.length / 3, triangles: idx.length / 3, scale: +scale.toFixed(6), original_extent_m: ext.map((v) => +(v * scale).toFixed(2)) }, vertices: verts, normals, indices: idx });

console.log('HARROW data baked:', OUT);

// Generates the authored terrain, scenario and offline fallback datasets for
// the SPOTFIRE theme. Deterministic: same seed -> same files.
// None of this is measured data. Weather alerts, weather, air quality and
// thermal detections are fetched live by the page at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FINAL = path.join(ROOT, 'shared/data/spotfire');
fs.mkdirSync(FINAL, { recursive: true });

let seed = 0x5f1e2026;
const rnd = () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const n = (s) => (rnd() * 2 - 1) * s;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const smooth = (x) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

const fract = (x) => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = .5, f = 1;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; a *= .5; f *= 2.03; }
  return s;
}

/* ---------------------------------------------------------------- terrain
   160 x 116 cells over the fictional Kestrel block. Heights are normalised
   0..1. The creek is a valley; two ridges frame the fire. Fuel is denser on
   the north and east slopes. Nothing here is a real DEM. */
const W = 160, H = 116;
const heights = [];
const fuel = [];
const creekX = (v) => .475 + .052 * Math.sin(v * 8.5 + .4) + .018 * Math.sin(v * 19 + 1.3);
let hmin = 1, hmax = 0;

for (let row = 0; row < H; row++) {
  const v = row / (H - 1);
  for (let col = 0; col < W; col++) {
    const u = col / (W - 1);
    const cx = creekX(v);
    const valley = Math.exp(-((u - cx) ** 2) / (2 * .038 ** 2));
    const ridgeA = Math.exp(-((u - (.20 + .085 * Math.sin(v * 7.2 + .3))) ** 2) / (2 * .072 ** 2));
    const ridgeB = Math.exp(-((u - (.78 - .070 * Math.sin(v * 5.1 + 1.1))) ** 2) / (2 * .085 ** 2));
    let h = .44 + .23 * fbm(u * 3.4 + 1.7, v * 3.1 + .6, 4);
    h += .17 * ridgeA + .14 * ridgeB - .23 * valley;
    h += .045 * Math.sin(v * 11 + u * 4.5) + .025 * Math.sin(v * 27 - u * 9);
    h += n(.018);
    heights.push(h);
    hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
  }
}
for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] - hmin) / (hmax - hmin);

for (let row = 0; row < H; row++) {
  const v = row / (H - 1);
  const cx = creekX(v);
  for (let col = 0; col < W; col++) {
    const u = col / (W - 1);
    const valley = Math.exp(-((u - cx) ** 2) / (2 * .045 ** 2));
    const ridgeB = Math.exp(-((u - (.78 - .070 * Math.sin(v * 5.1 + 1.1))) ** 2) / (2 * .09 ** 2));
    let f = .28 + .62 * fbm(u * 5.2 + 2.4, v * 5.4 + 3.1, 3) + .16 * ridgeB - .22 * valley;
    f += .05 * Math.sin(v * 31 + u * 8);
    fuel.push(round(clamp(f, 0, 1), 3));
  }
}

const creek = [];
for (let i = 0; i <= 42; i++) {
  const v = i / 42;
  creek.push([round(creekX(v), 4), round(v, 4)]);
}
const road = [];
for (let i = 0; i <= 30; i++) {
  const s = i / 30;
  const u = .11 + .67 * s + .035 * Math.sin(s * TAU * 1.7);
  const v = .91 - .76 * s + .018 * Math.sin(s * TAU * 2.3);
  road.push([round(u, 4), round(v, 4)]);
}
const line = [];
for (let i = 0; i <= 28; i++) {
  const s = i / 28;
  const u = .31 + .57 * s;
  const v = .50 - .31 * s + .012 * Math.sin(s * TAU * 1.8);
  line.push([round(u, 4), round(v, 4)]);
}
const labels = [
  { name: 'KESTREL FIRE', u: .43, v: .53, kind: 'fire' },
  { name: 'LOWELL FLATS', u: .76, v: .15, kind: 'town' },
  { name: 'DRY CREEK', u: .50, v: .76, kind: 'water' },
  { name: 'RIDGE 4', u: .61, v: .27, kind: 'ridge' },
  { name: 'ICP EAST', u: .23, v: .18, kind: 'site' },
  { name: 'CONTAINMENT', u: .63, v: .34, kind: 'line' }
];

const terrain = {
  meta: {
    synthetic: true,
    generated: '2026-11-06',
    width: W, height: H,
    anchor: { lat: 39.93, lon: -120.95, name: 'Plumas National Forest, CA' },
    map_km: { width: 34, height: 25 },
    vertical_exaggeration: 3.2,
    notes: 'Authored 2.5-D block: Dry Creek valley, two ridges, Lowell Flats, Kestrel front and Ridge 4 containment. Not a real DEM.'
  },
  heights,
  fuel,
  creek, road, line, labels
};
fs.writeFileSync(path.join(FINAL, 'terrain.json'), JSON.stringify(terrain));

/* A small inspectable sample, not the full render grid. */
const csv = ['u,v,height,fuel'];
for (let row = 0; row < H; row += 2) {
  for (let col = 0; col < W; col += 2) {
    const i = row * W + col;
    csv.push(`${round(col / (W - 1), 4)},${round(row / (H - 1), 4)},${round(heights[i], 4)},${fuel[i]}`);
  }
}
fs.writeFileSync(path.join(FINAL, 'terrain.csv'), csv.join('\n') + '\n');

/* ---------------------------------------------------------------- scenario
   13 stages at 15-minute steps from 13:20 to 16:20. The front advances NE,
   the wind shifts at 15:00, and Spot 3 grows through the run. Fire behaviour
   and resources are authored; only the weather/thermal/AQ feeds are live. */
const STAGES = 13;
const stageStart = new Date('2026-11-06T13:20:00Z');
const stages = [];
for (let s = 0; s < STAGES; s++) {
  const minutes = s * 15;
  const shift = s < 7 ? 0 : (s - 6) / 6;
  const wind = round(34 + 1.2 * s + 9 * shift, 0);
  const gust = round(wind * (1.42 + .04 * Math.sin(s * .7)), 0);
  const dir = s < 7 ? 200 : Math.round(200 + 40 * Math.min(1, (s - 6) / 3));
  const ros = round(1.6 + .035 * s + 1.3 * shift, 1);
  const front = [];
  for (let k = 0; k <= 14; k++) {
    const q = k / 14;
    const u = .075 + .715 * q + .017 * s;
    const v = .855 - .485 * q - .0125 * s + .016 * Math.sin(q * TAU * 1.7 + s * .24) + .006 * Math.sin(q * TAU * 4.1);
    front.push([round(u, 4), round(v, 4)]);
  }
  const active = round(18.7 + .42 * s, 1);
  const spotD = round(40 + 28 * Math.max(0, s - 3) + 10 * Math.max(0, s - 7), 0);
  stages.push({
    t: new Date(stageStart.getTime() + minutes * 60000).toISOString(),
    minute: minutes,
    wind, gust, dir, ros, active, spotD,
    wind_shift: s >= 7,
    front
  });
}

const spots = [
  { id: 1, label: 'SPOT 1', u: .36, v: .60, start: 0, d0: 8, grow: 1.4, state: 'HOLDING' },
  { id: 2, label: 'SPOT 2', u: .60, v: .42, start: 2, d0: 14, grow: 2.2, state: 'CONTAINED' },
  { id: 3, label: 'SPOT 3', u: .71, v: .30, start: 2, d0: 40, grow: 4.8, state: 'GROWING' },
  { id: 4, label: 'SPOT 4', u: .82, v: .25, start: 7, d0: 12, grow: 3.0, state: 'NEW' }
];

const resources = [
  { unit: 'CRW 1', kind: 'CREW', status: 'ENGAGED', pct: 76 },
  { unit: 'CRW 4', kind: 'CREW', status: 'ENGAGED', pct: 68 },
  { unit: 'DOZER 2', kind: 'DOZER', status: 'LINE', pct: 54 },
  { unit: 'DOZER 6', kind: 'DOZER', status: 'STAGED', pct: 31 },
  { unit: 'ENG 21', kind: 'ENGINE', status: 'STRUCT', pct: 82 },
  { unit: 'ENG 34', kind: 'ENGINE', status: 'STRUCT', pct: 61 },
  { unit: 'HELI 3', kind: 'AIR', status: 'BUCKET', pct: 47 },
  { unit: 'AIR 6', kind: 'AIR', status: 'RETARD', pct: 38 }
];

const triggers = [
  { id: 'lowell', name: 'LOWELL FLATS', pop: 6200, clear_min: 160, trigger: '17:02', state: 'ARMED' },
  { id: 'dry', name: 'DRY CREEK', pop: 340, clear_min: 95, trigger: '16:05', state: 'WATCH' },
  { id: 'ridge', name: 'RIDGE 4', pop: 0, clear_min: 240, trigger: '17:00', state: 'STANDBY' }
];

const log = [
  { at: '13:20', tag: 'ICP', text: 'KESTREL FIRE DAY 2 · EAST FLANK ACTIVE', hot: true },
  { at: '13:24', tag: 'WX', text: 'AWS 2 RIDGE · RH 12% · WIND 34 KM/H 200°' },
  { at: '13:31', tag: 'SPOT', text: 'SPOT 3 IDENTIFIED SOUTH OF DRY CREEK · 40 M', hot: true },
  { at: '13:40', tag: 'OPS', text: 'RIDGE 4 LINE FROM 0.0 TO 4.8 KM · HOLDING' },
  { at: '13:52', tag: 'FBAN', text: 'ROS HEAD 1.9 KM/H · ACTIVE LENGTH 18.7 KM' },
  { at: '14:06', tag: 'AIR', text: 'HELI 3 BUCKET RUNS ON EAST FLANK · 47%' },
  { at: '14:19', tag: 'WX', text: 'DEW POINT -1.4°C · FINE FUEL MC 3.2%' },
  { at: '14:35', tag: 'ICP', text: 'ISSUE 11 DRAFT DUE 14:30 · UNSIGNED', hot: true },
  { at: '14:48', tag: 'SPOT', text: 'SPOT 4 NEW · 12 M · WIND DRIVEN' },
  { at: '15:00', tag: 'WX', text: 'WIND SHIFT 200° → 240° · ROS INCREASING', hot: true },
  { at: '15:14', tag: 'OPS', text: 'LOWELL FLATS CLEAR-BY 17:02 · MARGIN 0:30' },
  { at: '15:27', tag: 'FBAN', text: 'SPOT 3 240 M · CROWNING IN LADDER FUEL', hot: true }
];

const scenario = {
  meta: {
    synthetic: true,
    incident: 'KESTREL FIRE',
    day: 2,
    icp: 'ICP EAST',
    fban: 'R. VALE',
    start: stageStart.toISOString(),
    end: new Date(stageStart.getTime() + (STAGES - 1) * 15 * 60000).toISOString(),
    duration_min: (STAGES - 1) * 15,
    trigger: '2026-11-06T17:02:00Z',
    clear_min: 160,
    loop_speed: 4,
    notes: 'Authored training scenario. Front, spots, trigger clocks and resource states are invented; live feeds are labelled separately.'
  },
  stages, spots, resources, triggers, log
};
fs.writeFileSync(path.join(FINAL, 'scenario.json'), JSON.stringify(scenario));

/* ---------------------------------------------------------------- fallback
   Only used when a live request fails or ?sim=1. It is authored, not a
   cached observation. Thermal events are deliberately absent. */
const fbStart = new Date('2026-11-06T13:00:00Z');
const hours = [];
for (let i = 0; i < 72; i++) {
  const d = new Date(fbStart.getTime() + (i - 48) * 3600000);
  const t = 29 + 5 * Math.sin((i - 48) / 24 * TAU + 1.1) + n(.6);
  const rh = clamp(17 - 8 * Math.sin((i - 48) / 24 * TAU + 1.1) + n(2), 7, 38);
  const w = clamp(31 + 9 * Math.max(0, Math.sin((i - 48) / 18)) + n(3), 8, 54);
  const dir = 198 + 42 * clamp((i - 52) / 10, 0, 1) + n(5);
  hours.push({
    time: d.toISOString().slice(0, 16),
    temperature_2m: round(t, 1),
    relative_humidity_2m: round(rh, 0),
    precipitation: i > 12 && i < 16 ? round(rnd() * 1.6, 1) : 0,
    wind_speed_10m: round(w, 1),
    wind_direction_10m: round(dir, 0),
    wind_gusts_10m: round(w * 1.55, 1),
    soil_moisture_0_to_7cm: round(.095 + .015 * Math.sin(i / 9), 3),
    soil_moisture_7_to_28cm: round(.118 + .012 * Math.sin(i / 13), 3)
  });
}
const fallback = {
  meta: {
    synthetic: true,
    generated: '2026-11-06',
    notes: 'Authored offline fallback for the Kestrel training scenario. Used only when a live feed is unavailable or ?sim=1.'
  },
  current: {
    time: '2026-11-06T13:20',
    temperature_2m: 31.4,
    relative_humidity_2m: 12,
    dew_point_2m: -1.4,
    precipitation: 0,
    cloud_cover: 8,
    wind_speed_10m: 34,
    wind_direction_10m: 200,
    wind_gusts_10m: 52
  },
  hourly: {
    time: hours.map((x) => x.time),
    temperature_2m: hours.map((x) => x.temperature_2m),
    relative_humidity_2m: hours.map((x) => x.relative_humidity_2m),
    precipitation: hours.map((x) => x.precipitation),
    wind_speed_10m: hours.map((x) => x.wind_speed_10m),
    wind_direction_10m: hours.map((x) => x.wind_direction_10m),
    wind_gusts_10m: hours.map((x) => x.wind_gusts_10m),
    soil_moisture_0_to_7cm: hours.map((x) => x.soil_moisture_0_to_7cm),
    soil_moisture_7_to_28cm: hours.map((x) => x.soil_moisture_7_to_28cm)
  },
  aq: {
    pm10: 24, pm2_5: 17.8, european_aqi: 58, us_aqi: 64,
    hourly_pm2_5: Array.from({ length: 24 }, (_, i) => round(14 + 6 * Math.sin(i / 5) + rnd() * 2, 1))
  },
  alerts: { features: [] }
};
fs.writeFileSync(path.join(FINAL, 'fallback.json'), JSON.stringify(fallback));

/* ---------------------------------------------------------------- readme */
const readme = `# SPOTFIRE - synthetic scene datasets

These files are **authored synthetic data**, not measurements. They drive the
terrain, Kestrel fire scenario and offline fallback for the SPOTFIRE theme.

- \`terrain.json\` - 160 x 116 normalised height and fuel grids for the fictional
  Kestrel block, plus Dry Creek, a service road, the Ridge 4 containment line
  and place labels. Not a real DEM.
- \`terrain.csv\` - an inspectable 2-cell sample of the same grid.
- \`scenario.json\` - 13 fifteen-minute stages (13:20-16:20 UTC), advancing fire
  front, wind shift at 15:00, four spots, resource states, trigger clocks and
  an analyst log. Fire behaviour is invented for training.
- \`fallback.json\` - authored weather, air quality and empty alert state used
  only when a live request fails or the page is opened with \`?sim=1\`.

The page fetches these live, keyless feeds at runtime:

- Open-Meteo forecast and 92-day history (weather, soil moisture, elevation)
- Open-Meteo Air Quality (PM2.5, PM10, EAQI, US AQI)
- NWS active alerts for the anchor point
- kanari.io 6-hour thermal detections (**Source: kanari.io**, CC BY 4.0)

Register with \`node specs/_tests/make-spotfire-data.mjs\`.
`;
fs.writeFileSync(path.join(FINAL, 'README.md'), readme);

console.log('wrote', FINAL);
console.log('terrain', W + 'x' + H, 'heights', heights.length);
console.log('scenario stages', stages.length, 'spots', spots.length, 'log', log.length);
console.log('fallback hours', hours.length);

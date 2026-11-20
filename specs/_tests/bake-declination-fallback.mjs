// Fetches one live DECLINATION snapshot and writes shared/data/declination/fallback.json.
// This is a manual bake step; the runtime never depends on it being fresh.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'shared/data/declination/fallback.json');
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
};
const last = (arr) => arr[arr.length - 1];

const [mag, speed, kp, dst, scales, alerts, obs, ovation] = await Promise.all([
  get('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json'),
  get('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json'),
  get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
  get('https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json'),
  get('https://services.swpc.noaa.gov/products/noaa-scales.json'),
  get('https://services.swpc.noaa.gov/products/alerts.json'),
  get('https://geomag.usgs.gov/ws/data/?id=BOU&format=json&elements=H,D,Z,F&sampling_period=60'),
  get('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json')
]);

const magRow = last(mag);
const kpRow = last(kp);
const dstRow = last(dst);
const obsVals = Object.fromEntries(obs.values.map((e) => [e.id, last(e.values.filter((v) => v != null))]));
const aurora = [];
for (const [lon, lat, value] of ovation.coordinates || []) {
  if (Math.round(lon) % 5 === 0 && Math.round(lat) % 5 === 0 && value > 0) aurora.push([lon, lat, value]);
}

const snapshot = {
  meta: {
    baked: new Date().toISOString(),
    note: 'Last-good SWPC/USGS snapshot for SIM or offline fallback. Not a live observation at read time.'
  },
  swpc: {
    bt: magRow.bt,
    bz: magRow.bz_gsm,
    time: magRow.time_tag,
    speed: last(speed).proton_speed,
    kp: kpRow.Kp,
    kp_time: kpRow.time_tag,
    dst: dstRow.dst,
    dst_time: dstRow.time_tag
  },
  scales: scales,
  alerts: (alerts || []).slice(-4).map((a) => ({ product_id: a.product_id, issue_datetime: a.issue_datetime, message: String(a.message || '').slice(0, 500) })),
  obs: {
    station: 'BOU',
    time: obs.times[obs.times.length - 1],
    H: obsVals.H,
    D_deg: obsVals.D / 60,
    Z: obsVals.Z,
    F: obsVals.F
  },
  aurora: {
    observation: ovation['Observation Time'],
    forecast: ovation['Forecast Time'],
    points: aurora
  }
};

fs.writeFileSync(OUT, JSON.stringify(snapshot));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
console.log('snapshot', snapshot.swpc, snapshot.obs, 'aurora points', aurora.length);

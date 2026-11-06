// Bake Mars heliocentric distance from NASA/JPL Horizons into a synchronous JS file.
// Horizons has no CORS headers, so a static page cannot call it directly; this
// snapshot is generated once and shipped. Re-run to extend the horizon.
//
//   node bake-mars.mjs
import { writeFileSync } from 'node:fs';

const START = '2026-01-01';
const STOP = '2031-01-01';
const STEP = '1 d';

function urlFor(a, b) {
  const q = new URLSearchParams({
    format: 'json',
    COMMAND: "'499'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@10'",
    START_TIME: "'" + a + "'",
    STOP_TIME: "'" + b + "'",
    STEP_SIZE: "'" + STEP + "'",
    QUANTITIES: "'19'",
    CSV_FORMAT: "'YES'"
  });
  return 'https://ssd.jpl.nasa.gov/api/horizons.api?' + q;
}

async function fetchRange(a, b) {
  const r = await fetch(urlFor(a, b));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const txt = j.result || '';
  const s = txt.indexOf('$$SOE'), e = txt.indexOf('$$EOE');
  if (s < 0 || e < 0) throw new Error('no ephemeris table');
  const rows = txt.slice(s + 5, e).trim().split(/\r?\n/);
  return rows.map((line) => {
    const parts = line.split(',');
    const date = (parts[0] || '').trim();          // 2026-Jan-01 00:00
    const rAU = parseFloat(parts[3]);
    return { date, r: rAU };
  }).filter((x) => Number.isFinite(x.r));
}

const all = [];
const seen = new Set();
const years = [2026, 2027, 2028, 2029, 2030];
for (const y of years) {
  const a = `${y}-01-01`, b = `${y + 1}-01-01`;
  const rows = await fetchRange(a, b);
  console.log(y, rows.length, rows[0] && rows[0].r, rows[rows.length - 1] && rows[rows.length - 1].r);
  for (const row of rows) {
    if (seen.has(row.date)) continue;   // chunk boundaries repeat the next Jan 1
    seen.add(row.date);
    all.push(row);
  }
}
if (all.length < 1800) throw new Error('short table: ' + all.length);
console.log('unique rows', all.length, 'first', all[0].date, 'last', all[all.length - 1].date);

const values = all.map((x) => Math.round(x.r * 10000) / 10000);
const out = `/* Baked ephemeris — do not hand-edit.
   Source : NASA/JPL Horizons API (DE441)
   Target : Mars (499)   Center: Sun (500@10)
   Quant. : 19 (heliocentric range r, AU), step ${STEP.trim()}
   Range  : ${START} .. ${STOP}  (inclusive of start, exclusive of stop)
   Regenerate with specs/_tests/bake-mars.mjs */
window.UISPACE_MARS_EPH = {
  source: 'NASA/JPL Horizons',
  body: 'Mars (499)',
  center: 'Sun (500@10)',
  start: '${START}',
  stepDays: 1,
  unit: 'AU',
  r: [${values.join(',')}]
};
`;
writeFileSync(new URL('../../shared/mars-ephemeris.js', import.meta.url), out, 'utf8');
console.log('rows', values.length, 'min', Math.min(...values), 'max', Math.max(...values));

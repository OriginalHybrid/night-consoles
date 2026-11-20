import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../themes');
const pats = ['\u00e2\u20ac\u201d', '\u00e2\u20ac\u201c', '\u00e2\u20ac\u2122', '\u00e2\u20ac\u0153',
  '\u00e2\u20ac', '\u00c2\u00b7', '\u00c2\u00b0', '\u00c3', '\u00e2\u20ac\u00a6', '\ufffd'];
// a lone capital A-tilde is legitimate in Portuguese ("SÃO PAULO"); mojibake is
// always A-tilde followed by a C1 continuation byte.
const moji = (t, p) => p === '\u00c3'
  ? (t.match(/\u00c3[\u0080-\u00bf]/g) || []).length
  : t.split(p).length - 1;
let total = 0;
for (const f of fs.readdirSync(dir)) {
  const t = fs.readFileSync(dir + '/' + f, 'utf8');
  const hits = {};
  for (const p of pats) { const n = moji(t, p); if (n) hits[JSON.stringify(p)] = n; }
  const keys = Object.keys(hits);
  total += keys.length;
  console.log(f.padEnd(26), keys.length ? JSON.stringify(hits) : 'clean');
}
console.log('files with issues:', total);

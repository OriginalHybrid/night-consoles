import fs from 'node:fs';
const dir = 'D:/Work/project-plans/uispace/themes';
const pats = ['\u00e2\u20ac\u201d', '\u00e2\u20ac\u201c', '\u00e2\u20ac\u2122', '\u00e2\u20ac\u0153',
  '\u00e2\u20ac', '\u00c2\u00b7', '\u00c2\u00b0', '\u00c3', '\u00e2\u20ac\u00a6', '\ufffd'];
let total = 0;
for (const f of fs.readdirSync(dir)) {
  const t = fs.readFileSync(dir + '/' + f, 'utf8');
  const hits = {};
  for (const p of pats) { const n = t.split(p).length - 1; if (n) hits[JSON.stringify(p)] = n; }
  const keys = Object.keys(hits);
  total += keys.length;
  console.log(f.padEnd(26), keys.length ? JSON.stringify(hits) : 'clean');
}
console.log('files with issues:', total);

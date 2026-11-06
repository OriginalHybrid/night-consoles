// Repair UTF-8 text that was decoded as windows-1252 (e.g. "â€”" -> "—").
// Only maximal runs of cp1252-mappable characters are touched, and only when
// the re-encoded bytes form valid UTF-8. Safe to re-run.
//   node fix-encoding.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Work/project-plans/uispace';
const APPLY = process.argv.includes('--apply');

// cp1252 byte -> unicode
const CP = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178
};
const REV = new Map();
for (let b = 0x80; b <= 0xFF; b++) {
  const cp = CP[b] != null ? CP[b] : b;   // 0xA0-0xFF map to themselves; 0x81 etc. too
  REV.set(cp, b);
}

function repair(str) {
  let out = '', i = 0, changed = 0;
  while (i < str.length) {
    const cp = str.codePointAt(i);
    if (!REV.has(cp)) { out += str[i]; i++; continue; }
    // collect a run of mappable characters
    let j = i, bytes = [];
    while (j < str.length) {
      const c = str.codePointAt(j);
      if (!REV.has(c)) break;
      bytes.push(REV.get(c));
      j += c > 0xFFFF ? 2 : 1;
    }
    const buf = Buffer.from(bytes);
    const decoded = buf.toString('utf8');
    const valid = !decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').equals(buf);
    if (valid) { out += decoded; if (decoded !== str.slice(i, j)) changed++; }
    else out += str.slice(i, j);
    i = j;
  }
  return { out, changed };
}

const targets = [];
for (const dir of ['themes', 'shared', 'specs/_tests']) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;
  for (const f of fs.readdirSync(base)) {
    if (!/\.(html|js|css|json|mjs|md)$/i.test(f)) continue;
    if (f.startsWith('_')) continue;
    if (f === 'fix-encoding.mjs' || f === 'scan-encoding.mjs') continue;
    targets.push(path.join(base, f));
  }
}

let files = 0, total = 0;
for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8');
  const { out, changed } = repair(raw);
  if (out === raw) continue;
  files++; total += changed;
  const a = raw.split('\n'), b = out.split('\n');
  const samples = [];
  for (let k = 0; k < a.length && samples.length < 3; k++) {
    if (a[k] !== b[k]) samples.push('  - ' + a[k].trim().slice(0, 110) + '\n  + ' + b[k].trim().slice(0, 110));
  }
  console.log(path.relative(ROOT, file), '(' + changed + ' run(s))');
  if (!APPLY) console.log(samples.join('\n'));
  if (APPLY) fs.writeFileSync(file, out, 'utf8');
}
console.log((APPLY ? 'applied to ' : 'would touch ') + files + ' file(s), ' + total + ' run(s)');

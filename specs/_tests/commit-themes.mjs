// One commit per theme, in gallery order (matches shared/palettes.js).
//   node commit-themes.mjs [--dry]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = 'D:/Work/project-plans/uispace';
const DRY = process.argv.includes('--dry');

const ORDER = [
  'terra-7', 'pawn-7-nightmarket', 'meridian-office', 'cryowatch', 'second-party',
  'tarsus-lost', 'mirror-lab', 'bloom-line', 'atlas-4a', 'chronos-prime',
  'reactor-null', 'scope-omega', 'hex-lab', 'loom-9', 'mtox-2',
  'tidal-3', 'pym-mon', 'safehouse', 'integration-9', 'horizon-99', 'gyre-watch'
];

const git = (args) => execFileSync('git', args, { cwd: ROOT, stdio: DRY ? 'pipe' : 'inherit' });
const tmp = mkdtempSync(join(tmpdir(), 'uisp-commit-'));

function commit(message, files) {
  if (DRY) {
    console.log('\n=== ' + message.split('\n')[0] + '   [' + files.length + ' file(s)]');
    return;
  }
  git(['add', '--', ...files]);
  const f = join(tmp, 'msg.txt');
  writeFileSync(f, message, 'utf8');
  git(['commit', '-F', f]);
}

if (!existsSync(join(ROOT, '.git'))) {
  if (DRY) console.log('would: git init');
  else { git(['init']); git(['branch', '-M', 'main']); }
}

/* ---------------------------------------------------------------- base */
commit(
  'chore: shared FUI foundation, palette registry and live-data adapters\n\n' +
  'Adds the reusable layer the theme pages build on: palette registry (40 scenes),\n' +
  'FUI primitives and plates, canvas toolkit (incl. procedural globe), page shell\n' +
  'generator, public-API adapters with deterministic SIM fallbacks, and the\n' +
  'verification tooling (CDP screenshot runner, JPL Horizons bake, resize harness).\n',
  ['.gitignore', 'shared', 'specs/_tests/shot.mjs', 'specs/_tests/bake-mars.mjs',
    'specs/_tests/resize.html', 'specs/_tests/fix-encoding.mjs']
);

/* ---------------------------------------------------------------- themes */
for (const slug of ORDER) {
  const rel = `themes/${slug}.html`;
  if (!existsSync(join(ROOT, rel))) { console.warn('missing', rel); continue; }
  const html = readFileSync(join(ROOT, rel), 'utf8');

  const title = ((html.match(/<title>([^<]+)<\/title>/) || [])[1] || slug)
    .replace(/\s*·\s*uispace\s*$/, '').trim();

  const apis = [...new Set([...html.matchAll(/U\.api\.([A-Za-z]+)\(/g)].map((m) => m[1]))];
  const data = apis.length
    ? `data: live ${apis.join(', ')} via public APIs, deterministic SIM fallback`
    : 'data: deterministic SIM feed (fictional telemetry)';

  const msg = `feat(${slug}): ${title}\n\n${data}\nclean-room recreation; no markup, CSS or copy from the reference.\n`;
  commit(msg, [rel]);
}

console.log(DRY ? '\ndry run complete' : '\nall themes committed');

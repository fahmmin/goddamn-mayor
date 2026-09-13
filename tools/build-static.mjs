/* node tools/build-static.mjs  ->  dist/
 *
 * Assembles exactly the files a browser should be able to fetch, and nothing
 * else.
 *
 * The alternative - pointing a host at the repo root - is how node_modules,
 * deploy scripts and .env end up one URL away from the public. It also breaks
 * outright: the root contains web3/node_modules by the time the bundle is
 * built, and packaging tens of thousands of files (some with sourcemap entries
 * that do not exist on disk) fails the upload.
 *
 * So this is an allow-list. A file that is not named here does not ship.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

/* Everything the two pages actually load. Directories are copied whole, minus
 * the skips below; single files are copied as named. */
const INCLUDE = [
  'index.html',
  'inside.html',
  'src',
  'vendor',
  'web3/config.json',
  'web3/bundle.js'
];

/* Tests live beside the code they test, which is good for reading and bad for
 * shipping. */
const SKIP = name => name.endsWith('.test.js') || name === 'node_modules';

let files = 0;
let bytes = 0;

function copy (from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (SKIP(name)) continue;
      copy(path.join(from, name), path.join(to, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files++;
  bytes += stat.size;
}

fs.rmSync(OUT, { recursive: true, force: true });

const missing = [];
for (const rel of INCLUDE) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) { missing.push(rel); continue; }
  copy(from, path.join(OUT, rel));
}

/* web3/config.json and web3/bundle.js are generated, so their absence means
 * the build ran out of order rather than that something is optional. */
if (missing.length) {
  console.error('\n  missing, so not shipped: ' + missing.join(', '));
  console.error('  run `node web3/make-config.js` and `npm --prefix web3 run build` first\n');
  process.exit(1);
}

console.log('\n  → dist/   ' + files + ' files, ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');
for (const rel of INCLUDE) console.log('    ' + rel);
console.log('');

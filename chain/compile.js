/* Compile contracts/ with solc-js. No Hardhat, no Foundry, no artifacts tree.
 *
 * The repo's rule is that dependencies live in chain/ and nowhere else. A full
 * framework would bring a config file, a plugin chain and a build directory to
 * hold three contracts we deploy once - so this is solc called directly, and
 * the output is a single JSON a deploy script can read.
 *
 *   node compile.js        → chain/build/contracts.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'contracts');
const OUT = path.join(HERE, 'build');

const SOURCES = ['CityUSD.sol', 'DistrictVault.sol', 'CityOracle.sol'];

/* solc asks for imports by the exact string in the source. OpenZeppelin paths
 * resolve straight out of node_modules; everything else is ours. */
function findImport (importPath) {
  const candidates = [
    path.join(HERE, 'node_modules', importPath),
    path.join(SRC, importPath),
    path.join(SRC, path.basename(importPath))
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { contents: fs.readFileSync(c, 'utf8') };
  }
  return { error: 'not found: ' + importPath };
}

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(
    SOURCES.map(f => [f, { content: fs.readFileSync(path.join(SRC, f), 'utf8') }])
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    /* Keep the standard-json input around: it is what Etherscan and Sourcify
     * want for verification, and regenerating it later never quite matches. */
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));

let errors = 0;
for (const e of out.errors || []) {
  if (e.severity === 'error') { errors++; console.error('\n' + e.formattedMessage); }
  else if (!/SPDX|Unused|shadow/i.test(e.formattedMessage)) console.warn('  warn  ' + e.message);
}
if (errors) { console.error('\n  ' + errors + ' compile error(s)\n'); process.exit(1); }

const artifacts = {};
for (const file of SOURCES) {
  for (const [name, c] of Object.entries(out.contracts[file] || {})) {
    artifacts[name] = {
      abi: c.abi,
      bytecode: '0x' + c.evm.bytecode.object,
      file
    };
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'contracts.json'), JSON.stringify(artifacts, null, 2));
fs.writeFileSync(path.join(OUT, 'solc-input.json'), JSON.stringify(input, null, 2));

console.log('\n  solc ' + solc.version());
for (const [name, a] of Object.entries(artifacts)) {
  const kb = (a.bytecode.length / 2 / 1024).toFixed(1);
  const over = kb > 24 ? '   OVER 24KB LIMIT' : '';
  console.log('  ok    ' + name.padEnd(16) + kb + ' KB' + over);
}
console.log('\n  → chain/build/contracts.json\n');

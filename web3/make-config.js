/* Turn chain/deployed.json + .env into the one file the browser fetches.
 *
 * Config is generated rather than compiled into the bundle so that a
 * redeploy is a file edit, not a rebuild - and so that no key, id or URL
 * ever has to live in a committed source file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const deployedPath = path.join(ROOT, 'chain', 'deployed.json');
if (!fs.existsSync(deployedPath)) {
  console.error('\n  chain/deployed.json not found - run `node chain/deploy.js` first.\n');
  process.exit(1);
}
const D = JSON.parse(fs.readFileSync(deployedPath, 'utf8'));

const ORDER = ['downtown', 'midtown', 'riverside', 'uptown', 'westside',
  'southside', 'wharves', 'redhook', 'airfield'];
const root = (D.root && D.root.name) || process.env.CITY_ROOT || 'cityhall.eth';

const cfg = {
  chainId: 11155111,
  rpc: (process.env.SEPOLIA_RPC_URL || '').startsWith('http')
    ? process.env.SEPOLIA_RPC_URL : 'https://ethereum-sepolia-rpc.publicnode.com',
  root,
  officeLabel: 'mayor',
  registry: D.registry && D.registry.address,
  oracle: D.oracle && D.oracle.address,
  token: D.token && D.token.address,
  vaults: ORDER.map(l => D.vaults && D.vaults[l]).filter(Boolean),
  districts: ORDER.map((l, i) => ({
    id: i, key: l, ens: l + '.' + root,
    registry: D.districts && D.districts[l] && D.districts[l].registry
  })),
  privyAppId: process.env.PRIVY_APP_ID || '',
  privyClientId: process.env.PRIVY_CLIENT_ID || ''
};

const missing = ['oracle', 'token'].filter(k => !cfg[k]);
if (missing.length) {
  console.error('\n  deployed.json is missing: ' + missing.join(', ') + ' - deploy has not finished.\n');
  process.exit(1);
}

fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
console.log('\n  → web3/config.json');
console.log('    root    ' + cfg.root);
console.log('    oracle  ' + cfg.oracle);
console.log('    vaults  ' + cfg.vaults.length + '/9');
console.log('    privy   ' + (cfg.privyAppId ? 'configured' : 'MISSING - wallet UI stays off'));
console.log('');

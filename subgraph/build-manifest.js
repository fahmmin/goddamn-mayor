/* node subgraph/build-manifest.js
 *
 * Writes subgraph.yaml and subgraph/abis/*.json from the deployment that
 * already exists - web3/config.json for the addresses and district names,
 * chain/build/contracts.json for our ABIs, chain/abi for the ENSv2 registry.
 *
 * The manifest is generated rather than written because it has twelve data
 * sources: one oracle, one token, one registry and nine vaults that differ
 * only by address.
 * Hand-maintaining that list guarantees it drifts from the deployment the
 * first time a vault is redeployed, and a subgraph indexing a stale address
 * fails by returning nothing, which looks exactly like a subgraph that is
 * merely still syncing. Forty lines here removes the whole class.
 *
 * startBlock matters more than it looks. Without one, graph-node scans Sepolia
 * from genesis - hours of sync for contracts deployed last week. Nothing in
 * the repo records a deploy block, so the first run finds one by bisecting on
 * block timestamp (see blockAtTime for why not on eth_getCode) and caches it
 * in subgraph/blocks.json, which is committed. Delete that file to re-probe
 * after a redeploy.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = __dirname;
const BLOCKS_FILE = path.join(OUT, 'blocks.json');

/* Both inputs are gitignored - they are deployment output, not source - so on
 * a fresh clone they are simply absent. Say which command produces the missing
 * one rather than letting an ENOENT for a path nobody recognises escape. */
function readOrExplain (rel, how) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error('missing ' + rel + '\n  it is deployment output, not source - run:  ' + how);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const cfg = readOrExplain('web3/config.json', 'npm run web3:config');
const built = readOrExplain('chain/build/contracts.json', 'node chain/compile.js');

const NETWORK = process.env.GRAPH_NETWORK || 'sepolia';
const RPC = process.env.SEPOLIA_RPC_URL || cfg.rpc;

// ---------------------------------------------------------------- abis

function writeAbi (name) {
  const c = built[name];
  if (!c || !c.abi) throw new Error('no ABI for ' + name + ' in chain/build/contracts.json');
  fs.mkdirSync(path.join(OUT, 'abis'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'abis', name + '.json'), JSON.stringify(c.abi, null, 2));
}

/* The ENSv2 registry is not ours and is not compiled here - its ABI is the
 * committed one in chain/abi, the same file deploy.js and verify-gate.js read.
 * One source for it means the subgraph cannot end up indexing a different
 * shape of registry than the deployer talked to. */
function copyAbi (name) {
  const p = path.join(ROOT, 'chain', 'abi', name + '.json');
  if (!fs.existsSync(p)) throw new Error('missing chain/abi/' + name + '.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const abi = j.abi || j;
  fs.mkdirSync(path.join(OUT, 'abis'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'abis', name + '.json'), JSON.stringify(abi, null, 2));
}

/* The role bitmap CityOracle demands, read from the deployment rather than
 * written down twice. deployed.json is committed, so this is available on a
 * fresh clone even though the compile output is not. */
function writeRole () {
  const p = path.join(ROOT, 'chain', 'deployed.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const r = d.offices && d.offices.mayor && d.offices.mayor.role;
  if (!r) throw new Error('chain/deployed.json has no offices.mayor.role');
  return String(r);
}

// ---------------------------------------------------------------- startBlock

async function rpc (method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.message);
  return j.result;
}

const hex = n => '0x' + n.toString(16);

/* Binary search on TIMESTAMP, not on eth_getCode.
 *
 * Finding a contract's exact deploy block by bisecting getCode is the obvious
 * move and it does not work here: it reads historical STATE, and the public
 * Sepolia endpoints are not archive nodes - they answer "historical state is
 * not available" for anything but the last few hundred blocks. Block HEADERS
 * are not state and are served all the way back, so bisecting on timestamp
 * works against any endpoint, including the free one in config.json.
 *
 * The cost is that this finds the block at a moment in time rather than the
 * exact deploy block. That is the right trade: a startBlock slightly too early
 * costs a few thousand empty blocks of sync, while one even slightly too late
 * silently drops events, and the whole point of setting one is to avoid
 * scanning Sepolia from genesis.
 */
async function blockAtTime (targetSec) {
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  const stamp = async b => {
    const blk = await rpc('eth_getBlockByNumber', [hex(b), false]);
    if (!blk) throw new Error('no header at block ' + b);
    return parseInt(blk.timestamp, 16);
  };

  if (await stamp(head) <= targetSec) return head;
  let lo = 1, hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await stamp(mid) < targetSec) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/* When this deployment happened. chain/deploy.js writes deployed.json as it
 * runs, so the file's own mtime is the closest thing the repo has to a deploy
 * time. A day of slack in front of it covers clock skew and the gap between
 * the first contract going out and the file being written. */
const SLACK_SEC = 24 * 60 * 60;

function deployedAt () {
  const f = path.join(ROOT, 'chain/deployed.json');
  return Math.floor(fs.statSync(f).mtimeMs / 1000) - SLACK_SEC;
}

async function resolveStartBlock () {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(BLOCKS_FILE, 'utf8')); } catch { /* first run */ }
  if (typeof cache.startBlock === 'number') return cache.startBlock;

  if (!RPC) throw new Error('set SEPOLIA_RPC_URL, or put {"startBlock":N} in subgraph/blocks.json');
  const at = deployedAt();
  console.log('probing for the block at ' + new Date(at * 1000).toISOString() + '…');
  const b = await blockAtTime(at);
  cache.startBlock = b;
  cache.probedFor = new Date(at * 1000).toISOString();
  fs.writeFileSync(BLOCKS_FILE, JSON.stringify(cache, null, 2));
  console.log('  startBlock ' + b);
  return b;
}

// ---------------------------------------------------------------- manifest

function source (name, address, startBlock, abi, events, file) {
  return [
    '  - kind: ethereum',
    '    name: ' + name,
    '    network: ' + NETWORK,
    '    source:',
    '      address: "' + address + '"',
    '      abi: ' + abi,
    '      startBlock: ' + startBlock,
    '    mapping:',
    '      kind: ethereum/events',
    '      apiVersion: 0.0.9',
    '      language: wasm/assemblyscript',
    '      file: ' + file,
    '      entities:',
    '        - Vault',
    '      abis:',
    '        - name: ' + abi,
    '          file: ./abis/' + abi + '.json',
    '      eventHandlers:',
    ...events.map(e => '        - event: ' + e[0] + '\n          handler: ' + e[1])
  ].join('\n');
}

const VAULT_EVENTS = [
  ['Deposit(indexed address,indexed address,uint256,uint256)', 'handleDeposit'],
  ['Withdraw(indexed address,indexed address,indexed address,uint256,uint256)', 'handleWithdraw'],
  ['Transfer(indexed address,indexed address,uint256)', 'handleTransfer'],
  ['Remitted(uint256,uint256)', 'handleRemitted']
];
const ORACLE_EVENTS = [
  ['CityPushed(indexed uint32,uint16,uint8,uint32,indexed address)', 'handleCityPushed'],
  ['DistrictPushed(indexed uint8,indexed uint32,uint32,uint32,uint16,uint16)', 'handleDistrictPushed'],
  ['Settled(indexed uint8,int256,uint256)', 'handleSettled']
];
const TOKEN_EVENTS = [
  ['FaucetDrawn(indexed address,uint256)', 'handleFaucetDrawn']
];
/* The office, over time. LabelUnregistered is the recall; ExpiryUpdated is the
   only way a term moves; EACRolesChanged plus TokenResource are what make
   "the deputy never held the write role" a query rather than a claim. */
const REGISTRY_EVENTS = [
  ['LabelRegistered(indexed uint256,indexed bytes32,string,address,uint64,indexed address)', 'handleLabelRegistered'],
  ['LabelUnregistered(indexed uint256,indexed address)', 'handleLabelUnregistered'],
  ['ExpiryUpdated(indexed uint256,indexed uint64,indexed address)', 'handleExpiryUpdated'],
  ['TokenResource(indexed uint256,indexed uint256)', 'handleTokenResource'],
  ['EACRolesChanged(indexed uint256,indexed address,uint256,uint256)', 'handleEACRolesChanged']
];

async function main () {
  ['CityOracle', 'DistrictVault', 'CityUSD'].forEach(writeAbi);
  copyAbi('UserRegistryImpl');

  if (!cfg.registry) throw new Error('web3/config.json has no registry address');

  const vaults = cfg.vaults || [];
  if (vaults.length !== (cfg.districts || []).length) {
    throw new Error('config.json has ' + vaults.length + ' vaults for ' +
      (cfg.districts || []).length + ' districts - they are indexed in lockstep');
  }

  /* One startBlock for every source. A per-contract block would be tighter,
     but these eleven contracts went out in one deploy script within a minute
     of each other, and the entities reference each other across sources - so
     eleven different starting points would buy nothing and risk a vault
     indexing before the oracle that names it. */
  const start = await resolveStartBlock();
  const at = () => start;

  const parts = [
    'specVersion: 1.0.0',
    'description: I\'M THE GODDAMN MAYOR - nine ERC-4626 district vaults and the city oracle that prices them.',
    'schema:',
    '  file: ./schema.graphql',
    'dataSources:',
    source('CityOracle', cfg.oracle, at(cfg.oracle), 'CityOracle', ORACLE_EVENTS, './src/oracle.ts'),
    source('CityUSD', cfg.token, at(cfg.token), 'CityUSD', TOKEN_EVENTS, './src/token.ts'),
    source('CityRegistry', cfg.registry, at(cfg.registry), 'UserRegistryImpl', REGISTRY_EVENTS, './src/registry.ts')
  ];

  vaults.forEach((v, i) => {
    const key = (cfg.districts[i] && cfg.districts[i].key) || ('district' + i);
    parts.push(source('Vault_' + key, v, at(v), 'DistrictVault', VAULT_EVENTS, './src/vault.ts'));
  });

  fs.writeFileSync(path.join(OUT, 'subgraph.yaml'), parts.join('\n') + '\n');

  /* The district table, compiled in rather than read at runtime: a mapping
     runs in wasm with no filesystem and no network, so anything it needs to
     know has to arrive as code. */
  const rows = (cfg.districts || []).map((d, i) =>
    '  { id: ' + d.id + ', key: "' + d.key + '", ens: "' + d.ens + '", vault: "' +
    String(vaults[i]).toLowerCase() + '" }');
  fs.writeFileSync(path.join(OUT, 'src', 'districts.ts'),
    '/* GENERATED by build-manifest.js - do not edit. */\n' +
    'export class District {\n' +
    '  id: i32; key: string; ens: string; vault: string;\n' +
    '  constructor(id: i32, key: string, ens: string, vault: string) {\n' +
    '    this.id = id; this.key = key; this.ens = ens; this.vault = vault;\n' +
    '  }\n}\n\n' +
    'export function districts(): District[] {\n  return [\n' +
    (cfg.districts || []).map((d, i) =>
      '    new District(' + d.id + ', "' + d.key + '", "' + d.ens + '", "' +
      String(vaults[i]).toLowerCase() + '")').join(',\n') +
    '\n  ];\n}\n\n' +
    'export function districtIdForVault(addr: string): i32 {\n' +
    '  let ds = districts();\n' +
    '  for (let i = 0; i < ds.length; i++) if (ds[i].vault == addr) return ds[i].id;\n' +
    '  return -1;\n}\n\n' +
    'export function ensForId(id: i32): string {\n' +
    '  let ds = districts();\n' +
    '  for (let i = 0; i < ds.length; i++) if (ds[i].id == id) return ds[i].ens;\n' +
    '  return "";\n}\n\n' +
    'export function vaultForId(id: i32): string {\n' +
    '  let ds = districts();\n' +
    '  for (let i = 0; i < ds.length; i++) if (ds[i].id == id) return ds[i].vault;\n' +
    '  return "";\n}\n\n' +
    '/* The role bitmap CityOracle accepts, from chain/deployed.json. A mapping\n' +
    '   runs in wasm with no filesystem, so it arrives as code like the rest. */\n' +
    'export const WRITE_ROLE_STR: string = "' + writeRole() + '";\n\n' +
    '/* The label CityOracle is configured to ask about. The write role shares a\n' +
    '   bit with SET_RESOLVER, which every district legitimately holds, so the\n' +
    '   bitmap alone does not answer "may this name write" - the label does. */\n' +
    'export const OFFICE_LABEL: string = "' + (cfg.officeLabel || 'mayor') + '";\n');

  /* Nine vaults share one ABI, so codegen emits nine identical binding
     modules. The handlers are one file, so they need one import - this
     re-export picks the first and keeps the district key out of the source. */
  const firstVault = 'Vault_' + ((cfg.districts[0] && cfg.districts[0].key) || 'district0');
  fs.writeFileSync(path.join(OUT, 'src', 'vault-abi.ts'), [
    '/* GENERATED by build-manifest.js - do not edit.',
    '   codegen writes one binding module per data source; all nine vaults',
    '   share an ABI, so the handlers import them from here. */',
    "export { Deposit, Withdraw, Transfer, Remitted, DistrictVault }",
    "  from '../generated/" + firstVault + "/DistrictVault';",
    ''
  ].join('\n'));

  console.log('wrote subgraph.yaml  (' + (vaults.length + 3) + ' data sources, network ' +
    NETWORK + ', startBlock ' + start + ')');
  console.log('wrote src/districts.ts  (' + rows.length + ' districts)');
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });

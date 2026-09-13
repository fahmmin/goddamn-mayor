/* node preflight.js  -  is the chain ready for the city?
 *
 * Read-only. No key required, nothing is signed. Answers the day-one question:
 * does ENSv2 look the way the docs say, and is the city's name still free?
 */
import { createPublicClient, http, getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { readFileSync, existsSync } from 'node:fs';
import { ENS, CHAIN_ID } from './addresses.js';

/* Same .env load as deploy.js, so `npm --prefix chain run preflight` answers
 * the same question whether or not the caller exported anything first.
 * Absent is fine - this run is read-only and falls back to the public node. */
const ENV_FILE = new URL('../.env', import.meta.url);
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const RPC = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const ROOT = (process.env.CITY_ROOT || 'cityhall.eth').replace(/\.eth$/, '');

const abi = n => JSON.parse(readFileSync(new URL('./abi/' + n + '.json', import.meta.url))).abi;
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const ZERO = '0x0000000000000000000000000000000000000000';
let bad = 0;
const ok = (c, msg) => { if (!c) bad++; console.log('  ' + (c ? 'ok  ' : 'FAIL') + '  ' + msg); };

console.log('\n  RPC ' + (process.env.SEPOLIA_RPC_URL ? '(from SEPOLIA_RPC_URL)' : '(public fallback)') + '\n');

const id = await client.getChainId();
ok(id === CHAIN_ID, 'chain is Sepolia (' + id + ')');
console.log('        block ' + (await client.getBlockNumber()));

console.log('\n  ENSv2 beta contracts');
for (const [name, address] of Object.entries(ENS)) {
  const code = await client.getBytecode({ address: getAddress(address) });
  ok(!!code, name.padEnd(25) + address + '  ' + (code ? (code.length - 2) / 2 + ' bytes' : 'NO CODE'));
}

console.log('\n  the city\'s name');
const reg = { address: getAddress(ENS.ETHRegistry), abi: abi('ETHRegistry') };
const owner = await client.readContract({ ...reg, functionName: 'findOwner', args: [ROOT] });
const free = owner === ZERO;
if (free) {
  console.log('  ok    ' + ROOT + '.eth is AVAILABLE - claim it');
} else {
  const expiry = await client.readContract({ ...reg, functionName: 'findExpiry', args: [ROOT] });
  console.log('  --    ' + ROOT + '.eth is TAKEN');
  console.log('        owner  ' + owner);
  console.log('        expires ' + (expiry ? new Date(Number(expiry) * 1000).toISOString() : 'never'));
  console.log('        (if that owner is you, nothing is wrong - carry on)');

  // Testnet work should never stall on a name. Offer a free throwaway; the real
  // name is chosen once, on the final deploy.
  for (let i = 0; i < 20; i++) {
    const alt = 'mm-' + Math.random().toString(16).slice(2, 8);
    if (await client.readContract({ ...reg, functionName: 'findOwner', args: [alt] }) === ZERO) {
      console.log('        free alternative:  CITY_ROOT=' + alt + '.eth');
      break;
    }
  }
}

/* 0x optional, exactly as deploy.js accepts it - the check that tells you
 * whether the deploy will work must not reject the key the deploy takes. */
const RAW_KEY = (process.env.DEPLOYER_PRIVATE_KEY || '').trim().replace(/^0x/, '');
if (RAW_KEY && !/^[0-9a-fA-F]{64}$/.test(RAW_KEY)) {
  console.log('\n  deployer');
  ok(false, 'DEPLOYER_PRIVATE_KEY is set but is not a 32-byte hex key');
} else if (RAW_KEY) {
  const { privateKeyToAccount } = await import('viem/accounts');
  const acct = privateKeyToAccount('0x' + RAW_KEY);
  const bal = await client.getBalance({ address: acct.address });
  console.log('\n  deployer');
  console.log('        ' + acct.address + '   ' + (Number(bal) / 1e18).toFixed(4) + ' ETH');
  ok(bal > 0n, 'deployer is funded');
  /* A taken name only matters if somebody else holds it. */
  if (!free && owner.toLowerCase() === acct.address.toLowerCase()) {
    console.log('        ' + ROOT + '.eth is held by THIS key - carry on');
  }
} else {
  console.log('\n  deployer  (no DEPLOYER_PRIVATE_KEY set - read-only run)');
}

console.log('\n  ' + (bad ? bad + ' FAILED' : 'all clear') + '\n');
process.exit(bad ? 1 : 0);

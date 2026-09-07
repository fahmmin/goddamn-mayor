/* node preflight.js  -  is the chain ready for the city?
 *
 * Read-only. No key required, nothing is signed. Answers the day-one question:
 * does ENSv2 look the way the docs say, and is the city's name still free?
 */
import { createPublicClient, http, getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { ENS, CHAIN_ID } from './addresses.js';

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

if (process.env.DEPLOYER_PRIVATE_KEY) {
  const { privateKeyToAccount } = await import('viem/accounts');
  const acct = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
  const bal = await client.getBalance({ address: acct.address });
  console.log('\n  deployer');
  console.log('        ' + acct.address + '   ' + (Number(bal) / 1e18).toFixed(4) + ' ETH');
  ok(bal > 0n, 'deployer is funded');
} else {
  console.log('\n  deployer  (no DEPLOYER_PRIVATE_KEY set - read-only run)');
}

console.log('\n  ' + (bad ? bad + ' FAILED' : 'all clear') + '\n');
process.exit(bad ? 1 : 0);

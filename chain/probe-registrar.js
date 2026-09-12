/* What does registering a name on the ENSv2 beta actually cost, and in what?
 *
 * register() takes a paymentToken rather than being payable, so the deploy
 * script needs to know which token the beta's price oracle accepts and how
 * long the commit-reveal wait is. Read-only: no key required.
 */
import { createPublicClient, http, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { ENS } from './addresses.js';
import fs from 'node:fs';

const rpc = (process.env.SEPOLIA_RPC_URL || '').startsWith('http')
  ? process.env.SEPOLIA_RPC_URL
  : 'https://ethereum-sepolia-rpc.publicnode.com';

const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
const registrarAbi = JSON.parse(fs.readFileSync(new URL('./abi/ETHRegistrar.json', import.meta.url))).abi;
const oracleAbi = JSON.parse(fs.readFileSync(new URL('./abi/StandardRentPriceOracle.json', import.meta.url))).abi;

const R = { address: ENS.ETHRegistrar, abi: registrarAbi };
const label = (process.env.CITY_ROOT || 'cityhall.eth').replace(/\.eth$/, '');

const [minAge, maxAge, minDur, available, oracleAddr] = await Promise.all([
  client.readContract({ ...R, functionName: 'MIN_COMMITMENT_AGE' }),
  client.readContract({ ...R, functionName: 'MAX_COMMITMENT_AGE' }),
  client.readContract({ ...R, functionName: 'MIN_REGISTER_DURATION' }),
  client.readContract({ ...R, functionName: 'isAvailable', args: [label] }),
  client.readContract({ ...R, functionName: 'rentPriceOracle' })
]);

console.log('\n  label                  ' + label + '.eth');
console.log('  available              ' + available);
console.log('  MIN_COMMITMENT_AGE     ' + minAge + 's');
console.log('  MAX_COMMITMENT_AGE     ' + maxAge + 's');
console.log('  MIN_REGISTER_DURATION  ' + minDur + 's (' + (Number(minDur) / 86400).toFixed(0) + ' days)');
console.log('  rentPriceOracle        ' + oracleAddr);

/* Which tokens does the oracle actually take? The beta gates on an accepted
 * payment-token list, and guessing wrong costs a failed tx on the clock. */
let tokens = [];
try {
  tokens = await client.readContract({ address: oracleAddr, abi: oracleAbi, functionName: 'getPaymentTokens' });
  console.log('  paymentTokens          ' + (tokens.length ? tokens.join(', ') : '(none listed)'));
} catch (e) {
  console.log('  paymentTokens          ! ' + e.shortMessage || e.message);
}

const ZERO = '0x0000000000000000000000000000000000000000';
for (const t of [...tokens, ZERO]) {
  try {
    const p = await client.readContract({ ...R, functionName: 'getRegisterPrice', args: [label, 31536000n, t] });
    const total = Array.isArray(p) ? p.reduce((a, b) => a + b, 0n) : p;
    console.log('  price 1y via ' + (t === ZERO ? 'ETH(0x0)     ' : t.slice(0, 10) + '...') +
      '  ' + total + '  (' + formatUnits(total, 6) + ' @6dp / ' + formatUnits(total, 18) + ' @18dp)');
  } catch (e) {
    console.log('  price 1y via ' + (t === ZERO ? 'ETH(0x0)' : t.slice(0, 10)) + '  ! ' + (e.shortMessage || e.message).split('\n')[0]);
  }
}
console.log('');

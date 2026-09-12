/* Is the ENS integration load-bearing, or is it decoration?
 *
 * This is the claim the whole ENS entry rests on, so it is a script rather
 * than a paragraph. It proves four things against the live deployment:
 *
 *   1. the mayor CAN push                    - the gate permits the office
 *   2. a stranger CANNOT                     - and it is the name doing it
 *   3. push() actually lands city data       - the write path works
 *   4. a burned name reverts the next push   - run with --burn
 *
 * (4) is destructive and deliberately opt-in: it unregisters the office name.
 * That is the demo's best beat, but it should happen when a camera is
 * running, not as a side effect of a status check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ENS } from './addresses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const l of fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const D = JSON.parse(fs.readFileSync(path.join(HERE, 'deployed.json'), 'utf8'));
const ART = JSON.parse(fs.readFileSync(path.join(HERE, 'build', 'contracts.json'), 'utf8'));
const REGISTRY_ABI = JSON.parse(fs.readFileSync(path.join(HERE, 'abi', 'UserRegistryImpl.json'), 'utf8')).abi;

const KEY = '0x' + process.env.DEPLOYER_PRIVATE_KEY.trim().replace(/^0x/, '');
const account = privateKeyToAccount(KEY);
const RPC = process.env.SEPOLIA_RPC_URL.startsWith('http')
  ? process.env.SEPOLIA_RPC_URL : 'https://ethereum-sepolia-rpc.publicnode.com';
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wal = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const O = { address: D.oracle.address, abi: ART.CityOracle.abi };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok    ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

/* viem puts the decoded custom-error name on cause.data.errorName; the
 * top-level shortMessage is only ever "the contract function reverted". A
 * test that greps the message passes for ANY revert, which is precisely the
 * assertion we must not make here - the point is that it reverts for the
 * right reason. */
function revertName (e) {
  let c = e;
  for (let i = 0; i < 5 && c; i++) {
    if (c.data && c.data.errorName) return c.data.errorName;
    c = c.cause;
  }
  return String(e && (e.shortMessage || e.message) || e).split('\n')[0];
}

async function revertsWith (want, call) {
  try { await pub.simulateContract(call); return { got: '(no revert)', ok: false }; }
  catch (e) { const got = revertName(e); return { got, ok: want.test(got) }; }
}

console.log('\n  oracle   ' + D.oracle.address);
console.log('  registry ' + D.registry.address);
console.log('  office   mayor.' + D.root.name + '\n');

// --- 1. the office, as the chain sees it -----------------------------------
const st = await pub.readContract({ ...O, functionName: 'officeState' });
const [status, expiry, holder] = st;
console.log('  status ' + status + '  expiry ' + new Date(Number(expiry) * 1000).toISOString() +
  '  holder ' + holder + '\n');
ok(holder.toLowerCase() === account.address.toLowerCase(), 'the deployer holds the office name');
ok(Number(expiry) * 1000 > Date.now(), 'the term has not expired yet');

// --- 2. the gate permits the mayor and refuses everyone else ---------------
const mayorCan = await pub.readContract({ ...O, functionName: 'canPush', args: [account.address] });
ok(mayorCan === true, 'canPush(mayor) is true');

const stranger = privateKeyToAccount(generatePrivateKey()).address;
const strangerCan = await pub.readContract({ ...O, functionName: 'canPush', args: [stranger] });
ok(strangerCan === false, 'canPush(a wallet holding no office) is false');

/* The read above could be a view that lies. Simulate the real call from the
 * stranger and require it to revert with NotTheMayor specifically - not any
 * revert, which a typo would also produce. */
const sr = await revertsWith(/NotTheMayor/, {
  ...O, functionName: 'push', account: stranger,
  args: [1, 5000, 3, 100, Array(9).fill(1), Array(9).fill(1), Array(9).fill(1), Array(9).fill(1)]
});
ok(sr.ok, 'push() from a stranger reverts with NotTheMayor  (got ' + sr.got + ')');

// --- 3. the write path actually lands data ---------------------------------
const day = Math.floor(Date.now() / 1000) % 1461;
const navs = Array.from({ length: 9 }, (_, i) => 1000 * (i + 1));
const hash = await wal.writeContract({
  ...O, functionName: 'push',
  args: [day, 7250, 3, 42410, navs, Array(9).fill(500), Array(9).fill(180), Array(9).fill(220)]
});
const rec = await pub.waitForTransactionReceipt({ hash });
ok(rec.status === 'success', 'the mayor can push: ' + hash);

const city = await pub.readContract({ ...O, functionName: 'city' });
ok(Number(city[0]) === day, 'city.day round-trips (' + city[0] + ')');
const ds = await pub.readContract({ ...O, functionName: 'allDistricts' });
ok(Number(ds[8].nav) === 9000, 'district 8 NAV round-trips (' + ds[8].nav + ')');

// --- 4. burn the office, and watch the same wallet lose the city ----------
if (process.argv.includes('--burn')) {
  console.log('\n  --burn: unregistering mayor.' + D.root.name + ' (the recall)\n');
  const tokenId = await pub.readContract({
    address: D.registry.address, abi: REGISTRY_ABI, functionName: 'findTokenId', args: ['mayor']
  });
  const bh = await wal.writeContract({
    address: D.registry.address, abi: REGISTRY_ABI, functionName: 'unregister', args: [tokenId]
  });
  await pub.waitForTransactionReceipt({ hash: bh });
  console.log('  burned  ' + bh + '\n');

  const after = await pub.readContract({ ...O, functionName: 'canPush', args: [account.address] });
  ok(after === false, 'canPush(mayor) is now FALSE - same wallet, no office');

  const br = await revertsWith(/OfficeVacant|TermExpired|NotTheMayor/, {
    ...O, functionName: 'push', account: account.address,
    args: [day + 1, 5000, 3, 100, navs, Array(9).fill(1), Array(9).fill(1), Array(9).fill(1)]
  });
  ok(br.ok, 'push() now reverts for the former mayor with ' + br.got);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

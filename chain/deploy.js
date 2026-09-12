/* Deploy the city: one ENSv2 namespace, one oracle, nine vaults.
 *
 * Staged and RESUMABLE. Every step writes its result to deployed.json and is
 * skipped on a re-run, because the middle of this script is a 60-second
 * commit-reveal wait and a hackathon is exactly where a process gets killed
 * between commit() and register(). Re-running is always safe.
 *
 *   node deploy.js              run every stage that is not already done
 *   node deploy.js --only=ens   run one stage
 *   node deploy.js --force=ens  re-run a stage that is already recorded
 *
 * Stages, in dependency order:
 *   funds     mint MockUSDC (registration is ERC20-priced, NOT payable)
 *   root      commit + register <CITY_ROOT> on the ETHRegistrar
 *   registry  deploy the city's own UserRegistry via the Verifiable Factory
 *   offices   mayor + deputy, expiring, with roles - the ENS integration
 *   districts nine district names, each with its own UserRegistry
 *   token     CityUSD
 *   oracle    CityOracle, gated on the mayor's name
 *   vaults    nine ERC-4626 DistrictVaults, then wireVaults()
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ENS, PAYMENT, REGISTRAR, ROLE, adminOf } from './addresses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, 'deployed.json');

// ---- env -------------------------------------------------------------------
for (const line of fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
/* Accept the key with or without 0x - exporting from a wallet gives you one
 * form, a generator the other, and a format nit is a poor reason to fail a
 * deploy at 2am. */
const RAW_KEY = (process.env.DEPLOYER_PRIVATE_KEY || '').trim().replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(RAW_KEY)) {
  console.error('\n  DEPLOYER_PRIVATE_KEY is missing or not a 32-byte hex key.');
  console.error('  Put a FRESH Sepolia key in .env (64 hex chars, 0x optional) and fund it.\n');
  process.exit(1);
}
const KEY = '0x' + RAW_KEY;
const RPC = (process.env.SEPOLIA_RPC_URL || '').startsWith('http')
  ? process.env.SEPOLIA_RPC_URL : 'https://ethereum-sepolia-rpc.publicnode.com';
const ROOT_NAME = (process.env.CITY_ROOT || 'cityhall.eth').trim();
const ROOT_LABEL = ROOT_NAME.replace(/\.eth$/, '');

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wal = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

// ---- artifacts + abis ------------------------------------------------------
const ART = JSON.parse(fs.readFileSync(path.join(HERE, 'build', 'contracts.json'), 'utf8'));
const abiOf = f => JSON.parse(fs.readFileSync(path.join(HERE, 'abi', f), 'utf8')).abi;
const REGISTRAR_ABI = abiOf('ETHRegistrar.json');
const REGISTRY_ABI = abiOf('UserRegistryImpl.json');
const FACTORY_ABI = abiOf('VerifiableFactory.json');
const ERC20_ABI = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)'
]);

// ---- resumable state -------------------------------------------------------
const D = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(D, null, 2) + '\n');

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];
const force = (args.find(a => a.startsWith('--force=')) || '').split('=')[1];

const log = (...a) => console.log('   ', ...a);
const head = s => console.log('\n  ' + s);

async function send (label, req) {
  const hash = await wal.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(label + ' reverted: ' + hash);
  log(label + '  ' + hash);
  return r;
}

async function deployRaw (name, args_) {
  const a = ART[name];
  const hash = await wal.deployContract({ abi: a.abi, bytecode: a.bytecode, args: args_ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(name + ' deploy failed: ' + hash);
  log(name.padEnd(14) + r.contractAddress);
  return r.contractAddress;
}

async function stage (name, fn) {
  if (only && only !== name) return;
  if (D[name] && force !== name) { head(name + '  ·  already done, skipping'); return; }
  head(name);
  await fn();
  save();
}

const DISTRICTS = [
  'downtown', 'midtown', 'riverside', 'uptown', 'westside',
  'southside', 'wharves', 'redhook', 'airfield'
];

/* A four-year term in real seconds. The game's 1461 days run far faster than
 * that, so the office is registered for the shortest the registrar allows and
 * the demo shortens it further by burning the name outright. */
const TERM_SECONDS = 60n * 60n * 24n * 28n;   // MIN_REGISTER_DURATION

/* The role the oracle checks. Reusing an existing, meaningful ENSv2 role
 * rather than inventing a bit: the EAC validates bitmaps, and a role the
 * registry does not know is a deploy-time revert we do not need. Writing the
 * city's records is, literally, setting its resolver data. */
const WRITE_ROLE = ROLE.SET_RESOLVER;

// ===========================================================================

console.log('\n  deployer   ' + account.address);
console.log('  rpc        ' + RPC.replace(/\/[^/]{12,}$/, '/***'));
console.log('  root name  ' + ROOT_NAME);

const bal = await pub.getBalance({ address: account.address });
console.log('  balance    ' + (Number(bal) / 1e18).toFixed(4) + ' ETH');
if (bal === 0n) { console.error('\n  Deployer has no Sepolia ETH. Fund it first.\n'); process.exit(1); }

// ---- funds -----------------------------------------------------------------
await stage('funds', async () => {
  const tok = PAYMENT.MockUSDC.address;
  const need = parseUnits('1000', PAYMENT.MockUSDC.decimals);
  const have = await pub.readContract({ address: tok, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  if (have < need) {
    await send('mint MockUSDC', { address: tok, abi: ERC20_ABI, functionName: 'mint', args: [account.address, need] });
  } else log('already holding ' + have + ' units');
  await send('approve registrar', {
    address: tok, abi: ERC20_ABI, functionName: 'approve', args: [ENS.ETHRegistrar, need * 10n]
  });
  D.funds = { token: tok };
});

// ---- root ------------------------------------------------------------------
await stage('root', async () => {
  const available = await pub.readContract({
    address: ENS.ETHRegistrar, abi: REGISTRAR_ABI, functionName: 'isAvailable', args: [ROOT_LABEL]
  });
  if (!available) throw new Error(ROOT_LABEL + '.eth is taken - set CITY_ROOT in .env to a free name');

  const secret = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const duration = REGISTRAR.MIN_REGISTER_DURATION;
  const ZERO = '0x0000000000000000000000000000000000000000';
  const REF = '0x' + '00'.repeat(32);

  const commitment = await pub.readContract({
    address: ENS.ETHRegistrar, abi: REGISTRAR_ABI, functionName: 'makeCommitment',
    args: [ROOT_LABEL, account.address, secret, ZERO, ENS.PublicResolverV2 || ENS.ENSV2Resolver, duration, REF]
  });
  await send('commit', { address: ENS.ETHRegistrar, abi: REGISTRAR_ABI, functionName: 'commit', args: [commitment] });

  const wait = Number(REGISTRAR.MIN_COMMITMENT_AGE) + 15;
  log('waiting ' + wait + 's for the commitment to mature...');
  await new Promise(r => setTimeout(r, wait * 1000));

  await send('register ' + ROOT_NAME, {
    address: ENS.ETHRegistrar, abi: REGISTRAR_ABI, functionName: 'register',
    args: [ROOT_LABEL, account.address, secret, ZERO, ENS.PublicResolverV2 || ENS.ENSV2Resolver,
      duration, PAYMENT.MockUSDC.address, REF]
  });
  D.root = { name: ROOT_NAME, label: ROOT_LABEL, owner: account.address };
});

// ---- the city's own registry ----------------------------------------------
await stage('registry', async () => {
  const addr = await deployUserRegistry('city');
  D.registry = { address: addr };

  const tokenId = await pub.readContract({
    address: ENS.ETHRegistry, abi: REGISTRY_ABI, functionName: 'findTokenId', args: [ROOT_LABEL]
  });
  await send('point ' + ROOT_NAME + ' at its registry', {
    address: ENS.ETHRegistry, abi: REGISTRY_ABI, functionName: 'setSubregistry', args: [tokenId, addr]
  });
});

/* UserRegistry instances are proxies minted by the Verifiable Factory. The
 * factory's event carries the address; salt is derived from the label so a
 * re-run is deterministic rather than producing a second orphan registry. */
async function deployUserRegistry (label) {
  const salt = BigInt('0x' + Buffer.from(label.padEnd(8, '_')).toString('hex'));
  const init = {
    abi: REGISTRY_ABI, functionName: 'initialize',
    args: [account.address, ROLE.REGISTRAR | ROLE.UNREGISTER | ROLE.RENEW |
      ROLE.SET_SUBREGISTRY | ROLE.SET_RESOLVER | adminOf(ROLE.SET_RESOLVER)]
  };
  const { encodeFunctionData, decodeEventLog } = await import('viem');
  const data = encodeFunctionData(init);
  const call = {
    address: ENS.VerifiableFactory, abi: FACTORY_ABI, functionName: 'deployProxy',
    args: [ENS.UserRegistryImpl, salt, data]
  };
  /* Simulate first: deployProxy returns the address, and a simulated return
   * beats scraping it back out of the receipt. It also surfaces a revert
   * before the gas is spent, which matters when a re-run may collide with a
   * salt this deployer has already used. */
  const { result: predicted } = await pub.simulateContract({ ...call, account });
  const hash = await wal.writeContract(call);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('registry deploy reverted for ' + label);

  let addr = predicted;
  for (const l of r.logs) {
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: l.data, topics: l.topics });
      if (ev.eventName === 'ProxyDeployed') { addr = ev.args.proxyAddress; break; }
    } catch { /* not a factory event */ }
  }
  log('registry ' + label.padEnd(10) + addr);
  return addr;
}

// ---- offices ---------------------------------------------------------------
/* The heart of the ENS track. mayor is:
 *   expiring          registered with a real expiry
 *   non-transferable  CAN_TRANSFER withheld, so the office cannot be sold
 *   revocable         the registry keeps UNREGISTER, so a recall can burn it
 * and it carries WRITE_ROLE, which is the only thing CityOracle will accept. */
await stage('offices', async () => {
  const reg = D.registry.address;
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + TERM_SECONDS;
  const ZERO = '0x0000000000000000000000000000000000000000';
  const resolver = ENS.PublicResolverV2 || ENS.ENSV2Resolver;

  await send('register mayor (expiring, non-transferable)', {
    address: reg, abi: REGISTRY_ABI, functionName: 'register',
    args: ['mayor', account.address, ZERO, resolver, WRITE_ROLE, expiry]
  });

  /* The bonus bullet: an agent whose permissions ARE its name. deputy may
   * read and propose; it never holds WRITE_ROLE, so it cannot push. */
  await send('register deputy (agent namespace, no write role)', {
    address: reg, abi: REGISTRY_ABI, functionName: 'register',
    args: ['deputy', account.address, ZERO, resolver, ROLE.RENEW, expiry]
  });

  D.offices = { mayor: { label: 'mayor', expiry: Number(expiry), role: WRITE_ROLE.toString() },
    deputy: { label: 'deputy', expiry: Number(expiry) } };
});

// ---- districts -------------------------------------------------------------
await stage('districts', async () => {
  const reg = D.registry.address;
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + TERM_SECONDS * 12n;
  const resolver = ENS.PublicResolverV2 || ENS.ENSV2Resolver;
  D.districts = D.districts || {};
  for (let i = 0; i < DISTRICTS.length; i++) {
    const label = DISTRICTS[i];
    if (D.districts[label]) { log(label + ' already registered'); continue; }
    const sub = await deployUserRegistry(label);
    await send('register ' + label + '.' + ROOT_NAME, {
      address: reg, abi: REGISTRY_ABI, functionName: 'register',
      args: [label, account.address, sub, resolver,
        ROLE.REGISTRAR | ROLE.SET_RESOLVER | ROLE.CAN_TRANSFER, expiry]
    });
    D.districts[label] = { id: i, registry: sub, expiry: Number(expiry) };
    save();
  }
});

// ---- contracts -------------------------------------------------------------
await stage('token', async () => {
  D.token = { address: await deployRaw('CityUSD', [account.address]) };
});

await stage('oracle', async () => {
  D.oracle = {
    address: await deployRaw('CityOracle',
      [D.registry.address, 'mayor', WRITE_ROLE, D.token.address, account.address]),
    writeRole: WRITE_ROLE.toString()
  };
});

await stage('vaults', async () => {
  D.vaults = D.vaults || {};
  for (let i = 0; i < DISTRICTS.length; i++) {
    const label = DISTRICTS[i];
    if (D.vaults[label]) { log(label + ' vault already deployed'); continue; }
    D.vaults[label] = await deployRaw('DistrictVault', [
      D.token.address, D.oracle.address, i, label + '.' + ROOT_NAME,
      'Mamdani ' + label[0].toUpperCase() + label.slice(1) + ' District', 'mm' + label.slice(0, 4).toUpperCase()
    ]);
    save();
  }
  await send('wireVaults', {
    address: D.oracle.address, abi: ART.CityOracle.abi, functionName: 'wireVaults',
    args: [DISTRICTS.map(l => D.vaults[l])]
  });
  // fund the oracle's settlement reserve out of the treasury's seed mint
  const reserve = parseUnits('5000000', 18);
  await send('fund settlement reserve', {
    address: D.token.address, abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
    functionName: 'transfer', args: [D.oracle.address, reserve]
  });
});

save();
console.log('\n  → chain/deployed.json\n');
console.log('  Add to .env:');
console.log('    CITY_ORACLE_ADDRESS=' + (D.oracle ? D.oracle.address : '?'));
console.log('');

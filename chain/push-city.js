/* The mayor's console: run the real simulation headlessly and publish it.
 *
 * Why this exists. A judge's Privy wallet is a fresh address, and it does not
 * hold mayor.cityhall.eth - so it cannot push, and that is correct rather
 * than a bug. The office is the office. The browser push path in
 * web3/src/index.js fires only when the connected wallet holds the write
 * role; for everyone else the market is read-only, which is the whole point.
 *
 * So the mayor needs a way to govern from the key that actually holds the
 * office. This is it. It loads the same src/*.js modules the browser does
 * against a stub DOM, runs the same deterministic simulation, and pushes the
 * same numbers MM.districts.stats() would show on screen.
 *
 * Nothing here invents data. Delete this file and the browser path still
 * works for whoever holds the name.
 *
 *   node push-city.js                 advance 90 days from the showcase, push once
 *   node push-city.js --days=400      seed history: push every 30 days
 *   node push-city.js --tank          govern badly on purpose, for the video
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : null; };
const DAYS = Number(arg('days') || 90);
const EVERY = Number(arg('every') || 30);
const TANK = process.argv.includes('--tank');

// ---- load the game exactly as the browser does ----------------------------
/* smoke.js already proved this approach works; the difference is that it
 * asserts and this one publishes. The stub DOM is deliberately the smallest
 * thing ui.js will accept, because ui.js is loaded only to keep the module
 * order honest - none of its output is read here. */
const { MM, TICKS } = await loadGame();

async function loadGame () {
  const store = {};
  const node = () => ({
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', value: '',
    classList: { add () {}, remove () {}, toggle () {}, contains: () => false },
    appendChild (c) { this.children.push(c); return c; },
    append () {}, removeChild (c) { return c; }, remove () {},
    setAttribute () {}, getAttribute: () => null, removeAttribute () {},
    addEventListener () {}, removeEventListener () {}, focus () {}, blur () {},
    querySelector: () => node(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    getContext: () => ctx(), insertBefore (c) { return c; }, closest: () => null,
    width: 1280, height: 800
  });
  const ctx = () => new Proxy({
    canvas: { width: 1280, height: 800 }, measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop () {} }),
    createRadialGradient: () => ({ addColorStop () {} }),
    createPattern: () => null, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData () {}, drawImage () {}
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });

  const doc = {
    createElement: () => node(), createElementNS: () => node(),
    getElementById: () => node(), querySelector: () => node(), querySelectorAll: () => [],
    body: node(), documentElement: node(), addEventListener () {}, removeEventListener () {},
    createDocumentFragment: () => node(), hidden: false, visibilityState: 'visible'
  };
  globalThis.window = {
    MM: { DEMO: 'showcase' }, document: doc, devicePixelRatio: 1,
    innerWidth: 1600, innerHeight: 900,
    addEventListener () {}, removeEventListener () {},
    requestAnimationFrame: () => 0, cancelAnimationFrame () {},
    matchMedia: () => ({ matches: false, addEventListener () {}, addListener () {} }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    /* Node's own performance, NOT a stub. undici reaches for
     * performance.markResourceTiming on every fetch, so replacing this
     * global breaks viem's transport - and the game only ever wanted now(). */
    performance: globalThis.performance,
    location: { search: '', href: 'http://localhost/' },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  globalThis.document = doc;
  globalThis.localStorage = window.localStorage;
  /* Node 24 defines navigator as a getter-only global, so a plain assignment
   * throws. smoke.js hits the same wall and solves it the same way. */
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', language: 'en-US' }, configurable: true, writable: true
  });
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.AudioContext = undefined;
  globalThis.matchMedia = window.matchMedia;
  globalThis.getComputedStyle = window.getComputedStyle;

  const ORDER = ['state.js', 'districts.js', 'gfx.js', 'materials.js', 'audio.js', 'policies.js',
    'events.js', 'sim.js', 'ground.js', 'roofs.js', 'props.js', 'lots.js', 'light.js',
    'bridges.js', 'landmarks.js', 'sky.js', 'render.js', 'ui.js', 'demo.js'];
  for (const f of ORDER) {
    const code = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    (0, eval)(code);
  }
  return { MM: window.MM, TICKS: window.MM.TICKS_PER_DAY };
}

// ---- chain ----------------------------------------------------------------
const D = JSON.parse(fs.readFileSync(path.join(HERE, 'deployed.json'), 'utf8'));
const ART = JSON.parse(fs.readFileSync(path.join(HERE, 'build', 'contracts.json'), 'utf8'));
const KEY = '0x' + process.env.DEPLOYER_PRIVATE_KEY.trim().replace(/^0x/, '');
const account = privateKeyToAccount(KEY);
const RPC = process.env.SEPOLIA_RPC_URL.startsWith('http')
  ? process.env.SEPOLIA_RPC_URL : 'https://ethereum-sepolia-rpc.publicnode.com';
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wal = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const O = { address: D.oracle.address, abi: ART.CityOracle.abi };

const can = await pub.readContract({ ...O, functionName: 'canPush', args: [account.address] });
console.log('\n  mayor    ' + account.address);
console.log('  office   mayor.' + D.root.name);
console.log('  canPush  ' + can);
if (!can) {
  console.error('\n  This wallet does not hold the office. That is the gate working,');
  console.error('  not a bug - push() would revert. Check chain/verify-gate.js.\n');
  process.exit(1);
}

// ---- run the city ---------------------------------------------------------
const s = MM.loadState();
const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'D'];

function ratingIndex (st) {
  const net = (st.dailyIncome || 0) - (st.dailyCost || 0);
  const income = Math.max(1, st.dailyIncome || 1);
  let score = ((st.approval || 50) / 100) * 6 + Math.max(-1, Math.min(1, net / income)) * 2;
  if ((st.treasury || 0) < 0) score -= 2;
  return Math.max(0, Math.min(8, Math.round(8 - score)));
}

/* --tank: govern badly on camera. Not a fake number - these are the real
 * levers, applied to the real simulation, and the city responds the way it
 * responds to a player doing the same thing. */
if (TANK) {
  s.taxRate = { res: 20, com: 20, ind: 20 };
  s.policies = {};
  console.log('  mode     TANK (taxes to 20%, every policy off)');
}

console.log('  running  ' + DAYS + ' days, pushing every ' + EVERY + '\n');

let pushes = 0;
for (let day = 0; day < DAYS; day++) {
  for (let t = 0; t < TICKS; t++) MM.sim.step(s);
  if (s.pending) s.pending = null;                 // nobody is here to answer events

  if (day % EVERY !== 0 && day !== DAYS - 1) continue;

  const st = MM.districts.stats(s);
  const rating = ratingIndex(s);
  const args = [
    Math.max(0, Math.round(s.day)),
    Math.round(Math.max(0, Math.min(100, s.approval || 0)) * 100),
    rating,
    Math.max(0, Math.round(s.pop || 0)),
    st.map(x => Math.max(0, Math.round(x.nav))),
    st.map(x => Math.max(0, Math.round((x.built || 0) * 14))),
    st.map(x => Math.max(0, Math.min(65535, Math.round(x.land)))),
    st.map(x => Math.max(0, Math.min(65535, Math.round(x.level * 100))))
  ];
  const hash = await wal.writeContract({ ...O, functionName: 'push', args });
  await pub.waitForTransactionReceipt({ hash });
  pushes++;
  console.log('  day ' + String(s.day).padStart(5) + '  appr ' + String(Math.round(s.approval)).padStart(3) +
    '  ' + RATINGS[rating].padEnd(4) + '  NAV $' + st.reduce((a, x) => a + x.nav, 0).toLocaleString().padStart(9) +
    '  ' + hash.slice(0, 12) + '…');
}

console.log('\n  ' + pushes + ' snapshots published by mayor.' + D.root.name + '\n');

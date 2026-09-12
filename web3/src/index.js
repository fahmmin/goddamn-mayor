/* The chain layer.
 *
 * The single rule this file exists to honour: it writes state.chain and it
 * stops. It never calls into the simulation, never blocks a frame on a
 * network round-trip, and never throws where the game can see it. Delete
 * bundle.js and index.html still runs exactly the game it was before.
 *
 * game.js calls ui.update(state) unconditionally every frame and re-reads
 * state fresh, so simply assigning state.chain is enough for the next frame
 * to render it. There are no edits to game.js anywhere in this layer.
 */
import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { mountWallet, getWallet } from './wallet.js';
import { ORACLE_ABI, VAULT_ABI, ERC20_ABI } from './abi.js';

const POLL_MS = 10000;          // how often we ask the chain for a new snapshot
const PUSH_EVERY_DAYS = 30;     // game-days between oracle writes

let cfg = null;
let pub = null;
let state = null;               // the game's state object, once we find it

/* Config is fetched rather than compiled in, so a redeploy is a file edit and
 * not a rebuild. Missing config is a normal, silent outcome: it means the
 * chain layer is simply not configured yet and the game plays on. */
async function loadConfig () {
  try {
    const r = await fetch('web3/config.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const c = await r.json();
    return c && c.oracle ? c : null;
  } catch { return null; }
}

/* The game does not expose its state object deliberately, so find it the way
 * anything else would: MM.state is set by game.js on boot. */
function findState () {
  const MM = window.MM;
  return (MM && MM.state) || null;
}

function ensureChain () {
  if (!state) return null;
  if (!state.chain) state.chain = { everLive: false, at: 0, districts: null };
  return state.chain;
}

// ---------------------------------------------------------------- reading

async function snapshot () {
  const ch = ensureChain();
  if (!ch || !pub) return;
  try {
    const [city, districts, office] = await Promise.all([
      pub.readContract({ address: cfg.oracle, abi: ORACLE_ABI, functionName: 'city' }),
      pub.readContract({ address: cfg.oracle, abi: ORACLE_ABI, functionName: 'allDistricts' }),
      pub.readContract({ address: cfg.oracle, abi: ORACLE_ABI, functionName: 'officeState' })
    ]);

    const w = getWallet();
    ch.districts = districts.map((d, i) => ({
      id: i,
      ens: (cfg.districts && cfg.districts[i] && cfg.districts[i].ens) || '',
      nav: Number(d.nav),
      pop: Number(d.pop),
      land: Number(d.land),
      level: Number(d.level) / 100
    }));
    ch.rating = RATINGS[Number(city[2])] || null;
    ch.day = Number(city[0]);
    ch.office = {
      label: cfg.officeLabel || 'mayor',
      status: Number(office[0]),
      expiry: Number(office[1]),
      holder: office[2],
      canPush: w ? await canPush(w.address) : false
    };
    ch.wallet = w ? { address: w.address } : null;
    ch.at = performance.now();
    ch.everLive = true;
    ch.error = null;
  } catch (e) {
    /* A dead RPC must look like staleness, never like a crash. The panel
     * keeps the last-known numbers and its badge flips to "stale" on its
     * own once ch.at falls behind. */
    if (ch) ch.error = String(e && e.shortMessage || e);
  }
}

const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'D'];

async function canPush (who) {
  try {
    return await pub.readContract({ address: cfg.oracle, abi: ORACLE_ABI, functionName: 'canPush', args: [who] });
  } catch { return false; }
}

// ---------------------------------------------------------------- writing

/* The write path. Everything the oracle stores is derived here from the same
 * numbers the HUD is showing, via MM.districts.stats() - the module the game
 * already uses. Nothing is invented for the chain. */
function cityPayload () {
  const MM = window.MM;
  const s = state;
  if (!MM || !MM.districts || !s) return null;
  const st = MM.districts.stats(s);
  const d = { net: (s.dailyIncome || 0) - (s.dailyCost || 0) };
  return {
    day: Math.max(0, Math.round(s.day || 0)),
    approval: Math.round(Math.max(0, Math.min(100, s.approval || 0)) * 100),
    rating: ratingIndex(s, d),
    pop: Math.max(0, Math.round(s.pop || 0)),
    navs: st.map(x => Math.max(0, Math.round(x.nav))),
    pops: st.map(x => Math.max(0, Math.round((x.built || 0) * 14))),
    lands: st.map(x => Math.max(0, Math.min(65535, Math.round(x.land)))),
    levels: st.map(x => Math.max(0, Math.min(65535, Math.round(x.level * 100))))
  };
}

function ratingIndex (s, d) {
  const appr = typeof s.approval === 'number' ? s.approval : 50;
  const income = Math.max(1, s.dailyIncome || 1);
  let score = (appr / 100) * 6 + Math.max(-1, Math.min(1, d.net / income)) * 2;
  if ((s.treasury || 0) < 0) score -= 2;
  return Math.max(0, Math.min(8, Math.round(8 - score)));
}

let lastPushDay = -1e9;
let pushing = false;

export async function pushNow (force) {
  const w = getWallet();
  if (!w || pushing || !cfg) return { ok: false, why: 'no wallet' };
  const p = cityPayload();
  if (!p) return { ok: false, why: 'no city' };
  if (!force && p.day - lastPushDay < PUSH_EVERY_DAYS) return { ok: false, why: 'too soon' };

  pushing = true;
  try {
    const hash = await w.writeContract({
      address: cfg.oracle, abi: ORACLE_ABI, functionName: 'push',
      args: [p.day, p.approval, p.rating, p.pop, p.navs, p.pops, p.lands, p.levels]
    });
    lastPushDay = p.day;
    await pub.waitForTransactionReceipt({ hash });
    await snapshot();
    return { ok: true, hash };
  } catch (e) {
    /* The interesting failure. When the term has expired or the name was
     * burned, this is CityOracle.TermExpired / OfficeVacant / NotTheMayor -
     * surfaced verbatim, because that revert IS the demo. */
    const msg = String(e && (e.shortMessage || e.message) || e);
    const ch = ensureChain();
    if (ch) ch.lastPushError = msg;
    return { ok: false, why: msg };
  } finally { pushing = false; }
}

// ---------------------------------------------------------------- vaults

export async function deposit (districtId, amountHuman) {
  const w = getWallet();
  if (!w || !cfg) throw new Error('connect a wallet first');
  const vault = cfg.vaults[districtId];
  const amount = parseUnits(String(amountHuman), 18);

  const allowance = await pub.readContract({
    address: cfg.token, abi: ERC20_ABI, functionName: 'allowance', args: [w.address, vault]
  });
  if (allowance < amount) {
    const h = await w.writeContract({
      address: cfg.token, abi: ERC20_ABI, functionName: 'approve', args: [vault, amount * 100n]
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const hash = await w.writeContract({
    address: vault, abi: VAULT_ABI, functionName: 'deposit', args: [amount, w.address]
  });
  await pub.waitForTransactionReceipt({ hash });
  await snapshot();
  return hash;
}

export async function drawFaucet () {
  const w = getWallet();
  if (!w || !cfg) throw new Error('connect a wallet first');
  const hash = await w.writeContract({ address: cfg.token, abi: ERC20_ABI, functionName: 'faucet' });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function balances () {
  const w = getWallet();
  if (!w || !cfg) return null;
  const cash = await pub.readContract({
    address: cfg.token, abi: ERC20_ABI, functionName: 'balanceOf', args: [w.address]
  });
  const shares = await Promise.all(cfg.vaults.map(v =>
    pub.readContract({ address: v, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [w.address] })
      .catch(() => 0n)));
  return { cash: Number(formatUnits(cash, 18)), positions: shares.map(s => Number(formatUnits(s, 18))) };
}

// ---------------------------------------------------------------- boot

async function boot () {
  cfg = await loadConfig();
  if (!cfg) return;                               // not configured; game plays on

  pub = createPublicClient({ chain: sepolia, transport: http(cfg.rpc) });

  /* game.js sets MM.state during its own boot, which may land after this
   * script. Poll briefly rather than racing it. */
  for (let i = 0; i < 60 && !state; i++) {
    state = findState();
    if (!state) await new Promise(r => setTimeout(r, 100));
  }
  if (!state) return;

  if (window.MM && window.MM.districts && cfg.root) window.MM.districts.setRoot(cfg.root);

  mountWallet({ cfg, onChange: snapshot, api: { pushNow, deposit, drawFaucet, balances } });

  await snapshot();
  setInterval(snapshot, POLL_MS);

  /* Push on a game-day cadence rather than a wall-clock one, so a paused game
   * never writes and a fast-forwarded one does not spam. */
  setInterval(() => {
    if (!state || !state.chain || !state.chain.office) return;
    if (!state.chain.office.canPush) return;
    if ((state.day || 0) - lastPushDay >= PUSH_EVERY_DAYS) pushNow(false);
  }, 4000);

  window.MM_CHAIN = { snapshot, pushNow, deposit, drawFaucet, balances, cfg };
}

boot().catch(e => console.warn('[chain] boot failed, game continues:', e));

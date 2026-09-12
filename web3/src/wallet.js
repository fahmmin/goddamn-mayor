/* Privy embedded wallets, and the small amount of DOM that drives them.
 *
 * The target is the plan's own acceptance test: a judge opens the URL cold,
 * with no wallet and no extension, and holds a position in a district in
 * under sixty seconds. That rules out seed phrases, browser extensions and
 * network-switching prompts, which is the whole reason Privy is here.
 *
 * Email OTP rather than OAuth: OAuth needs per-provider dashboard setup and a
 * redirect round-trip through an origin the CSP has to allow. A six-digit
 * code works on a laptop that has never seen this app.
 */
import Privy, { LocalStorage, getUserEmbeddedEthereumWallet, getEntropyDetailsFromUser }
  from '@privy-io/js-sdk-core';
import { createWalletClient, custom, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

let privy = null;
let wallet = null;       // { address, writeContract }
let api = null;
let cfg = null;
let onChange = () => {};

export function getWallet () { return wallet; }

// ---------------------------------------------------------------- DOM bits

function el (tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

let ui = {};

function mountDom () {
  /* Live inside the market panel the game already draws, rather than adding a
   * second floating box. If the panel is not there (narrow screen), there is
   * nothing to attach to and the chain layer stays headless. */
  const panel = document.querySelector('.mm-market');
  if (!panel) return false;
  const foot = panel.querySelector('.mkt-foot');
  if (!foot) return false;

  foot.textContent = '';
  ui.foot = foot;
  ui.status = el('div', 'w-status', foot, 'not connected');
  ui.row = el('div', 'w-row', foot);
  ui.connect = el('button', 'w-btn primary', ui.row, 'Connect wallet');
  ui.connect.addEventListener('click', openLogin);
  return true;
}

/* The login modal. Two fields, one at a time, nothing else on screen. */
function openLogin () {
  if (ui.modal) { ui.modal.remove(); ui.modal = null; }
  const scrim = el('div', 'w-scrim', document.body);
  ui.modal = scrim;
  const box = el('div', 'w-modal', scrim);
  el('div', 'w-title', box, 'Enter the city economy');
  el('div', 'w-sub', box, 'A wallet is created for you. No extension, no seed phrase.');

  const input = el('input', 'w-input', box);
  input.type = 'email';
  input.placeholder = 'you@example.com';
  input.autocomplete = 'email';

  const err = el('div', 'w-err', box, '');
  const actions = el('div', 'w-actions', box);
  const cancel = el('button', 'w-btn', actions, 'Cancel');
  const go = el('button', 'w-btn primary', actions, 'Send code');

  cancel.addEventListener('click', () => { scrim.remove(); ui.modal = null; });
  scrim.addEventListener('click', e => { if (e.target === scrim) { scrim.remove(); ui.modal = null; } });

  let stage = 'email';
  let email = '';

  async function submit () {
    err.textContent = '';
    go.disabled = true;
    try {
      if (stage === 'email') {
        email = input.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address.');
        go.textContent = 'Sending...';
        await privy.auth.email.sendCode(email);
        stage = 'code';
        input.value = '';
        input.type = 'text';
        input.inputMode = 'numeric';
        input.placeholder = '6-digit code';
        box.querySelector('.w-sub').textContent = 'We sent a code to ' + email + '.';
        go.textContent = 'Sign in';
        input.focus();
      } else {
        go.textContent = 'Signing in...';
        await privy.auth.email.loginWithCode(email, input.value.trim());
        await ensureWallet();
        scrim.remove();
        ui.modal = null;
      }
    } catch (e) {
      err.textContent = String(e && (e.message || e)).slice(0, 160);
      go.textContent = stage === 'email' ? 'Send code' : 'Sign in';
    } finally { go.disabled = false; }
  }

  go.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  /* The game listens for bare keys on window (space pauses, digits pick
   * tools). Stop them at the modal or typing an email plays the game. */
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    scrim.addEventListener(ev, e => e.stopPropagation());
  }
  setTimeout(() => input.focus(), 30);
}

// ---------------------------------------------------------------- wallet

/* The secure context is an invisible iframe that holds key material; the app
 * never sees a private key. CSP already allows frame-src auth.privy.io. */
function mountSecureIframe () {
  const iframe = document.createElement('iframe');
  iframe.src = privy.embeddedWallet.getURL();
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  privy.setMessagePoster(iframe.contentWindow);
  window.addEventListener('message', e => {
    if (e.source !== iframe.contentWindow) return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      privy.embeddedWallet.onMessage(data);
    } catch { /* not ours */ }
  });
}

async function ensureWallet () {
  let { user } = await privy.user.get();
  if (!user) return null;

  let account = getUserEmbeddedEthereumWallet(user);
  if (!account) {
    const created = await privy.embeddedWallet.create({});
    user = created.user;
    account = getUserEmbeddedEthereumWallet(user);
  }
  if (!account) return null;

  const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(user);
  const provider = await privy.embeddedWallet.getEthereumProvider({ wallet: account, entropyId, entropyIdVerifier });

  /* Sepolia only. Ask once; if the wallet is already there this is a no-op. */
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
  } catch { /* embedded wallets are already on the configured chain */ }

  const client = createWalletClient({ account: account.address, chain: sepolia, transport: custom(provider) });
  wallet = {
    address: account.address,
    writeContract: args => client.writeContract({ ...args, account: account.address, chain: sepolia })
  };
  render();
  onChange();
  return wallet;
}

// ---------------------------------------------------------------- rendering

function short (a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }

async function render () {
  if (!ui.status) return;
  if (!wallet) {
    ui.status.textContent = 'not connected';
    return;
  }
  ui.row.textContent = '';
  ui.status.textContent = short(wallet.address);

  const faucet = el('button', 'w-btn', ui.row, 'Get CITYUSD');
  const dep = el('button', 'w-btn primary', ui.row, 'Underwrite');
  faucet.addEventListener('click', async () => {
    faucet.disabled = true; faucet.textContent = '...';
    try { await api.drawFaucet(); await render(); }
    catch (e) { ui.status.textContent = String(e.shortMessage || e.message || e).slice(0, 60); }
    finally { faucet.disabled = false; faucet.textContent = 'Get CITYUSD'; }
  });
  dep.addEventListener('click', openDeposit);

  try {
    const b = await api.balances();
    if (b) {
      const held = b.positions.reduce((a, x) => a + x, 0);
      ui.status.textContent = short(wallet.address) + '  ·  $' + Math.round(b.cash).toLocaleString() +
        (held > 0.5 ? '  ·  ' + Math.round(held).toLocaleString() + ' underwritten' : '');
    }
  } catch { /* balances are decoration; never let them break the panel */ }
}

function openDeposit () {
  if (ui.modal) { ui.modal.remove(); ui.modal = null; }
  const scrim = el('div', 'w-scrim', document.body);
  ui.modal = scrim;
  const box = el('div', 'w-modal', scrim);
  el('div', 'w-title', box, 'Underwrite a district');
  el('div', 'w-sub', box, 'You are taking exposure to how well this administration governs, not to an asset.');

  const sel = el('select', 'w-input', box);
  (cfg.districts || []).forEach((d, i) => {
    const o = el('option', null, sel, d.ens || ('district ' + i));
    o.value = String(i);
  });
  const amt = el('input', 'w-input', box);
  amt.type = 'number'; amt.value = '500'; amt.min = '1';

  const err = el('div', 'w-err', box, '');
  const actions = el('div', 'w-actions', box);
  const cancel = el('button', 'w-btn', actions, 'Cancel');
  const go = el('button', 'w-btn primary', actions, 'Deposit');

  cancel.addEventListener('click', () => { scrim.remove(); ui.modal = null; });
  scrim.addEventListener('click', e => { if (e.target === scrim) { scrim.remove(); ui.modal = null; } });
  for (const ev of ['keydown', 'keyup', 'keypress']) scrim.addEventListener(ev, e => e.stopPropagation());

  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Confirming...'; err.textContent = '';
    try {
      await api.deposit(Number(sel.value), amt.value);
      scrim.remove(); ui.modal = null;
      await render();
    } catch (e) {
      err.textContent = String(e && (e.shortMessage || e.message) || e).slice(0, 200);
      go.disabled = false; go.textContent = 'Deposit';
    }
  });
}

// ---------------------------------------------------------------- entry

export async function mountWallet (opts) {
  cfg = opts.cfg;
  api = opts.api;
  onChange = opts.onChange || (() => {});
  if (!cfg.privyAppId) return;                 // not configured; read-only city

  if (!mountDom()) return;

  privy = new Privy({
    appId: cfg.privyAppId,
    clientId: cfg.privyClientId || undefined,
    storage: new LocalStorage()
  });

  try {
    await privy.initialize();
    mountSecureIframe();
  } catch (e) {
    ui.status && (ui.status.textContent = 'wallet unavailable');
    console.warn('[privy] init failed', e);
    return;
  }

  /* Restoring a session is a SEPARATE try. A first-time visitor has no tokens
   * in storage and Privy reports that by throwing missing_or_invalid_token -
   * which is the single most common way this code path is reached, not a
   * failure. Folding it in with initialize() showed every new judge "wallet
   * unavailable" on the one screen that has to work in sixty seconds. */
  try {
    const { user } = await privy.user.get();
    if (user) await ensureWallet();             // returning visitor, no prompt
  } catch (e) {
    const code = e && (e.code || e.error);
    if (!/missing_or_invalid_token|No tokens found/i.test(String(code) + String(e && e.message))) {
      console.warn('[privy] session restore failed', e);
    }
  }
  render();
}

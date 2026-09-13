/* The cities, kept somewhere other than this browser.
 *
 * localStorage is still the save. This is the sync layer on top of it, so the
 * mayor who signs in on a second machine gets their city rather than a fresh
 * one. Everything here is best-effort: a cloud that is down, unconfigured or
 * refusing the token must cost the player nothing, because the game is
 * perfectly playable with only the local save and always has been.
 *
 * MANY cities per mayor, not one. Breaking ground and taking over City Hall
 * are different games and a mayor may want both on the go; a single row per
 * user would mean starting either one quietly destroyed the other on the very
 * next autosave.
 *
 * All traffic goes through the city API, never straight at the database. See
 * supabase/schema.sql for why - a Privy token means nothing to Postgres, so
 * RLS cannot be the boundary and the API has to be.
 */

let base = '';            // API origin, '' when not configured
let syncedDid = null;     // whose cities we hold - the guard against crossing accounts
let currentId = null;     // the city being played, once it has a row
let timer = 0;
let lastSent = '';

const ID_KEY = 'mamdani.city.id';

export function configure (cfg) {
  base = (cfg && (cfg.cloud || (cfg.supabase && cfg.supabase.functions))) || '';
  return !!base;
}

export function configured () { return !!base; }

/* Which account the in-memory city belongs to. Null until a list or pull has
 * succeeded, and that is load-bearing: pushing before then is how the previous
 * player city would be written into this one row. */
export function syncedAs () { return syncedDid; }

/* Which row is being written to, or null when this city has never been saved. */
export function playing () { return currentId; }

/* Which row this browser was last playing. Remembered locally so a reload
 * keeps writing to the same city instead of making a new one every time. */
function remembered () {
  try { return localStorage.getItem(ID_KEY) || null; } catch (e) { return null; }
}

function remember (id) {
  currentId = id || null;
  try {
    if (id) localStorage.setItem(ID_KEY, id);
    else localStorage.removeItem(ID_KEY);
  } catch (e) { /* private mode - the id just will not survive a reload */ }
}

async function call (token, method, path, body) {
  if (!base || !token) return null;
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error('cloud ' + method + ' ' + r.status);
  return r.json();
}

/* The saved blob stores the typed arrays as plain arrays, exactly as
 * MM.saveState wrote them. Rebuild them the way MM.loadState does - and be as
 * forgiving about a short pow array, because an older save legitimately has
 * one. */
function hydrate (o) {
  const MM = window.MM;
  if (!o || !MM || o.version !== 1) return null;
  const cells = MM.GRID * MM.GRID;
  const s = Object.assign({}, o);
  s.grid = Uint8Array.from(o.grid || []);
  s.level = Uint8Array.from(o.level || []);
  s.pow = Uint8Array.from(o.pow || []);
  if (s.grid.length !== cells || s.level.length !== cells) return null;
  if (s.pow.length !== cells) s.pow = new Uint8Array(cells);
  s.pending = null;
  s.cooldowns = s.cooldowns || {};
  return s;
}

/* What actually goes over the wire.
 *
 * Everything the local save holds, minus one field. `chain` is the on-chain
 * snapshot, re-read every ten seconds - uploading it would store a kilobyte of
 * numbers that are stale before they land, and restore them over fresher ones
 * on the way back. The grid, the growth levels and the land-value map all go,
 * because those ARE the city. */
function blobOf (s) {
  return JSON.stringify(Object.assign({}, s, {
    grid: Array.from(s.grid),
    level: Array.from(s.level),
    pow: Array.from(s.pow),
    pending: null,
    chain: undefined
  }));
}

/* Move a downloaded city into the live one.
 *
 * In place, and by .set() for the typed arrays, for the same reason
 * demo.js newGame is: render.js diffs a per-tile signature against these exact
 * buffers and lots.js caches a plan over them, so handing either a new object
 * renders the city before this one. */
export function adopt (save) {
  const MM = window.MM;
  const s = MM && MM.state;
  const src = hydrate(save);
  if (!s || !src) return false;

  s.grid.set(src.grid);
  s.level.set(src.level);
  s.pow.set(src.pow);
  for (const k in src) {
    if (k === 'grid' || k === 'level' || k === 'pow') continue;
    if (k === 'chain') continue;        // live data; never let a save overwrite it
    s[k] = src[k];
  }
  s.rev = (s.rev || 0) + 1;             // every downstream cache is keyed to this
  s.pending = null;
  s.gameOver = null;
  lastSent = '';                        // different city: the last upload means nothing
  try { MM.saveState(s); } catch (e) { /* private mode; the city still runs */ }
  return true;
}

/* This mayor cities, most recently played first. Deliberately without the
 * saves: choosing between six cities should not mean downloading six grids. */
export async function list (token, did) {
  try {
    const r = await call(token, 'GET', '/cities');
    syncedDid = did || 'unknown';
    const cities = (r && r.cities) || [];
    /* Keep writing to the one this browser was already on, if it still
     * exists; otherwise the most recent is the sensible default. */
    const mine = remembered();
    currentId = cities.some(c => c.id === mine) ? mine
      : (cities[0] ? cities[0].id : null);
    return cities;
  } catch (e) {
    return null;             // unreachable and empty are not the same, so say null
  }
}

/* One city save, by id - or the most recently played when no id is given. */
export async function pull (token, id) {
  try {
    const row = await call(token, 'GET', '/city' + (id ? '?id=' + encodeURIComponent(id) : ''));
    if (!row || !row.save) return null;
    remember(row.id || id || null);
    return {
      id: row.id, name: row.name, save: row.save,
      day: Number(row.day) || 0, at: row.updated_at || null
    };
  } catch (e) {
    return null;
  }
}

/* A NEW row, so that breaking ground or taking over City Hall ADDS a city
 * rather than overwriting the one already stored. */
export async function create (getToken, s, name) {
  if (!base || !syncedDid || !s) return null;
  try {
    const token = await getToken();
    if (!token) return null;
    const blob = blobOf(s);
    const r = await call(token, 'POST', '/city',
      { save: JSON.parse(blob), day: s.day || 0, name: name || 'My city' });
    if (r && r.id) { remember(r.id); lastSent = blob; }
    return r;
  } catch (e) {
    return null;
  }
}

/* Debounced: the sim autosaves every few seconds and on every unload, and none
 * of that deserves a request. */
export function schedulePush (getToken, s, wait) {
  if (!base || !syncedDid || !s) return;
  clearTimeout(timer);
  timer = setTimeout(function () { pushNow(getToken, s); }, wait == null ? 4000 : wait);
}

/* Skipped when the city is byte-identical to the last upload, which is most
 * ticks of a paused game, and refused entirely before a list or pull has
 * succeeded - pushing first is how one account city lands in another row. */
export async function pushNow (getToken, s) {
  if (!base || !syncedDid || !s) return false;
  let blob;
  try { blob = blobOf(s); } catch (e) { return false; }
  if (blob === lastSent) return false;

  try {
    const token = await getToken();
    if (!token) return false;
    const r = await call(token, currentId ? 'PUT' : 'POST',
      '/city' + (currentId ? '?id=' + encodeURIComponent(currentId) : ''),
      { save: JSON.parse(blob), day: s.day || 0 });
    if (r && r.id && !currentId) remember(r.id);
    lastSent = blob;
    return true;
  } catch (e) {
    return false;            // offline is not an error the player owns
  }
}

/* Signing out, or signing in as somebody else. Forget everything account
 * shaped, so a later push cannot land in the wrong row. */
export function reset () {
  clearTimeout(timer);
  timer = 0;
  syncedDid = null;
  currentId = null;
  lastSent = '';
}

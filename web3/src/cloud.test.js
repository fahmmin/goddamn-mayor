/* node web3/src/cloud.test.js
 *
 * The dangerous half of cloud sync is adopt(): it replaces the live city in
 * place, and the two ways to get that wrong are silent. Hand the renderer a
 * different typed array and it draws the city before this one; push before a
 * pull has landed and one account's city is written into another's row.
 * Both are asserted here.
 */
import * as cloud from './cloud.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg); }
};

const GRID = 48, CELLS = GRID * GRID;

function liveState () {
  return {
    version: 1, day: 5, pop: 100, treasury: 1000, rev: 3,
    grid: new Uint8Array(CELLS), level: new Uint8Array(CELLS), pow: new Uint8Array(CELLS),
    log: [], cooldowns: {}, pending: { keep: 'me' }, gameOver: 'yes'
  };
}

function savedCity (day) {
  const grid = new Array(CELLS).fill(0);
  grid[10] = 7;                                   // something recognisable
  return {
    version: 1, day: day == null ? 42 : day, pop: 900, treasury: 50,
    grid, level: new Array(CELLS).fill(2), pow: new Array(CELLS).fill(1),
    log: [{ day: 1, text: 'hello' }], cooldowns: {}
  };
}

let saved = 0;
global.window = { MM: { GRID, state: liveState(), saveState () { saved++; return true; } } };

console.log('\nMAYOR - cloud sync\n');

// ---- adopt --------------------------------------------------------------
const s = global.window.MM.state;
const grid = s.grid, level = s.level, pow = s.pow;   // the exact buffers

ok(cloud.adopt(savedCity()) === true, 'a stored city is adopted');
ok(s.grid === grid && s.level === level && s.pow === pow,
  'the typed arrays are the SAME objects - render.js diffs against these');
ok(s.grid[10] === 7, 'and their contents came from the stored city');
ok(s.day === 42 && s.pop === 900, 'scalars came across too');
ok(s.rev === 4, 'rev is bumped, so every downstream cache is invalidated');
ok(s.pending === null, 'a pending event from the old city is dropped');
ok(s.gameOver === null, 'and so is its game-over');
ok(saved === 1, 'the adopted city is written to the local save');

// ---- refusing a bad blob ------------------------------------------------
ok(cloud.adopt(null) === false, 'null is refused');
ok(cloud.adopt({ version: 2, grid: [], level: [], pow: [] }) === false, 'a future version is refused');
ok(cloud.adopt({ version: 1, grid: [1, 2], level: [1, 2], pow: [] }) === false,
  'a grid of the wrong size is refused rather than half-applied');
ok(s.day === 42, 'and a refused adopt left the city alone');

// ---- a short pow array, which older saves legitimately have --------------
const short = savedCity();
short.pow = [];
ok(cloud.adopt(short) === true, 'a save with no land-value array still loads');
ok(s.pow.length === CELLS, 'and gets a full-size one');

// ---- the cross-account guard --------------------------------------------
cloud.reset();
ok(cloud.syncedAs() === null, 'after reset nothing is synced');
const never = async () => { throw new Error('token should not be asked for'); };
const pushed = await cloud.pushNow(never, s);
ok(pushed === false, 'a push before any pull is refused - it would cross accounts');

// ---- what actually goes over the wire ------------------------------------
/* The blob must carry the whole city - the grid, the growth LEVELS and the
   land-value map especially, since those ARE the city - and must not carry
   the on-chain snapshot, which is re-read every ten seconds. */
{
  const live = global.window.MM.state;
  live.chain = { day: 999, districts: [1, 2, 3] };   // as the chain layer leaves it
  live.level[5] = 4;
  live.pow[6] = 200;

  let sent = null;
  global.fetch = async (url, opt) => ({
    ok: true,
    json: async () => {
      if (String(url).endsWith('/cities')) return { cities: [] };
      sent = JSON.parse(opt.body);
      return { id: 'row-1', name: 'Broke ground', day: live.day };
    }
  });

  cloud.configure({ cloud: 'http://localhost:8787' });
  await cloud.list('token', 'did:privy:me');          // the guard opens only after this
  const made = await cloud.create(async () => 'token', live, 'Broke ground');

  ok(made && made.id === 'row-1', 'starting a city creates its OWN row, not an overwrite');
  ok(!!(sent && sent.save), 'and uploads a save');
  ok(sent.save.chain === undefined, 'the on-chain snapshot is NOT uploaded');
  ok(sent.save.level[5] === 4, 'growth levels are uploaded');
  ok(sent.save.pow[6] === 200, 'the land-value map is uploaded');
  ok(sent.save.grid.length === CELLS, 'the whole grid is uploaded');

  const expect = Object.keys(live).filter(k => k !== 'chain' && k !== 'pending');
  const missing = expect.filter(k => !(k in sent.save));
  ok(missing.length === 0, 'every other field of the live city is uploaded' +
    (missing.length ? ' - MISSING ' + missing.join(', ') : ''));

  /* And a stored chain blob must never come back over the live one. */
  const withChain = savedCity();
  withChain.chain = { day: 1, stale: true };
  cloud.adopt(withChain);
  ok(live.chain && live.chain.day === 999, 'adopting does not overwrite live chain data');
}

console.log('\n  ' + pass + ' passing' + (fail ? ', ' + fail + ' FAILING' : '') + '\n');
process.exit(fail ? 1 : 0);

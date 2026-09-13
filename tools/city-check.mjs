/* npm run api:check  -  the storage path, against the real database.
 *
 * Kept OUT of `npm test`, which must stay offline and deterministic: this one
 * needs DATABASE_URL and a reachable Postgres. It is the half that unit tests
 * cannot reach - that a whole city survives jsonb, that a second city is a
 * second ROW, and that knowing an id is not enough to touch another mayor city.
 *
 * It writes under a reserved DID and deletes it again, so it is safe to run
 * against the same database the game uses.
 */
import pg from 'pg';
import { DATABASE_URL, requireDb } from '../lib/env.mjs';

requireDb();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DID = 'did:privy:__integration__';
const CELLS = 48 * 48;

let pass = 0, fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  ok    ' + m); }
  else { fail++; console.log('  FAIL  ' + m); }
};

const city = (day) => ({
  version: 1, tick: 9, day, speed: 1,
  grid: Array.from({ length: CELLS }, (_, i) => i % 13),
  level: Array.from({ length: CELLS }, (_, i) => i % 5),
  pow: Array.from({ length: CELLS }, (_, i) => i % 256),
  pop: 40574, jobs: 900, employed: 800, treasury: 51234, approval: 62,
  rent: 104.5, traffic: 3, happiness: 61, pollution: 7, ridership: 220,
  dailyIncome: 900, dailyCost: 700, taxRate: { res: 9, com: 11, ind: 12 },
  policies: { freeBuses: true }, log: [{ day, text: 'A test entry.', kind: 'info' }],
  pending: null, selected: 1, streak: 3, termDay: 1461, gameOver: null,
  cooldowns: { flood: 90 }
});

function diff (x, y, path, out) {
  if (x === y) return out;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of Object.keys(x)) if (!(k in y)) out.push(path + '.' + k + ' MISSING');
    for (const k of Object.keys(y)) if (!(k in x)) out.push(path + '.' + k + ' APPEARED');
    for (const k of Object.keys(x)) if (k in y) diff(x[k], y[k], path + '.' + k, out);
    return out;
  }
  out.push(path + ': ' + JSON.stringify(x) + ' -> ' + JSON.stringify(y));
  return out;
}

console.log('\nMAYOR - the saved city, against Postgres\n');

try {
  await pool.query('delete from public.cities where privy_did = $1', [DID]);

  const a = city(612);
  const kb = (JSON.stringify(a).length / 1024).toFixed(1);
  const { rows: ins } = await pool.query(
    `insert into public.cities (privy_did, name, save, day) values ($1,$2,$3,$4)
     returning id`, [DID, 'Broke ground', a, a.day]);
  ok(!!ins[0].id, 'a city inserts (' + kb + ' KB of JSON)');

  await pool.query(
    'insert into public.cities (privy_did, name, save, day) values ($1,$2,$3,$4)',
    [DID, 'City Hall', city(37), 37]);
  const { rows: list } = await pool.query(
    `select id, name, day from public.cities where privy_did = $1 order by updated_at desc`, [DID]);
  ok(list.length === 2, 'starting a second city ADDS a row rather than overwriting');

  const { rows: got } = await pool.query(
    'select save from public.cities where privy_did = $1 and id = $2', [DID, ins[0].id]);
  const back = got[0].save;

  /* Deep equality, NOT string equality. jsonb stores object keys sorted by
   * length and then bytewise, so the key ORDER coming back is different and
   * always will be - which is harmless, because every reader here looks keys
   * up by name. Asserting on JSON.stringify would fail forever for no reason. */
  const diffs = diff(a, back, 'save', []);
  ok(diffs.length === 0, 'every value survives the round trip' +
    (diffs.length ? ' - ' + diffs.slice(0, 4).join('; ') : ''));
  ok(back.grid.length === CELLS && back.level.length === CELLS && back.pow.length === CELLS,
    'the grid, the growth levels and the land-value map all come back full size');
  ok(back.rent === 104.5, 'a fractional value is not rounded');
  ok(back.gameOver === null && 'gameOver' in back, 'an explicit null is kept, not dropped');
  ok(Object.keys(a).sort().join() === Object.keys(back).sort().join(), 'no field is added or lost');

  await pool.query(
    `update public.cities set save = $3, day = $4, updated_at = now()
      where privy_did = $1 and id = $2`, [DID, ins[0].id, city(700), 700]);
  const { rows: upd } = await pool.query('select day from public.cities where id = $1', [ins[0].id]);
  ok(upd[0].day === 700, 'an update lands on the named row');

  const { rowCount } = await pool.query(
    'update public.cities set day = 1 where privy_did = $1 and id = $2',
    ['did:privy:somebody-else', ins[0].id]);
  ok(rowCount === 0, 'another mayor cannot write it, even knowing the id');

  const { rowCount: del } = await pool.query(
    'delete from public.cities where privy_did = $1 and id = $2',
    ['did:privy:somebody-else', ins[0].id]);
  ok(del === 0, 'nor delete it');

  const { rows: size } = await pool.query(
    `select pg_size_pretty(sum(pg_column_size(save))::bigint) stored
       from public.cities where privy_did = $1`, [DID]);
  console.log('\n  two cities occupy ' + size[0].stored + ' on disk - jsonb compresses them');
} finally {
  await pool.query('delete from public.cities where privy_did = $1', [DID]);
  await pool.end();
}

console.log('\n  ' + pass + ' passing' + (fail ? ', ' + fail + ' FAILING' : '') + '\n');
process.exit(fail ? 1 : 0);

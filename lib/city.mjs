/* The saved city: one implementation, two front doors.
 *
 * Vercel serves this as /api/city and /api/cities; tools/city-server.js serves
 * the same functions on localhost:8787 for development. Writing the rules
 * twice is how the two quietly stop agreeing, so they are written once here.
 *
 * The rule that matters: the DID comes out of the VERIFIED token and every
 * query is scoped by it. An id is a guess away from another mayor's city
 * otherwise, and "it is a uuid" is not an access rule.
 */
import pg from 'pg';
import { didFromToken } from './privy.mjs';
import { DATABASE_URL, PRIVY_APP_ID } from './env.mjs';

/* One pool per warm process. Serverless reuses the process between
 * invocations, so this is reused too; a cold start pays for one connection.
 * Point DATABASE_URL at Supabase's TRANSACTION pooler (port 6543) in
 * production - that is the one built for short-lived callers like this. */
let pool = null;
function db () {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000
    });
    /* A dead backend must not take the process down with it. */
    pool.on('error', () => {});
  }
  return pool;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* A 48x48 city with its log is about 15KB, 35KB for a dense one with a full
 * log. Half a megabyte is generous headroom - and bounded, because an
 * unbounded body is how one caller fills the table. */
export const MAX_BYTES = 512 * 1024;

/* Whoever is calling, or null. Never throws for an ordinary bad token: an
 * expired session is a normal thing for a browser to be holding. */
export async function caller (authorization) {
  const header = authorization || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  return didFromToken(token, PRIVY_APP_ID);
}

export async function listCities (did) {
  const { rows } = await db().query(
    `select id, name, day, created_at, updated_at
       from public.cities where privy_did = $1
      order by updated_at desc limit 50`, [did]);
  return { cities: rows };
}

export async function getCity (did, id) {
  const { rows } = id
    ? await db().query(
      'select id, name, save, day, updated_at from public.cities where privy_did = $1 and id = $2',
      [did, id])
    : await db().query(
      `select id, name, save, day, updated_at from public.cities
        where privy_did = $1 order by updated_at desc limit 1`, [did]);
  return rows[0] || { save: null };
}

/* A NEW row. Called when a mayor breaks ground or takes over City Hall, so
 * that starting a city ADDS one rather than overwriting the last. */
export async function createCity (did, save, day, name) {
  const { rows } = await db().query(
    `insert into public.cities (privy_did, name, save, day)
          values ($1, $2, $3, $4)
       returning id, name, day, updated_at`,
    [did, String(name || 'My city').slice(0, 80), save, Number(day) || 0]);
  return { ok: true, ...rows[0] };
}

export async function updateCity (did, id, save, day, name) {
  const { rows } = await db().query(
    `update public.cities
        set save = $3, day = $4, name = coalesce($5, name), updated_at = now()
      where privy_did = $1 and id = $2
     returning id, name, day, updated_at`,
    [did, id, save, Number(day) || 0, name ? String(name).slice(0, 80) : null]);
  return rows[0] ? { ok: true, ...rows[0] } : null;
}

export async function deleteCity (did, id) {
  const { rowCount } = await db().query(
    'delete from public.cities where privy_did = $1 and id = $2', [did, id]);
  return { ok: true, deleted: rowCount };
}

/* The body every write shares. Returns { error, status } or { save, day, name }. */
export function readWrite (raw) {
  if (typeof raw === 'string' && raw.length > MAX_BYTES) {
    return { error: 'save too large', status: 413 };
  }
  let body = raw;
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { return { error: 'bad json', status: 400 }; }
  }
  if (!body || typeof body.save !== 'object' || !body.save) {
    return { error: 'no save', status: 400 };
  }
  return { save: body.save, day: body.day, name: body.name };
}

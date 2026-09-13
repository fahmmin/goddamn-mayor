/* node api/migrate.js  -  make the cities table, or say it is already there.
 *
 * The same SQL as supabase/schema.sql, applied over the connection string so
 * nobody has to paste anything into a dashboard. Safe to run twice.
 */
import pg from 'pg';
import { requireDb } from '../lib/env.mjs';

const SQL = `
create extension if not exists pgcrypto;

create table if not exists public.cities (
  id          uuid        primary key default gen_random_uuid(),
  privy_did   text        not null,
  name        text        not null default 'My city',
  save        jsonb       not null,
  day         integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cities_by_mayor
  on public.cities (privy_did, updated_at desc);

alter table public.cities enable row level security;
revoke all on public.cities from anon, authenticated;

comment on table public.cities is
  'Saved cities, one row each. Written only by the city API, which verifies the Privy token.';
`;

const client = new pg.Client({
  connectionString: requireDb(),
  ssl: { rejectUnauthorized: false }      // Supabase terminates TLS with its own CA
});

await client.connect();
try {
  await client.query(SQL);
  const { rows } = await client.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'cities'
      order by ordinal_position`);
  console.log('\n  public.cities');
  for (const r of rows) console.log('    ' + r.column_name.padEnd(12) + r.data_type);
  const { rows: cnt } = await client.query('select count(*)::int as n from public.cities');
  console.log('\n  ' + cnt[0].n + ' cities stored\n');
} finally {
  await client.end();
}

-- The cities a mayor can pick up again on any machine.
--
-- Run this once in the Supabase SQL editor (SQL Editor -> New query -> Run),
-- or over a connection string with:  npm run api:migrate
--
-- MANY cities per mayor, not one. Breaking ground and taking over City Hall
-- are different games, and a mayor who starts one should not lose the other -
-- which is exactly what a single row keyed by the user would do on the next
-- autosave.
--
-- There is deliberately NOT a policy on this table. Supabase enforces RLS
-- against tokens it can verify - Clerk, Firebase, Auth0, Cognito, WorkOS - and
-- Privy is not one of them, so a Privy token means nothing to Postgres and any
-- policy written against auth.jwt() here would be decoration. The city API is
-- the only door: it verifies the Privy token itself and then uses a credential
-- the browser never sees. RLS is still ENABLED, because that is what makes the
-- front door locked: with RLS on and no policy, the publishable key shipped to
-- every browser can read and write exactly nothing.

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

-- The only query the app makes: this mayor's cities, most recently played first.
create index if not exists cities_by_mayor
  on public.cities (privy_did, updated_at desc);

alter table public.cities enable row level security;
revoke all on public.cities from anon, authenticated;

comment on table  public.cities is 'Saved cities, one row each. Written only by the city API, which verifies the Privy token.';
comment on column public.cities.privy_did is 'Privy DID (the verified sub claim), e.g. did:privy:xxx';
comment on column public.cities.day is 'Mirror of save->>day, so the city list needs no blob parsing.';

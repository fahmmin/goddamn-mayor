# The saved city

localStorage is still the save. This is the sync layer on top of it, so a mayor
who signs in on a second machine gets their city back instead of a fresh one.

## Why there is a function here at all

Supabase enforces Row Level Security against tokens it can verify, and it
verifies five providers: Clerk, Firebase, Auth0, Cognito and WorkOS. Privy is
not one of them, and it publishes no OIDC discovery URL, so a Privy access
token means nothing to Postgres. A policy written against `auth.jwt()` here
would look like security and enforce nothing.

So the boundary is the Edge Function. It verifies the Privy token itself,
takes the DID out of the *verified claims* rather than the request body, and
touches exactly that one row using the service role. The service role key never
leaves the server, and no Supabase key is shipped to the browser at all - the
client only knows the function URL.

## Setting it up

**1. The table.** Supabase dashboard -> SQL Editor -> New query, paste
[`schema.sql`](schema.sql), Run.

**2. The function's secrets.** Project Settings -> Edge Functions -> Secrets:

| Secret | Where it comes from |
|---|---|
| `PRIVY_APP_ID` | Privy dashboard, the same id as `PRIVY_APP_ID` in `.env` |
| `PRIVY_VERIFICATION_KEY` | Privy dashboard -> Configuration -> App settings -> verification key (public) |
| `ALLOWED_ORIGIN` | optional; the exact origin to allow, e.g. `http://localhost:8080`. Defaults to `*` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform -
do not add them.

**3. Deploy.**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy city
```

**4. Point the app at it.** `SUPABASE_URL=https://<ref>.supabase.co` in `.env`
(`NEXT_PUBLIC_SUPABASE_URL` is accepted too), then:

```bash
npm run web3:config && npm run web3:build
```

`make-config.js` prints a `cloud` line saying which it used. Leave `SUPABASE_URL`
blank and the whole layer switches itself off - the city stays in localStorage,
which is exactly how the game shipped before this existed.

## The API

    GET  /city   -> { save, day, updated_at } | { save: null }
    PUT  /city   <- { save, day }             -> { ok: true, day }

Both require `Authorization: Bearer <privy access token>`; without a valid one
they answer 401 and touch nothing.

## What the client does

`web3/src/cloud.js`, bundled into `web3/bundle.js`:

- **on login** - pulls the stored city. `src/shell.js` then offers it rather
  than imposing it, because the city on this machine may be the newer one.
- **while playing** - uploads a changed city every 20s. Byte-identical cities
  are skipped, so a paused game costs nothing.
- **never before a pull has landed** - pushing first is how one account's city
  would be written into another's row. `web3/src/cloud.test.js` asserts it.

`adopt()` moves a downloaded city into the live one *in place*, by `.set()` for
the typed arrays, for the same reason `demo.js`'s `newGame` does: render.js
diffs a per-tile signature against those exact buffers. The test fails if you
change it to assignment - which was checked, not assumed.

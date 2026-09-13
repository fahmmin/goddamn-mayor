# I'M THE GODDAMN MAYOR

An isometric city-builder that runs in a browser tab. You get four years, a
treasury, and a city that complains loudly when you get it wrong. Zone it, wire
it with roads and buses, pass the platform you ran on, and try to still be
popular when the term ends.

On top of that there is a chain layer: the city's districts are ENS names with
vaults attached, and the mayor can publish the city's numbers on-chain. That
part is a hackathon entry (ETHOnline 2026) and runs on Sepolia. It is play
money and unaudited contracts. Treat it as a demo, because that is what it is.

The game itself does not need any of it. Pull the network out and it is exactly
the same game.

---

## Run it

```bash
npm install
npm start          # → http://localhost:8080
```

That is the whole game. `npm install` pulls one package (`pg`), and it is only
for the save-sync API described below — **nothing npm-installed is ever sent to
the browser.** The game is plain `<script>` tags over one `window.MM` global:
no bundler, no framework, no React, no TypeScript.

Optional, if you want saved cities to follow you between machines:

```bash
npm run api:migrate    # creates the cities table
npm run api            # → http://localhost:8787
```

Two URL switches: `?diorama` freezes the economy for screenshots, `?play`
starts you on an empty block instead of the built-out city.

## How to play

| | |
|---|---|
| `1`-`9`, `s`, `t`, `0` | pick a build tool |
| Left-drag | explore; build when a tool is selected |
| Right-drag | pan — flick to throw it |
| Wheel | zoom |
| Space | pause |
| `+` / `-` | speed |
| `Esc` | menu |

**Nothing grows without a road.** Zone next to roads or you are paying upkeep
on empty lots. After that, watch rent (let it run and people leave),
unemployment (you zoned homes without jobs) and traffic (you built roads where
you needed buses).

Policies are trade-offs, not upgrades. A rent freeze holds rent down and slows
new housing. Free buses are transformative and get more expensive with every
resident they attract. There is no build order that wins for free.

---

## What it is built with

| | |
|---|---|
| **The game** | Vanilla JavaScript, Canvas 2D, no dependencies. ~25 files under `src/`, each hanging one thing off `window.MM`. |
| **Graphics** | Isometric Canvas 2D. One WebGL shader bakes a material atlas at startup; browsers without WebGL fall back to Canvas2D. No image assets. |
| **Sound** | WebAudio synthesis. No audio files. |
| **Contracts** | Solidity, compiled with solc-js directly — no Hardhat, no Foundry. ERC-4626 vaults from OpenZeppelin. |
| **Chain client** | viem + Privy, bundled by esbuild into one 650KB file that loads *beside* the game, never inside it. |
| **Indexing** | A subgraph on The Graph Studio — twelve data sources over the oracle, the faucet, all nine vaults and the ENSv2 registry. It draws the market panel's sparkline (ninety days of valuations: one query here, ninety archive calls over the RPC) and keeps the office's history, which the chain does not — a burned name leaves no state to read. |
| **Saves** | Postgres (Supabase), behind a small API that verifies a Privy token. |
| **Hosting** | Static files + two serverless functions. Vercel config included. |

The reason for the "no dependencies" rule in `src/` is portability: the game is
a folder of scripts and a canvas, so it can be dropped into a browser extension
side panel later without a build step. `CONTRACT.md` is the interface between
the modules and is worth reading before editing any of them. `src/state.js` in
particular is treated as read-only.

---

## Architecture

Three layers that do not know much about each other.

```
  browser
  ├── src/*.js          the game. deterministic, offline, no dependencies
  ├── web3/bundle.js    the chain layer. viem + Privy, loaded beside the game
  └── web3/config.json  generated at build time; addresses and URLs, no secrets

  server
  ├── api/city.mjs      one saved city   (Vercel function)
  ├── api/cities.mjs    the city list    (Vercel function)
  └── lib/*.mjs         the rules both of those share

  chain
  ├── contracts/        CityUSD, DistrictVault, CityOracle
  ├── chain/            compile, deploy, verify, publish — deployer tooling
  └── subgraph/         the index over all of it
```

**The game** is synchronous and deterministic. `src/*.js` never touches the
network. It keeps its whole world in one object — a 48×48 grid plus about
thirty scalars — and saves it to `localStorage`.

**The chain layer** is a separate bundle that polls the oracle every ten
seconds and writes what it learns onto `MM.state.chain`. If it fails to load,
or you never sign in, the game does not notice.

**The save API** is two serverless functions over Postgres. It exists because
the browser cannot hold a database credential — something has to verify the
Privy token and then talk to Postgres with authority, and that something must
not be the bundle.

### Files worth knowing

| | |
|---|---|
| `src/state.js` | the state shape, terrain seed, save/load. Read-only by convention |
| `src/sim.js` | land value, growth, rent, traffic, budget, approval |
| `src/render.js` | the isometric renderer, day/night, traffic |
| `src/shell.js` | title screen, menus, the panels you see before playing |
| `src/districts.js` | the nine districts and what each is worth |
| `lib/city.mjs` | the save API rules, shared by the functions and the dev server |
| `lib/privy.mjs` | token verification. ES256 via WebCrypto, no library |
| `tools/serve.js` | the static host. No dependencies |
| `chain/` | deployer tooling. npm deps live here, never in `src/` |

---

## The chain part

Live on Sepolia. The root name is
[`cityhall.eth`](https://sepolia.app.ens.domains/cityhall.eth).

| | |
|---|---|
| CityOracle | `0x51c64a4668d879528537c1e4e1fc0ec8d9afd88a` |
| City registry | `0x13f44e08710548E39df3eE4eBA42E8924d516db9` |
| CityUSD | `0x1a2ff1ab4be9e56ddaa0f845b97c1ea4faa9cfce` |
| Subgraph | `api.studio.thegraph.com/query/1760255/mayor/v0.1.0` |

Nine districts, each with its own ENSv2 registry and its own ERC-4626 vault.
`CityOracle.push()` is the only way city data reaches the chain, and it checks
that the caller holds the write role on `mayor.cityhall.eth`. No name, no
write. When the term expires the name expires and the transaction reverts by
itself.

That is the one idea here worth the trouble: the office is a name, the name
expires, and permissions are attached to the role rather than to the person
holding it.

```bash
node chain/verify-gate.js     # 8 assertions against the live deployment
```

It proves the mayor can push, a stranger cannot, the data round-trips, and a
burned name stops working.

### The index

Twelve data sources: the oracle, the CityUSD faucet, the nine vaults, and the
city registry. The registry half exists because the gate is a *live* question
by design — `push()` asks ENS what is true right now — and the price of that
design is that the office has no history on chain. `unregister()` leaves no
state, so after the recall an RPC can only tell you that nobody holds
`mayor.cityhall.eth`. Not who did, and not that they held the write role while
they signed ninety days of valuations. `Name` and `NameEvent` keep that record.

```bash
cd subgraph && npm install
npm run build      # generate the manifest, codegen, compile to wasm
npm run deploy     # needs your Subgraph Studio deploy key
npm run verify     # assertions against the deployed index
```

`npm run verify` is the one worth running after a deploy. A subgraph that is
still syncing, one pointed at a stale address, and one built from too late a
startBlock all answer an empty array with HTTP 200 — so "no rows" cannot be
told from "not finished" unless something asks a question it knows the answer
to. It checks that the office is indexed with the write role, that the Deputy
is indexed *without* it and has never once held it, and that all nine vaults
and the oracle are there.

The manifest, the ABIs and `src/districts.ts` are generated and gitignored.
`blocks.json` caches the probed startBlock and is committed — delete it to
re-probe after a redeploy.

---

## Saved cities

Cities live in `localStorage` first. If a Postgres URL is configured, signing in
with Privy also syncs them, so the same account gets the same cities on another
machine.

A saved city is about **15 KB** of JSON — 90% of that is three 2304-element
arrays (tiles, growth levels, land value). Two cities take about 6 KB on disk
once Postgres compresses them. Many cities per account, because breaking ground
and taking over City Hall are different games and starting one should not
destroy the other.

Supabase RLS is enabled on the table **with no policy at all**, which is
deliberate. Supabase can only enforce RLS against tokens it can verify — Clerk,
Firebase, Auth0, Cognito, WorkOS — and Privy is none of those. A policy written
against `auth.jwt()` here would look like security and enforce nothing. So the
API is the boundary: it verifies the token itself, takes the user id out of the
*verified claims* rather than the request body, and scopes every query by it.

---

## Deploying

Vercel, with `vercel.json` in the repo:

```bash
vercel            # static files from the root, api/*.mjs as functions
```

Set these as project environment variables:

| | |
|---|---|
| `DATABASE_URL` | **the pooler URI, not the direct one.** Supabase's `db.<ref>.supabase.co` is IPv6-only; use Connect → Session or Transaction pooler |
| `PRIVY_APP_ID` | so tokens can be verified |
| `SUBGRAPH_URL` | optional; without it charts fall back to a local sample |
| `CITY_API_URL` | optional; defaults to `/api` on Vercel, which is correct |

The build runs `web3/make-config.js` and then esbuild, which produces
`web3/config.json` and `web3/bundle.js`. `chain/deployed.json` is committed on
purpose — it is contract addresses and tx hashes, all public on-chain data, and
the build has no other way to learn them.

`.vercelignore` keeps the deployer tooling, the contracts, the tests and the
subgraph out of the deployment, because `outputDirectory` is the repo root and
anything not excluded becomes a public URL.

---

## Tests

```bash
npm test         # 113 assertions, no browser, no network
node smoke.js    # 225 checks: 500 game-days against a fake DOM
npm run api:check  # 10 assertions against a real Postgres
```

`smoke.js` is the useful one. It loads every module against a stub DOM, runs
500 days, answers every event, toggles every policy, and fails on any NaN,
out-of-range stat or broken module contract.

`npm run api:check` is deliberately kept out of `npm test` so the offline suite
stays offline.

---

## Rough edges

Things that are genuinely unfinished or that will bite you:

- **The Supabase Edge Function (`supabase/functions/city`) is written but never
  deployed or tested.** The Node path is the one with tests behind it. If you
  deploy the function, verify it yourself before trusting it.
- **`index.html`'s CSP allows `https://*.supabase.co`**, a wildcard, because the
  project host is generated into `config.json` and pinning it would mean editing
  committed HTML on every redeploy. The real narrowing is the API, which serves
  nothing without a verified token — but it is looser than the rest of that
  policy, which lists hosts one per purpose.
- **A free-tier Alchemy key caps `eth_getLogs` at a 10-block range.** Any tool
  that tries to find things by scanning logs will silently find nothing. viem
  reports the cap as `JSON is not a valid request object`, which is not a clue.
- **Contracts are unaudited and on a testnet.** They were written for a
  hackathon deadline.
- **The subgraph is deployed to Studio, not published to the decentralised
  network.** Fine for a demo, rate-limited for anything else.
- **There is no multiplayer.** The "city is a public company" framing is real in
  the sense that the vaults and names exist, but everyone is playing their own
  city.

## Where this is going

Private lobbies: a lobby deploys its own ENS subtree, the host picks a mayor,
and friends join as tenants holding expiring, non-transferable subnames. The
chain is already the server for that. After that, a bond desk and an index
across cities.

---

More detail lives in [`CONTRACT.md`](CONTRACT.md) (module interfaces),
[`docs/VISUALS.md`](docs/VISUALS.md) (rendering budgets and tradeoffs),
[`docs/SUBMISSION.md`](docs/SUBMISSION.md) (the hackathon writeup) and
[`CHANGELOG.md`](CHANGELOG.md).

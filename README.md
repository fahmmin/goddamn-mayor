# I'm The Goddamn Mayor

An isometric city-builder whose governing permissions are ENS names, so the
right to publish the city's numbers on-chain expires when the term does.

## Status

The game predates this event and is complete: a deterministic simulation over a
48×48 grid, roughly 11,700 lines of vanilla JavaScript under `src/`, zero
runtime dependencies, no bundler and no framework. Everything through commit
`e97169e` is that game. Everything after it is the chain layer, built during
ETHOnline 2026 against `docs/WEB3_PLAN.md`: nine ENSv2 district registries and
nine ERC-4626 vaults behind `cityhall.eth`, a `CityOracle` whose write path is
gated on holding the write role on `mayor.cityhall.eth`, Privy embedded wallets
over email OTP, a Postgres save-sync behind a token-verifying API, and a
twelve-source subgraph over the vaults, the oracle, the faucet and the city
registry. The two layers do not know about each other. `src/*.js` never reaches
the network, the chain layer is a separately bundled file loaded beside it, and
removing that one script tag leaves the game exactly as it was.

## Live Demo

- Application: https://im-the-mayor.vercel.app/
- Subgraph queries: https://api.studio.thegraph.com/query/1760255/mayor/v0.2.0
- Subgraph dashboard: https://thegraph.com/studio/subgraph/mayor
- Root ENS name: https://sepolia.app.ens.domains/cityhall.eth
- Deployment manifest: [`chain/deployed.json`](chain/deployed.json)

Network is Sepolia (`11155111`). Nothing needs installing and no wallet is
needed to look around; connecting one is email and a six-digit code, with no
extension and no seed phrase. The deployed city has sixteen oracle pushes
behind it, so the market panel is drawing indexed history rather than a sample
taken in your browser. Both claims are checkable without a wallet:

```bash
node chain/verify-gate.js
cd subgraph && npm run verify
```

## Documentation

- [Hackathon submission, tracks and the ENS argument](docs/SUBMISSION.md)
- [Module contract — the interface between every file in `src/`](CONTRACT.md)
- [What was built each day, and what it found](CHANGELOG.md)
- [The Web3 build plan this was executed against](docs/WEB3_PLAN.md)
- [Rendering budgets and the tradeoffs behind them](docs/VISUALS.md)
- [Game design — the simulation and its levers](docs/GAME.md)
- [The original plan for the game itself](docs/PLAN.md)

## Sponsor Track Verification

Two tracks are entered: ENS (Best Use of ENSv2) and Privy (B2B Financial
Product, Best Financial Flow). The Graph is used and is load-bearing, but is
deliberately not entered — `docs/SUBMISSION.md` states why in full.

The ENS claim rests on one function. `CityOracle.push()` does not check an
owner address or a mapping it maintains; it asks the registry a live question
about roles and expiry, and there is deliberately no owner-only escape hatch on
it. See `_requireOffice()` in
[`contracts/CityOracle.sol`](contracts/CityOracle.sol), and
[`chain/verify-gate.js`](chain/verify-gate.js) for the eight assertions that
prove it against the live deployment — including that a stranger's call reverts
with `NotTheMayor` specifically, rather than merely reverting.

The registry half of the subgraph is what makes the claim auditable after the
fact: `unregister()` leaves no state, so once a recall burns the office an RPC
can only report that nobody holds it. See
[`subgraph/src/registry.ts`](subgraph/src/registry.ts) and
[`subgraph/verify-index.js`](subgraph/verify-index.js).

## Workspace

- `src/` — the game. Vanilla JS over one `window.MM` global, no dependencies, never networked
- `web3/` — the chain layer. viem and Privy, bundled by esbuild, loaded beside the game
- `contracts/` — `CityOracle`, `DistrictVault`, `CityUSD`
- `chain/` — compile, deploy, verify and push tooling. npm dependencies live here, never in `src/`
- `subgraph/` — the index over the vaults, the oracle, the faucet and the city registry
- `api/` — two Vercel functions for saved cities
- `lib/` — the rules those functions share, including Privy token verification
- `tools/` — the dependency-free static host and build helpers
- `supabase/` — an Edge Function alternative to the Node API, written but not deployed
- `vendor/` — Lenis, vendored rather than fetched so CSP stays `default-src 'self'`
- `docs/` — plans, submission, design notes

## Prerequisites

Node.js 22.18.0 and npm 10.9.3 are what this was built and verified against.
Only the save-sync API has a runtime dependency; the game itself has none.

```bash
npm install
npm start
```

That serves the game at http://localhost:8080. Two URL switches exist:
`?diorama` freezes the economy for screenshots, and `?play` starts on an empty
block rather than the built-out city. Saved cities that follow you between
machines additionally need `npm run api:migrate` and `npm run api`, and a
`DATABASE_URL`; without them the city stays in `localStorage` and nothing
else changes.

Deployer tooling, contract compilation and the subgraph each carry their own
dependencies and are installed separately, under `chain/` and `subgraph/`.

## Checks

```bash
npm test                      # 113 assertions, no browser, no network
node smoke.js                 # 225 checks: 500 game-days against a fake DOM
node chain/verify-gate.js     # 8 assertions against the live deployment
cd subgraph && npm run verify # 10 assertions against the deployed index
npm run api:check             # 10 assertions against a real Postgres
```

The offline suites are the gate. `smoke.js` loads every module against a stub
DOM, runs 500 days, answers every event, toggles every policy, and fails on any
NaN, out-of-range statistic or broken module contract. Both stay green with the
chain unreachable, because `smoke.js` only evaluates the files listed in its
`ORDER` array and therefore never loads the chain bundle. `npm run api:check`
is deliberately excluded from `npm test` so the offline suite stays offline.

The two live checks answer the questions a reader should not have to take on
trust: whether the contract really enforces the office, and whether the index
really recorded it. Both are read-only and need no wallet. `verify-gate.js`
additionally accepts `--burn`, which unregisters the office and is destructive
on purpose.

## How To Play

`1`-`9`, `s`, `t` and `0` pick a build tool; left-drag explores, or builds when
a tool is selected; right-drag pans; the wheel zooms; space pauses; `+` and `-`
change speed; `Esc` opens the menu.

Nothing grows without a road, so zoning away from one means paying upkeep on
empty lots. After that the levers fight each other: rent rises until people
leave, zoning homes without jobs produces unemployment, and building roads
where buses were needed produces traffic. Policies are trade-offs rather than
upgrades — a rent freeze holds rent down and slows new housing, free buses are
transformative and grow more expensive with every resident they attract — so
there is no build order that wins for free.

## Security

This is hackathon work. The contracts are unaudited, deployed to a testnet, and
hold play money; they were written against a deadline and should be read as a
demonstration rather than as something to put funds behind. ENSv2 on Sepolia is
itself a beta, and `chain/addresses.js` pins the documented beta deployment
rather than the contracts-v2 namespace, because the two are both live and
differ. Known rough edges, including the wildcard in the page's CSP and the
Supabase Edge Function that is written but never deployed, are listed at the end
of `docs/SUBMISSION.md` and in the repository's own notes rather than left for a
reader to discover.

## Attribution

ERC-4626 vaults and the ERC-20 base are OpenZeppelin Contracts. The namespace is
ENSv2 on Sepolia. Wallets and email OTP are Privy. Indexing is The Graph, via
Subgraph Studio. Smooth scrolling on the landing page is Lenis, vendored. The
game, the simulation, the renderer, the contracts and the subgraph mappings are
original work. These are factual integration attributions and do not imply
endorsement.

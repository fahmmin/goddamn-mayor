# MAYOR MAMDANI — the Web3 layer

**Event:** ETHOnline 2026 · **Ship date:** 2026-09-15 · **Chain:** Sepolia only
**Tracks:** ENS (ENSv2) · The Graph (two tracks) · Privy

Progress against this plan is logged daily in [`../CHANGELOG.md`](../CHANGELOG.md).
Prize reference: [`../SPONSOR_TRACKS.md`](../SPONSOR_TRACKS.md).

---

## Context

MAYOR MAMDANI is a finished, visually-complete isometric city-builder: 11,700 lines,
zero runtime deps, deterministic sim, Electron shell. The game is done. What it
lacks is a reason for anyone but the player to care what happens in it.

The ask: make the city an **investable public entity** — districts you can buy into,
offices you can hold, identities that carry permissions — and enter three ETHOnline
2026 tracks with it. The previous plan (`docs/WEB3_PLAN.md`, Hedera + Graph + Arc)
optimised for prize pool. This one optimises for **the judge remembering the demo**,
which given 9 days means one coherent system on one chain, not three bolt-ons on three.

Three decisions shape everything below: **web-only** (Electron leaves the critical
path), a **Sept 15 freeze**, and **demo what is real now, document the rest as
roadmap**.

---

## The audit — what changed, and why

| The original idea | Verdict | What ships instead |
|---|---|---|
| Districts as investable funds | **Keep.** It's the whole demo. | Unchanged. |
| "Mutual fund index" | **Reframe.** The mayor controls the number the fund tracks — a judge spots that instantly. | **Underwriting a term.** Not an index of assets; exposure to a governance performance. The number to watch is the *spread* between market price and fundamentals — that spread is the mayor's credit. Same sidebar, defensible mechanism. |
| A real DAO (proposals, quorum, timelock) | **Cut.** Large contract surface, zero extra track points. | Shareholder **signal** in the sidebar + Privy key quorum on the treasury. Same screenshot, one day cheaper. |
| Roles in the city | **Keep and make load-bearing.** | ENS role bitmaps gate the oracle write at the *contract* level. No name, no write. |
| Tenants (roadmap) | **Promote to the demo.** | `apt-4b.riverside.cityhall.eth` — expiring + non-transferable + revocable, three of the brief's four bullets in one object. |
| Hedera | **Concept fits; calendar doesn't.** ATS is an enterprise monorepo the prior spike flagged as risky, and it's a second chain. | Phase 2, designed in §8 so the roadmap is credible. |

### Why these three tracks

Sepolia carries **ENSv2 beta** *and* — confirmed against `networks-registry.thegraph.com`
— The Graph's Subgraph Studio deploy endpoint **and** Substreams/Firehose endpoints
(`sepolia`, `eip155:11155111`, `issuanceRewards: true`). So ENS and The Graph compose
on **one chain**, which the prior plan could not do (it had to push Substreams to Base
because Arc has none). Privy adds embedded wallets with **no chain of its own**, so the
whole system stays single-chain with no bridging to explain.

| Track | Addressable | Slots | Why it lands |
|---|---:|---:|---|
| **ENS** — Best Use of ENSv2 | $4,500 | 4 | Hits **all four** subname-setup bullets + hierarchical registries + EAC + the "agents as namespaces" bonus. |
| **The Graph** — Composable/Standardized | $5,000 | 3 | Standardized ERC-4626 schema over 8 district vaults (qualifies alone) **+** Subgraph ⊕ Substreams on the same chain. |
| **The Graph** — AI Tooling (From Scratch) | $5,000 | 3 | `mcp-city-hall` + Deputy Mayor agent. Same subgraph, second track. |
| **Privy** — B2B Financial Product | $2,500 | 1 | City treasury = "shared organization wallet" + **key quorum**. Their own example. |
| **Privy** — Best Financial Flow | $2,500 | 1 | Deposit into a district vault. |
| | **$19,500** | **12** | |

---

## 1. The concept

> **The city is a public company and the mayor is its management.** Eight districts
> each issue shares. Share value tracks that district's land value — a number the
> simulation already computes every game-day. Every office, every district, every
> parcel and every tenant is an ENS name, and the names are not labels: holding one
> is what grants the permission to act.

The causal chain the demo has to show, end to end, in one shot:

```
you govern badly  →  approval falls  →  credit rating downgrades
                  →  district NAVs drop  →  the sidebar goes red
                  →  mayor.cityhall.eth moves closer to expiry
```

### Why ENS is load-bearing, not cosmetic

`CityOracle.push()` — the only way city data reaches the chain — requires the caller to
hold the write role on `mayor.cityhall.eth` in the ENSv2 registry. **No name, no write.**
When the 4-year term expires, the name expires, and the transaction reverts on its own.
The brief's bar is "central, not cosmetic" and "no hard-coded values"; this answers both
at the contract level rather than in prose.

And because the office is a subname the player *holds* rather than *is* (§4.1), losing it
is visible without losing the player: same wallet, same identity, no longer able to write
to the city.

---

## 2. The districts already exist

`src/demo.js:73-85` — `zoneAt(x,y)` is a pure geometric partition of the 48×48 grid into
eight named areas, currently used **only** to generate the showcase city and read by
nothing else:

| District | Region | ENS name |
|---|---|---|
| Downtown | `x≥16, 11≤y≤29` | `downtown.cityhall.eth` |
| Midtown | `x≥11, 11≤y≤34` | `midtown.cityhall.eth` |
| Riverside Towers | `x≥31` | `riverside.cityhall.eth` |
| Works & Wharves | `y≥36, x≥16` | `wharves.cityhall.eth` |
| South Side | `y≥30` | `southside.cityhall.eth` |
| Uptown High Street | `x≥16` | `uptown.cityhall.eth` |
| Airport Low-Rise | `y≤5` | `airfield.cityhall.eth` |
| The West Side | else | `westside.cityhall.eth` |

**Extract the geometric branch** (dropping the `hash(x,y,11)` level roll) into a new
`src/districts.js` exposing `MM.districts.at(x,y)` and `MM.districts.stats(s)`. Eight
districts is also the right number for the sidebar — enough rows to look like a market.

**Per-district NAV** aggregates `s.pow` (per-tile land value, `Uint8Array` 0..255, written
once per game-day at `sim.js:240-252`) plus tile counts and levels. `s.pow` is already
exactly the price signal needed; nothing new has to be simulated.

> **Key on `s.day`, never `s.rev`.** `lots.js:67-70` warns explicitly that land value
> moves daily *without* bumping `rev` — `s.rev` is cache invalidation, not an economic epoch.

---

## 3. Architecture

```
┌─ browser (static host) ─────────────────────────────────────┐
│  index.html                                                 │
│   ├── src/*.js          UNTOUCHED. window.MM, no bundler,   │
│   │                     no deps, smoke.js still passes.     │
│   │                     + src/districts.js (new, same rules)│
│   └── web3/bundle.js    NEW. esbuild output. Owns Privy +   │
│                         viem + all chain talk. Writes       │
│                         state.chain; game never knows.      │
└────────────────┬────────────────────────────────────────────┘
                 │ fetch (read) · Privy embedded wallet (write)
┌────────────────▼─── cityhall/ (Node, the only place deps live) ──┐
│  GET /city        subgraph query → district rows for sidebar     │
│  GET /rating      credit rating from approval + debt/revenue     │
│  mcp-city-hall    MCP server over the subgraph (standalone)      │
│  deputy agent     Claude, holds deputy.cityhall.eth               │
└────────────────┬─────────────────────────────────────────────────┘
                 │
┌────────────────▼─── Sepolia ─────────┐   ┌─── The Graph ────────┐
│  ENSv2 PermissionedRegistry          │   │  Subgraph (Studio)   │
│   cityhall.eth                        │──▶│   ERC-4626 standard  │
│   ├─ 8× UserRegistry (districts)     │   │   + ENS registry     │
│   │   └─ parcels, tenants            │   │  Substreams (sepolia)│
│   └─ offices: mayor/treasurer/...    │   └──────────┬───────────┘
│  DistrictVault ×8  (ERC-4626)        │              │
│  CityOracle  (ENS-role-gated write)  │◀─────────────┘
└──────────────────────────────────────┘
```

### The one architectural decision that matters

`src/*.js` stays **byte-identical** in its constraints — classic `<script>`, `window.MM`,
no deps, no `fetch`. All chain code lives in a **separately-bundled** `web3/bundle.js`
loaded after `game.js`. Consequences:

- `CONTRACT.md`'s rules for `src/` hold; the `mm-module-contract` skill stays true.
- `smoke.js` never loads the bundle (it only evals files in `src/` listed in its `ORDER`
  array at `smoke.js:98`), so `npm test` and `npm run smoke` stay green with the chain down.
- The Arc/Graph "working frontend **and** backend" requirement is satisfied by construction.
- Pull the network and it is exactly the game it is today.

`web3/bundle.js` writes `state.chain = {...}` and stops. `game.js:176` calls
`ui.update(state)` unconditionally every frame and re-reads state fresh, so the next
frame renders it. **Zero edits to `game.js`.**

### Files

| Path | Status | Owns |
|---|---|---|
| `index.html` | edit | CSP `connect-src`; two new `<script>` tags |
| `src/districts.js` | **new** | `MM.districts.at/stats` — extracted from `demo.js:73-85` |
| `src/ui.js` + `src/style.css` | edit | the sidebar panel |
| `web3/` | **new** | Privy, viem, ENS reads/writes, subgraph client → esbuild bundle |
| `contracts/` | **new** | `DistrictVault.sol`, `CityOracle.sol`, deploy scripts |
| `subgraph/` | **new** | schema, mappings, `subgraph.yaml` |
| `cityhall/` | **new** | API, `mcp-city-hall`, Deputy Mayor agent |
| `src/game.js`, `src/state.js`, `src/sim.js` | **untouched** | — |

### Contracts — deliberately two

Everything else is stock ENSv2. Minimum custom surface:

1. **`DistrictVault`** — ERC-4626, one per district. `totalAssets()` reads `CityOracle`.
   Standard schema is what makes the Graph subgraph *standardized* rather than bespoke.
2. **`CityOracle`** — the mayor pushes daily per-district land value + approval + rating.
   Write gated on an ENSv2 role check against `mayor.cityhall.eth`. **This is the ENS integration.**

---

## 4. The ENS layer

### 4.1 Person ≠ office

The root is the **institution**, not the mayor. A mayor does not own the city's
namespace; City Hall does, and the mayor holds a term-limited subname *of* it.

```
zohran.eth                    the player's own name — permanent, theirs
   └─ holds ─▶ mayor.cityhall.eth      the office — expiring, non-transferable
```

Term ends, or the recall fires: **the office name burns, the person remains.** They
keep their identity and lose their permissions, because the permissions were never
attached to the human — they were attached to the role. That is what Enhanced Access
Control is *for*, and it is the cleanest available answer to the question the ENS track
is actually asking: why is a permissioned name better than a plain address?

It also costs almost nothing to build — both names are being minted anyway — and it
makes the demo's best beat legible in one frame: the same wallet, before and after,
holding the same identity and no longer able to write to the city.

### 4.2 The API

Concrete against the real ENSv2 API (`PermissionedRegistry`, ERC1155Singleton):

```
register(label, owner, registry, resolver, roleBitmap, expiry)   // expiry uint64
renew(anyId, newExpiry)          unregister(anyId)               // burns = revoke
setSubregistry(anyId, registry)  setResolver(anyId, resolver)
grantRoles(anyId, roleBitmap, account)   revokeRoles(...)
```

Roles: `ROLE_REGISTRAR 1<<0`, `ROLE_UNREGISTER 1<<12`, `ROLE_RENEW 1<<16`,
`ROLE_SET_SUBREGISTRY 1<<20`, `ROLE_SET_RESOLVER 1<<24`,
`ROLE_CAN_TRANSFER_ADMIN (1<<28)<<128`. Admin of any role is `role << 128`.
Subname registries deploy as `UserRegistry` proxies via the **Verifiable Factory**.

**All four of the brief's subname setups, each landing on a real game mechanic:**

| Brief bullet | Mechanism | Game meaning |
|---|---|---|
| **Expiring** | `expiry` = term end (`s.termDay`, 1461 days) | Your term of office runs out |
| **Revocable** | `unregister()` burns the token | Recall election — the sim *already* triggers this at `lowDays > 21` |
| **Non-transferable** | withhold `ROLE_CAN_TRANSFER_ADMIN` | An office cannot be sold |
| **Transferable** | grant `ROLE_CAN_TRANSFER_ADMIN` | A parcel deed can |
| **Forever, no parent control** | max `expiry` + revoke parent's `ROLE_UNREGISTER` | A homesteaded parcel the city cannot seize |
| **Own subname registry** | 8× `UserRegistry` via Verifiable Factory | Each district issues its own parcels |
| **Bonus: agents as namespaces** | `deputy.cityhall.eth` holds read+propose roles, never `ROLE_UNREGISTER` | The Deputy Mayor's permissions *are* its name |

**Tenants** (promoted from roadmap into the demo):
`apt-4b.riverside.cityhall.eth` — expiring, non-transferable, revocable. Issued by the
district registry to a friend's wallet. Rent flows to the parcel deed holder.

**Resolver text records** on each district name carry the live economics — `nav`, `pop`,
`landvalue`, `rating` — written each game-day. This is the sidebar's read path, and the
reason "no hard-coded values" is provably satisfied.

---

## 5. The sidebar — the shot

Always visible, **not** a tab. `.mm-rail` is 306px at `right:10px`, so the new panel sits
at `right: 326px; top: 86px`. (The rail collapses to 44px without reflow — acceptable,
it only ever shrinks.)

**One-line trap:** `style.css:32` is an explicit opt-in list —
`.mm-bar, .mm-tools, .mm-rail, .mm-dock, .mm-tut, .mm-scrim { pointer-events: auto; }`.
A panel missing from it is invisible to clicks and silently dead.

Reuse what exists rather than inventing:

- **`_budRow(parent, label, kind)`** at `ui.js:288-292` is literally *label → live money
  value*. Exactly the row shape. Copy it.
- **`svg.spark`** (polyline + circle) already builds sparklines for the stat tiles.
- **`setText/setCls/setAttr`** at `ui.js:33-37` cache the last value on the node itself
  (`__t`, `__c<cls>`) — `update()` runs at 60fps and must not touch the DOM unless
  something moved. Every write goes through them.
- **`money()` / `signed()`** at `ui.js:41,47`; `.sub.up{--green}` / `.sub.down{--rose}` exist.
- **The lazy-build guard** at `ui.js:561` (`if (!this._polBuilt && MM.POLICIES...)`) is
  precisely the "chain data arrived after the UI was constructed" case. Copy it.
- **Interpolate between chain snapshots** with a lerp inside `update()` against a target
  on `state.chain` — `performance.now()` is already read once per frame at `ui.js:557`.
  That is what makes the numbers *move* rather than jump every 10 seconds.

Row: `▲ riverside.cityhall.eth   $12,430   +2.4%   ▁▂▄▆▇` — eight of them, ticking.

---

## 6. Build order — 9 days

Sequenced so the **locked** track is de-risked on day one. ENSv2 is a beta with thin
docs; if it cannot do what we need, that must surface immediately, not on day 8.

Day 1 is complete — see the changelog for what actually shipped and what it found.

| Day | Work | Ships |
|---|---|---|
| **1** (Sep 6) | **ENSv2 spike** — check `cityhall.eth` is free on Sepolia and register it (fallbacks in preference order: `municipal.eth`, `cityhall2026.eth`); deploy one `UserRegistry` via Verifiable Factory; mint one subname with expiry + roles; read it back. **In parallel:** web port (static host, CSP `connect-src`, drop Electron from the critical path). | Game live at a URL. One real subname. |
| **2** (Sep 7) | Full ENS build-out: 8 district registries, office names with EAC roles, all four subname setups, resolver text records. `src/districts.js` extracted from `demo.js`. | **ENS track is winnable from here.** |
| **3** (Sep 8) | `CityOracle` (ENS-role-gated) + `DistrictVault` ×8 (ERC-4626). Deploy, verify. | Contracts live. |
| **4** (Sep 9) | The write path: game pushes daily per-district NAV + approval + rating, signed by the mayor's key. Seed 400 game-days of history. | Live onchain city data. |
| **5** (Sep 10) | Subgraph — standardized ERC-4626 schema + ENS registry events. Deploy to **Subgraph Studio**. | **Graph track 1 qualifies.** |
| **6** (Sep 11) | **The sidebar.** Panel, rows, sparklines, interpolation. Credit rating. | **The screenshot.** |
| **7** (Sep 12) | Privy — embedded wallet, deposit-into-vault flow, treasury **key quorum**. | **Privy track (both prizes).** |
| **8** (Sep 13) | `mcp-city-hall` MCP server + Deputy Mayor agent holding `deputy.cityhall.eth`. Substreams module on `sepolia` for the composition half. | **Graph track 2 + ENS bonus.** |
| **9** (Sep 14–15) | **Freeze.** Three videos (Graph 2–4 min; ENS demo; Privy walkthrough), README, architecture diagram, submissions. | Submitted. |

**Cut order if behind** — drop from the bottom: Substreams (the standardized-schema path
qualifies alone) → Deputy Mayor agent → tenants → districts 5–8. **Never cut:** the ENS
role gate on `CityOracle`, or the sidebar.

---

## 7. Determinism — nearly free, worth taking

`sim.js` contains **zero** `Math.random`. Growth uses `rnd(i, day)` at `sim.js:61-65`, an
integer hash seeded on tile index and day. The only impurity is two calls in
`events.js:539` and `:557`. Replace them with a seeded stream and the entire game becomes
a pure function of *(seed, action log)* — which means **any observer can independently
recompute a district's NAV and check the oracle didn't lie.** That is a genuinely strong
claim for a fund's data layer and it costs about ten lines.

Caveat: `scaleMoney` at `events.js:520-534` closes over the delta at call time, so replays
must apply choices in the same order.

---

## 8. Phase 2 — documented, not built

The plan the roadmap points at, so the submission reads as a real product:

- **Private lobbies** — the next step. A lobby deploys its own `cityhall.eth`
  subtree; the host picks a mayor; friends join as **tenants** holding expiring,
  non-transferable subnames. The chain is already the server — no backend needed.
- **Hedera — Municipal Bond Desk.** *Concept fits well; the calendar doesn't.* Issue debt
  through the Asset Tokenization Studio: face value, coupon, maturity in game-days, with
  the credit rating from §5 setting the coupon the market demands. "Oracle pricing / NAV"
  and "compliance controls" are named extra-points items and this wins both. Deferred
  because ATS is an enterprise monorepo the prior spike flagged as risky, and it is a
  second chain — in 9 days it makes all three tracks mediocre.
- **Arc.** Treasury as real USDC where gas and money are the same dollar; nanopayments
  for per-tile build costs. Deferred for the same reason: a second chain.
- **Cross-city index.** Many cities, one market — the actual "mutual fund of cities."

---

## 9. Verification

Each of these must pass before the freeze:

1. **The game still is the game.** `npm test` and `npm run smoke` green with the chain
   down and `web3/bundle.js` absent. `smoke.js` never loads it — but `src/districts.js`
   **must** be added to the `ORDER` array at `smoke.js:98` *and* as a `<script>` in
   `index.html`, or it is silently never evaluated and every check still passes.
2. **ENS is load-bearing.** Burn `mayor.cityhall.eth` (or let it expire) and confirm
   `CityOracle.push()` **reverts** — from the *same wallet*, which still holds its own
   personal name. Record this take: identity intact, permissions gone. It is the single
   best proof of "central, not cosmetic" and of why §4.1's person/office split matters.
3. **Live data only.** Every sidebar number traces to a Subgraph Studio query. Grep the
   repo for hard-coded NAVs before submitting; a mocked value disqualifies the Graph entry.
4. **The causal chain, in one take.** Tank approval on camera → rating downgrades →
   sidebar goes red → name nears expiry. This is the video.
5. **A judge with no wallet can play.** Open the URL cold, Privy embedded wallet, deposit
   into a district, see the position appear under an ENS name. Time it — if it is over 60
   seconds, fix it.
6. **Determinism.** Replay the action log from seed and assert the recomputed NAV matches
   what the oracle published.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **ENSv2 beta cannot do what we need** | Day-1 spike, before anything depends on it. Fallback: resolve subnames off a parent's resolver (the brief's *other* qualifying path) instead of deploying our own registries. |
| **9 days for 3 tracks** | Cut order in §6. ENS ships day 2 and never gets cut. |
| **Sidebar numbers look fake** | Every number traces to the subgraph; determinism check in §9.6 makes it provable. |
| **CSP / CORS on `file://`** | Web-only removes this entirely — a real origin, no `Origin: null`. |
| **Chain down during judging** | `state.chain` absent → sidebar shows last-known and a stale badge. The game never awaits the chain. |
| **Scope creep back toward a real DAO** | Explicitly cut in §Audit. Shareholder signal only. |

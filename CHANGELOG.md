# Changelog

The Web3 layer, built for **ETHOnline 2026** against [`docs/WEB3_PLAN.md`](docs/WEB3_PLAN.md).
Everything before `e97169e` is the game itself; everything after is the chain layer.

The game is a finished isometric city-builder — deterministic simulation, zero
runtime dependencies, ~11,700 lines. The Web3 layer does not touch it. `src/*.js`
never reaches the network, and `npm test` / `npm run smoke` stay green with the
chain unreachable.

---

## At a glance

| Day | Date | Shipped | Checks |
|:---:|---|---|---|
| **1** | 2026-09-06 | Web build served over HTTP · nine districts with per-district NAV · showcase economy unfrozen · ENSv2 verified on Sepolia · secret hygiene | 8 · 12 · 207 green |
| 2 | 2026-09-07 | *planned* — claim the root name, 8 district registries, offices with EAC roles, all four subname setups, resolver text records | |
| 3 | 2026-09-08 | *planned* — `CityOracle` (ENS-role-gated) + `DistrictVault` ×8 (ERC-4626), deployed and verified | |
| 4 | 2026-09-09 | *planned* — the write path: daily NAV + approval + rating pushed onchain, signed by the mayor | |
| 5 | 2026-09-10 | *planned* — standardized ERC-4626 subgraph, deployed to Subgraph Studio | |
| 6 | 2026-09-11 | *planned* — the sidebar: live district rows, sparklines, credit rating | |
| 7 | 2026-09-12 | *planned* — Privy embedded wallet, vault deposit flow, treasury key quorum | |
| 8 | 2026-09-13 | *planned* — `mcp-city-hall` MCP server, Deputy Mayor agent, Substreams module | |
| 9 | 2026-09-14/15 | *planned* — freeze: videos, docs, architecture diagram, submissions | |

Check counts are `districts` · `sim` · `smoke`.

---

## Day 1 — 2026-09-06

Web build, districts, and the read-only half of the ENS work. No transaction has
been signed yet.

| Shipped | Where | Verified by |
|---|---|---|
| Nine districts, each with a NAV derived from `s.pow` | `src/districts.js` | 8 tests, incl. one replaying `zoneAt` across all 2304 tiles |
| Swappable ENS root — testnet name now, real name at redeploy | `MM.districts.setRoot()` | round-trip test; empty/null cannot wipe the root |
| Static host, so the game has an origin | `tools/serve.js` | loaded in a real browser, clean console |
| Showcase city keeps its looks **and** runs its economy | `src/demo.js` | `s.pow` fills 1,845 tiles; city nets +$7k/day |
| ENSv2 preflight — 12 read-only checks | `chain/preflight.js` | all 10 contracts have code; ABI proven against the docs deployment |
| Secrets cannot reach the repo | `.gitignore`, `.env.example` | `git check-ignore` on `.env`; repo grepped clean |
| Privy + Hedera docs servers | `.mcp.json` | project scope, no secrets |

### What it found

Four things, each of which would have cost more later than it did here.

- **The showcase was a diorama, and a diorama has no land value.** `demo.js`
  replaced `MM.sim` with a clock-only stub that never called `daily()` — its own
  comment said *"hold the economy still."* It was built to show off the renderer.
  But `daily()` is what fills `s.pow`, and `s.pow` is what every district is
  worth, so every NAV was `$0` and nothing moved. Now three modes: `showcase`
  (default) treats the planned city as a starting position and lets the economy
  run, `?diorama` restores the freeze for renderer stills, `?play` opens on the
  starter block.

- **There are two live ENSv2 deployments on Sepolia.** `contracts-v2` carries its
  own CI namespace under `deployments/sepolia` (2026-06-29); the docs publish a
  different set as the beta. Bytecode differs by ~19 bytes, so calls succeed
  against either — you would simply build your city in a namespace nobody is
  looking at. `chain/addresses.js` pins the **documented** set.

- **The district map already existed, and it has nine regions, not eight.**
  `demo.js`'s `zoneAt()` was a pure geometric partition used only to generate the
  showcase city. The residential wedge at `y≥36, x<16` was never named in the
  original comment; it is Red Hook now.

- **`cityhall.eth` is available on Sepolia.** The name the plan chose is free.

### Also worth recording

- The simulation is deterministic except for two `Math.random()` calls in
  `events.js:539,557`. Seeding those makes the whole game a pure function of
  *(seed, action log)* — so anyone can recompute a district's NAV and check the
  oracle did not lie. Roughly ten lines, not yet done.
- `policies.js` declares `pollutionMul` on four policies and `sim.js` never reads
  it. A dead lever; do not write DAO copy promising it does anything.
- Vendored ABIs trimmed 1.87MB → 158KB (deployment JSONs ship bytecode, storage
  layouts and metadata; only address + interface is needed).

### Commits

```
f5ce574  chore: docs servers for privy and hedera
a568578  feat: verify ENSv2 on sepolia before trusting it
99f2e36  feat: serve the city over http, and let the showcase run its economy
fa96bb0  feat: nine districts, and what each one is worth
```

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
| — | 2026-09-07/10 | *(the chain layer did not move — this window went into visual fidelity and a landing page)* | |
| **2** | 2026-09-12 | **The whole chain layer, in one day.** `cityhall.eth` registered · 9 district registries · mayor + deputy offices · CityOracle, CityUSD, 9 ERC-4626 vaults deployed · market panel · Privy embedded wallets · ENS gate proven 8/8 against the live chain | 8 · 12 · 207 green · 8 onchain |
| 3 | 2026-09-13 | *planned* — docs, demo video, pitch, submissions | |

Check counts are `districts` · `sim` · `smoke` · `gate`.


---

## Day 2 — 2026-09-12

The city went onchain. `cityhall.eth` is registered, nine districts each have
their own registry and their own ERC-4626 vault, and the ENS gate is proven
rather than asserted.

| Shipped | Where | Verified by |
|---|---|---|
| `cityhall.eth` registered on Sepolia | tx `0x6f0fff01…` | the name resolves; the deployer holds it |
| Nine district registries via Verifiable Factory | `chain/deploy.js` | 9 proxies, addresses in `deployed.json` |
| `mayor` + `deputy` offices, expiring and non-transferable | `chain/deploy.js` | `officeState()` returns holder + expiry |
| `CityOracle`, ENS-role-gated | `contracts/CityOracle.sol` | **8/8 in `verify-gate.js`, live** |
| `CityUSD` + nine stock ERC-4626 vaults | `contracts/` | `wireVaults()`, reserve funded |
| District market panel — live/stale/local | `src/ui.js`, `src/style.css` | reads real NAVs in a real browser |
| Privy embedded wallets, email OTP | `web3/src/wallet.js` | cold load shows "Connect wallet" |
| The game is untouched | — | 207 smoke + 20 unit checks green throughout |

### What it found

- **`ETHRegistrar.register()` is not payable.** It takes an ERC-20
  `paymentToken`, so no amount of Sepolia ETH buys a name. Worse, the vendored
  `chain/abi/MockUSDC.json` carries the address from *contracts-v2's own*
  namespace, not the documented beta's — the beta oracle answers
  `isPaymentToken()` **false** for it, and `getRegisterPrice()` then reverts
  with a signature viem cannot decode. That reads as a stale ABI rather than a
  wrong address. Found read-only, before the key existed; at deploy time on a
  deadline it would have read as "ENSv2 is broken, drop the track." Both real
  tokens are now in `addresses.js`: `cityhall.eth` is 8.000021 MockUSDC/year.

- **The plan's vault design was drainable.** `DistrictVault.totalAssets()`
  reading the oracle breaks ERC-4626 share math — shares mint against assets
  that are not there. The vault is now stock OpenZeppelin and the oracle moves
  real tokens instead, capped at 5% out per settlement.

- **A revert test that greps `shortMessage` passes on any failure.** viem's
  `shortMessage` is always "the contract function reverted"; the decoded custom
  error lives on `cause.data.errorName`. The first version of `verify-gate.js`
  would have passed for a typo'd function name. It now asserts `NotTheMayor`
  by name.

- **Privy reports a first-time visitor by throwing.** `user.get()` raises
  `missing_or_invalid_token` when storage is empty — the most common path, not
  an error. Catching it alongside `initialize()` showed every new judge "wallet
  unavailable" on the one screen that has to work cold.

- **`config.json` is served to browsers.** It was publishing the paid Alchemy
  key to buy nothing; the browser's handful of reads run fine on the public
  node. `make-config.js` now refuses to write if the Privy app secret or the
  deployer key would appear in the served file.

- **The market panel walked 2,304 tiles at 60fps** in its first draft. NAV
  changes once per game-day, so it is sampled there and cached.

### Commits

```
3f4e48c  feat: deploy the city to Sepolia, and prove the ENS gate is real
4ffe1c2  feat: the chain layer - deploy path, Privy wallets, oracle reads
2fb18af  feat: contracts and the district market panel
```

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

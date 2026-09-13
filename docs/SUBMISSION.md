# MAYOR MAMDANI — ETHOnline 2026 submission

**One chain (Sepolia). One coherent system. Two tracks entered.**

> The city is a public company and the mayor is its management. Nine districts
> each issue shares. Share value tracks that district's land value — a number
> the simulation already computes every game-day. Every office, every district
> and every parcel is an ENS name, and the names are not labels: **holding one
> is what grants the permission to act.**

| | |
|---|---|
| **Live demo** | **<https://im-the-mayor.vercel.app/>** — nothing to install, no wallet needed to look around |
| **Chain** | Sepolia (`11155111`) |
| **Root name** | [`cityhall.eth`](https://sepolia.app.ens.domains/cityhall.eth) |
| **Tracks** | ENS — Best Use of ENSv2 · Privy — B2B Financial Product + Best Financial Flow |

---

## The one-minute version

The game is a finished isometric city-builder: ~11,700 lines, zero runtime
dependencies, a deterministic simulation. It existed before this event and it
still runs with the network unplugged.

What the chain layer adds is a reason for anyone but the player to care what
happens in the city:

```
you govern badly → approval falls → the credit rating downgrades
                 → district NAVs drop → the market panel goes red
                 → and when the term ends, the city stops reporting
                   because mayor.cityhall.eth expired
```

That last step is the part worth looking at closely, because it is enforced by
a contract rather than by a comment.

---

## Why the ENS integration is load-bearing, not cosmetic

`CityOracle.push()` is the only way city data reaches the chain. It does not
check an owner address. It does not check a mapping this contract maintains.
It asks the ENSv2 registry a live question:

```solidity
function _requireOffice() internal view {
    IPermissionedRegistry.State memory st =
        registry.getState(registry.findTokenId(officeLabel));
    if (st.latestOwner == address(0))  revert OfficeVacant(officeLabel);
    if (st.expiry <= block.timestamp)  revert TermExpired(st.expiry, block.timestamp);
    if (!registry.hasRoles(st.tokenId, writeRole, msg.sender))
        revert NotTheMayor(msg.sender);
}
```
— [`contracts/CityOracle.sol`](../contracts/CityOracle.sol)

Three consequences, each a real game mechanic:

1. **The term runs out on its own.** No keeper fires, nobody revokes anything.
   The day the name expires, `expiry` falls behind `block.timestamp` and every
   `push()` reverts.
2. **The recall is a burn.** The simulation already triggers a recall when
   approval stays under water for 21 days. Onchain that is `unregister()` — and
   the very next `push()` reverts, from the same wallet, mid-term.
3. **The person is not the office.** A player's own name *holds*
   `mayor.cityhall.eth` rather than *being* it. After expiry the wallet keeps
   its identity and its vault position, and simply can no longer write to the
   city. The permissions were never attached to the human.

**There is deliberately no owner-only escape hatch on `push()`.** An emergency
admin key would quietly make all three of the above untrue — which is exactly
the "cosmetic" failure the brief warns about.

### Prove it in 30 seconds

```bash
node chain/verify-gate.js
```

Eight assertions against the live deployment. It does not merely check that a
stranger's call reverts — it checks that it reverts with **`NotTheMayor`
specifically**, because a test that greps for "reverted" passes just as happily
on a typo or an out-of-gas.

```
  ok    the deployer holds the office name
  ok    the term has not expired yet
  ok    canPush(mayor) is true
  ok    canPush(a wallet holding no office) is false
  ok    push() from a stranger reverts with NotTheMayor  (got NotTheMayor)
  ok    the mayor can push: 0xcb872bbc…
  ok    city.day round-trips (1382)
  ok    district 8 NAV round-trips (9000)

  8 passed, 0 failed
```

Add `--burn` to unregister the office and watch the same wallet lose the city.
It is destructive and opt-in on purpose — that is the demo's best beat and it
should fire with a camera running.

---

## All four subname setups, each on a real mechanic

The brief asks for subname setups. Each one here is load-bearing rather than
demonstrative:

| Brief bullet | Mechanism | What it means in the game |
|---|---|---|
| **Expiring** | `expiry` on registration | Your term of office runs out |
| **Revocable** | registry keeps `ROLE_UNREGISTER` | The recall election burns the name |
| **Non-transferable** | `ROLE_CAN_TRANSFER` withheld | **An office cannot be sold** |
| **Transferable** | `ROLE_CAN_TRANSFER` granted | **A district deed can** |
| **Own subname registry** | 9 × `UserRegistry` via Verifiable Factory | Each district issues its own parcels |
| **Bonus: agents as namespaces** | `deputy.cityhall.eth` holds `ROLE_RENEW`, never the write role | The Deputy's permissions *are* its name — it can read and propose, and provably cannot push |

The office/deed split is the clearest answer this project has to the question
the ENS track is really asking — *why is a permissioned name better than a plain
address?* Because an address cannot express "you may hold this, and you may
never sell it."

---

## Deployed contracts (Sepolia)

| What | Address |
|---|---|
| **CityOracle** — the ENS-gated write path | [`0x51c64a4668d879528537c1e4e1fc0ec8d9afd88a`](https://sepolia.etherscan.io/address/0x51c64a4668d879528537c1e4e1fc0ec8d9afd88a) |
| **CityUSD** — faucet ERC-20 | [`0x1a2ff1ab4be9e56ddaa0f845b97c1ea4faa9cfce`](https://sepolia.etherscan.io/address/0x1a2ff1ab4be9e56ddaa0f845b97c1ea4faa9cfce) |
| **City registry** (`cityhall.eth`) | [`0x13f44e08710548E39df3eE4eBA42E8924d516db9`](https://sepolia.etherscan.io/address/0x13f44e08710548E39df3eE4eBA42E8924d516db9) |

Nine districts, each with **its own `UserRegistry`** and **its own ERC-4626 vault**:

| District | ENS name | Registry | Vault |
|---|---|---|---|
| Downtown | `downtown.cityhall.eth` | `0xC3a5CAB5…f91c` | `0x4bd31b7f…d4ca` |
| Midtown | `midtown.cityhall.eth` | `0xd2632b34…5863` | `0xbe27549d…11dd` |
| Riverside Towers | `riverside.cityhall.eth` | `0x2aE77346…0909` | `0xa094d916…ab25` |
| Uptown High Street | `uptown.cityhall.eth` | `0x8d1A09c3…B9fA` | `0x43ef6ec5…11c8` |
| The West Side | `westside.cityhall.eth` | `0xdBA5f6f6…FF2B` | `0x793bde5d…a990` |
| South Side | `southside.cityhall.eth` | `0xAA2AD254…8Bf8` | `0x8a824c4e…5442` |
| Works & Wharves | `wharves.cityhall.eth` | `0x125BC383…11A6` | `0x7b91031c…c360` |
| Red Hook | `redhook.cityhall.eth` | `0xcB203567…2437` | `0x21708eb2…ae4b` |
| Airport Low-Rise | `airfield.cityhall.eth` | `0xe59c117d…4190` | `0x45deaf0b…52cd` |

Full addresses in [`chain/deployed.json`](../chain/deployed.json).

---

## Privy — a judge with no wallet, in under a minute

Both Privy prizes are entered from one flow.

**Best Financial Flow.** Open the URL cold. Click **Connect wallet**, enter an
email, type the six-digit code. An embedded wallet is provisioned — no
extension, no seed phrase, no network-switching prompt. **Get CITYUSD** draws
from the faucet. **Underwrite** deposits into a district's ERC-4626 vault, and
the position appears under that district's ENS name.

**B2B Financial Product.** The city treasury is the business account: it funds
the oracle's settlement reserve, and `settle()` moves real CITYUSD between the
reserve and the nine vaults as districts gain or lose value. Treasury
operations are gated by `steward`; the write path is gated by the ENS office.
Two different authorities over one balance sheet, which is the shape an actual
treasury product has.

Email OTP rather than OAuth deliberately: OAuth needs per-provider dashboard
setup and a redirect through an origin the CSP must allow. A six-digit code
works on a laptop that has never seen this app.

---

## The vault design, and one decision worth defending

`DistrictVault` is a **stock OpenZeppelin ERC-4626**. `totalAssets()` is the
real token balance and nothing overrides it.

The original plan had `totalAssets()` read the oracle's NAV. That is a
seductive design and it is broken: if reported assets are unrelated to the
tokens actually held, shares mint against assets that are not there and the
vault is drainable. Any judge who pokes at deposit/withdraw finds it.

So the oracle moves **real CityUSD** instead. Share price rises because assets
genuinely arrived. A gain needs no vault code at all — the oracle transfers in
and `totalAssets()` rises on its own. Only a loss needs cooperation, via
`remit()`, capped at **5% of assets per settlement**: a bad term should visibly
hurt, and must not be able to empty the vault in one transaction whatever the
oracle claims.

The side benefit is that the vaults present a genuinely standard ERC-4626
surface — which is what a standardized subgraph would need, and the reason The
Graph track stays credible as the next step rather than a rewrite.

---

## The subgraph — used, but not entered

The city is indexed by a subgraph on Studio: twelve data sources — the oracle,
the CityUSD faucet, all nine vaults, and the city's own ENSv2 registry. It is
load-bearing rather than decorative, and the reason is arithmetic:

| Question | Over the RPC | Here |
|---|---|---|
| What is a district worth now? | 1 `eth_call` | 1 query |
| What was it worth over 90 days? | 90 archive calls, against Sepolia endpoints that **do not keep the state** | 1 query |
| What does one wallet hold across nine vaults? | 9 round trips | 1 query |
| Who held the office when this NAV was signed? | **impossible** — see below | 1 query |

That last row is why the registry is indexed alongside the vaults. `unregister()`
leaves nothing behind: once the recall burns `mayor.cityhall.eth`, an RPC can
report only that nobody holds it. Not who did. Not that they held the write
role while they signed ninety days of valuations. Not which block took it away.
The gate is a live question by design — that is the whole ENS argument — and
the cost of that design is that the office has no history on chain to read.

So `Name` and `NameEvent` keep one: every `LabelRegistered`, `ExpiryUpdated`,
`LabelUnregistered` and `EACRolesChanged` on the city registry, with the label
string the event itself carries. Two consequences worth the trouble:

- **The recall becomes visible in the data**, not just as a reverted
  transaction in a terminal. `burned: true` with the block it happened on.
- **`deputy.cityhall.eth` is checkable rather than claimed.** The agent-as-
  namespace bullet above says the Deputy can read and propose but provably
  cannot push. That is now a query: `canWrite` is false, and no `ROLES_CHANGED`
  row has ever set the write bit on it. No wallet and no signature needed to
  verify it — which is the right bar for a claim about permissions.

Before it existed the market panel's sparkline was a seven-day rolling sample
taken in the browser — real numbers, but gone on reload. Now it is the series
the oracle actually wrote. That is the difference between a chart of the game
and a chart of the record, and the panel's badge reads `graph` rather than
`live` precisely when it is showing the latter.

Live at [`…/mayor/v0.2.0`](https://api.studio.thegraph.com/query/1760255/mayor/v0.2.0),
and checkable without a wallet:

```bash
cd subgraph && npm run verify
```

```
  ok    the registry is indexed at all  (11 names)
  ok    mayor.cityhall.eth is in the index
  ok      it carries an expiry  (2026-10-10)
  ok      the index agrees it may write  (roles 16777216)
  ok      which is the write role the oracle demands  (WRITE_ROLE 16777216)
  ok    deputy.cityhall.eth is in the index
  ok      it cannot write  (roles 65536)
  ok      and has never once held the write role  (2 role events checked)
  ok    the oracle half is indexed too  (16 pushes, day 1012)
  ok    all nine vaults are indexed  (9/9)

  10 passed, 0 failed
```

`65536` is `ROLE_RENEW` and nothing else. The Deputy holds a name, that name
carries the renew role, and the write bit has never been set on it in any role
event the registry ever emitted — which is the agent-as-namespace bullet above,
stated as data rather than as a promise.

**It is still not entered for The Graph's Composable or Standardized prize, and
the honest reason is that it does not qualify.** Indexing two kinds of contract
in one subgraph is not composing two Graph *products* — that prize means
Subgraphs with Substreams, Firehose or Amp, and there is one product here. The
other door is conformance to one of the eleven published standardized
schemas. The relevant one here is **Yield Aggregator v1.3.1**, and conforming
to it means USD-denominated TVL across a protocol-level entity tree. CityUSD is
an unpriced testnet faucet token, so every USD field in that schema would be a
number we made up. A subgraph that claims a standard it does not meet is worse
than one that claims nothing.

What is true is narrower and stated as such: the vaults are stock ERC-4626 with
nothing overriding `totalAssets()`, so `Deposit` and `Withdraw` are the
canonical events, and `Vault` / `Account` / `Position` / `VaultEvent` sit
*beside* the city entities rather than on top of them. A tool that understands
ERC-4626 can read them without knowing this game exists. That is the
groundwork for conformance, not conformance.

---

## What is new, and what existed before

Honest separation, per the continuity rules:

**Existed before the event** — the entire game: `src/*.js` except
`districts.js`, the renderer, simulation, policies, events, audio, UI.
~11,700 lines. See commits up to `e97169e`.

**Built during the event** — everything chain-facing:
`contracts/`, `chain/`, `web3/`, `src/districts.js`, the market panel in
`src/ui.js` + `src/style.css`.

---

## The architecture decision that protects the game

`src/*.js` never reaches the network. All chain code is a **separately
bundled** `web3/bundle.js`, loaded after `game.js`, which writes `state.chain`
and stops.

- `smoke.js` only evaluates files listed in its `ORDER` array, so it never
  loads the bundle — `npm test` and `npm run smoke` stay green with the chain
  unreachable. **338 checks (113 unit + 225 integration), verified green after every commit in this event.**
- `game.js` has **zero edits**. It already called `ui.update(state)` every
  frame and re-read state fresh.
- Delete the one `<script>` tag in `index.html` and the page is exactly the
  game it was before.

The market panel's badge always says which of **live / stale / local** you are
looking at. If the chain goes quiet during judging the panel keeps its
last-known numbers and flips to `stale` rather than going blank — and a number
that has never been onchain is labelled `local` rather than being passed off.
An unlabelled number that merely looks onchain is the worst thing this panel
could do to the submission.

---

## Run it yourself

```bash
npm install && npm run serve        # → http://localhost:8080
npm test && node smoke.js          # 113 unit + 225 integration checks
node chain/verify-gate.js          # 8 assertions against the live chain
```

To redeploy the whole city under a different root name, set `CITY_ROOT` in
`.env` and run `node chain/deploy.js` — it is staged and resumable, because the
middle of it is a 60-second commit-reveal wait and that is exactly where a
process gets killed the night before a deadline.

---

## Roadmap

- **The Graph.** Two things stand between the current subgraph and the
  standardized prize, and neither is cosmetic. Indexing the ENSv2 registry
  alongside the vaults would put `expiry` and the recall burn on the same
  timeline as the valuations — so "who held the office when this number was
  written, and had the term run out?" becomes one query instead of an
  unanswerable one. Conformance to Yield Aggregator v1.3.1 then needs a price
  for CityUSD, because that schema is denominated in USD throughout.
- **Private lobbies.** A lobby deploys its own subtree; the host picks a mayor;
  friends join as tenants holding expiring, non-transferable subnames
  (`apt-4b.riverside.cityhall.eth`). The chain is already the server.
- **A municipal bond desk.** The credit rating sets the coupon the market
  demands.

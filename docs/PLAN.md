# I'M THE GODDAMN MAYOR — production plan

One document app. One front door. Five minutes from cold open to "I want to play this."

Decisions taken (2026-09-12):

1. `landing/` is **deleted**. The shell in `src/shell.js` becomes the landing page.
2. The Graph gets a **real subgraph deployed to Subgraph Studio**.
3. "Start Demo" is a **guided auto-playing tour** with a skip.

Stated assumptions, flagged rather than asked:

- The ENS root stays `cityhall.eth`. Nine district registries are deployed under
  it on Sepolia; renaming it for a cosmetic change costs a full redeploy, and
  "City Hall" is on-theme anyway. Only user-facing strings change.
- Jaro is **self-hosted as woff2**, not loaded from `fonts.googleapis.com`.
  `CONTRACT.md` says "no external fonts, no CDN, CSP is `default-src 'self'`",
  and `src/fonts/` already self-hosts Instrument Serif the same way. Same
  typeface, same look, no CSP exemption, works offline. If you want the Google
  link tags instead, say so and I add `fonts.googleapis.com` to `style-src` and
  `fonts.gstatic.com` to a new `font-src`.

---

## Why one document

`src/shell.js` already renders the train carriage over the **live renderer**,
flying the camera between real tile coordinates across eight stops
(`Shell.prototype.apply` lerps `r.scale` and `r.centerOn`). `landing/` is a
Figma export whose carriage is a remote `figma.site` PNG that the page's own CSP
would block, sitting on a React + Vite + Tailwind + TypeScript stack that exists
to render about five kilobytes of markup.

Two documents cannot tween a camera between them. A page navigation gives a
white flash plus the 400–900ms cache bake that `CONTRACT.md` calls the
performance contract. Inside one document, "open the app" is already a camera
tween that exists and is already smooth.

So: the title screen becomes stop 0 of the ride, and "open the app" is the ride
running to its end and handing the camera back.

---

## Phase 0 — Name, type, and the things that block everything else

**Effort: half a day. Ships independently.**

### 0.1 Rename

19 occurrences of "Obsicity" across `package.json`, `README.md`, `src/ens.js`,
`src/events.js`, `src/inspect.js`, `src/policies.js`, `src/roofs.js`,
`src/shell.js`, `src/sim.js`, `src/style.css`, `src/ui.js`, `tools/serve.js`.

- Display name: **I'M THE GODDAMN MAYOR**
- Short form in tight UI (nav mark, toasts, console): **MAYOR**
- `package.json`: `name: "goddamn-mayor"`, `productName: "I'm the Goddamn Mayor"`
- The CSS class prefix `obs-` stays. It is not user-visible, and renaming ~200
  selectors across a 53KB stylesheet buys nothing.
- `index.html`'s `<title>` is already correct.

### 0.2 Jaro

- Fetch Jaro (latin subset) into `src/fonts/jaro.woff2`, licence note beside it.
- `src/style.css` gains an `@font-face` block pointing at that file, with
  `font-display: swap`.
- Apply to: the nav wordmark, the hero title, the stop titles. **Not** to body
  copy, numbers, or the HUD — Jaro is a display face with one weight and a
  variable optical size, and the HUD is dense tabular data that needs the
  existing stack.
- Check Jaro at 12rem for the counters closing up; tighten `letter-spacing`
  to around `-0.03em` and set `font-optical-sizing: auto`.

### 0.3 Delete `landing/`

`git rm -r landing`. Nothing imports it; `tools/serve.js` does not reference it.
Lift before deleting: the `train-bob` keyframes from `tailwind.config.js` (a 6px
translateY over 3s — worth keeping as a subtle sway on the real carriage) and
the two copy blocks you wrote in `LandingPage.tsx`.

**Done when:** `grep -ri obsicity` returns nothing outside `CHANGELOG.md` and git
history; the title screen renders in Jaro; `npm test` and `npm run smoke` pass.

---

## Phase 1 — The shell becomes the landing page

**Effort: 2 days. This is the phase you look at.**

### 1.1 The title stop

`STOPS[0]` in `src/shell.js:53` becomes the title screen. Layout at stop 0, over
the live city seen through the carriage window:

```
┌────────────────────────────────────────────────────────────┐
│  MAYOR                          inside · chain · settings  │
│                                                            │
│   IM THE                                                   │
│   GODDAMN         ← Jaro, clamp(3rem, 11vw, 12rem)          │
│   MAYOR             line-height .78                        │
│                                                            │
│   [ BE THE MAYOR ]  [ START DEMO ]                         │
│   Day 612 · 24,910 residents · 79% approval   ← if a save  │
│                                                            │
│                                            AIRFIELD        │
│                                            DOWNTOWN        │
│   scroll to ride the line                  MARINA ···      │
└────────────────────────────────────────────────────────────┘
```

### 1.2 Left column: why this app

The left copy column (`.obs-copy`) carries one beat per stop. It is the
argument, not a feature list. Draft, one per stop:

**0 — title.**
> You have watched a city get it wrong. The bus line went the wrong way. The
> money landed in the wrong district. You knew. Nobody asked you.
>
> *"He should have done this instead of that. Put the money here, not there."*
>
> Had that moment? Good. Take the office.

**1 — the airfield.** *You do not get advice. You get consequences.*
Nine blocks of runway on the northern edge. Everything you build has an address
and a bill, and both arrive whether you were paying attention or not.

**2 — downtown.** *The height rules bend once, for you.*
Land value is highest here, which is exactly why the wrong call costs the most
here. One building in this city is allowed to break the rules. You pick it.

**3 — the marina.** *Somebody is going to get rich off this water.*
The most expensive addresses in the city are looking at it. You set what they pay.

**4 — the high street.** *Approval is not a score. It is your term.*
Groceries, clinics, childcare. Let them slip and your name expires early —
onchain, publicly, with your address on it.

**5 — the stadium.** *Spend money on joy. Watch it come back.*
Parks and spectacle cost you every single day and return it in land value.
Nobody believes that until they run it.

**6 — the waterfront.** *The towers do not pay for themselves.*
The container port and the power station. Every skyline is subsidised by
somewhere nobody photographs.

**7 — the blocks.** *Twenty-five thousand people. Each one a number you own.*
This is where the residents live. The rent index you are judged on is made of
them.
> **[ TAKE THE OFFICE ]**

Copy rule for this column: two sentences plus an italic line. Any beat that needs
a third sentence is a beat that has not been written yet.

### 1.3 Right-bottom: the district ledger

Today `.obs-rail` is a column of dots with hover-only labels. It becomes a
**standing ledger** in the bottom-right:

- All eight names visible at once, right-aligned, uppercase, tight tracking.
- Current stop: full white, with a leading rule.
- Passed: 45% white. Ahead: 18% white.
- Each stays a button — clicking jumps the camera (`scrollTo(i)` already does it).
- On the last stop all eight are lit, which is the "scrolling is done" state you
  asked for: the whole city listed, every one somewhere you can actually go.

Names, in ride order: **AIRFIELD · DOWNTOWN · MARINA · HIGH STREET · STADIUM ·
WATERFRONT · THE BLOCKS**, with stop 0 unlabelled.

### 1.4 Carriage sway

Port the `train-bob` keyframes onto `.obs-car`: `translateY(0 → -6px)` over 3s,
`ease-in-out`, infinite, gated behind
`@media (prefers-reduced-motion: no-preference)`.

**Files:** `src/shell.js` (STOPS table, `_build`, `apply`), `src/style.css`.

**Done when:** cold load shows the Jaro title over the live city; scrolling moves
the camera and lights the ledger; at the last stop all eight names are lit;
`npm run smoke` is unchanged.

---

## Phase 2 — Two doors

**Effort: 1 day.**

Stop 0's CTA row replaces `Enter the city` / `New city`:

| Button | Behaviour |
| --- | --- |
| **BE THE MAYOR** (primary) | Privy login → the fork below → onboarding chapter 1 |
| **START DEMO** (ghost) | Guided tour. No wallet, no email, instant. |
| **Continue** (only when `s.day > 1`) | Resume the save. `_sync()` already computes the subtitle. |

### The fork, after login

A two-card choice, not a menu:

- **BREAK GROUND** — an empty starter block. `MM.createState()`, the `?play`
  semantics at `src/demo.js:33`. Your city from nothing.
- **TAKE OVER CITY HALL** — the built-out showcase city, inherited mid-term with
  its problems already in place. The `'showcase'` mode that is already default.

Both paths already exist as flags in `demo.js`; this is a surface over them, not
new game logic. The fork calls a new `MM.demo.start(mode)` that swaps state in
place and bumps `s.rev` so `render.js` re-bakes exactly once — rather than
setting `MM.DEMO` and reloading, which would throw away the whole point of
Phase 2.

### The handoff — the seamless zoom

`Shell.prototype.play` today snaps the camera back to `this._cam`. It becomes a
tween:

1. Fade the carriage image and the copy over 420ms.
2. Tween `r.scale` and `r.centerOn` from wherever the ride is to the play
   camera over 900ms, using the existing `ease()`.
3. Tween `s.tick` from the stop's hour to the city's real hour, so the light
   travels with the camera instead of cutting.
4. At t=1, restore `s.speed`, drop `.obs-open`, hand input back.

No page load, no cache rebuild — the renderer has been drawing the whole time.
That is the entire "move from the train window and zoom into the real city" ask,
and it is about thirty lines because `apply()` already does the hard part.

**Done when:** either door goes from carriage to playable city with no frame drop
and no white flash.

---

## Phase 3 — Privy, promoted to the front door

**Effort: 1 day.**

Privy works today but `mountWallet` attaches to `.mm-market .mkt-foot`, which
only exists after the game HUD renders — so it is unreachable from a title screen.

### 3.1 Export a login the shell can call

`web3/src/wallet.js` gains `login()` (opens the modal, resolves to `{address}` or
`null`) and `currentUser()` (cached session, no network). `web3/src/index.js`
adds both to `window.MM_CHAIN`.

### 3.2 The shell must survive the chain layer being late

`web3/bundle.js` is `defer`-loaded and 660KB. "BE THE MAYOR" can be clicked
before it exists. So the button:

1. Shows "waking the chain…" and polls for up to 4s if `MM_CHAIN.login` is
   absent — the same pattern `index.js` already uses to find `MM.state`.
2. On timeout, offers the demo door instead. Never hangs, never throws.

### 3.3 Bug to fix: the shell eats the OTP keystrokes

`src/shell.js:190` binds `keydown` on `window` **in the capture phase** and calls
`e.stopPropagation()` for every key while the shell is open.
`web3/src/wallet.js:118` stops propagation on the modal scrim — but that is a
bubble-phase listener on a descendant, so the shell's capture handler runs first
and swallows the keystroke. **Typing an email into the Privy modal from the title
screen will not work.**

Fix: the shell's capture handler returns early when `e.target.closest('.w-modal')`
is non-null. Pre-existing, and only reachable once Phase 3 puts login on the title
screen, which is why it has not bitten yet.

Check: `src/shell.test.js` synthesises a `keydown` on a `.w-modal input` and
asserts it is not stopped.

### 3.4 Restyle the modal

`.w-scrim` / `.w-modal` take the shell's glass treatment so the login does not
look like a different application. Copy: "Take the office" / "No extension, no
seed phrase, no gas. A wallet is made for you."

**Done when:** cold page, no extension, no save → BE THE MAYOR → email → code →
embedded wallet → the fork → a playable city, without ever leaving the document.

---

## Phase 4 — Onboarding, levels and gamification

**Effort: 3 days. New module: `src/quests.js`.**

### 4.1 Design rule

Quests are **derived, never stored**. `MM.quests.check(s)` is a pure function of
game state, exactly like `MM.ens` and `MM.districts`. That means no save
migration, no desync, correct after a reload, correct in a replay, and testable
without a DOM. The codebase already picked this idiom twice; this is the third.

```js
MM.quests = {
  CHAPTERS,      // ordered, static
  check(s),      // -> { chapter, index, steps: [{id,label,done}], pct }
  level(s)       // -> mayor level 1..6, derived from chapters done
}
```

`ui.js` diffs `check(s)` against its own previous frame's result to detect a
completion, so "just completed" needs no state field either.

### 4.2 The chapters

| # | Chapter | Steps | What it teaches |
| --- | --- | --- | --- |
| 1 | **Take the office** | wallet connected · `mayor.cityhall.eth` held · term clock running | Your name is onchain |
| 2 | **Break ground** | lay a road · zone a residential lot beside it · it reaches level 1 | Nothing grows without a road |
| 3 | **Keep them alive** | power reaches every zone · a clinic · a school · a bus stop · approval ≥ 60 | The tenant utilities |
| 4 | **Make it pay** | set all three tax rates · ten straight days of surplus · treasury above start | The tax structure |
| 5 | **Go on record** | push the city to CityOracle · see the tx · see it in the subgraph | The chain write is real |
| 6 | **Underwrite** | draw the faucet · deposit into a district vault · hold through one settlement | ERC-4626, live |

Each step is one predicate over `s`, plus — for 1, 5 and 6 — over `s.chain`,
which `web3/src/index.js` already populates and never blocks a frame on.

### 4.3 Mayor level

`MM.quests.level(s)` is chapters complete + 1, capped at 6:
**Candidate · Councillor · Deputy · Mayor · Boss · Machine.** Shown once, beside
the wordmark. It is not an XP bar and it does not tick.

### 4.4 The HUD surface — deliberately quiet

You asked for good gamification, not overstimulating. So exactly one new element:

- A slim card bottom-left, above the log. Collapsed by default to one line:
  `CH.2 BREAK GROUND — 1/3`, with a 2px progress rule.
- Click expands to the steps, click again collapses. Collapse state in
  `localStorage`, not in the save.
- Step completion: the row strikes through, one soft `coin` chime. No toast.
- Chapter completion: one toast, one `levelup` chime, the card advances. This is
  the only celebration in the game.
- Never blocks input, never darkens the screen, never has a Next button.

### 4.5 Tests

`src/quests.test.js` — node, no framework, matching `src/sim.test.js`. Build a
state; assert chapter 2 flips only when a zoned lot is genuinely road-adjacent;
assert `check()` is pure (twice on the same state gives an identical result and
mutates nothing).

**Files:** new `src/quests.js`, `src/quests.test.js`; edits to `src/ui.js`,
`src/style.css`, `index.html` (one script tag), `smoke.js` (load order),
`package.json` (test script).

---

## Phase 5 — The subgraph

**Effort: 2 days. Blocked on: a Subgraph Studio deploy key from you.**

### 5.1 Why it earns its place

Direct RPC reads give you *now*. They cannot give a district's NAV over ninety
days without ninety archive calls, and they cost nine round-trips to list one
wallet's positions across nine vaults. The subgraph gives both in one query. So
it ships **with a visible feature attached**: a NAV sparkline per district in the
market panel, and a one-query positions list. A logo on a slide would not be
worth two days.

### 5.2 `subgraph/`

```
subgraph/
  schema.graphql
  subgraph.yaml          generated — do not hand-edit
  build-manifest.js      reads web3/config.json + chain/deployed.json
  src/oracle.ts
  src/vault.ts
  src/token.ts
  package.json
```

The manifest is **generated from `web3/config.json`**, which already holds the
nine vault addresses, the oracle, the token and each district's ENS name.
Hand-writing eleven data sources guarantees they drift from the deployment; a
40-line generator guarantees they cannot.

### 5.3 Schema — standardized, not bespoke

The vaults are stock OpenZeppelin `ERC4626`, so they already emit the canonical
`Deposit(caller, owner, assets, shares)` and `Withdraw(...)`. The schema is the
standard 4626 shape with the city entities beside it, not layered on top:

```graphql
type Vault @entity {                  # one per district
  id: Bytes!                          # address
  districtId: Int!
  ensName: String!                    # riverside.cityhall.eth
  asset: Bytes!
  totalAssets: BigInt!
  totalShares: BigInt!
  sharePrice: BigDecimal!
  positions: [Position!]!  @derivedFrom(field: "vault")
  events:    [VaultEvent!]! @derivedFrom(field: "vault")
}

type Account  @entity { id: Bytes!  positions: [Position!]! @derivedFrom(field: "account") }

type Position @entity {
  id: ID!  account: Account!  vault: Vault!
  shares: BigInt!  depositedAssets: BigInt!  withdrawnAssets: BigInt!
}

type VaultEvent @entity(immutable: true) {
  id: Bytes!  vault: Vault!  kind: VaultEventKind!  account: Bytes
  assets: BigInt!  shares: BigInt!  assetsAfter: BigInt!
  block: BigInt!  timestamp: BigInt!  tx: Bytes!
}
enum VaultEventKind { DEPOSIT WITHDRAW REMIT SETTLE }

type CitySnapshot @entity(immutable: true) {
  id: Bytes!  day: Int!  approval: Int!  rating: Int!  pop: Int!
  mayor: Bytes!  timestamp: BigInt!  tx: Bytes!
}

type DistrictSnapshot @entity(immutable: true) {
  id: Bytes!  districtId: Int!  day: Int!
  nav: BigInt!  pop: Int!  land: Int!  level: Int!  timestamp: BigInt!
}

type Mayor @entity { id: Bytes!  pushes: Int!  firstDay: Int!  lastDay: Int! }
```

Handlers map one-to-one onto events the contracts already emit — nothing needs a
contract change:

| Event | Source | Handler |
| --- | --- | --- |
| `Deposit`, `Withdraw`, `Transfer` | DistrictVault ×9 | `src/vault.ts` |
| `Remitted` | DistrictVault ×9 | `src/vault.ts` |
| `CityPushed` | CityOracle | `src/oracle.ts` |
| `DistrictPushed` | CityOracle | `src/oracle.ts` |
| `Settled` | CityOracle | `src/oracle.ts` |
| `FaucetDrawn` | CityUSD | `src/token.ts` |

`startBlock` per source comes from `chain/deployed.json`, so the first sync takes
seconds rather than scanning Sepolia from genesis.

### 5.4 Client

New `web3/src/graph.js`, bundled into the existing `web3/bundle.js`:

- `queryDistricts()` — nine vaults plus latest snapshot, one request
- `queryPositions(address)` — one wallet across all vaults, one request
- `queryHistory(districtId, n)` — n `DistrictSnapshot`s, for the sparkline

`index.html`'s CSP already allows `api.studio.thegraph.com` and
`gateway.thegraph.com`, so no CSP change.

Same failure discipline as `index.js`: a dead endpoint is **staleness, never a
crash**. The sparkline keeps its last points and the badge flips to "stale". A
frozen snapshot at `web3/fixtures/history.json` backs the demo so a flaky Sepolia
on stage cannot produce an empty chart — clearly labelled in the UI when it is
the fixture talking, because a fake number presented as live is worse than no
number.

### 5.5 Deploy

```bash
npx graph auth --studio $GRAPH_DEPLOY_KEY
npm --prefix subgraph run codegen
npm --prefix subgraph run build
npm --prefix subgraph run deploy
```

The query URL lands in `.env` as `SUBGRAPH_URL` and is copied into
`web3/config.json` by the existing `web3/make-config.js`.

**Done when:** the market panel draws a real 90-day NAV sparkline sourced from
Studio, and the docs page's Graph block links to the live query URL.

---

## Phase 6 — `/inside.html`, the what's-actually-happening page

**Effort: 2 days.**

White. Minimal. Visual. The rule is a **text budget**, enforced while writing:
every block gets one title, one subtitle of six words or fewer, and at most three
bullets of eight words or fewer. If a block needs a paragraph, the diagram is not
doing its job and the diagram gets redrawn.

### 6.1 Build

A static `inside.html` plus `src/inside.css`. No React, no bundler — same
constraint as the rest of `src/`, and `tools/serve.js` already serves `.html`.
Every diagram is **inline SVG**: crisp, themeable, zero requests, and legible in
the page source.

### 6.2 The main diagram — the horizontal block flow

The layout from your reference: cards in a row, dotted connectors between them,
one card highlighted, one card holding a stacked list.

```
┌────────┐    ┌──────────┐    ╔═══════════╗    ┌────────────┐    ┌──────────┐
│  YOU   │┈┈▶ │  PRIVY   │┈┈▶ ║ YOUR CITY ║┈┈▶ │ CITYORACLE │┈┈▶ │ 9 VAULTS │
│        │    │          │    ║           ║    │            │    │ ERC-4626 │
│ an     │    │ e-mail,  │    ║ a determ- ║    │ one write  │    │ downtown │
│ e-mail │    │ then a   │    ║ inistic   ║    │ per term   │    │ midtown  │
│ address│    │ wallet   │    ║ simulation║    │            │    │ riverside│
└────────┘    └──────────┘    ╚═══════════╝    └────────────┘    │ …        │
     ▲                                                           └──────────┘
     │                                                                │
     └──────────────── THE GRAPH ◀───────────────────────────────────┘
                       history, in one query
```

The highlighted card is **YOUR CITY**, because that is the claim: the thing on
chain is the output of a real simulation, not a number someone typed.

### 6.3 The identity diagram — ENS subregistries

A tree drawn with names `src/ens.js` actually derives, generated at author time
by running the module rather than by inventing examples:

```
cityhall.eth                                       the city
└── downtown.cityhall.eth                          a district — its own registry
    └── 1422-canal.downtown.cityhall.eth           a parcel
        └── ada.1422-canal.downtown.cityhall.eth   a resident
```

Three bullets, total:
- Each district owns its own registry.
- A parcel's name is a pure function of its tile.
- Nothing is stored. The same city names the same things everywhere.

### 6.4 The five blocks

| Block | Glyph | The three lines | The proof on the card |
| --- | --- | --- | --- |
| **ENS** | nested squares | own registry per district · names derived, not stored · residents too | a live name, resolving |
| **Privy** | key into a door | e-mail, no extension · wallet made for you · no seed phrase, no gas | "60 seconds, cold" |
| **The Graph** | layered planes | one query, nine vaults · ninety days of history · standardized 4626 schema | the real query, runnable |
| **ERC-4626** | stacked coins | stock OpenZeppelin · totalAssets is the real balance · price moves because the city did | the Etherscan link |
| **The simulation** | the isometric grid | deterministic · no RNG in naming or drawing · same city on every machine | a seed and two identical frames |

Every card carries one **real artifact** — an address, a name, a runnable query —
not a description of one. That is the difference between a docs page and a pitch
deck.

### 6.5 Entry points

- Shell nav: "What's inside", replacing "The chain".
- Direct at `/inside.html`, works with the game never loaded.
- A dark variant via `prefers-color-scheme`, because it will be opened from a
  dark game.

---

## Phase 7 — The five-minute budget

**Effort: 2 days. New module: `src/tour.js`.**

`MM.tour` drives the camera and the sim that already exist. It adds no game logic
— it schedules beats and lets the real systems produce the results.

| Clock | Beat | Driven by |
| --- | --- | --- |
| 0:00 | Title. Jaro. The regret line. Two buttons. | `shell.apply(0)` |
| 0:25 | The ride. Eight stops, auto-advancing. | `shell.scrollTo(i)` on a timer |
| 1:40 | Lands in the city. Sim at speed 3. | the Phase 2 handoff tween |
| 1:55 | An event fires and is answered. | `MM.maybeFireEvent` — the real one |
| 2:10 | Inspector opens a parcel. A real ENS name resolves. | `MM.inspect` |
| 2:40 | Oracle push. Tx hash. Etherscan link. | `MM_CHAIN.pushNow(true)` |
| 3:20 | Subgraph sparkline and positions appear. | `graph.queryHistory` |
| 4:00 | Deposit into a district vault. The position appears. | `MM_CHAIN.deposit` |
| 4:30 | Camera pulls back. Title returns. | `shell.show('title')` |

Skip is always live: any key, or a click on "take it from here", stops the tour
where it is and hands over a fully playable city. It never traps anyone.

Beats 2:40 and 4:00 need a funded wallet. The tour pre-checks and, without one,
substitutes the read-only version of the same beat — showing the last real push
from the subgraph instead of making a new one — rather than showing an error. A
demo must not depend on a stranger's inbox.

### `tools/tour-check.js`

Headless rehearsal. Asserts every beat fires, in order, and that the total is
under 300 seconds on a cold load. This is the check that fails if the tour
breaks, and the only reason to trust a five-minute claim.

---

## What I need from you

1. **A Subgraph Studio deploy key.** Phase 5 cannot deploy without it. Put it in
   `.env` as `GRAPH_DEPLOY_KEY` — do not paste it into chat.
2. **A funded Sepolia address** for the demo wallet, so beats 2:40 and 4:00 take
   the real write path rather than the fallback.
3. **A call on the fonts** if you want the Google CDN link tags rather than the
   self-hosted woff2 (see the assumption at the top).

---

## Risks, named

| Risk | Mitigation |
| --- | --- |
| Sepolia RPC dies mid-pitch | Already treated as staleness, never a crash. Plus the labelled fixture in 5.4. |
| Privy e-mail OTP on stage | Session persists in LocalStorage — log in beforehand. And START DEMO needs no wallet at all. |
| Jaro illegible at 12rem | Checked in Phase 0, before anything is built on it. |
| The rename breaks saves | It does not — no persisted key contains the name. Verified against `src/state.js`. |
| `smoke.js` load-order assert | Every new `src/` file is added to it in the same commit. Non-negotiable; it is how this repo catches load-order bugs. |
| Scope | Phases 0–2 are a complete, shippable improvement alone. 4, 5 and 6 are independent of each other and can land in any order. |

---

## Sequence

```
0  rename + Jaro + delete landing/      0.5d   independent
1  shell becomes the landing page       2.0d   needs 0
2  two doors + the zoom handoff         1.0d   needs 1
3  Privy at the front door              1.0d   needs 2
4  quests + levels                      3.0d   needs 3
5  subgraph                             2.0d   needs a deploy key only
6  inside.html                          2.0d   independent
7  guided tour + rehearsal              2.0d   needs 2, ideally 4 and 5
                                       -----
                                       13.5d
```

Phases 5 and 6 run in parallel with 1–4 — neither touches `src/shell.js`.

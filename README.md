# MAYOR MAMDANI

An isometric New York City-builder that runs in a window next to your IDE.

You are the Mayor. You have four years, a treasury, and a city that will tell you
loudly when you get it wrong. Zone it, wire it with roads and buses, pass the
platform you ran on, and try to still be popular when the term is up.

Built to be played in the gaps — while a build runs, while a test suite churns,
while an agent is thinking. Glance over, lay two blocks, glance back.

## Run it

```bash
npm install
npm run serve      # → http://localhost:8080
```

That is the build the Web3 layer targets. `npm start` still opens the Electron
window if you prefer it next to your IDE.

Two switches on the URL: `?diorama` freezes the economy and holds the city
exactly as planned (the mode to shoot stills in), `?play` opens on the starter
block instead of the built-out city.

## Build a Windows executable

```bash
npm run dist
```

Output lands in `dist/MayorMamdani-win32-x64/`. `MayorMamdani.exe` is the game —
the folder is self-contained and portable; copy it anywhere.

## Checks

```bash
npm test
```

`npm test` runs the simulation unit tests. `node smoke.js` runs the full
integration harness: it loads every module against a fake DOM, drives 500 game
days, answers every event, toggles every policy on and off, and fails on any
NaN, out-of-range stat, or broken module contract. Both run without Electron.

## Playing

| | |
|---|---|
| `1`-`9`, `s`, `t`, `0` | pick a build tool |
| Left-drag | build / paint |
| Right-drag | pan the city — flick and let go to throw it |
| Wheel | zoom |
| Arrows | pan (hold them), `Shift` to sprint |
| Space | pause / resume |
| `+` / `-` | game speed |
| `m` | mute |

**The one rule that matters:** nothing grows without a road. Zone next to roads,
or you're paying upkeep on empty lots.

Then watch three numbers. **Rent** is the heart of the game — let it run and
approval bleeds and people leave. **Unemployment** means you zoned homes without
jobs. **Traffic** means you built roads where you needed buses.

Policies are real trade-offs, not upgrades. A rent freeze holds rent down and
slows new housing. Taxing high earners funds everything and cools commercial
growth. Free buses are transformative and get more expensive with every resident
you attract. There is no build order that wins for free.

## Architecture

Electron shell, one HTML page, plain canvas 2D. No bundler, no framework, no
runtime dependencies — classic `<script>` tags over a single `window.MM`
namespace, which is also what makes it portable to a browser-extension side
panel later.

| File | Owns |
|---|---|
| `main.js` | Electron window |
| `src/state.js` | the shared state shape, terrain seed, save/load |
| `src/sim.js` | land value, growth, rent, traffic, budget, approval |
| `src/render.js` | isometric renderer, day/night, traffic animation |
| `src/ui.js` + `style.css` | HUD, policy cards, budget, event modal |
| `src/policies.js` | the platform |
| `src/events.js` | things that happen to a city |
| `src/audio.js` | synthesized sound, no assets |
| `src/game.js` | input, main loop, build/bulldoze, wiring |
| `src/districts.js` | the nine districts, and what each one is worth |
| `tools/serve.js` | static host, no dependencies |
| `chain/` | ENSv2 addresses, ABIs, preflight — the only place npm deps live |

`CONTRACT.md` is the interface between those modules and the reason several of
them could be written at the same time.

## The Web3 layer

Built for **ETHOnline 2026**. Full plan in [`docs/WEB3_PLAN.md`](docs/WEB3_PLAN.md);
daily progress in [`CHANGELOG.md`](CHANGELOG.md).

> **The city is a public company and the mayor is its management.** Nine
> districts each issue shares. Share value tracks that district's land value —
> a number the simulation already computes every game-day. Every office, every
> district, every parcel and every tenant is an ENS name, and the names are not
> labels: holding one is what grants the permission to act.

Three tracks, one chain (Sepolia), because a system a judge can hold in their
head beats three bolt-ons they cannot:

| Track | What it does here |
|---|---|
| **ENS** (ENSv2) | The city is a namespace. `mayor.…eth` **expires** with the four-year term, is **revoked** by the recall the simulation already triggers, and is **non-transferable** because an office cannot be sold — while a parcel deed can. Each district deploys its own registry and issues its own parcels. |
| **The Graph** | A standardized ERC-4626 subgraph over the district vaults, composed with Substreams on the same chain. It is what makes the live numbers real rather than asserted. |
| **Privy** | Embedded wallets, so anyone is in the economy in ten seconds with no seed phrase. The treasury is a shared organization wallet behind a key quorum. |

### Why ENS is load-bearing, not decoration

`CityOracle.push()` — the only way city data reaches the chain — requires the
caller to hold the write role on the mayor's name. **No name, no write.** When
the term expires the name expires and the transaction reverts on its own.

The root is the *institution*, not the person: a player's own name **holds**
`mayor.…eth` rather than being it. Term ends, the office burns, the person
remains — identity intact, permissions gone. Permissions were never attached to
the human; they were attached to the role.

### What it does not do

The simulation stays local, synchronous and deterministic. `src/*.js` never
touches the network — the chain layer loads beside it, never inside it. Pull the
network out and this is exactly the game it was before.

### Where this is going

Private lobbies: a lobby deploys its own subtree, the host picks a mayor, and
friends join as **tenants** holding expiring, non-transferable subnames. The
chain is already the server. After that, a municipal bond desk and a cross-city
index — many cities, one market.

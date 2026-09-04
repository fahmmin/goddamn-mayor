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
npm start
```

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
| Right-drag | pan the city |
| Wheel | zoom |
| Arrows | pan |
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

`CONTRACT.md` is the interface between those modules and the reason several of
them could be written at the same time.

## Where this is going

Browser-extension side panel. Then the Web3 layer — city charters as assets,
cross-city trade, a shared metaverse map. The simulation is deliberately
self-contained so none of that has to touch it.

---
name: mm-module-contract
description: Use when writing or editing any file in src/ of MAYOR MAMDANI - the module wrapper, the window.MM namespace, load order, and the hard constraints (no ES modules, no bundler, no npm runtime deps, no network, must run from file://).
---

# MAYOR MAMDANI module contract

Electron app, one HTML page, canvas 2D. **Classic `<script>` tags. No ES modules,
no bundler, zero npm runtime dependencies.** Everything hangs off `window.MM`.

## Every module file is wrapped exactly like this

```js
window.MM = window.MM || {};
(function (MM) { 'use strict';
  /* ... */
  MM.thing = thing;
})(window.MM);
```

No `export`, no `import`, no `require` inside `src/`. `require` exists only in
`main.js`, which is the Electron main process.

## Load order

`index.html` loads modules in dependency order, and `smoke.js` asserts that order:

```
state.js -> gfx.js -> audio.js -> policies.js -> events.js -> sim.js ->
ground.js -> roofs.js -> props.js -> lots.js -> render.js -> ui.js -> game.js
```

Adding a module means adding one `<script>` tag **and** updating `smoke.js` to match.

## Files you must not edit

- `src/state.js` — the shared state shape. Read-only truth for every other module.
- `src/game.js` — input, main loop, wiring.

If a change seems to need either, that is the signal to stop and ask, not to edit.

## What state.js gives you

Constants: `MM.GRID` (48), `MM.TICKS_PER_DAY` (24), `MM.TILE`, `MM.TILE_INFO`,
`MM.BUILDABLE`, `MM.ZONES`, `MM.SERVICES`.

Helpers: `MM.idx(x,y)`, `MM.inBounds(x,y)`, `MM.createState()`, `MM.count(s,tile)`,
`MM.log(s,text,kind)`, `MM.saveState/loadState/clearSave`.

State fields: `tick, day, speed, grid` (Uint8Array), `level` (Uint8Array 0..4),
`pow` (Uint8Array 0..255, land value), `pop, jobs, employed, treasury, approval,
rent, traffic, happiness, pollution, ridership, dailyIncome, dailyCost,
taxRate{res,com,ind}, policies{}, log[], pending, selected, streak, termDay,
gameOver, cooldowns{}`.

## Module APIs — implement exactly these

| File | Exports |
|---|---|
| `audio.js` | `MM.audio.play(name)`, `.setMuted(bool)`, `.muted`, `.ambient(bool)` |
| `policies.js` | `MM.POLICIES`, `MM.togglePolicy(s,id)`, `MM.policyDailyCost(s)`, `MM.hasPolicy(s,id)` |
| `events.js` | `MM.EVENTS`, `MM.maybeFireEvent(s)` |
| `sim.js` | `MM.sim.step(s)` (exactly 1 tick), `MM.sim.derive(s)` |
| `lots.js` | `MM.lots.plan/role/draw/lots` |
| `render.js` | `MM.Renderer` — `resize, draw, screenToTile, panBy, zoomAt, centerOn, hover, overlay` |
| `ui.js` | `MM.UI` — `update, toast, showEvent, setMuted` (owns `src/style.css`) |

Shapes:

```js
POLICIES[i] = { id, name, icon, blurb, dailyCost, unlockPop, effects: {...} }
EVENTS[i]   = { id, title, text, icon, weight, cooldown, cond(s)->bool,
                choices: [ { label, hint, apply(s) } ] }
```

`sim.step()` must call `MM.maybeFireEvent(s)` on day rollover and assign the
result to `s.pending`.

## Hard constraints

- **No network calls, no external fonts, no CDN.** CSP is `default-src 'self'`.
  A Google Fonts link will silently fail to load and the app must still look right.
- **Must run from `file://`** inside Electron. Anything assuming an HTTP origin is out.
- **Audio is synthesized**, never asset files. Create the `AudioContext` lazily on
  first call and `resume()` it — Chromium blocks audio until a user gesture.
- **`ui.update(state)` runs every frame.** Diff text, never rebuild DOM.
- **`#hud` overlays the full-bleed `#city` canvas.** HUD wrappers are
  `pointer-events:none` with `pointer-events:auto` on the actual controls, or map
  dragging breaks.

## Checks

```bash
npm test     # src/sim.test.js
npm run smoke
```

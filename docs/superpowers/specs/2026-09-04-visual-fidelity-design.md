# Visual fidelity — design

**Date:** 2026-09-04
**Status:** approved, implementing
**Piece:** D of four (see Scope below)

## Goal

Move the city's look toward a modern mobile city-builder (SimCity BuildIt was the
reference the user supplied): a real downtown silhouette, bridges over the river,
and a hero landmark.

**Non-goal:** parity with the reference. That is a 3D engine with hand-authored
meshes and textures. This game draws procedural canvas paths with zero art assets
and no dependencies. Everything here is scoped to what this renderer can reach.

## Scope

The user's request covered four independent subsystems. They were decomposed and
ordered; this spec covers **D** only.

| # | Piece | Depends on |
|---|-------|-----------|
| A | Player level + XP | — |
| B | HUD / UI density | A, C |
| C | Production + timers | A, B |
| **D** | **Visual fidelity** | **nothing** |

Order agreed: **D → A → B → C**. D is orthogonal — it touches no game rules, so it
cannot be invalidated by the others.

## Constraints

Inherited from `CONTRACT.md`, all binding:

- Classic `<script>` tags, no ES modules, no bundler, zero npm runtime deps.
- Everything hangs off `window.MM`; every file uses the standard module wrapper.
- No network, no external fonts, no CDN. CSP is `default-src 'self'`.
- Must run from `file://` inside Electron.
- `state.js` and `game.js` are never edited.

**Renderer-only boundary (decided):** no new tile types, no `sim.js` changes, no
save-format change. Bridges are drawn where roads already imply them; landmarks
are placed by the city plan.

## Key findings that shaped the design

**1. Land value cannot drive the height gradient.**
`sim.js:242-250` rewrites `s.pow` every day but never bumps `s.rev`. Heights driven
from it would silently desync the static render cache; adding invalidation would
trigger the ~500ms rebuild daily.

`s.level` is the correct driver: it bumps `rev` at `sim.js:316`, and
`lots.plan()` already reruns exactly on `rev`. A downtown score computed inside
`plan()` therefore costs no new cache machinery.

**2. Crossings exist, but only in built-out cities.** Measured with a throwaway probe:

| Map | Water tiles | Crossings | Spans |
|---|---|---|---|
| Starter (`createState`) | 192 | 0 | — |
| Demo showcase | 184 | 20 | 4×17, 5×2, 8×1 |

The river is a uniform 4-wide band across 46 rows. So bridges render nothing on a
fresh map (correct — no roads reach the water yet), and the demo city currently has
**20 roads dead-ending into the river**, a visible flaw this fixes.

20 identical spans would read as a fence, hence the tiering below.

## Design

### 1. Downtown gradient + architecture (`lots.js`)

- `plan()` computes a per-lot `dt` (0..1): the fraction of tiles in a radius-4
  neighbourhood at level 3–4. Cached with the plan, so it reruns exactly on `rev`.
- `shape()` gains a `dt` term, gated on lot size so a 1×1 can never be a supertall:
  `top *= 1 + dt * 0.25 * (area >= 4 ? 1 : 0)`
- Two new commercial archetypes, chosen only in the top `dt` band so they cluster
  rather than speckle:
  - `spire` — TALL 15, tapering setbacks to a mast (~220px @ scale 1, vs 110 today)
  - `setback` — TALL 11, stepped ziggurat crown
- The saturated-glass branch at `lots.js:2220` currently fires on `r < 0.30`
  everywhere. Gate the strong tints on `dt` instead: the pale model-village palette
  survives in outer districts, colour concentrates downtown.

### 2. Bridges (`bridges.js`, new)

- `MM.bridges.plan(s)` caches on `s.rev`; scans rows and columns for
  `road → water×N → road`, N in 1..10.
- Drawing hooks into the existing per-diagonal sweep in `render.js:_structures`,
  which already interleaves by `d = x+y` for vehicles. That yields correct
  painter's order against buildings for free, inside the static cache.
- **Tiered:** every crossing gets a plain deck with piers; suspension towers and
  cables only on spans ≥4 that sit ≥8 tiles from another hero span, picked with
  `gfx.hash` so it is deterministic and never flickers.
- Deck sits ~0.55 × `UNIT` above the water so the boats in `sky.js` pass under it.

### 3. Landmark (`landmarks.js`, new)

- Draws entirely through the public `MM.gfx` API with its own local frame, so it
  needs none of `lots.js`'s private `Q` state.
- One delegation line in `lots.js`: when `L.arch === 'hero'`, hand off to
  `MM.landmarks.draw`.
- Placed with the existing `pin(x, y, arch, w, h)` on a 3×3 block. A tapering
  lattice spire, roughly 2× the new supertalls.
- **Demo-only, deliberately.** The airport, stadium and marina are already
  demo-only; `createState()` has none of them. Auto-placing a landmark in a player
  city would silently turn a tower they built into an Eiffel Tower. Player cities
  get landmarks in piece A, when they become unlockable.

### 4. Integration fix

`render.js:_rebuildLights` caps window rows at 9
(`clamp(round(top/(22*sc)), 1, 9)`). At 220px that spreads 9 rows over the full
height and windows read as giant. Cap goes to 18.

`light.js:reflect` needs no change — it reads `sh.top`, so taller towers get longer
water reflections automatically.

## Files

| File | Change |
|---|---|
| `src/lots.js` | downtown score, `dt` height term, `spire`/`setback`, colour gating, `hero` delegation |
| `src/bridges.js` | **new** |
| `src/landmarks.js` | **new** |
| `src/render.js` | bridge diagonal hook, window row cap 9→18 |
| `src/demo.js` | pin the landmark |
| `index.html`, `smoke.js` | load order (both must match) |
| `CONTRACT.md` | document the two new modules |

## Verification

- `npm test` (sim unit tests) and `npm run smoke` (206-check integration) stay green.
- Determinism: `lots.js` and the new modules use `gfx.hash` only, never
  `Math.random`, or the static cache flickers.
- Real renders through the actual pipeline via `tools/shot.js` at several zooms and
  hours — the method that worked for the lighting pass. Screenshots are the
  acceptance test; there is no pixel assertion.
- **Perf budget, measured against the current baseline:** cache rebuild stays under
  ~1s, live draw stays under ~1ms at default zoom. Supertalls increase overdraw, so
  rebuild is the number to watch.

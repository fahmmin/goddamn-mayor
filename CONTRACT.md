# MAYOR MAMDANI - module contract

Electron desktop app. **Classic `<script>` tags, no ES modules, no bundler, ZERO npm runtime deps.**
Everything hangs off the global `window.MM`. Load order (index.html):

    state.js -> gfx.js -> audio.js -> policies.js -> events.js -> sim.js ->
    ground.js -> roofs.js -> props.js -> lots.js -> light.js -> bridges.js ->
    landmarks.js -> sky.js -> render.js -> ui.js -> demo.js -> game.js

Every module file must be wrapped exactly like this:

    window.MM = window.MM || {};
    (function (MM) { 'use strict';
       /* ... */
       MM.thing = thing;
    })(window.MM);

## From state.js (read-only truth - do NOT edit state.js)

`MM.GRID` (48), `MM.TICKS_PER_DAY` (24), `MM.TILE`, `MM.TILE_INFO`, `MM.BUILDABLE`,
`MM.ZONES`, `MM.SERVICES`, `MM.idx(x,y)`, `MM.inBounds(x,y)`, `MM.createState()`,
`MM.count(s,tile)`, `MM.log(s,text,kind)`, `MM.saveState/loadState/clearSave`.

State fields: `tick, day, speed, grid(Uint8Array), level(Uint8Array 0..4), pow(Uint8Array 0..255 land value),
pop, jobs, employed, treasury, approval, rent, traffic, happiness, pollution, ridership,
dailyIncome, dailyCost, taxRate{res,com,ind}, policies{}, log[], pending, selected, streak, termDay, gameOver, cooldowns{}`

## Module APIs - implement exactly these

### src/audio.js -> `MM.audio`
- `MM.audio.play(name)` - names: `place, bulldoze, coin, error, event, levelup, ui, bus, alarm, cheer`
- `MM.audio.setMuted(bool)`, `MM.audio.muted`
- `MM.audio.ambient(bool)` - looping low city hum
WebAudio synthesis only, no asset files. Lazily create the AudioContext on first call and
resume() it, because Chromium blocks audio until a user gesture.

### src/policies.js -> `MM.POLICIES`, `MM.togglePolicy(s,id)`, `MM.policyDailyCost(s)`, `MM.hasPolicy(s,id)`
`POLICIES[i] = { id, name, icon, blurb, dailyCost, unlockPop, effects: {...} }`

### src/events.js -> `MM.EVENTS`, `MM.maybeFireEvent(s)`
`EVENTS[i] = { id, title, text, icon, weight, cooldown, cond(s)->bool, choices: [ { label, hint, apply(s) } ] }`
`maybeFireEvent(s)` returns an event object or null. Called once per game day by sim.

### src/sim.js -> `MM.sim.step(s)` (advances exactly 1 tick), `MM.sim.derive(s)`
`step()` must call `MM.maybeFireEvent(s)` on day rollover and assign the result to `s.pending`.

### src/gfx.js -> `MM.gfx` (drawing primitives, and the light)
Besides the isometric primitives, gfx owns the art-direction sun. Two shared
constants, because a tree, a tower and a lamp post all have to agree about it:

- `MM.gfx.CAST` - `{ x, y, len, tint, foot }`. Where a shadow lands on the
  ground and how dark: `x, y` is the unit screen direction (down and to the
  right, towards the camera - the only place an isometric shadow can be seen),
  `len` the ground reach per pixel of drawn height, `tint`/`foot` the rgba of
  the long throw and of the contact seam. render.js casts the buildings,
  props.js the trees and street furniture.
- `MM.gfx.FL` - the colour of the light per face `[top, +v, +u]`. A roof square
  to the sun goes warm, a wall turned away is lit by sky alone and goes blue.
  `gfx.faces()` applies it; render.js's own face table matches it by hand.

### src/lots.js -> `MM.lots`
Block-scale buildings. The tile grid is the zoning; the architecture is a *lot*.

- `MM.lots.plan(s)` - groups neighbouring tiles of one kind into rectangular lots
  (1x1 up to 3x3) and assigns each an archetype. Rebuilt only when `s.rev` changes.
- `MM.lots.role(s,x,y)` -> `0` not ours | `1` this tile anchors a lot | `-1` covered by its lot.
  The anchor is the lot's max corner, so painter's order by `x+y` still holds.
- `MM.lots.draw(ctx, {s,x,y,cx,cy,fx,fy,scale})` - draws the whole complex from its anchor.
- `MM.lots.ground(ctx, o)` - same `o`, but paints **only** the lot's ground
  plane: its lawn, forecourt, plaza. render.js calls this from the ground pass,
  because the whole ground plane has to be down before the shadows are laid or
  every lot paints over the shadow falling across it. `draw()` then skips those
  same pads. Internally it runs the archetype with everything but the flat
  ground-level pads aimed at a null context, so no primitive needs a special
  case and none can leak through.
- `MM.lots.lots` - the current plan, for tests.

Claims RES/COM/IND/PARK plus SCHOOL, CLINIC, GROCERY, CHILDCARE and TOWER.
render.js draws only ROAD, WATER, EMPTY and BUS itself. Archetypes are keyed by
kind, level and lot size: `podium curve atrium court campus rotunda mall strip`
(commercial), `row perim towers` (residential), `shed plant yard` (industrial),
`green pond sport plaza` (parks), `school clinic market creche social` (civic).

Deterministic: `MM.gfx.hash` only, never `Math.random`, or the static cache flickers.

### src/light.js -> `MM.light`
The sun, and everything that reflects it. render.js bakes the city at fixed noon
into an offscreen cache, so this file is split the same way:

- `MM.light.update(r)` - fills `MM.light.sun` from the renderer's clock:
  `{elev, day, gold, u, v, kU, kV, sx, sy, r}`. `u,v` is the sun as a tile-space
  direction; `sx,sy` is where its disc sits on screen. Called once a frame.
- `MM.light.reflect(ctx, r, s)` - **baked**. Water mirrors. Called from inside
  the static pass, before roads and structures, so a building on the near bank
  occludes the reflection of one on the far bank for free.
- `MM.light.sky(ctx, r)` - Sun disc and haze, or the moon after dark.
- `MM.light.shimmer(ctx, r, s)` - **live**. Sky sheen, two wave trains and sun
  glitter on open water. Three fills total; drops out below scale 0.62.
- `MM.light.glow(ctx, r)` - The directional wash from the sun's screen
  position, on top of render.js's flat ambient `_tint`.
- `MM.light.haze(ctx, r)` - Aerial perspective: air scatters enough
  light to lift the far end of a view towards the sky's colour, and an
  isometric camera puts "far" straight up the screen. Keyed to the screen, not
  the ground, so it cannot go in the *city* cache.
- `MM.light.key(r)` - what those three washes depend on, as a string. They are
  a pure function of the light and the window, and each is a full-viewport
  gradient - 2ms for a linear one and 3.6ms for a radial, against 1.2ms to
  blit the same pixels. So render.js paints them into offscreen layers once
  per light bucket and blits those (`_bakeAtmo`); this key says when a bake
  has gone stale. It quantises the sun's position and the light, or the layer
  rebakes every frame and the gradient is paid for anyway.
- `MM.light.glowAlpha()` - strength of the additive wash, so an empty layer
  can be skipped rather than blitted.

Because they are baked, `sky/glow/haze` must draw only from `sun`, `r.w/h` and
`r.L/N/golden` - never from the grid, the camera or the clock directly - and
must not assume they are drawing into the live context.

Reflective *shading* is not here: it lives in `gfx.setSun/gfx.spec`, which adds a
specular lobe inside the existing wall fill in `extrude`/`faces`, so every module
that draws a wall gets it with no extra draw call and no depth problems.

### src/bridges.js -> `MM.bridges`
Road crossings over the river. Roads stop dead at water; anywhere a road reaches
one bank and another picks up on the far bank in the same line, the network
already implies a crossing.

- `MM.bridges.plan(s)` - finds `road -> water x N -> road` runs. Cached on `s.rev`.
- `MM.bridges.drawDiag(ctx, o, d)` - draws every deck tile on diagonal `d`.
  `o` is `{ox, oy, fx, fy, scale}`. Called from render.js's structure sweep, which
  already orders by `d = x+y`, so an elevated deck paints correctly between what
  is behind it and what is in front.

Tiered: every crossing gets a deck, piers and railings; only long spans well
clear of another get towers and cables, or twenty crossings read as a fence.
Renderer-only - no tile type, no sim change, no save change.

### src/landmarks.js -> `MM.landmarks`
Hero structures - the one building allowed to break the height rules.

- `MM.landmarks.draw(ctx, o, L, Q)` - called from `lots.js` when a lot's
  archetype is `'hero'`. Draws on the public `MM.gfx` API with its own frame.
- Height is read from `MM.lots.shape()`, so the tower, render.js's window lights
  and light.js's water reflections agree.

Placed with `MM.lots.pin` from the city plan in `demo.js`, like the airport and
stadium. Never auto-placed.

### src/render.js -> `MM.Renderer`
Owns the static cache and, inside it, the ground-shadow layer. A cast shadow is
the swept silhouette - the convex hull of a footprint and the same footprint
pushed out along `MM.gfx.CAST`. Every caster goes into one offscreen layer, so
overlapping shadows union instead of stacking into blotches, and it blits back
through a blur with `source-atop` so the result lands on painted ground and not
on the open sky. Baked at noon like the rest of the cache.

- `new MM.Renderer(canvas)`
- `r.resize()`, `r.draw(state, dtMs)`
- `r.screenToTile(px,py)` -> `{x,y}` or `null`
- `r.panBy(dx,dy)`, `r.zoomAt(px,py,delta)`, `r.centerOn(x,y)`
- `r.panHold(dx,dy,boost)` - unit direction for held keys, or `(0,0)` to stop
- `r.fling(vx,vy)` - throw the map, px/s; `r.stopPan()` kills both
- `r.clampCamera()` - keep some city on screen
- `r.hover = {x,y}|null`, `r.overlay = 'none'|'value'|'traffic'|'pollution'`

**The cache is the performance contract.** A rebuild is 400-900ms of vector
drawing on a built-up city, so the whole design is about not doing one:

- It caches **as much of the city as a device-pixel budget allows** rather than
  a viewport plus a fixed margin. The grid is 48x48, so at ordinary zooms the
  whole city fits and a pan is a blit and nothing else. Zoomed past that, the
  margin falls back to whatever the budget buys.
- A rebuild **waits for the camera to stop**. Mid-gesture the existing cache is
  blitted where it now belongs and at the size it now wants (`_blitAt`), so a
  zoom goes soft for the length of the wheel spin and sharpens when it ends,
  rather than dropping a 750ms freeze into the middle of it.
- A grid change repaints **only the tiles whose picture changed**. `_sig` builds
  a per-tile signature (tile, level, the neighbours a road links to, and the
  identity of the lot covering it); diffing it against the last bake gives the
  exact dirty set, and `_paintCity(s, rect)` repaints that rect under a clip.
  `s.rev` is bumped by every player edit *and* by every block that levels up on
  its own, so this path runs constantly.
- Canvas memory is part of the contract. Chromium keeps 2D canvases on the GPU
  only up to a budget and silently drops to software past it, which costs about
  10x. Keep the total (city cache + light layer + shadow layer + live) well
  under 100MB; the light layer is held at half resolution for this reason, and
  it is why the shadow blur rides out on its blit rather than getting a second
  canvas of its own.

`tools/perf.js` measures all of it. Note that canvas2d is queued: timing a draw
call measures nothing until the pipeline is drained, so drain with getImageData
once per block of frames - never per frame, where the drain costs more than the
frame.

### src/ui.js -> `MM.UI` (+ owns src/style.css)
- `new MM.UI(rootEl, state, handlers)` with handlers
  `{ onSelect(tile), onPolicy(id), onSpeed(n), onOverlay(name), onTax(kind,val), onSave(), onReset(), onMute() }`
- `ui.update(state)` - called every frame, must be cheap (diff text, never rebuild DOM)
- `ui.toast(text, kind)`, `ui.showEvent(evt, cb)`, `ui.setMuted(bool)`

`#hud` is an empty div overlaying the full-bleed `#city` canvas. HUD wrapper elements must be
`pointer-events:none` with `pointer-events:auto` on the actual controls, so map dragging still works.

## Rules
- Only edit the files you own. Never edit state.js. index.html changes
  only to add a module `<script>`, and then smoke.js's load order must match.
- game.js is the lead's. The one thing module agents may ask of it is input
  wiring for a camera API render.js exposes (held keys, drag velocity); the
  camera itself lives in render.js, which is the only thing that sees a frame
  and can integrate against real time.
- No network calls, no external fonts, no CDN. CSP is `default-src 'self'`.
- Must run from `file://` inside Electron.

# Browser visual update

The reference guides a sunlit, detailed city with natural greens, warm masonry,
blue-grey glass, compact resource counters and an illustrated service catalog.
The renderer remains a fixed isometric Canvas2D scene. It does not require a
3D engine, asset downloads, external fonts or a build step.

## Scenery

- Masonry, concrete, grass and road grain share a tiny procedural atlas. Its
  WebGL fragment shader uses seeded noise; three 128×128 tiles are copied to
  Canvas2D once and the shader resources are released. The fallback paints
  deterministic textures directly in Canvas2D.
- Warm key light, cooler glass, vertical wall shading, recessed windows and
  varied blinds give buildings more depth. Surface detail follows each plane.
- Twelve cached canopy sprites add irregular outlines and shaded leaf clusters.
- A quarter-resolution silhouette mask keeps ground traffic behind solid
  building masses. The renderer reads it only when scenery changes and uses
  typed-array lookups during animation. It is deliberately conservative at
  silhouette edges; small decorative geometry does not contribute to the mask.
- Lot planning, maximum-corner anchors and the simulation state remain intact.

## Budgets and interaction

| Preset | Maximum display DPR | City-cache pixels | Cars/buses | Pedestrians |
|---|---:|---:|---:|---:|
| Eco | 1 | 6 million | 40 | 35 |
| Balanced | 1.5 | 10 million | 64 | 90 |
| High | 2 | 10 million | 80 | 150 |

Eco also disables surface grain, detailed crowns and live water shimmer.
The cache may lower its own resolution to cover a larger area within budget.
The pixel limits apply to the city canvas, not total browser memory. Light,
shadow, atmosphere and visibility buffers also consume memory.

Materials and geometry render only when the static cache changes. Pan and zoom
reuse that cache; zoom waits 180 ms after movement stops before sharpening,
unless coverage is missing or magnification becomes excessive. Local edits
continue to use the existing partial repaint path. HUD text and state writes
are diffed, and the opaque panels avoid backdrop blur over the animated canvas.

Initial Chromium measurements at 1440×960, DPR 1, scale 0.9 on the full
42,410-resident diorama: cached frames approximately 3–4 ms, panning about
3–4 ms, with a 4.84-million-pixel city cache. The visibility mask adds about
1.2 MB each for its canvas and readback. Full city rebuilds are still roughly
one second on the development machine, comparable to the original renderer;
large zoom changes can briefly stall after settling. These are local drawing
measurements with a readback to drain queued work, not an FPS guarantee or
measurements on low-end phones.

## Verification

`npm test` covers the economy and districts; `npm run smoke` covers module
loading and a 500-day simulation.

> **The rendering numbers below were measured, not estimated** — by a
> `visual-check` harness that drove the real Chromium renderer and asserted
> navigation, placement costs, catalog filtering, budget controls, vehicle
> visibility, graphics budgets and deferred zoom rebuilds, with `--canvas` to
> force the material fallback.
>
> That harness ran under Electron, and Electron was removed when the project
> became web-only: it was 368MB of install for a binary no player would ever
> open. The measurements stand and the renderer has not changed since, but
> **there is currently no way to re-run them.** Rebuilding it against a
> headless browser is the obvious replacement if these budgets ever need
> defending again.
Screenshots go to `output/playwright/`.

Interactive browser checks additionally exercised touch tap/pinch, a 390×844
viewport at DPR 2, narrow-screen menus, WebGL disabled, and the 4K cache budget.
The `?diorama` and `?play` URL patterns also had stray control characters;
those are fixed so preview mode reliably protects saved games.

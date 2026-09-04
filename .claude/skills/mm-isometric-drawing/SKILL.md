---
name: mm-isometric-drawing
description: Use when drawing anything on the MAYOR MAMDANI city canvas - tiles, lots, buildings, props, overlays. Covers painter's order, the lot anchor rule, and why every drawing decision must be deterministic rather than random.
---

# Drawing on the city canvas

The tile grid is the **zoning**. The architecture is a **lot** — a rectangle of
1x1 up to 3x3 neighbouring tiles of one kind, grouped by `MM.lots.plan(s)` and
given an archetype.

## Who draws what

`render.js` draws only `ROAD`, `WATER`, `EMPTY` and `BUS` itself.

`lots.js` claims everything else: `RES`, `COM`, `IND`, `PARK`, plus the civic
tiles `SCHOOL`, `CLINIC`, `GROCERY`, `CHILDCARE` and `TOWER`. If you are adding a
new building, you are almost certainly working in `lots.js`, not `render.js`.

Archetypes are keyed by kind, level and lot size:

| Kind | Archetypes |
|---|---|
| Commercial | `podium curve atrium court campus rotunda mall strip` |
| Residential | `row perim towers` |
| Industrial | `shed plant yard` |
| Parks | `green pond sport plaza` |
| Civic | `school clinic market creche social` |

## Painter's order and the anchor rule

Tiles draw back-to-front sorted by `x + y`. A lot spans several tiles but is
drawn once, in full, from a single tile — **its max corner** — so that a
multi-tile building still lands in the right place in that ordering.

`MM.lots.role(s,x,y)` tells you which case you are in:

| Return | Meaning |
|---:|---|
| `0` | not a lot tile — draw it normally |
| `1` | this tile anchors a lot — draw the whole complex here |
| `-1` | covered by its lot — draw nothing |

Never draw a lot from any tile but its anchor, and never skip the `-1` check, or
buildings overdraw their neighbours.

## Determinism is not optional

Use `MM.gfx.hash` for every varied decision — window pattern, prop placement,
roof pick, colour jitter. **Never `Math.random`.**

The renderer caches static geometry between frames. A random call means the same
tile draws differently on a redraw and the whole city flickers. Same input, same
pixels, every frame.

`MM.lots.plan(s)` is rebuilt only when `s.rev` changes, so a lot's archetype must
be a pure function of its tiles — not of when it was planned.

## Renderer surface

```js
const r = new MM.Renderer(canvas);
r.resize();
r.draw(state, dtMs);
r.screenToTile(px, py);   // -> {x,y} or null
r.panBy(dx, dy);
r.zoomAt(px, py, delta);
r.centerOn(x, y);
r.hover = {x,y} | null;
r.overlay = 'none' | 'value' | 'traffic' | 'pollution';
```

The renderer also owns day/night lighting and traffic animation, driven by
`state.tick` — 24 ticks to a game day.

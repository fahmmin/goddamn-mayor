/* src/bridges.js - road crossings over the river.

   Roads stop dead at the water. Anywhere a road runs up to one bank and
   another road picks up on the far bank in the same line, the network already
   implies a crossing; this module draws it.

   Renderer-only by design: no new tile type, no sim change, no save change.
   A crossing is a pure function of the grid, so the plan is cached on s.rev
   exactly like MM.lots, and the geometry is baked into the renderer's static
   cache along with the rest of the city.

   PAINTER'S ORDER: a bridge deck is elevated over water, so it has to paint
   between the buildings behind it and the buildings in front. render.js
   already sweeps diagonals (d = x+y) to interleave traffic; drawDiag() hooks
   into that same sweep, which gets the ordering right for free.

   Geometry matches gfx tile space: one tile = 2 units, so a tile centred at
   (cx,cy) spans u,v = -1..1.                                                */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx, T = MM.TILE || {}, PAL = G.PAL;
  var GRID = MM.GRID || 48;
  var hash = G.hash, css = G.css, faces = G.faces, mul = G.mul, mix = G.mix;
  var UNIT = 15;                       // one storey in px at scale 1, as lots.js

  var MAX_SPAN = 10;                   // wider than this is a tunnel's problem
  var HERO_MIN = 4;                    // shortest span worth towers and cables
  var HERO_GAP = 12;                   // keep hero spans this far apart

  /* one entry per crossing; dir 0 = runs along +x, 1 = along +y */
  var spans = [];
  var byDiag = {};                     // d = x+y  ->  [span, tileIndexInSpan]
  var planRev = -1, planDone = false;

  function isRoad (t) { return t === T.ROAD || t === T.BUS; }

  /* ------------------------------------------------------------------ *
   * the plan
   * ------------------------------------------------------------------ */

  function plan (s) {
    if (planDone && planRev === (s.rev | 0)) return;
    planRev = s.rev | 0; planDone = true;
    spans.length = 0;
    byDiag = {};

    var g = s.grid, x, y, n, i;
    function at (ax, ay) {
      return (ax < 0 || ay < 0 || ax >= GRID || ay >= GRID) ? -1 : g[ay * GRID + ax];
    }

    /* runs along +x: road, then water, then road */
    for (y = 0; y < GRID; y++) {
      for (x = 0; x < GRID; x++) {
        if (at(x, y) !== T.WATER || !isRoad(at(x - 1, y))) continue;
        n = 0;
        while (at(x + n, y) === T.WATER) n++;
        if (n >= 1 && n <= MAX_SPAN && isRoad(at(x + n, y))) {
          spans.push({ x: x, y: y, n: n, dir: 0, hero: 0 });
        }
        x += n;
      }
    }
    /* runs along +y */
    for (x = 0; x < GRID; x++) {
      for (y = 0; y < GRID; y++) {
        if (at(x, y) !== T.WATER || !isRoad(at(x, y - 1))) continue;
        n = 0;
        while (at(x, y + n) === T.WATER) n++;
        if (n >= 1 && n <= MAX_SPAN && isRoad(at(x, y + n))) {
          spans.push({ x: x, y: y, n: n, dir: 1, hero: 0 });
        }
        y += n;
      }
    }

    /* Which crossings get towers and cables. A city grid puts a road at the
       water every few tiles, so treating every crossing as a landmark span
       reads as a fence rather than a skyline - the demo map alone has twenty.
       Long spans first, then greedily keep only those far enough apart. */
    var k, j, c, o, ok;
    var order = spans.slice().sort(function (a, b) {
      return (b.n - a.n) || (hash(a.x, a.y, 71) - hash(b.x, b.y, 71));
    });
    var heroes = [];
    for (k = 0; k < order.length; k++) {
      c = order[k];
      if (c.n < HERO_MIN) continue;
      ok = 1;
      for (j = 0; j < heroes.length; j++) {
        o = heroes[j];
        if (Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < HERO_GAP) { ok = 0; break; }
      }
      if (!ok) continue;
      c.hero = 1;
      heroes.push(c);
    }

    /* index every deck tile by its diagonal, so the draw hook is a lookup */
    for (k = 0; k < spans.length; k++) {
      c = spans[k];
      for (i = 0; i < c.n; i++) {
        var tx = c.dir === 0 ? c.x + i : c.x;
        var ty = c.dir === 0 ? c.y : c.y + i;
        var d = tx + ty;
        (byDiag[d] || (byDiag[d] = [])).push(c, i);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * drawing
   * ------------------------------------------------------------------ */

  /* Deck rides high enough that the river boats in sky.js pass underneath. */
  function deckH (sc) { return UNIT * sc * 0.55; }

  /* One tile of deck, plus whatever superstructure stands on it. `o` carries
     the camera: cx, cy, fx, fy, scale. */
  function tile (ctx, o, c, i) {
    var sc = o.scale, fx = o.fx, fy = o.fy;
    var tx = c.dir === 0 ? c.x + i : c.x;
    var ty = c.dir === 0 ? c.y : c.y + i;
    var cx = (tx - ty) * fx + o.ox, cy = (tx + ty) * fy + o.oy;
    var h = deckH(sc), st = UNIT * sc;
    var last = i === c.n - 1;

    // deck runs the full tile along the span and is narrower across it, so a
    // road still reads as a road from above
    var W = 0.62;
    var u0 = c.dir === 0 ? -1 : -W, u1 = c.dir === 0 ? 1 : W;
    var v0 = c.dir === 0 ? -W : -1, v1 = c.dir === 0 ? W : 1;

    // piers: one pair per tile, straight down into the water
    var pw = 0.16;
    var pu = c.dir === 0 ? 0 : 0, pv = 0;
    G.prism(ctx, cx, cy, fx, fy, pu - pw, pv - pw, pu + pw, pv + pw,
      -h * 0.9, h * 0.14, faces(mul(PAL.concreteB, 0.94)));

    // the deck slab, then the carriageway on top of it
    G.prism(ctx, cx, cy, fx, fy, u0, v0, u1, v1, h * 0.14, h, faces(PAL.concrete));
    var b = G.buf, n = G.rectPts(b, u0 + 0.02, v0 + 0.10, u1 - 0.02, v1 - 0.10);
    G.slab(ctx, cx, cy, fx, fy, b, n, h + 0.4, css(PAL.asphalt));

    // centre line, dashed along the span
    if (sc > 0.5) {
      var m = 0.055;
      n = c.dir === 0
        ? G.rectPts(b, -0.62, -m, -0.06, m)
        : G.rectPts(b, -m, -0.62, m, -0.06);
      G.slab(ctx, cx, cy, fx, fy, b, n, h + 0.7, css(PAL.paint));
      n = c.dir === 0
        ? G.rectPts(b, 0.06, -m, 0.62, m)
        : G.rectPts(b, -m, 0.06, m, 0.62);
      G.slab(ctx, cx, cy, fx, fy, b, n, h + 0.7, css(PAL.paint));
    }

    // railings down both edges
    if (sc > 0.45) {
      var rh = Math.max(1.2, st * 0.17);
      var e = 0.035;
      if (c.dir === 0) {
        G.prism(ctx, cx, cy, fx, fy, u0, v0 - e, u1, v0 + e, h, h + rh, faces(PAL.steel));
        G.prism(ctx, cx, cy, fx, fy, u0, v1 - e, u1, v1 + e, h, h + rh, faces(PAL.steel));
      } else {
        G.prism(ctx, cx, cy, fx, fy, u0 - e, v0, u0 + e, v1, h, h + rh, faces(PAL.steel));
        G.prism(ctx, cx, cy, fx, fy, u1 - e, v0, u1 + e, v1, h, h + rh, faces(PAL.steel));
      }
    }

    if (!c.hero || sc < 0.42) return;

    // Hero span: a tower at each end and a catenary between them. Towers go on
    // the first and last deck tile so the cable spans the whole crossing.
    if (i !== 0 && !last) return;
    var th = st * (2.6 + hash(c.x, c.y, 73) * 1.4);
    var tw = 0.13;
    var col = mix(PAL.steel, PAL.white, 0.35);
    var off = c.dir === 0 ? W : W;
    var ax, av;
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      ax = c.dir === 0 ? 0 : sgn * off;
      av = c.dir === 0 ? sgn * off : 0;
      G.prism(ctx, cx, cy, fx, fy, ax - tw, av - tw, ax + tw, av + tw,
        h, h + th, faces(col));
      // cross-brace near the top, so the tower reads as a portal frame
      if (sgn > 0 && sc > 0.6) {
        var bh = h + th * 0.72, bt = Math.max(0.8, st * 0.10);
        if (c.dir === 0) {
          G.prism(ctx, cx, cy, fx, fy, -tw, -off, tw, off, bh, bh + bt, faces(col));
        } else {
          G.prism(ctx, cx, cy, fx, fy, -off, -tw, off, tw, bh, bh + bt, faces(col));
        }
      }
    }
  }

  /* One stroke per hero span. It is issued from the span's FIRST (furthest)
     tile on purpose: a cable is one long object in a painter's-order renderer,
     so whichever diagonal draws it decides what it can cover. Issued from the
     near end it painted straight over every building between the towers.
     Issued from the far end, everything nearer paints over it instead, which
     is the right way round for a wire. */
  function cables (ctx, o, c) {
    var sc = o.scale;
    if (!c.hero || sc < 0.42) return;
    var st = UNIT * sc, h = deckH(sc);
    var th = st * (2.6 + hash(c.x, c.y, 73) * 1.4);
    var W = 0.62;

    var x0 = c.x, y0 = c.y;
    var x1 = c.dir === 0 ? c.x + c.n - 1 : c.x;
    var y1 = c.dir === 0 ? c.y : c.y + c.n - 1;

    var ctx0 = ctx;
    ctx0.strokeStyle = css(mul(PAL.steel, 0.86));
    ctx0.lineWidth = Math.max(0.9, 1.5 * sc);
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var au = c.dir === 0 ? 0 : sgn * W, av = c.dir === 0 ? sgn * W : 0;
      var cxA = (x0 - y0) * o.fx + o.ox, cyA = (x0 + y0) * o.fy + o.oy;
      var cxB = (x1 - y1) * o.fx + o.ox, cyB = (x1 + y1) * o.fy + o.oy;
      var ax = G.ix(cxA, o.fx, au, av), ay = G.iy(cyA, o.fy, au, av, h + th);
      var bx = G.ix(cxB, o.fx, au, av), by = G.iy(cyB, o.fy, au, av, h + th);
      // sag to roughly deck height at midspan
      var mx = (ax + bx) * 0.5, my = (ay + by) * 0.5 + th * 1.15;
      ctx0.beginPath();
      ctx0.moveTo(ax, ay);
      ctx0.quadraticCurveTo(mx, my, bx, by);
      ctx0.stroke();

      // hangers down to the deck
      if (sc > 0.6) {
        ctx0.lineWidth = Math.max(0.6, 0.8 * sc);
        for (var k = 1; k < 6; k++) {
          var t = k / 6;
          var px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
          var py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
          var dx = (1 - t) * ax + t * bx;
          var dy = (1 - t) * (G.iy(cyA, o.fy, au, av, h)) + t * (G.iy(cyB, o.fy, au, av, h));
          ctx0.beginPath();
          ctx0.moveTo(px, py);
          ctx0.lineTo(dx, dy);
          ctx0.stroke();
        }
        ctx0.lineWidth = Math.max(0.9, 1.5 * sc);
      }
    }
  }

  /* render.js calls this once per diagonal, inside its structure sweep. */
  function drawDiag (ctx, o, d) {
    var list = byDiag[d];
    if (!list) return;
    for (var k = 0; k < list.length; k += 2) {
      var c = list[k], i = list[k + 1];
      if (i === 0) cables(ctx, o, c);     // furthest diagonal: behind the city
      tile(ctx, o, c, i);
    }
  }

  MM.bridges = { plan: plan, drawDiag: drawDiag, spans: spans };
})(window.MM);

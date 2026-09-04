/* src/lots.js - block-scale buildings.

   The tile grid is the *zoning*, not the architecture. This module groups
   neighbouring tiles of one zone into rectangular LOTS (up to 3x3) and draws
   each lot as one designed complex: a curved office slab with a forecourt, a
   run of brownstones with front gardens, a mall with a striped car park, a
   works with a sawtooth shed and container yard.

   Everything is deterministic - MM.gfx.hash only, never Math.random - so the
   city is pixel-stable and the renderer's static cache stays valid. The plan
   is rebuilt only when s.rev changes (a player edit or a growth level-up).

   Geometry is in gfx tile space relative to the lot's ANCHOR tile, which is
   its max corner (x1,y1) so painter's order by x+y still works:
       one tile = 2 units, so a w x h lot spans u = -2(w-1)-1 .. 1
                                             v = -2(h-1)-1 .. 1
   Heights are screen px: UNIT px is one storey.                            */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx, T = MM.TILE || {}, PAL = G.PAL;
  var GRID = MM.GRID || 48;
  var TAU = Math.PI * 2;
  var hash = G.hash, css = G.css, cssA = G.cssA, faces = G.faces, mul = G.mul, mix = G.mix;
  var clamp = G.clamp;
  var UNIT = 15;                       // one storey in px at scale 1

  /* ================================================================== *
   * the plan
   * ================================================================== */

  var owner = new Int32Array(GRID * GRID);
  var lots = [];
  var planRev = -1, planDone = false;

  /* Pins let a city plan nail a named landmark to a named block: an airport
     needs a runway's worth of land and a stadium needs to sit where the plan
     says, neither of which a hash can decide. Keyed on the lot's top-left
     tile; the tiles under it must already be the right kind. */
  var PINS = {};
  function pin (x, y, arch, w, h) { PINS[y * GRID + x] = { arch: arch, w: w || 1, h: h || 1 }; planDone = false; }
  function clearPins () { PINS = {}; planDone = false; }

  var MERGES = {};                     // land this module draws, zone or civic
  MERGES[T.RES] = 1; MERGES[T.COM] = 1; MERGES[T.IND] = 1; MERGES[T.PARK] = 1;
  MERGES[T.SCHOOL] = 1; MERGES[T.CLINIC] = 1; MERGES[T.TOWER] = 1;
  MERGES[T.GROCERY] = 1; MERGES[T.CHILDCARE] = 1;

  var ZONED = {};                      // ...and which of it grows levels
  ZONED[T.RES] = 1; ZONED[T.COM] = 1; ZONED[T.IND] = 1;

  /* how many tiles across a lot of this kind may span */
  function capOf (kind, lv) {
    if (kind === T.PARK) return 3;
    if (kind === T.SCHOOL || kind === T.TOWER || kind === T.CLINIC) return 2;
    if (kind === T.GROCERY || kind === T.CHILDCARE) return 1;
    return lv >= 3 ? 3 : (lv >= 1 ? 2 : 1);
  }

  /* ---- downtown -------------------------------------------------------
     A tower belongs where the city is already dense; a lone level-4 block out
     in the suburbs is a mistake, not a skyline. This is a summed-area table
     over "tile at level 3+", so a lot can ask how built-up its neighbourhood
     is in four reads instead of eighty-one.

     Driven by s.level, never s.pow. Level changes bump s.rev (sim.js), which
     is what both this plan and the renderer's static cache are keyed on. Land
     value moves every day WITHOUT bumping rev, so heights driven from it would
     silently desync the cache. */
  var DTR = 4;                         // neighbourhood radius, in tiles
  var dtSum = new Int32Array((GRID + 1) * (GRID + 1));

  function downtownField (s) {
    var g = s.grid, lvs = s.level, x, y, i, row, prev, hot;
    for (y = 0; y < GRID; y++) {
      row = (y + 1) * (GRID + 1); prev = y * (GRID + 1);
      for (x = 0; x < GRID; x++) {
        i = y * GRID + x;
        hot = (ZONED[g[i]] && (lvs[i] | 0) >= 3) ? 1 : 0;
        dtSum[row + x + 1] = hot + dtSum[prev + x + 1] + dtSum[row + x] - dtSum[prev + x];
      }
    }
  }

  /* 0..1 - how much of this lot's neighbourhood is built up */
  function dtOf (L) {
    var x0 = L.x0 - DTR, y0 = L.y0 - DTR, x1 = L.x1 + DTR + 1, y1 = L.y1 + DTR + 1;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > GRID) x1 = GRID;
    if (y1 > GRID) y1 = GRID;
    var area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    var w = GRID + 1;
    var n = dtSum[y1 * w + x1] - dtSum[y0 * w + x1] - dtSum[y1 * w + x0] + dtSum[y0 * w + x0];
    return n / area;
  }

  /* size preferences, tried in a hash-rotated order so the grain varies */
  var PREF3 = [[3, 3], [3, 2], [2, 3], [2, 2], [3, 1], [1, 3], [2, 1], [1, 2]];
  var PREF2 = [[2, 2], [2, 1], [1, 2]];

  function fits (s, kind, x0, y0, w, h) {
    if (x0 + w > GRID || y0 + h > GRID) return false;
    var g = s.grid, lv = s.level, x, y, i;
    for (y = y0; y < y0 + h; y++) {
      for (x = x0; x < x0 + w; x++) {
        i = y * GRID + x;
        if (g[i] !== kind || owner[i] >= 0) return false;
        if (ZONED[kind] && (lv[i] || 0) < 1 && !PINS[y0 * GRID + x0]) return false;
      }
    }
    return true;
  }

  function plan (s) {
    if (planDone && planRev === (s.rev | 0)) return;
    planRev = s.rev | 0; planDone = true;
    lots.length = 0;
    for (var q = 0; q < owner.length; q++) owner[q] = -1;
    downtownField(s);

    var g = s.grid, lvs = s.level, x, y, i, k, kind, lv, cap, pref, st, c, w, h, xx, yy, j, id, mx;
    for (y = 0; y < GRID; y++) {
      for (x = 0; x < GRID; x++) {
        i = y * GRID + x;
        kind = g[i];
        if (!MERGES[kind] || owner[i] >= 0) continue;
        lv = lvs[i] || 0;
        var P = PINS[i];
        if (P && fits(s, kind, x, y, P.w, P.h)) { w = P.w; h = P.h; cap = 0; } else { P = null; }
        cap = P ? 0 : capOf(kind, lv);
        if (cap > 1 && hash(x, y, 5) < 0.13) cap = 1;      // some blocks never merge
        if (!P) { w = 1; h = 1; }
        if (cap > 1) {
          pref = cap >= 3 ? PREF3 : PREF2;
          st = (hash(x, y, 6) * pref.length) | 0;
          for (k = 0; k < pref.length; k++) {
            c = pref[(st + k) % pref.length];
            if (c[0] > cap || c[1] > cap) continue;
            if (fits(s, kind, x, y, c[0], c[1])) { w = c[0]; h = c[1]; break; }
          }
        }
        id = lots.length;
        mx = 0;
        for (yy = y; yy < y + h; yy++) {
          for (xx = x; xx < x + w; xx++) {
            j = yy * GRID + xx;
            owner[j] = id;
            if ((lvs[j] || 0) > mx) mx = lvs[j] || 0;
          }
        }
        var L = {
          x0: x, y0: y, x1: x + w - 1, y1: y + h - 1, w: w, h: h,
          kind: kind, lv: mx, road: 0, arch: '', pinned: !!P, dt: 0
        };
        L.dt = dtOf(L);
        L.arch = P ? P.arch : '';          // archetypes need the whole city first
        lots.push(L);
      }
    }
    /* Downtown is RELATIVE: a city's core is wherever that city is densest,
       not some absolute density. Normalising here means a small town gets its
       own modest centre and a built-out metropolis gets a real one, instead of
       a magic constant tuned against whichever map happened to be open. The
       floor is what stops a sparse town promoting its least-empty block to a
       skyline. Archetypes are picked only now, because the score needs every
       lot counted first. */
    var dmax = 0;
    for (k = 0; k < lots.length; k++) if (lots[k].dt > dmax) dmax = lots[k].dt;
    var dnorm = dmax > 0.18 ? dmax : 0;
    for (k = 0; k < lots.length; k++) {
      var Lk = lots[k];
      Lk.dt = dnorm ? Math.min(1, Lk.dt / dnorm) : 0;
      if (!Lk.arch) Lk.arch = pickArch(Lk);
    }

    /* which lot edges face a street - drives entrances, trees and parking */
    for (k = 0; k < lots.length; k++) { roadMask(s, lots[k]); waterMask(s, lots[k]); }
  }

  /* bit 0 +x, 1 -x, 2 +y, 3 -y */
  function roadMask (s, L) {
    var g = s.grid, m = 0, x, y;
    for (y = L.y0; y <= L.y1; y++) {
      if (L.x1 + 1 < GRID && g[y * GRID + L.x1 + 1] === T.ROAD) m |= 1;
      if (L.x0 - 1 >= 0 && g[y * GRID + L.x0 - 1] === T.ROAD) m |= 2;
    }
    for (x = L.x0; x <= L.x1; x++) {
      if (L.y1 + 1 < GRID && g[(L.y1 + 1) * GRID + x] === T.ROAD) m |= 4;
      if (L.y0 - 1 >= 0 && g[(L.y0 - 1) * GRID + x] === T.ROAD) m |= 8;
    }
    L.road = m;
  }

  /* same bits, for the river. A waterfront lot wants its quay on the water
     side, not on the street side. */
  function waterMask (s, L) {
    var g = s.grid, m = 0, x, y;
    for (y = L.y0; y <= L.y1; y++) {
      if (L.x1 + 1 < GRID && g[y * GRID + L.x1 + 1] === T.WATER) m |= 1;
      if (L.x0 - 1 >= 0 && g[y * GRID + L.x0 - 1] === T.WATER) m |= 2;
    }
    for (x = L.x0; x <= L.x1; x++) {
      if (L.y1 + 1 < GRID && g[(L.y1 + 1) * GRID + x] === T.WATER) m |= 4;
      if (L.y0 - 1 >= 0 && g[(L.y0 - 1) * GRID + x] === T.WATER) m |= 8;
    }
    L.water = m;
  }

  var CIVIC = {};
  CIVIC[T.SCHOOL] = 'school'; CIVIC[T.CLINIC] = 'clinic'; CIVIC[T.TOWER] = 'social';
  CIVIC[T.GROCERY] = 'market'; CIVIC[T.CHILDCARE] = 'creche';

  function pickArch (L) {
    var r = hash(L.x0, L.y0, 21), big = L.w > 1 || L.h > 1;
    if (CIVIC[L.kind]) return CIVIC[L.kind];
    if (L.kind === T.PARK) {
      if (!big) return r < 0.30 ? 'sport' : (r < 0.55 ? 'pond' : 'green');
      return r < 0.22 ? 'plaza' : (r < 0.46 ? 'pond' : (r < 0.68 ? 'sport' : 'green'));
    }
    if (L.kind === T.IND) {
      if (!big) return r < 0.55 ? 'shed' : 'yard';
      return r < 0.44 ? 'shed' : (r < 0.74 ? 'plant' : 'yard');
    }
    if (L.kind === T.RES) {
      if (L.lv >= 3 && big) return r < 0.34 ? 'towers' : (r < 0.72 ? 'perim' : 'row');
      if (L.lv >= 2) return r < 0.42 ? 'perim' : 'row';
      return 'row';
    }
    /* commercial */
    // Supertalls need a big lot AND a dense neighbourhood. Gating on level
    // alone speckles towers across the map; gating on dt clusters them.
    if (L.lv >= 3 && L.w * L.h >= 4 && (L.dt || 0) > 0.62) {
      if (r < 0.42) return 'spire';
      if (r < 0.74) return 'setback';
    }
    if (L.lv >= 3) {
      if (big) return r < 0.10 ? 'rotunda' : (r < 0.24 ? 'podium' : (r < 0.42 ? 'curve' :
        (r < 0.58 ? 'atrium' : (r < 0.72 ? 'court' : (r < 0.84 ? 'campus' :
          (r < 0.93 ? 'mall' : 'strip'))))));
      return r < 0.36 ? 'podium' : 'strip';
    }
    if (big) return r < 0.28 ? 'mall' : (r < 0.48 ? 'campus' : (r < 0.68 ? 'atrium' :
      (r < 0.86 ? 'court' : 'curve')));
    return 'strip';
  }

  /* ================================================================== *
   * drawing kit - everything below draws into the current lot frame Q
   * ================================================================== */

  var Q = {
    ctx: null, gp: 0, gctx: null,
    cx: 0, cy: 0, fx: 32, fy: 16, sc: 1, U: 22, dt: 0,
    x: 0, y: 0, lv: 0, w: 1, h: 1, road: 0, wat: 0, kind: 0, seed: 0, hc: 1, pal: null,
    win: null, deck: null, ak: 1,
    u0: -1, v0: -1, u1: 1, v1: 1
  };

  function R (k) { return hash(Q.x, Q.y, k); }
  function pick (arr, k) { return arr[(R(k) * arr.length) | 0]; }

  function box (u0, v0, u1, v1, hb, ht, col) {
    G.prism(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, v0, u1, v1, hb, ht, faces(col));
  }
  function boxF (u0, v0, u1, v1, hb, ht, F) {
    G.prism(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, v0, u1, v1, hb, ht, F);
  }
  function ext (n, hb, ht, col, seam) {
    G.extrude(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, hb, ht, col, seam);
  }
  /* Flat rectangle at height h.

     A pad at ground level is the lot's own share of the ground plane - lawn,
     forecourt, plaza - and render.js needs the whole ground plane down before
     it lays the shadows, or every lot would paint over the shadow falling
     across it. So a ground-level pad is drawn in the ground phase and skipped
     in the structure phase; a raised one (a roof deck) goes the other way. */
  function padTarget (h) {
    return Q.gp ? (h ? null : Q.gctx) : (h ? Q.ctx : null);
  }
  function pad (u0, v0, u1, v1, col, h) {
    var ctx = padTarget(h);
    if (!ctx) return;
    var b = G.buf2, n = G.rectPts(b, u0, v0, u1, v1);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b, n, h || 0, typeof col === 'string' ? col : css(col));
  }
  function padS (u0, v0, u1, v1, style, h) {
    var ctx = padTarget(h);
    if (!ctx) return;
    var b = G.buf2, n = G.rectPts(b, u0, v0, u1, v1);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b, n, h || 0, style);
  }
  function XY (u, v, hh) {
    return [G.ix(Q.cx, Q.fx, u, v), G.iy(Q.cy, Q.fy, u, v, hh || 0)];
  }

  /* flat roof with a raised rim - the single cheapest "not a cube" cue */
  function parapet (u0, v0, u1, v1, h, col, deck) {
    var t = Math.max(1.2, 2.6 * Q.sc), e = 0.055;
    box(u0, v0, u1, v1, h, h + t, mul(col, 1.04));
    pad(u0 + e, v0 + e, u1 - e, v1 - e, deck || Q.deck || PAL.roofGrey, h + t * 0.7);
  }

  /* glazing on one wall plane; side 0 = the +v (left) face, 1 = +u (right) */
  function glaze (side, fixed, a0, a1, h0, h1, cols, rows, col) {
    var ctx = Q.ctx;
    ctx.fillStyle = css(col || PAL.glass);
    ctx.beginPath();
    G.winGrid(ctx, Q.cx, Q.cy, Q.fx, Q.fy, side, fixed, a0, a1, h0, h1, cols, rows);
    ctx.fill();
  }
  /* horizontal ribbon glazing - the modern-office read */
  function bands (side, fixed, a0, a1, h0, h1, n, col) {
    var ctx = Q.ctx;
    ctx.fillStyle = css(col || PAL.glassB);
    ctx.beginPath();
    G.ribbon(ctx, Q.cx, Q.cy, Q.fx, Q.fy, side, fixed, a0, a1, h0, h1, n);
    ctx.fill();
  }
  /* both street faces of a rectangular mass at once */
  function facade (u0, v0, u1, v1, h0, h1, n, col, mode) {
    if (Q.sc < 0.42) return;
    var gc = col || Q.win;
    if (mode === 'grid') {
      var cols = Math.max(2, Math.round((u1 - u0) * 2.4));
      var rows = Math.max(1, Math.round((h1 - h0) / (Q.U * 0.9)));
      glaze(0, v1, u0 + 0.06, u1 - 0.06, h0, h1, cols, rows, gc);
      cols = Math.max(2, Math.round((v1 - v0) * 2.4));
      glaze(1, u1, v0 + 0.06, v1 - 0.06, h0, h1, cols, rows, gc);
    } else {
      bands(0, v1, u0 + 0.06, u1 - 0.06, h0, h1, n, gc);
      bands(1, u1, v0 + 0.06, v1 - 0.06, h0, h1, n, gc);
    }
  }

  /* shop fascia: a coloured board across a wall with a name on it */
  function fascia (side, fixed, a0, a1, h0, h1, bg, text) {
    var ctx = Q.ctx;
    ctx.fillStyle = css(bg);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, side, fixed, a0, a1, h0, h1);
    ctx.fill();
    if (!text || Q.sc < 0.85) return;
    var cellH = (h1 - h0) * 0.52 / 7;
    var pxA = Math.sqrt(Q.fx * Q.fx + Q.fy * Q.fy) * 0.5;
    var cellA = cellH / pxA;
    var wide = (text.length * 6 - 1) * cellA;
    var room = (a1 - a0) * 0.86;
    if (wide > room) { cellA *= room / wide; cellH *= room / wide; wide = room; }
    ctx.fillStyle = css(PAL.signWht);
    ctx.beginPath();
    G.textWall(ctx, Q.cx, Q.cy, Q.fx, Q.fy, side, fixed, text,
      (a0 + a1) * 0.5 + (side === 1 ? wide * 0.5 : -wide * 0.5),
      h0 + (h1 - h0) * 0.5 - cellH * 3.5, cellA, cellH);
    ctx.fill();
  }

  /* A block-long facade belongs to several tenants: split it into units,
     each with its own sign colour and name. One long ribbon reads as a
     warehouse; four short ones read as a high street. */
  function shopRow (side, fixed, a0, a1, h0, h1, k) {
    var span = a1 - a0;
    var n = Math.max(1, Math.round(span / 0.95));
    var i, b0, b1;
    for (i = 0; i < n; i++) {
      b0 = a0 + span * (i / n) + 0.03;
      b1 = a0 + span * ((i + 1) / n) - 0.03;
      fascia(side, fixed, b0, b1, h0, h1,
        SIGNS[(hash(Q.x + i * 5, Q.y + i, k) * SIGNS.length) | 0],
        SHOPS[(hash(Q.x + i, Q.y + i * 3, k + 1) * SHOPS.length) | 0]);
    }
  }

  /* extruded rooftop letters - the landmark read of the reference image */
  function roofSign (text, u, v, dir, size, col, hb, maxW) {
    if (Q.sc < 0.5) return;
    var pxU = Math.sqrt(Q.fx * Q.fx + Q.fy * Q.fy) * 0.5;
    var cells = text.length * 6 - 1;
    var wide = cells * (size / 7) / pxU;
    if (maxW && wide > maxW) { size *= maxW / wide; wide = maxW; }   // shrink to fit
    G.text3D(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, text,
      dir === 0 ? u - wide * 0.5 : u, dir === 0 ? v : v + wide * 0.5,
      dir, size, Math.max(0.06, size / pxU * 0.16), hb, col);
  }

  /* thin canopy slab on posts over an entrance */
  function canopy (u0, v0, u1, v1, h, col) {
    var t = Math.max(1.2, 2.2 * Q.sc);
    box(u0, v0, u1, v1, h, h + t, col || PAL.canopy);
    var pc = mul(PAL.metalB, 1);
    box(u1 - 0.09, v0 + 0.02, u1 - 0.02, v0 + 0.09, 0, h, pc);
    box(u1 - 0.09, v1 - 0.09, u1 - 0.02, v1 - 0.02, 0, h, pc);
    box(u0 + 0.02, v1 - 0.09, u0 + 0.09, v1 - 0.02, 0, h, pc);
  }

  /* ---- landscape props ---------------------------------------------- */

  var TO = { cx: 0, cy: 0, fx: 32, fy: 16, u: 0, v: 0, x: 0, y: 0, size: 1, variant: 0 };
  function push (u, v, size, variant) {
    if (!MM.props || Q.sc < 0.34) return 0;
    TO.cx = Q.cx; TO.cy = Q.cy; TO.fx = Q.fx; TO.fy = Q.fy;
    TO.u = u; TO.v = v; TO.x = Q.x + ((u * 4) | 0); TO.y = Q.y + ((v * 4) | 0);
    TO.size = size; TO.variant = variant | 0;
    (MM.props.treePush || MM.props.tree)(Q.ctx, TO);
    return 1;
  }
  function flushTrees () { if (MM.props && MM.props.treeFlush) MM.props.treeFlush(Q.ctx); }
  function tree (u, v, size, variant) { if (push(u, v, size, variant)) flushTrees(); }

  /* a run of trees between two points - one batch, three fills */
  function treeLine (u0, v0, u1, v1, n, size, k) {
    var any = 0;
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0.5 : i / (n - 1);
      var r = hash(Q.x + i, Q.y, k + i);
      if (r < 0.14) continue;
      any |= push(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, size * (0.82 + r * 0.4), r < 0.3 ? 1 : 0);
    }
    if (any) flushTrees();
  }

  function hedge (u0, v0, u1, v1) {
    box(u0, v0, u1, v1, 0, Math.max(1.6, 3.4 * Q.sc), PAL.hedge);
  }

  function planter (u, v, r, col) {
    box(u - r, v - r, u + r, v + r, 0, Math.max(1.4, 3 * Q.sc), col || PAL.planter);
    tree(u, v, 0.72, 2);
  }

  /* one parked car, body + glass */
  var CARS = G.CARS;
  function car (u, v, along, k) {
    var p = Q.fx / 32, c = CARS[(hash(Q.x + (u * 8) | 0, Q.y + (v * 8) | 0, k) * CARS.length) | 0];
    var a = 0.21, b = 0.155;
    var u0 = along ? u - a : u - b, u1 = along ? u + a : u + b;
    var v0 = along ? v - b : v - a, v1 = along ? v + b : v + a;
    boxF(u0, v0, u1, v1, 1.0 * p, 5.6 * p, faces(c));
    var ctx = Q.ctx;
    ctx.fillStyle = css(mul(c, 0.42));
    ctx.beginPath();
    var iu = (u1 - u0) * 0.26, iv = (v1 - v0) * 0.26;
    G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0 + iu, v0 + iv, 5.6 * p);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1 - iu, v0 + iv, 5.6 * p);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1 - iu, v1 - iv, 5.6 * p);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0 + iu, v1 - iv, 5.6 * p);
    ctx.closePath(); ctx.fill();
  }

  /* painted parking bays + the cars standing in them */
  function parking (u0, v0, u1, v1, along, k) {
    var ctx = Q.ctx;
    padS(u0, v0, u1, v1, css(PAL.parkLot), 0);
    var span = along ? (u1 - u0) : (v1 - v0);
    var n = Math.max(1, Math.round(span / 0.52));
    var d = span / n, i, t;
    if (Q.sc > 0.5) {                                   // stall lines, one path
      ctx.fillStyle = cssA(PAL.stall, 0.55);
      ctx.beginPath();
      for (i = 0; i <= n; i++) {
        t = i * d;
        if (along) G.rectPts(G.buf2, u0 + t - 0.012, v0 + 0.03, u0 + t + 0.012, v1 - 0.03);
        else G.rectPts(G.buf2, u0 + 0.03, v0 + t - 0.012, u1 - 0.03, v0 + t + 0.012);
        var b = G.buf2;
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[0], b[1], 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[2], b[3], 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[4], b[5], 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[6], b[7], 0);
        ctx.closePath();
      }
      ctx.fill();
    }
    if (Q.sc < 0.45) return;
    for (i = 0; i < n; i++) {                           // cars, back row first
      if (hash(Q.x + i, Q.y + (k | 0), 71 + i) < 0.34) continue;
      t = u0 + (i + 0.5) * d;
      if (along) car(t, (v0 + v1) * 0.5, false, 71 + i);
      else car((u0 + u1) * 0.5, v0 + (i + 0.5) * d, true, 71 + i);
    }
  }

  /* street lamp */
  function lamp (u, v) {
    var p = Q.fx / 32, ctx = Q.ctx;
    var a = XY(u, v, 0), b = XY(u, v, 15 * p);
    ctx.strokeStyle = css(PAL.steel);
    ctx.lineWidth = Math.max(0.8, 1.1 * p);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.fillStyle = css(PAL.white);
    ctx.beginPath();
    ctx.ellipse ? ctx.ellipse(b[0], b[1] - 1 * p, 2.4 * p, 1.2 * p, 0, 0, TAU)
      : ctx.rect(b[0] - 2 * p, b[1] - 2 * p, 4 * p, 2 * p);
    ctx.fill();
  }

  /* rooftop kit from roofs.js, reused for any flat-topped mass */
  function roofKit (u0, v0, u1, v1, top) {
    if (!MM.roofs || !MM.roofs.draw || Q.sc < 0.4) return;
    try {
      MM.roofs.draw(Q.ctx, {
        x: Q.x, y: Q.y, kind: Q.kind, level: Q.lv, cx: Q.cx, cy: Q.cy,
        fx: Q.fx, fy: Q.fy, top: top, u0: u0, v0: v0, u1: u1, v1: v1,
        scale: Q.sc, seed: (Math.imul(Q.x, 73856093) ^ Math.imul(Q.y, 19349663)) & 1023
      });
    } catch (e) { /* a roof must never kill the frame */ }
  }

  /* roof garden: planting beds and small trees on a terrace */
  function roofGarden (u0, v0, u1, v1, h, n) {
    pad(u0, v0, u1, v1, PAL.treeA, h);
    var i, a, b;
    for (i = 0; i < n; i++) {
      a = hash(Q.x, Q.y, 140 + i); b = hash(Q.x, Q.y, 160 + i);
      var uu = u0 + (u1 - u0) * (0.12 + a * 0.76);
      var vv = v0 + (v1 - v0) * (0.12 + b * 0.76);
      box(uu - 0.07, vv - 0.07, uu + 0.07, vv + 0.07, h, h + 2.2 * Q.sc, PAL.planter);
    }
  }

  /* wall band following an arc - ribbon glazing on a curved facade.
     Outer surface only, so it paints straight onto the mass beneath. */
  function arcWall (cu, cv, r, a0, a1, seg, h0, h1, col) {
    var ctx = Q.ctx, i, aA, aB, uA, vA, uB, vB, nu, nv, mag, k;
    for (i = 0; i < seg; i++) {
      aA = a0 + (a1 - a0) * (i / seg);
      aB = a0 + (a1 - a0) * ((i + 1) / seg);
      uA = cu + Math.cos(aA) * r; vA = cv + Math.sin(aA) * r;
      uB = cu + Math.cos(aB) * r; vB = cv + Math.sin(aB) * r;
      nu = vB - vA; nv = uA - uB;
      if (nu + nv <= 0) continue;
      mag = (nu < 0 ? -nu : nu) + (nv < 0 ? -nv : nv);
      k = ((nu > 0 ? nu * G.RM : -nu * 0.44) + (nv > 0 ? nv * G.LM : -nv * 0.44)) / mag;
      ctx.fillStyle = ctx.strokeStyle = css(mul(col, k));
      ctx.beginPath();
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, vA, h1);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, vB, h1);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, vB, h0);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, vA, h0);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 0.7; ctx.stroke();
    }
  }

  /* a plain mass with glazing and a parapet - the workhorse */
  function mass (u0, v0, u1, v1, H, col, mode) {
    var st = Q.U, n = Math.max(1, Math.round((H - st * 0.5) / (st * 0.92)));
    box(u0, v0, u1, v1, 0, H, col);
    facade(u0, v0, u1, v1, st * 0.34, H - st * 0.28, n, null, mode);
    parapet(u0, v0, u1, v1, H, col);
    return H;
  }

  /* sawtooth industrial roof, ridges across `along` */
  function sawtooth (u0, v0, u1, v1, hb, hh, n, along, col) {
    var ctx = Q.ctx, F = faces(col), Fg = css(PAL.glassB), i, a0, a1, d, b;
    ctx.fillStyle = F[0];
    if (along === 0) {
      d = (v1 - v0) / n;
      for (i = 0; i < n; i++) {
        a0 = v0 + i * d; a1 = a0 + d;
        ctx.fillStyle = F[0];
        ctx.beginPath();                       // the sloping deck
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, a0, hb);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, a0, hb);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, a1, hb + hh);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, a1, hb + hh);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = Fg;                    // the glazed riser facing us
        ctx.beginPath();
        G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, a1, u0, u1, hb, hb + hh);
        ctx.fill();
      }
      ctx.fillStyle = F[2];                    // zigzag end wall
      ctx.beginPath();
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, v0, hb);
      for (i = 0; i < n; i++) {
        a0 = v0 + i * d; a1 = a0 + d;
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, a1, hb + hh);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, a1, hb);
      }
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, v1, hb - 1);
      ctx.closePath(); ctx.fill();
    } else {
      d = (u1 - u0) / n;
      for (i = 0; i < n; i++) {
        a0 = u0 + i * d; a1 = a0 + d;
        ctx.fillStyle = F[0];
        ctx.beginPath();
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a0, v0, hb);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a0, v1, hb);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1, v1, hb + hh);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1, v0, hb + hh);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = Fg;
        ctx.beginPath();
        G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, a1, v0, v1, hb, hb + hh);
        ctx.fill();
      }
      ctx.fillStyle = F[1];
      ctx.beginPath();
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, v1, hb);
      for (i = 0; i < n; i++) {
        a0 = u0 + i * d; a1 = a0 + d;
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1, v1, hb + hh);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1, v1, hb);
      }
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u1, v1, hb - 1);
      ctx.closePath(); ctx.fill();
    }
  }

  /* street kit. back=(-u,-v) kerbs before the building, front=(+u,+v) after */
  function edgeKit (front) {
    if (Q.sc < 0.45) return;
    var m = Q.road, u0 = Q.u0, v0 = Q.v0, u1 = Q.u1, v1 = Q.v1, o = 0.30;
    var nu = Math.max(2, Math.round((u1 - u0) * 1.3));
    var nv = Math.max(2, Math.round((v1 - v0) * 1.3));
    if (front) {
      if (m & 1) { treeLine(u1 - o, v0 + 0.4, u1 - o, v1 - 0.4, nv, 0.86, 210); if (R(41) < 0.5) lamp(u1 - o, v1 - 0.5); }
      if (m & 4) { treeLine(u0 + 0.4, v1 - o, u1 - 0.4, v1 - o, nu, 0.86, 230); if (R(42) < 0.5) lamp(u0 + 0.5, v1 - o); }
    } else {
      if (m & 2) treeLine(u0 + o, v0 + 0.4, u0 + o, v1 - 0.4, nv, 0.86, 250);
      if (m & 8) treeLine(u0 + 0.4, v0 + o, u1 - 0.4, v0 + o, nu, 0.86, 270);
    }
  }

  /* kerbside parked cars on whichever street the lot fronts */
  function kerbCars (k) {
    if (Q.sc < 0.55) return;
    var m = Q.road;
    if ((m & 1) && R(k) < 0.6) {
      var n = Math.max(1, Math.round((Q.v1 - Q.v0) * 1.1));
      for (var i = 0; i < n; i++) car(Q.u1 - 0.20, Q.v0 + 0.5 + i * ((Q.v1 - Q.v0 - 1) / Math.max(1, n - 1) || 0), false, k + i);
    }
    if ((m & 4) && R(k + 1) < 0.6) {
      var n2 = Math.max(1, Math.round((Q.u1 - Q.u0) * 1.1));
      for (var j = 0; j < n2; j++) car(Q.u0 + 0.5 + j * ((Q.u1 - Q.u0 - 1) / Math.max(1, n2 - 1) || 0), Q.v1 - 0.20, true, k + 20 + j);
    }
  }

  /* ================================================================== *
   * names - civic and fictional, never a real brand
   * ================================================================== */
  var SHOPS = ['BODEGA', 'DELI', 'CO-OP', 'LAUNDRY', 'BAGELS', 'HARDWARE', 'RECORDS',
    'PHARMACY', 'GROCERS', 'TAQUERIA', 'BARBER', 'BOOKS', 'DINER', 'FLORIST'];
  var FIRMS = ['ATLAS', 'MERIDIAN', 'HUDSON', 'NORTHSIDE', 'ORBIT', 'VERTEX', 'HALCYON',
    'LOTUS', 'QUANTA', 'BEACON', 'KESTREL', 'SUMMIT'];
  var HOODS = ['MAMDANI', 'QUEENS', 'BRONX', 'HARLEM', 'ASTORIA', 'FLATBUSH', 'CITY HALL',
    'THE HEIGHTS', 'SUNSET PARK'];
  var WORKS = ['DEPOT', 'WORKS', 'FREIGHT', 'COLD STORE', 'RECYCLING', 'STEEL'];
  var SIGNS = [PAL.signRed, PAL.signBlue, PAL.signGrn, PAL.signOrg, PAL.signDark, PAL.signYel];
  /* the same set minus the near-black one: awnings and gondolas need to read */
  var BRIGHT = [PAL.signRed, PAL.signBlue, PAL.signGrn, PAL.signOrg, PAL.signYel, PAL.teal];
  /* glazing tints - every block picks one, so facades differ street to street */
  var WINS = [
    [136, 198, 226], [110, 168, 198], [150, 200, 196], [ 96, 132, 158],
    [178, 208, 220], [126, 156, 176], [164, 190, 178], [ 92, 116, 136]
  ];

  /* ================================================================== *
   * archetypes
   * ================================================================== */
  var ARCH = {};

  /* ---- commercial: high street ---- */
  ARCH.strip = function () {
    var m = 0.30, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal;
    var H = (2 + Q.lv * 0.75 + R(11) * 1.5) * st * Q.hc;
    var g1 = st * 0.86;
    box(u0, v0, u1, v1, 0, H, col);
    facade(u0, v0, u1, v1, g1 + st * 0.42, H - st * 0.26,
      Math.max(1, Math.round((H - g1) / st)), null, 'grid');
    var ctx = Q.ctx;                                  // shopfront glazing
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + 0.09, u1 - 0.09, st * 0.12, g1);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + 0.09, v1 - 0.09, st * 0.12, g1);
    ctx.fill();
    shopRow(0, v1, u0 + 0.09, u1 - 0.09, g1, g1 + st * 0.34, 12);
    shopRow(1, u1, v0 + 0.09, v1 - 0.09, g1, g1 + st * 0.34, 14);
    if (R(15) < 0.5) {                                // awning over the door
      box(u0 + 0.2, v1, u0 + 0.7, v1 + 0.10, g1 * 0.72, g1 * 0.86, pick(SIGNS, 16));
    }
    parapet(u0, v0, u1, v1, H, col);
    roofKit(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, H + 3 * Q.sc);
    edgeKit(true); kerbCars(60);
  };

  /* ---- commercial: two wings around a glazed atrium ---- */
  ARCH.atrium = function () {
    var m = 0.34, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var h1 = (2.6 + Q.lv * 0.95 + R(15) * 1.6) * st * Q.hc * (0.78 + Q.ak * 0.22);
    var h2 = h1 * (0.60 + R(16) * 0.34);
    var lk = Math.min(h1, h2) * (0.48 + R(17) * 0.16);
    var a, b;
    if (du >= dv) {
      a = u0 + du * 0.36; b = u1 - du * 0.32;
      mass(u0, v0, a, v1, h1, col, 'band');
      box(a, v0 + dv * 0.12, b, v1 - dv * 0.12, 0, lk, PAL.glassB);
      bands(0, v1 - dv * 0.12, a, b, st * 0.3, lk - st * 0.2, 3, PAL.glassG);
      pad(a, v0 + dv * 0.12, b, v1 - dv * 0.12, PAL.metalA, lk);
      mass(b, v0, u1, v1, h2, col, 'grid');
      canopy(a + du * 0.02, v1 - dv * 0.12, b - du * 0.02, v1 + 0.14, lk * 0.42);
      roofGarden(a + 0.08, v0 + dv * 0.14, b - 0.08, v1 - dv * 0.14, lk + 1, 3);
      roofKit(u0 + 0.1, v0 + 0.1, a - 0.1, v1 - 0.1, h1 + 3 * Q.sc);
      if (Q.lv >= 3) roofSign(pick(FIRMS, 18), (u0 + a) * 0.5, v1 - 0.24, 0, 7.5 * Q.sc, pick(SIGNS, 19), h1 + 3 * Q.sc, (a - u0) * 0.9);
    } else {
      a = v0 + dv * 0.36; b = v1 - dv * 0.32;
      mass(u0, v0, u1, a, h1, col, 'band');
      box(u0 + du * 0.12, a, u1 - du * 0.12, b, 0, lk, PAL.glassB);
      bands(1, u1 - du * 0.12, a, b, st * 0.3, lk - st * 0.2, 3, PAL.glassG);
      pad(u0 + du * 0.12, a, u1 - du * 0.12, b, PAL.metalA, lk);
      mass(u0, b, u1, v1, h2, col, 'grid');
      canopy(u1 - du * 0.12, a + dv * 0.02, u1 + 0.14, b - dv * 0.02, lk * 0.42);
      roofGarden(u0 + du * 0.14, a + 0.08, u1 - du * 0.14, b - 0.08, lk + 1, 3);
      roofKit(u0 + 0.1, v0 + 0.1, u1 - 0.1, a - 0.1, h1 + 3 * Q.sc);
      if (Q.lv >= 3) roofSign(pick(FIRMS, 18), u1 - 0.24, (v0 + a) * 0.5, 1, 7.5 * Q.sc, pick(SIGNS, 19), h1 + 3 * Q.sc, (a - v0) * 0.9);
    }
    edgeKit(true); kerbCars(62);
  };

  /* ---- commercial: curved slab over a forecourt ---- */
  ARCH.curve = function () {
    var m = 0.30, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal;
    var cu = u0, cv = v0;                          // arc centred on the back corner
    var r1 = Math.min(u1 - u0, v1 - v0) * (0.80 + R(20) * 0.26) + 0.55;
    var r0 = r1 * (0.60 + R(21) * 0.12);
    var H = (2.8 + Q.lv * 1.0 + R(22) * 1.6) * st * Q.hc * (0.78 + Q.ak * 0.22);
    var seg = Q.sc > 0.75 ? 9 : 6;
    var n = G.bandPts(G.buf, cu, cv, r0, r1, 0, Math.PI * 0.5, seg);
    ext(n, 0, H, col, 1);
    var storeys = Math.max(2, Math.round(H / st));
    for (var i = 0; i < storeys; i++) {            // ribbon glazing round the curve
      var y0 = st * (i + 0.30), y1 = st * (i + 0.78);
      if (y1 > H - st * 0.2) break;
      arcWall(cu, cv, r1 + 0.005, 0, Math.PI * 0.5, seg, y0, y1, PAL.glassB);
      arcWall(cu, cv, r0 - 0.005, Math.PI * 0.5, Math.PI, seg, y0, y1, PAL.glassG);
    }
    n = G.bandPts(G.buf, cu, cv, r0 - 0.03, r1 + 0.03, 0, Math.PI * 0.5, seg);
    ext(n, H, H + Math.max(1.4, 2.8 * Q.sc), mul(col, 1.05), 1);
    n = G.bandPts(G.buf, cu, cv, r0 + 0.06, r1 - 0.06, 0, Math.PI * 0.5, seg);
    G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, H + 2 * Q.sc, css(PAL.roofGrey));
    /* forecourt inside the arc: a drop-off ring and planting */
    var fu = cu + r1 * 0.62, fv = cv + r1 * 0.62;
    if (fu < u1 - 0.3 && fv < v1 - 0.3 && Q.sc > 0.5) {
      n = G.ringPts(G.buf, (fu + u1) * 0.5, (fv + v1) * 0.5, Math.min(u1 - fu, v1 - fv) * 0.44, 12);
      G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, 0, css(PAL.treeA));
      tree((fu + u1) * 0.5, (fv + v1) * 0.5, 1.05, 0);
    }
    treeLine(u1 - 0.3, v0 + 0.5, u1 - 0.3, v1 - 0.5, 3, 0.8, 300);
    if (Q.lv >= 3) roofSign(pick(FIRMS, 23), (cu + r0 * 0.7 + u1) * 0.5, v1 - 0.3, 0, 7 * Q.sc, pick(SIGNS, 24), H + 3 * Q.sc, (u1 - u0) * 0.55);
    edgeKit(true); kerbCars(64);
  };

  /* ---- commercial: podium + tower ---- */
  ARCH.podium = function () {
    var m = 0.30, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var Hp = st * (1.8 + R(30) * 0.5);
    var ch = Math.min(du, dv) * 0.18;
    var n = G.chamfPts(G.buf, u0, v0, u1, v1, ch);
    ext(n, 0, Hp, col);
    var ctx = Q.ctx;
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + ch, u1 - ch, st * 0.14, Hp * 0.62);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + ch, v1 - ch, st * 0.14, Hp * 0.62);
    ctx.fill();
    shopRow(0, v1, u0 + ch, u1 - ch, Hp * 0.66, Hp * 0.92, 31);
    shopRow(1, u1, v0 + ch, v1 - ch, Hp * 0.66, Hp * 0.92, 33);
    n = G.chamfPts(G.buf, u0, v0, u1, v1, ch);
    ext(n, Hp, Hp + Math.max(1.2, 2.4 * Q.sc), mul(col, 1.06));
    /* tower on the hashed corner */
    var tw = du * (0.44 + R(33) * 0.14), th = dv * (0.44 + R(33) * 0.14);
    var cu = R(34) < 0.5 ? u0 + du * 0.06 : u1 - tw - du * 0.06;
    var cv = R(35) < 0.5 ? v0 + dv * 0.06 : v1 - th - dv * 0.06;
    var Ht = Hp + (1.8 + Q.lv * 1.5 + R(36) * 2.6) * st * Q.hc * Q.ak;
    var tc = R(37) < 0.4 ? PAL.glassB : mul(col, 0.98);
    n = G.chamfPts(G.buf, cu, cv, cu + tw, cv + th, Math.min(tw, th) * 0.16);
    ext(n, 0, Ht, tc);
    bands(0, cv + th, cu + 0.05, cu + tw - 0.05, Hp + st * 0.4, Ht - st * 0.4,
      Math.max(2, Math.round((Ht - Hp) / st)), PAL.glassB);
    bands(1, cu + tw, cv + 0.05, cv + th - 0.05, Hp + st * 0.4, Ht - st * 0.4,
      Math.max(2, Math.round((Ht - Hp) / st)), PAL.glassB);
    var ci = Math.min(tw, th) * 0.16;
    box(cu + ci, cv + ci, cu + tw - ci, cv + th - ci, Ht, Ht + st * 0.85, mul(col, 1.02));
    roofKit(cu + ci, cv + ci, cu + tw - ci, cv + th - ci, Ht + st * 0.85);
    roofGarden(u0 + 0.14, v0 + 0.14, u1 - 0.14, v1 - 0.14, Hp + 2 * Q.sc, 4);
    if (Q.w > 1 || Q.h > 1) {
      roofSign(pick(FIRMS, 38), (u0 + u1) * 0.5, v1 - 0.22, 0, 6.5 * Q.sc, pick(SIGNS, 39), Hp + 2.5 * Q.sc, (u1 - u0) * 0.86);
    }
    edgeKit(true); kerbCars(66);
  };

  /* ---- commercial: perimeter block round a courtyard ---- */
  ARCH.court = function () {
    var m = 0.30, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var d = Math.min(du, dv) * (0.26 + R(50) * 0.08) + 0.12;    // bar depth
    var iu0 = u0 + d, iv0 = v0 + d, iu1 = u1 - d, iv1 = v1 - d;
    var base = (2.2 + Q.lv * 0.8) * st * Q.hc;
    var H = [base * (0.9 + R(51) * 0.5), base * (0.9 + R(52) * 0.5),
      base * (0.9 + R(53) * 0.5), base * (0.9 + R(54) * 0.5)];
    mass(u0, v0, u1, iv0, H[0], col, 'grid');                   // north bar
    mass(u0, iv0, iu0, iv1, H[1], col, 'grid');                 // west bar
    pad(iu0, iv0, iu1, iv1, PAL.grass, 0);                      // courtyard
    if (Q.sc > 0.5) {
      tree((iu0 + iu1) * 0.5, (iv0 + iv1) * 0.5, 1.0, 0);
      tree(iu0 + (iu1 - iu0) * 0.24, iv1 - (iv1 - iv0) * 0.22, 0.8, 2);
      tree(iu1 - (iu1 - iu0) * 0.22, iv0 + (iv1 - iv0) * 0.26, 0.9, 1);
    }
    mass(iu1, iv0, u1, iv1, H[2], col, 'grid');                 // east bar
    mass(u0, iv1, u1, v1, H[3], col, 'band');                   // street bar
    shopRow(0, v1, u0 + 0.12, u1 - 0.12, st * 0.9, st * 1.24, 55);
    roofKit(u0 + 0.1, iv1 + 0.1, u1 - 0.1, v1 - 0.1, H[3] + 3 * Q.sc);
    edgeKit(true); kerbCars(68);
  };

  /* ---- commercial: big box + car park ---- */
  ARCH.mall = function () {
    var m = 0.12, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.lot);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var frontV = du >= dv;                       // car park on the long street side
    var split = frontV ? v0 + dv * 0.46 : u0 + du * 0.46;
    var H = st * (1.5 + Q.lv * 0.35 + R(60) * 0.5) * Q.hc;
    var bu0, bv0, bu1, bv1;
    if (frontV) {
      bu0 = u0; bv0 = v0; bu1 = u1; bv1 = split;
      parking(u0, split + 0.10, u1, v1, true, 61);
    } else {
      bu0 = u0; bv0 = v0; bu1 = split; bv1 = v1;
      parking(split + 0.10, v0, u1, v1, false, 61);
    }
    box(bu0, bv0, bu1, bv1, 0, H, col);
    var fh = H + st * 0.55;
    box(bu0 + 0.06, bv0 + 0.06, bu1 - 0.06, bv1 - 0.06, H, fh, mul(col, 1.05));
    var sg = pick(SIGNS, 62), nm = pick(SHOPS, 63);
    fascia(0, bv1, bu0 + 0.14, bu1 - 0.14, H + st * 0.10, fh - st * 0.08, sg, nm);
    fascia(1, bu1, bv0 + 0.14, bv1 - 0.14, H + st * 0.10, fh - st * 0.08, sg, nm);
    var ctx = Q.ctx;                             // entrance glazing
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    if (frontV) G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, bv1, (bu0 + bu1) * 0.5 - 0.32, (bu0 + bu1) * 0.5 + 0.32, st * 0.12, H - st * 0.2);
    else G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, bu1, (bv0 + bv1) * 0.5 - 0.32, (bv0 + bv1) * 0.5 + 0.32, st * 0.12, H - st * 0.2);
    ctx.fill();
    if (frontV) canopy((bu0 + bu1) * 0.5 - 0.42, bv1 - 0.02, (bu0 + bu1) * 0.5 + 0.42, bv1 + 0.20, H * 0.62);
    else canopy(bu1 - 0.02, (bv0 + bv1) * 0.5 - 0.42, bu1 + 0.20, (bv0 + bv1) * 0.5 + 0.42, H * 0.62);
    pad(bu0 + 0.08, bv0 + 0.08, bu1 - 0.08, bv1 - 0.08, PAL.roofGrey, fh);
    roofKit(bu0 + 0.14, bv0 + 0.14, bu1 - 0.14, bv1 - 0.14, fh);
    roofSign(nm, (bu0 + bu1) * 0.5, bv1 - 0.3, 0, 6 * Q.sc, sg, fh, (bu1 - bu0) * 0.8);
    edgeKit(true);
  };

  /* ---- commercial: office block set in its own car park ---- */
  ARCH.campus = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var wide = du >= dv;
    var cut = wide ? v0 + dv * 0.52 : u0 + du * 0.52;
    var H = (2.2 + Q.lv * 0.8 + R(210) * 1.6) * st * Q.hc;
    var bu0 = u0 + du * 0.06, bv0 = v0 + dv * 0.06;
    var bu1 = wide ? u1 - du * 0.06 : cut - 0.16;
    var bv1 = wide ? cut - 0.16 : v1 - dv * 0.06;
    /* a plan with a notch, so it is not another slab */
    var n = G.elPts(G.buf, bu0, bv0, bu1, bv1, (bu1 - bu0) * (0.52 + R(211) * 0.2),
      (bv1 - bv0) * (0.54 + R(212) * 0.2));
    ext(n, 0, H, col);
    facade(bu0, bv0, bu1, bv1, st * 0.34, H - st * 0.3,
      Math.max(2, Math.round(H / st)), null, R(213) < 0.5 ? 'band' : 'grid');
    parapet(bu0, bv0, bu1, bv1, H, col);
    roofKit(bu0 + 0.1, bv0 + 0.1, bu1 - 0.1, bv1 - 0.1, H + 3 * Q.sc);
    if (wide) {
      canopy((bu0 + bu1) * 0.5 - 0.34, bv1 - 0.02, (bu0 + bu1) * 0.5 + 0.34, bv1 + 0.22, st * 0.9);
      parking(u0, cut + 0.04, u1, v1, true, 214);
      treeLine(u0 + 0.2, cut - 0.06, u1 - 0.2, cut - 0.06, Math.max(2, Math.round(du)), 0.8, 215);
    } else {
      canopy(bu1 - 0.02, (bv0 + bv1) * 0.5 - 0.34, bu1 + 0.22, (bv0 + bv1) * 0.5 + 0.34, st * 0.9);
      parking(cut + 0.04, v0, u1, v1, false, 214);
      treeLine(cut - 0.06, v0 + 0.2, cut - 0.06, v1 - 0.2, Math.max(2, Math.round(dv)), 0.8, 215);
    }
    if (Q.lv >= 2) {
      roofSign(pick(FIRMS, 216), (bu0 + bu1) * 0.5, bv1 - 0.24, 0, 6 * Q.sc, pick(SIGNS, 217), H + 2.6 * Q.sc, (bu1 - bu0) * 0.8);
    }
    edgeKit(true);
  };

  /* ---- commercial: glass rotunda between two wings (the landmark) ---- */
  ARCH.rotunda = function () {
    var m = 0.26, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var cu = (u0 + u1) * 0.5, cv = (v0 + v1) * 0.5;
    var r = Math.min(du, dv) * 0.30;
    var Hw = (1.8 + Q.lv * 0.45) * st * Q.hc;
    var Hd = Hw + (1.6 + Q.lv * 0.4) * st;         // the drum must clear its wings
    /* two low wings, drawn back first */
    mass(u0, v0, u1, cv - r * 0.72, Hw, col, 'band');
    mass(u0, cv + r * 0.72, u1, v1, Hw, col, 'band');
    /* the drum */
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, r, 0, Hd, mix(col, PAL.white, 0.3), 16);
    var st2 = Math.max(2, Math.round(Hd / st));
    for (var i = 0; i < st2; i++) {
      var y0 = st * (i + 0.28), y1 = st * (i + 0.76);
      if (y1 > Hd - st * 0.15) break;
      arcWall(cu, cv, r + 0.004, -Math.PI * 0.15, Math.PI * 0.92, 12, y0, y1, PAL.glassB);
    }
    /* gfx.dome draws from the ground plane up, so shift the tile-space
       centre by the drum height to sit the cap on top of the drum */
    G.dome(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu - Hd / Q.fy, cv - Hd / Q.fy, r * 1.03,
      r * Q.fx * 0.46, mix(PAL.glassG, PAL.teal, 0.30), 1);
    if (Q.sc > 0.5) {
      planter(u0 + du * 0.12, v1 - dv * 0.10, 0.10);
      planter(u1 - du * 0.12, v1 - dv * 0.10, 0.10);
      tree(cu, v1 - dv * 0.06, 1.0, 0);
    }
    roofSign(pick(FIRMS, 220), cu, v1 - 0.2, 0, 6 * Q.sc, pick(SIGNS, 221), Hw + 2.6 * Q.sc, (u1 - u0) * 0.7);
    edgeKit(true); kerbCars(69);
  };

  /* ---- residential: a run of row houses ---- */
  ARCH.row = function () {
    var m = 0.24, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, du = u1 - u0, dv = v1 - v0;
    var along = du >= dv ? 0 : 1;                       // which way the row runs
    var span = along === 0 ? du : dv;
    var depth = (along === 0 ? dv : du) * 0.62;
    var n = Math.max(2, Math.round(span / 0.66));
    var cell = span / n;
    var gabled = R(40) < 0.62;
    var fam = [PAL.brickA, PAL.brickB, PAL.brickC, PAL.stucco, PAL.sand];
    var back = along === 0 ? v0 + (dv - depth) * 0.62 : u0 + (du - depth) * 0.62;
    var i, a0, a1, r, col, H, b0, b1;
    for (i = 0; i < n; i++) {
      a0 = (along === 0 ? u0 : v0) + i * cell + cell * 0.04;
      a1 = a0 + cell * 0.92;
      r = hash(Q.x + i * 7, Q.y + i * 3, 44);
      col = fam[(hash(Q.x + i, Q.y, 45) * fam.length) | 0];
      col = mix(col, PAL.stucco, r * 0.25);
      H = (1.9 + Q.lv * 0.35 + r * 0.8) * st * Q.hc;
      b0 = back; b1 = back + depth;
      if (along === 0) {
        box(a0, b0, a1, b1, 0, H, col);
        if (Q.sc > 0.5) {
          glaze(0, b1, a0 + cell * 0.12, a1 - cell * 0.12, st * 0.30, H - st * 0.22,
            2, Math.max(1, Math.round(H / st)), PAL.glass);
        }
        if (gabled) G.gable(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, a0, b0, a1, b1, H, H + st * 0.5, 1, mul(col, 0.72));
        else parapet(a0, b0, a1, b1, H, col, PAL.roofGrey);
        if (Q.sc > 0.7) {
          box(a0 + cell * 0.30, b1, a0 + cell * 0.62, b1 + 0.13, 0, st * 0.30, PAL.concrete);   // stoop
          if (r < 0.4) box(a1 - cell * 0.22, b0 + 0.06, a1 - cell * 0.10, b0 + 0.18, H + st * 0.2, H + st * 0.7, PAL.brickB);
        }
        if (Q.sc > 0.55) tree((a0 + a1) * 0.5, b1 + 0.30, 0.62, r < 0.5 ? 2 : 0);
      } else {
        box(b0, a0, b1, a1, 0, H, col);
        if (Q.sc > 0.5) {
          glaze(1, b1, a0 + cell * 0.12, a1 - cell * 0.12, st * 0.30, H - st * 0.22,
            2, Math.max(1, Math.round(H / st)), PAL.glass);
        }
        if (gabled) G.gable(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, b0, a0, b1, a1, H, H + st * 0.5, 0, mul(col, 0.72));
        else parapet(b0, a0, b1, a1, H, col, PAL.roofGrey);
        if (Q.sc > 0.7) box(b1, a0 + cell * 0.30, b1 + 0.13, a0 + cell * 0.62, 0, st * 0.30, PAL.concrete);
        if (Q.sc > 0.55) tree(b1 + 0.30, (a0 + a1) * 0.5, 0.62, r < 0.5 ? 2 : 0);
      }
    }
    edgeKit(true); kerbCars(70);
  };

  /* ---- residential: perimeter block with balconies ---- */
  ARCH.perim = function () {
    var m = 0.30, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var d = Math.min(du, dv) * 0.30 + 0.10;
    var iu0 = u0 + d, iv0 = v0 + d, iu1 = u1 - d, iv1 = v1 - d;
    var H = (3.0 + Q.lv * 0.7 + R(80) * 1.3) * st * Q.hc * (0.7 + Q.ak * 0.3);
    var floors = Math.max(3, Math.round(H / st));
    box(u0, v0, u1, iv0, 0, H, col);
    parapet(u0, v0, u1, iv0, H, col);
    box(u0, iv0, iu0, iv1, 0, H * 0.94, col);
    parapet(u0, iv0, iu0, iv1, H * 0.94, col);
    if (iu1 > iu0 && iv1 > iv0) {
      pad(iu0, iv0, iu1, iv1, PAL.grass, 0);
      if (Q.sc > 0.5) tree((iu0 + iu1) * 0.5, (iv0 + iv1) * 0.5, 0.9, 0);
    }
    box(iu1, iv0, u1, iv1, 0, H * 0.94, col);
    parapet(iu1, iv0, u1, iv1, H * 0.94, col);
    box(u0, iv1, u1, v1, 0, H, col);
    parapet(u0, iv1, u1, v1, H, col);
    if (Q.sc > 0.5) {                                     // balcony bands on the street faces
      var i, hh;
      for (i = 1; i < floors; i++) {
        hh = i * (H / floors);
        box(u0 + 0.08, v1, u1 - 0.08, v1 + 0.10, hh, hh + Math.max(1, 1.8 * Q.sc), mul(col, 1.07));
        box(u1, iv0 + 0.08, u1 + 0.10, iv1 - 0.08, hh, hh + Math.max(1, 1.8 * Q.sc), mul(col, 1.07));
      }
      glaze(0, v1, u0 + 0.12, u1 - 0.12, st * 0.3, H - st * 0.3,
        Math.max(3, Math.round(du * 2.2)), floors, PAL.glass);
      glaze(1, u1, iv0 + 0.12, iv1 - 0.12, st * 0.3, H * 0.94 - st * 0.3,
        Math.max(2, Math.round(dv * 2.2)), floors, PAL.glass);
    }
    roofKit(u0 + 0.1, iv1 + 0.1, u1 - 0.1, v1 - 0.1, H + 3 * Q.sc);
    edgeKit(true); kerbCars(72);
  };

  /* ---- residential: slabs in a green superblock ---- */
  ARCH.towers = function () {
    var m = 0.10, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var n = du * dv > 12 ? 3 : 2, i;
    var slabs = [];
    for (i = 0; i < n; i++) {
      var a = hash(Q.x, Q.y, 90 + i), b = hash(Q.x, Q.y, 100 + i), c = hash(Q.x, Q.y, 110 + i);
      var w = 0.5 + a * 0.5, hgt = 0.9 + b * 0.7;
      var uu = u0 + 0.25 + (du - 1.0) * ((i + 0.5) / n) - w * 0.5;
      var vv = v0 + 0.3 + (dv - 1.2) * b;
      if (c < 0.5) { var t = w; w = hgt; hgt = t; }
      slabs.push([uu, vv, uu + w, vv + hgt, (3.6 + Q.lv * 0.9 + c * 3) * st * Q.hc * Q.ak]);
    }
    slabs.sort(function (p, q) { return (p[0] + p[1]) - (q[0] + q[1]); });
    /* paths and planting between the slabs */
    pad(u0 + 0.2, (v0 + v1) * 0.5 - 0.10, u1 - 0.2, (v0 + v1) * 0.5 + 0.10, PAL.plaza, 0);
    for (i = 0; i < slabs.length; i++) {
      var S = slabs[i];
      mass(S[0], S[1], S[2], S[3], S[4], col, 'grid');
      var floors = Math.max(4, Math.round(S[4] / st));
      if (Q.sc > 0.55) {
        for (var f = 1; f < floors; f++) {
          var hh = f * (S[4] / floors);
          box(S[0] + 0.04, S[3], S[2] - 0.04, S[3] + 0.08, hh, hh + Math.max(0.9, 1.6 * Q.sc), mul(col, 1.08));
        }
      }
      roofKit(S[0] + 0.06, S[1] + 0.06, S[2] - 0.06, S[3] - 0.06, S[4] + 3 * Q.sc);
      if (Q.sc > 0.5) tree(S[0] - 0.22, S[3] + 0.24, 0.85, 0);
    }
    treeLine(u0 + 0.3, v1 - 0.28, u1 - 0.3, v1 - 0.28, Math.max(2, Math.round(du * 1.4)), 0.9, 320);
    edgeKit(true); kerbCars(74);
  };

  /* ---- industrial: sawtooth shed with a loading dock ---- */
  ARCH.shed = function () {
    var m = 0.10, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.gravel);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0;
    var deep = du >= dv ? 0 : 1;
    var dock = 0.62;                                  // apron for the trucks
    var bu0 = u0, bv0 = v0, bu1 = u1, bv1 = v1;
    if (deep === 0) bv1 = v1 - dock; else bu1 = u1 - dock;
    var H = st * (1.5 + R(120) * 0.5);
    box(bu0, bv0, bu1, bv1, 0, H, col);
    var bays = Math.max(3, Math.round((deep === 0 ? (bv1 - bv0) : (bu1 - bu0)) * 2.2));
    sawtooth(bu0, bv0, bu1, bv1, H, st * 0.42, bays, deep === 0 ? 0 : 1, mul(col, 0.94));
    var ctx = Q.ctx;                                   // roller-shutter doors
    ctx.fillStyle = css(PAL.spandrel);
    ctx.beginPath();
    var i, t, k = Math.max(2, Math.round((deep === 0 ? (bu1 - bu0) : (bv1 - bv0)) * 1.5));
    for (i = 0; i < k; i++) {
      t = (i + 0.5) / k;
      if (deep === 0) G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, bv1, bu0 + (bu1 - bu0) * (t - 0.30 / k), bu0 + (bu1 - bu0) * (t + 0.30 / k), st * 0.08, H * 0.66);
      else G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, bu1, bv0 + (bv1 - bv0) * (t - 0.30 / k), bv0 + (bv1 - bv0) * (t + 0.30 / k), st * 0.08, H * 0.66);
    }
    ctx.fill();
    fascia(deep === 0 ? 0 : 1, deep === 0 ? bv1 : bu1,
      (deep === 0 ? bu0 : bv0) + 0.2, (deep === 0 ? bu1 : bv1) - 0.2,
      H * 0.74, H * 0.96, pick(SIGNS, 121), pick(WORKS, 122));
    /* trailers waiting on the apron */
    if (Q.sc > 0.5) {
      var n = Math.max(1, Math.round((deep === 0 ? du : dv) / 0.9));
      for (i = 0; i < n; i++) {
        if (hash(Q.x + i, Q.y, 123) < 0.35) continue;
        t = 0.5 + i * 0.9;
        var tc = hash(Q.x + i, Q.y, 124) < 0.5 ? PAL.white : PAL.metalA;
        if (deep === 0) {
          box(u0 + t - 0.34, bv1 + 0.10, u0 + t + 0.34, bv1 + 0.46, 1.5 * Q.sc, st * 0.72, tc);
          box(u0 + t - 0.16, bv1 + 0.46, u0 + t + 0.16, bv1 + 0.58, 1.0 * Q.sc, st * 0.52, PAL.signBlue);
        } else {
          box(bu1 + 0.10, v0 + t - 0.34, bu1 + 0.46, v0 + t + 0.34, 1.5 * Q.sc, st * 0.72, tc);
          box(bu1 + 0.46, v0 + t - 0.16, bu1 + 0.58, v0 + t + 0.16, 1.0 * Q.sc, st * 0.52, PAL.signBlue);
        }
      }
    }
    edgeKit(true);
  };

  /* ---- industrial: tanks, silos and pipe racks ---- */
  ARCH.plant = function () {
    var m = 0.10, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.gravel);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0, i;
    /* control building at the back */
    box(u0, v0, u0 + du * 0.42, v0 + dv * 0.38, 0, st * 1.3, col);
    parapet(u0, v0, u0 + du * 0.42, v0 + dv * 0.38, st * 1.3, col);
    /* pipe rack across the plot */
    var ph = st * 0.9;
    box(u0 + du * 0.06, v0 + dv * 0.46, u1 - du * 0.06, v0 + dv * 0.52, ph, ph + 2.4 * Q.sc, PAL.metalB);
    for (i = 0; i < 4; i++) {
      var pu = u0 + du * (0.10 + i * 0.26);
      box(pu, v0 + dv * 0.46, pu + 0.06, v0 + dv * 0.52, 0, ph, PAL.metalB);
    }
    /* tank farm */
    var tanks = 2 + ((R(130) * 2) | 0);
    for (i = 0; i < tanks; i++) {
      var a = hash(Q.x, Q.y, 131 + i), b = hash(Q.x, Q.y, 141 + i);
      var tu = u0 + du * (0.18 + a * 0.62), tv = v0 + dv * (0.60 + b * 0.32);
      var r = (0.20 + a * 0.14) * Math.min(du, dv) * 0.9;
      var th = st * (0.8 + b * 1.1);
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, tu, tv, r, 0, th, PAL.metalA, 12);
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, tu, tv, r * 1.02, th * 0.42, th * 0.5, PAL.metalB, 12);
      if (Q.sc > 0.7) {                              // domed cap, lifted onto the tank
        G.dome(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, tu - th / Q.fy, tv - th / Q.fy, r,
          r * Q.fx * 0.20, PAL.metalA, 0);
      }
    }
    /* silos + chimney */
    var su = u1 - du * 0.16, sv = v0 + dv * 0.22;
    for (i = 0; i < 3; i++) {
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, su - i * 0.30, sv + i * 0.06, 0.14, 0, st * (2.0 + i * 0.2), PAL.bone, 10);
    }
    var chu = u0 + du * 0.50, chv = v0 + dv * 0.16;
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, chu, chv, 0.10, 0, st * 3.0, PAL.concreteB, 10);
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, chu, chv, 0.11, st * 2.7, st * 2.85, PAL.signRed, 10);
    edgeKit(true);
  };

  /* ---- industrial: open container yard ---- */
  ARCH.yard = function () {
    var m = 0.10, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.asphalt);
    edgeKit(false);
    var st = Q.U, col = Q.pal, du = u1 - u0, dv = v1 - v0, i, j;
    box(u0, v0, u0 + du * 0.34, v0 + dv * 0.30, 0, st * 1.1, col);
    parapet(u0, v0, u0 + du * 0.34, v0 + dv * 0.30, st * 1.1, col);
    var CC = [PAL.signRed, PAL.signBlue, PAL.signGrn, PAL.signOrg, PAL.teal, PAL.terracot];
    var rows = Math.max(2, Math.round(dv * 1.1)), cols = Math.max(2, Math.round(du * 1.1));
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var a = hash(Q.x + i, Q.y + j, 150);
        if (a < 0.30) continue;
        var cu = u0 + du * ((i + 0.5) / cols), cv = v0 + dv * 0.32 + (dv * 0.66) * ((j + 0.5) / rows);
        var stack = 1 + ((a * 2.6) | 0);
        for (var s2 = 0; s2 < stack; s2++) {
          box(cu - 0.34, cv - 0.16, cu + 0.34, cv + 0.16, s2 * st * 0.42, (s2 + 1) * st * 0.42 - 1,
            CC[(hash(Q.x + i, Q.y + j, 151 + s2) * CC.length) | 0]);
        }
      }
    }
    if (Q.sc > 0.6) {                             // gantry crane
      var gh = st * 2.2;
      box(u0 + du * 0.06, v1 - 0.30, u0 + du * 0.06 + 0.08, v1 - 0.22, 0, gh, PAL.signYel);
      box(u1 - du * 0.06 - 0.08, v1 - 0.30, u1 - du * 0.06, v1 - 0.22, 0, gh, PAL.signYel);
      box(u0 + du * 0.04, v1 - 0.30, u1 - du * 0.04, v1 - 0.22, gh, gh + 3 * Q.sc, PAL.signYel);
    }
    edgeKit(true);
  };

  /* ---- parks ---- */
  ARCH.green = function () {
    var u0 = Q.u0, v0 = Q.v0, u1 = Q.u1, v1 = Q.v1;
    pad(u0, v0, u1, v1, PAL.grass);
    var du = u1 - u0, dv = v1 - v0, i;
    padS(u0 + du * 0.10, (v0 + v1) * 0.5 - 0.09, u1 - du * 0.10, (v0 + v1) * 0.5 + 0.09,
      css(PAL.plaza), 0);
    padS((u0 + u1) * 0.5 - 0.09, v0 + dv * 0.10, (u0 + u1) * 0.5 + 0.09, v1 - dv * 0.10,
      css(PAL.plaza), 0);
    if (Q.sc < 0.4) return;
    var n = Math.round(du * dv * 0.9) + 2;
    for (i = 0; i < n; i++) {
      var a = hash(Q.x, Q.y, 170 + i), b = hash(Q.x, Q.y, 190 + i), c = hash(Q.x, Q.y, 210 + i);
      push(u0 + 0.35 + (du - 0.7) * a, v0 + 0.35 + (dv - 0.7) * b,
        0.8 + c * 0.55, c < 0.16 ? 3 : (c < 0.36 ? 2 : (c < 0.52 ? 1 : 0)));
    }
    flushTrees();
    if (Q.sc > 0.7) {
      for (i = 0; i < 3; i++) {
        var t = (i + 0.5) / 3;
        box(u0 + du * 0.14, v0 + dv * t - 0.05, u0 + du * 0.14 + 0.22, v0 + dv * t + 0.05,
          2 * Q.sc, 4.4 * Q.sc, PAL.trunk);
      }
    }
  };

  ARCH.pond = function () {
    var u0 = Q.u0, v0 = Q.v0, u1 = Q.u1, v1 = Q.v1;
    pad(u0, v0, u1, v1, PAL.grass);
    var du = u1 - u0, dv = v1 - v0, i;
    var cu = (u0 + u1) * 0.5 + (R(160) - 0.5) * du * 0.18;
    var cv = (v0 + v1) * 0.5 + (R(161) - 0.5) * dv * 0.18;
    var rr = Math.min(du, dv) * 0.30;
    var b = G.buf, n = 14;
    for (i = 0; i < n; i++) {                       // wobbled shoreline
      var a = i / n * TAU, k = 0.78 + hash(Q.x, Q.y, 162 + i) * 0.44;
      b[i * 2] = cu + Math.cos(a) * rr * k * (du / Math.min(du, dv));
      b[i * 2 + 1] = cv + Math.sin(a) * rr * k * (dv / Math.min(du, dv));
    }
    G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, b, n, 0, css(PAL.sand));
    for (i = 0; i < n; i++) {
      var a2 = i / n * TAU, k2 = 0.70 + hash(Q.x, Q.y, 162 + i) * 0.40;
      b[i * 2] = cu + Math.cos(a2) * rr * k2 * (du / Math.min(du, dv));
      b[i * 2 + 1] = cv + Math.sin(a2) * rr * k2 * (dv / Math.min(du, dv));
    }
    G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, b, n, 0, css(PAL.pond));
    if (Q.sc < 0.4) return;
    var m2 = Math.round(du * dv * 0.7) + 2;
    for (i = 0; i < m2; i++) {
      var p = hash(Q.x, Q.y, 230 + i), q2 = hash(Q.x, Q.y, 250 + i), c = hash(Q.x, Q.y, 270 + i);
      var tu = u0 + 0.3 + (du - 0.6) * p, tv = v0 + 0.3 + (dv - 0.6) * q2;
      if ((tu - cu) * (tu - cu) + (tv - cv) * (tv - cv) < rr * rr * 1.3) continue;
      push(tu, tv, 0.85 + c * 0.5, c < 0.2 ? 3 : (c < 0.4 ? 1 : 0));
    }
    flushTrees();
  };

  ARCH.sport = function () {
    var u0 = Q.u0, v0 = Q.v0, u1 = Q.u1, v1 = Q.v1;
    pad(u0, v0, u1, v1, PAL.grass);
    var du = u1 - u0, dv = v1 - v0, i;
    var cu0 = u0 + du * 0.14, cv0 = v0 + dv * 0.14, cu1 = u1 - du * 0.14, cv1 = v1 - dv * 0.14;
    var col = R(180) < 0.5 ? PAL.courtB : PAL.courtG;
    pad(cu0, cv0, cu1, cv1, col, 0);
    var ctx = Q.ctx;
    ctx.fillStyle = cssA(PAL.paint, 0.85);
    ctx.beginPath();
    G.rectPts(G.buf2, cu0 + 0.08, cv0 + 0.08, cu1 - 0.08, cv0 + 0.11);
    var bb = G.buf2;
    G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[0], bb[1], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[2], bb[3], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[4], bb[5], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[6], bb[7], 0);
    ctx.closePath();
    G.rectPts(G.buf2, cu0 + 0.08, cv1 - 0.11, cu1 - 0.08, cv1 - 0.08);
    G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[0], bb[1], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[2], bb[3], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[4], bb[5], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[6], bb[7], 0);
    ctx.closePath();
    G.rectPts(G.buf2, (cu0 + cu1) * 0.5 - 0.015, cv0 + 0.08, (cu0 + cu1) * 0.5 + 0.015, cv1 - 0.08);
    G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[0], bb[1], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[2], bb[3], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[4], bb[5], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, bb[6], bb[7], 0);
    ctx.closePath();
    ctx.fill();
    if (Q.sc < 0.5) return;
    var fh = 6.5 * Q.sc;                             // fence posts + rail
    ctx.strokeStyle = cssA(PAL.metalB, 0.75);
    ctx.lineWidth = Math.max(0.6, 0.9 * Q.sc);
    for (i = 0; i <= 6; i++) {
      var t = i / 6;
      var p1 = XY(cu0 + (cu1 - cu0) * t, cv1, 0), p2 = XY(cu0 + (cu1 - cu0) * t, cv1, fh);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    var r1 = XY(cu0, cv1, fh), r2 = XY(cu1, cv1, fh);
    ctx.beginPath(); ctx.moveTo(r1[0], r1[1]); ctx.lineTo(r2[0], r2[1]); ctx.stroke();
    treeLine(u0 + 0.3, v0 + 0.14, u1 - 0.3, v0 + 0.14, Math.max(2, Math.round(du)), 0.85, 340);
  };

  /* paved civic plaza - the one place the city writes its own name down */
  ARCH.plaza = function () {
    var u0 = Q.u0, v0 = Q.v0, u1 = Q.u1, v1 = Q.v1;
    pad(u0, v0, u1, v1, PAL.plaza);
    var du = u1 - u0, dv = v1 - v0, i, j;
    var ctx = Q.ctx;                                 // paving grid
    if (Q.sc > 0.5) {
      ctx.fillStyle = cssA(PAL.concreteB, 0.6);
      ctx.beginPath();
      for (i = 0; i < 4; i++) {
        for (j = 0; j < 4; j++) {
          if ((i + j) & 1) continue;
          var a0 = u0 + du * (i / 4), a1 = u0 + du * ((i + 1) / 4);
          var b0 = v0 + dv * (j / 4), b1 = v0 + dv * ((j + 1) / 4);
          G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a0 + 0.03, b0 + 0.03, 0);
          G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1 - 0.03, b0 + 0.03, 0);
          G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a1 - 0.03, b1 - 0.03, 0);
          G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, a0 + 0.03, b1 - 0.03, 0);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
    /* fountain */
    var fu = u0 + du * 0.30, fv = v0 + dv * 0.34;
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, fu, fv, Math.min(du, dv) * 0.16, 0, 3 * Q.sc, PAL.concrete, 12);
    var n = G.ringPts(G.buf, fu, fv, Math.min(du, dv) * 0.14, 12);
    G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, 3.2 * Q.sc, css(PAL.pond));
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, fu, fv, Math.min(du, dv) * 0.04, 3 * Q.sc, 9 * Q.sc, PAL.concrete, 8);
    for (i = 0; i < 4; i++) planter(u0 + du * (0.2 + i * 0.2), v1 - 0.24, 0.10);
    /* the district's name, in letters you can read from the helicopter */
    roofSign(pick(HOODS, 200), (u0 + u1) * 0.5, v0 + dv * 0.72, 0,
      16 * Q.sc, pick(SIGNS, 201), 0, du * 0.88);
    treeLine(u0 + 0.3, v0 + 0.22, u1 - 0.3, v0 + 0.22, Math.max(2, Math.round(du)), 0.9, 360);
  };

  /* ================================================================== *
   * landmarks - the pieces a city is known by. Reached through pins, and a
   * few of them turn up on their own in big enough blocks.
   * ================================================================== */

  /* An airliner: fuselage, swept wings, tail, engines. Heights are derived
     from the length in SCREEN px (k), not from the length in tile units -
     mixing the two is what made the first pass look like flat blue crates. */
  function plane (u, v, len, dir, col) {
    var k = len * Q.fx * 0.5;                          // length in px
    var w = len * 0.10, body = col || PAL.white, F = faces(body);
    var hb = k * 0.05, ht = hb + k * 0.135;            // undercarriage, fuselage top
    var wingH = hb + k * 0.03, tailT = ht + k * 0.26;
    var tint = mul(body, 0.9);
    if (dir === 0) {                                   // nose toward +u
      box(u - len * 0.24, v - len * 0.44, u + len * 0.10, v - w, wingH, wingH + k * 0.022, PAL.metalA);
      box(u - len * 0.24, v + w, u + len * 0.10, v + len * 0.44, wingH, wingH + k * 0.022, PAL.metalA);
      box(u - len * 0.16, v - len * 0.34, u - len * 0.02, v - len * 0.24, hb * 0.4, hb * 0.4 + k * 0.075, PAL.metalB);
      box(u - len * 0.16, v + len * 0.24, u - len * 0.02, v + len * 0.34, hb * 0.4, hb * 0.4 + k * 0.075, PAL.metalB);
      boxF(u - len * 0.50, v - w, u + len * 0.42, v + w, hb, ht, F);
      box(u + len * 0.42, v - w * 0.7, u + len * 0.50, v + w * 0.7, hb + k * 0.03, ht - k * 0.02, tint);
      box(u - len * 0.50, v - w * 0.35, u - len * 0.32, v + w * 0.35, ht - k * 0.01, tailT, PAL.signBlue);
      box(u - len * 0.46, v - len * 0.20, u - len * 0.34, v + len * 0.20, ht - k * 0.01, ht + k * 0.05, PAL.signBlue);
      var ctx = Q.ctx;                                 // cabin windows
      if (Q.sc > 0.6) {
        ctx.fillStyle = css(PAL.glassDark);
        ctx.beginPath();
        G.winGrid(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v + w, u - len * 0.34, u + len * 0.32,
          hb + k * 0.075, ht - k * 0.022, Math.max(4, (len * 3) | 0), 1);
        ctx.fill();
      }
    } else {                                           // nose toward +v
      box(u - len * 0.44, v - len * 0.24, u - w, v + len * 0.10, wingH, wingH + k * 0.022, PAL.metalA);
      box(u + w, v - len * 0.24, u + len * 0.44, v + len * 0.10, wingH, wingH + k * 0.022, PAL.metalA);
      box(u - len * 0.34, v - len * 0.16, u - len * 0.24, v - len * 0.02, hb * 0.4, hb * 0.4 + k * 0.075, PAL.metalB);
      box(u + len * 0.24, v - len * 0.16, u + len * 0.34, v - len * 0.02, hb * 0.4, hb * 0.4 + k * 0.075, PAL.metalB);
      boxF(u - w, v - len * 0.50, u + w, v + len * 0.42, hb, ht, F);
      box(u - w * 0.7, v + len * 0.42, u + w * 0.7, v + len * 0.50, hb + k * 0.03, ht - k * 0.02, tint);
      box(u - w * 0.35, v - len * 0.50, u + w * 0.35, v - len * 0.32, ht - k * 0.01, tailT, PAL.signBlue);
      box(u - len * 0.20, v - len * 0.46, u + len * 0.20, v - len * 0.34, ht - k * 0.01, ht + k * 0.05, PAL.signBlue);
    }
  }

  /* a bus or a coach */
  function bus (u, v, along, col) {
    var p = Q.fx / 32, a = 0.46, b = 0.155, c = col || PAL.signBlue;
    var u0 = along ? u - a : u - b, u1 = along ? u + a : u + b;
    var v0 = along ? v - b : v - a, v1 = along ? v + b : v + a;
    box(u0, v0, u1, v1, 1.4 * p, 12.5 * p, c);
    box(u0 + 0.015, v0 + 0.015, u1 - 0.015, v1 - 0.015, 12.5 * p, 13.4 * p, mul(c, 1.12));
    var ctx = Q.ctx;
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + 0.04, u1 - 0.04, 7.0 * p, 11.2 * p);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + 0.04, v1 - 0.04, 7.0 * p, 11.2 * p);
    ctx.fill();
  }

  /* ---- landmark: airport ---- */
  ARCH.airport = function () {
    var u0 = Q.u0 + 0.1, v0 = Q.v0 + 0.1, u1 = Q.u1 - 0.1, v1 = Q.v1 - 0.1;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, ctx = Q.ctx, i;
    var along = du >= dv;                              // runway follows the long axis
    var lng = along ? du : dv, shr = along ? dv : du;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grassDark);
    /* airside: runway, then a taxiway, then the apron */
    var rw0 = shr * 0.03, rw1 = shr * 0.25, tx0 = shr * 0.32, tx1 = shr * 0.41;
    strip(along, u0, v0, u1, v1, rw0, rw1, PAL.asphalt);
    strip(along, u0, v0, u1, v1, tx0, tx1, PAL.asphaltLo);
    dashes(along, u0, v0, u1, v1, (rw0 + rw1) * 0.5, lng, 0.05, PAL.paint);
    dashes(along, u0, v0, u1, v1, (tx0 + tx1) * 0.5, lng * 0.5, 0.03, PAL.paintYel);
    for (i = 0; i < 2; i++) {                          // threshold bars
      var tt = i ? 0.93 : 0.07;
      bar(along, u0, v0, u1, v1, tt, rw0 + 0.04, rw1 - 0.04, PAL.paint);
    }
    var ap0 = shr * 0.44;
    strip(along, u0, v0, u1, v1, ap0, shr, PAL.concreteB);

    /* terminal: a long chamfered pier with a glazed front and a roof sign */
    var tu0, tv0, tu1, tv1, Ht = st * (2.2 + Math.min(1.0, lng * 0.045));
    if (along) { tu0 = u0 + du * 0.16; tu1 = tu0 + du * 0.46; tv0 = v0 + shr * 0.60; tv1 = v0 + shr * 0.94; }
    else { tv0 = v0 + dv * 0.16; tv1 = tv0 + dv * 0.46; tu0 = u0 + shr * 0.60; tu1 = u0 + shr * 0.94; }
    var n = G.chamfPts(G.buf, tu0, tv0, tu1, tv1, Math.min(tu1 - tu0, tv1 - tv0) * 0.22);
    ext(n, 0, Ht, PAL.bone);
    bands(0, tv1, tu0 + 0.12, tu1 - 0.12, st * 0.32, Ht - st * 0.30, 3, PAL.glassB);
    bands(1, tu1, tv0 + 0.12, tv1 - 0.12, st * 0.32, Ht - st * 0.30, 3, PAL.glassB);
    parapet(tu0, tv0, tu1, tv1, Ht, PAL.bone, PAL.metalA);
    roofSign('AIRPORT', (tu0 + tu1) * 0.5, tv1 - 0.25, 0, 7 * Q.sc, PAL.signBlue,
      Ht + 3 * Q.sc, (tu1 - tu0) * 0.62);
    canopy(tu0 + 0.1, tv1, tu1 - 0.1, tv1 + Math.min(0.8, shr * 0.12), st * 1.0, PAL.metalA);

    /* control tower, scaled to the field */
    var cr = clamp(Math.min(du, dv) * 0.045, 0.18, 0.46);
    var cu = along ? tu1 + cr * 4.0 : u0 + shr * 0.80;
    var cv = along ? v0 + shr * 0.80 : tv1 + cr * 4.0;
    G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, cr * 1.15, 0, st * 3.6, PAL.concrete, 12);
    G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, cr * 2.3, st * 3.6, st * 4.5, PAL.glassDark, 12);
    G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, cr * 2.5, st * 4.5, st * 4.8, PAL.metalA, 12);
    box(cu - 0.05, cv - 0.05, cu + 0.05, cv + 0.05, st * 4.8, st * 5.9, PAL.metalB);

    /* aircraft on stand, nose in to the terminal, with a jet bridge each */
    var pl = clamp(Math.min(du, dv) * 0.20, 1.1, 3.2);
    var stands = Math.max(2, Math.min(5, Math.round((along ? tu1 - tu0 : tv1 - tv0) / (pl * 1.15))));
    for (i = 0; i < stands; i++) {
      var t = (i + 0.5) / stands;
      var pu = along ? tu0 + (tu1 - tu0) * t : u0 + shr * 0.50;
      var pv = along ? v0 + shr * 0.50 : tv0 + (tv1 - tv0) * t;
      padS(pu - (along ? pl * 0.5 : 0.28), pv - (along ? 0.28 : pl * 0.5),
        pu + (along ? pl * 0.5 : 0.28), pv + (along ? 0.28 : pl * 0.5),
        cssA(PAL.paintYel, 0.35), 0.4);
      if (along) box(pu - 0.07, pv + 0.30, pu + 0.07, tv0, st * 0.8, st * 1.15, PAL.metalA);
      else box(pu + 0.30, pv - 0.07, tu0, pv + 0.07, st * 0.8, st * 1.15, PAL.metalA);
      if (hash(Q.x, Q.y, 400 + i) < 0.18) continue;
      plane(pu, pv, pl, along ? 0 : 1,
        [PAL.white, PAL.bone, PAL.signWht][(hash(Q.x, Q.y, 410 + i) * 3) | 0]);
    }
    /* hangar with an arched roof, at the far end of the apron */
    var hs = clamp(Math.min(du, dv) * 0.12, 0.8, 2.1);
    var hu0 = along ? u1 - hs * 1.9 : u0 + shr * 0.55, hv0 = along ? v0 + shr * 0.55 : v1 - hs * 1.9;
    var hu1 = hu0 + (along ? hs * 1.6 : hs), hv1 = hv0 + (along ? hs : hs * 1.6);
    box(hu0, hv0, hu1, hv1, 0, st * 1.5, PAL.metalB);
    G.gable(ctx, Q.cx, Q.cy, Q.fx, Q.fy, hu0, hv0, hu1, hv1, st * 1.5, st * 2.3, along ? 0 : 1, PAL.metalA);
    fascia(0, hv1, hu0 + 0.12, hu1 - 0.12, st * 0.4, st * 0.85, PAL.signDark, 'HANGAR');
    /* fuel farm and the ground fleet - an empty apron reads as a car park */
    var fu = along ? u0 + du * 0.06 : u0 + shr * 0.62;
    var fv = along ? v0 + shr * 0.62 : v0 + dv * 0.06;
    for (i = 0; i < 3; i++) {
      var ru = fu + (along ? i * 0.46 : 0), rv = fv + (along ? 0 : i * 0.46);
      G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, ru, rv, 0.19, 0, st * 0.85, PAL.metalA, 10);
      G.dome(ctx, Q.cx, Q.cy, Q.fx, Q.fy, ru - st * 0.85 / Q.fy, rv - st * 0.85 / Q.fy,
        0.38, st * 0.30, PAL.metalB);
    }
    for (i = 0; i < 5; i++) {
      if (hash(Q.x, Q.y + i, 415) < 0.3) continue;
      var gu = along ? tu0 + (tu1 - tu0) * ((i + 0.5) / 5) : u0 + shr * 0.54;
      var gv = along ? v0 + shr * 0.54 : tv0 + (tv1 - tv0) * ((i + 0.5) / 5);
      car(gu, gv, along, 416 + i);
    }
    if (Q.sc > 0.5) {
      lamp(along ? tu0 - 0.3 : u0 + shr * 0.96, along ? v0 + shr * 0.96 : tv0 - 0.3);
      lamp(along ? tu1 + 0.3 : u0 + shr * 0.96, along ? v0 + shr * 0.96 : tv1 + 0.3);
    }
    edgeKit(true);
  };

  /* a band across the field: t0..t1 measured from the u0/v0 edge, across the
     short axis when `along`, across the long axis otherwise */
  function strip (along, u0, v0, u1, v1, t0, t1, col) {
    if (along) pad(u0, v0 + t0, u1, v0 + t1, col);
    else pad(u0 + t0, v0, u0 + t1, v1, col);
  }
  /* centreline dashes down a strip */
  function dashes (along, u0, v0, u1, v1, at, len, wide, col) {
    var ctx = Q.ctx, i, n = Math.max(4, Math.round(len * 1.1));
    var a0 = along ? u0 : v0, a1 = along ? u1 : v1;
    ctx.fillStyle = cssA(col, 0.85);
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var s0 = a0 + (a1 - a0) * ((i + 0.25) / n), s1 = a0 + (a1 - a0) * ((i + 0.75) / n);
      var b = G.buf2;
      if (along) G.rectPts(b, s0, v0 + at - wide, s1, v0 + at + wide);
      else G.rectPts(b, u0 + at - wide, s0, u0 + at + wide, s1);
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[0], b[1], 0);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[2], b[3], 0);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[4], b[5], 0);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[6], b[7], 0);
      ctx.closePath();
    }
    ctx.fill();
  }
  /* a bar across a strip, at fraction t of its length */
  function bar (along, u0, v0, u1, v1, t, c0, c1, col) {
    if (along) {
      var uu = u0 + (u1 - u0) * t;
      pad(uu - 0.10, v0 + c0, uu + 0.10, v0 + c1, col);
    } else {
      var vv = v0 + (v1 - v0) * t;
      pad(u0 + c0, vv - 0.10, u0 + c1, vv + 0.10, col);
    }
  }

  /* ---- landmark: stadium ---- */
  ARCH.stadium = function () {
    var u0 = Q.u0 + 0.2, v0 = Q.v0 + 0.2, u1 = Q.u1 - 0.2, v1 = Q.v1 - 0.2;
    var du = u1 - u0, dv = v1 - v0, st = Q.U;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var d = Math.min(du, dv) * 0.20;                   // stand depth
    var pu0 = u0 + d, pv0 = v0 + d, pu1 = u1 - d, pv1 = v1 - d;
    var Hs = st * 2.6, Hr = Hs + st * 0.5;
    var seat = PAL.signRed, shell = PAL.bone;
    /* pitch, painted */
    pad(pu0, pv0, pu1, pv1, PAL.courtG);
    var ctx = Q.ctx;
    ctx.fillStyle = cssA(PAL.paint, 0.8);
    ctx.beginPath();
    G.rectPts(G.buf2, pu0 + 0.1, (pv0 + pv1) * 0.5 - 0.02, pu1 - 0.1, (pv0 + pv1) * 0.5 + 0.02);
    var b = G.buf2;
    G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[0], b[1], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[2], b[3], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[4], b[5], 0);
    G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, b[6], b[7], 0);
    ctx.closePath();
    ctx.fill();
    var cn = G.ringPts(G.buf, (pu0 + pu1) * 0.5, (pv0 + pv1) * 0.5, Math.min(du, dv) * 0.11, 14);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, cn, 0.4, cssA(PAL.paint, 0.55));
    /* four stands, back to front, each with a raked seating deck and a roof */
    function stand (a0, b0, a1, b1, inward) {
      box(a0, b0, a1, b1, 0, Hs, shell);
      pad(a0 + 0.05, b0 + 0.05, a1 - 0.05, b1 - 0.05, seat, Hs * 0.62);
      box(a0, b0, a1, b1, Hs, Hr, mul(shell, 1.05));
      pad(a0 + 0.03, b0 + 0.03, a1 - 0.03, b1 - 0.03, PAL.metalA, Hr);
    }
    stand(u0, v0, u1, pv0);
    stand(u0, pv0, pu0, pv1);
    stand(pu1, pv0, u1, pv1);
    stand(u0, pv1, u1, v1);
    /* floodlights */
    var i, j, cs = [[u0 + 0.10, v0 + 0.10], [u1 - 0.10, v0 + 0.10], [u0 + 0.10, v1 - 0.10], [u1 - 0.10, v1 - 0.10]];
    var mh = Hr + st * 1.9;
    for (i = 0; i < 4; i++) {
      var mu = cs[i][0], mv = cs[i][1];
      box(mu - 0.055, mv - 0.055, mu + 0.055, mv + 0.055, 0, mh, PAL.metalB);
      box(mu - 0.13, mv - 0.13, mu + 0.13, mv + 0.13, mh - st * 0.22, mh, mul(PAL.metalB, 0.92));
      for (j = 0; j < 2; j++) {                        // two banks of lamps
        box(mu - 0.26, mv - 0.26, mu + 0.26, mv + 0.26,
          mh + j * st * 0.30, mh + j * st * 0.30 + st * 0.22, PAL.signWht);
      }
    }
    roofSign('STADIUM', (u0 + u1) * 0.5, v1 - 0.10, 0, 6 * Q.sc, PAL.signRed, Hr + 1, du * 0.7);
    edgeKit(true);
  };

  /* ---- landmark: bus depot ---- */
  ARCH.depot = function () {
    var u0 = Q.u0 + 0.14, v0 = Q.v0 + 0.14, u1 = Q.u1 - 0.14, v1 = Q.v1 - 0.14;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.asphalt);
    edgeKit(false);
    var wide = du >= dv;
    var bu1 = wide ? u1 : u0 + du * 0.34, bv1 = wide ? v0 + dv * 0.34 : v1;
    mass(u0, v0, bu1, bv1, st * 1.9, PAL.bone, 'grid');
    fascia(0, bv1, u0 + 0.2, bu1 - 0.2, st * 1.1, st * 1.45, PAL.signGrn, 'BUSES');
    /* canopy over the stands */
    var cu0 = wide ? u0 : bu1 + 0.24, cv0 = wide ? bv1 + 0.24 : v0;
    canopy(cu0, cv0, u1, v1, st * 1.3, PAL.metalA);
    var n = Math.max(2, Math.round((wide ? du : dv) / 0.95));
    for (i = 0; i < n; i++) {
      if (hash(Q.x, Q.y, 420 + i) < 0.18) continue;
      var t = (i + 0.5) / n;
      var col = [PAL.signBlue, PAL.signGrn, PAL.signYel, PAL.signOrg][(hash(Q.x, Q.y, 430 + i) * 4) | 0];
      if (wide) bus(cu0 + (u1 - cu0) * t, (cv0 + v1) * 0.5, false, col);
      else bus((cu0 + u1) * 0.5, cv0 + (v1 - cv0) * t, true, col);
    }
    edgeKit(true);
  };

  /* shipping-container paint, deliberately loud */
  var CONT = [PAL.signRed, PAL.signBlue, PAL.signGrn, PAL.signOrg,
    PAL.metalB, PAL.signYel, PAL.terracot, PAL.teal];

  /* a small boat: hull, cabin, mast */
  function boat (u, v, len, along, col) {
    var p = Q.fx / 32, w = len * 0.36;
    var u0 = along ? u - len : u - w, u1 = along ? u + len : u + w;
    var v0 = along ? v - w : v - len, v1 = along ? v + w : v + len;
    box(u0, v0, u1, v1, 0.5 * p, 4.4 * p, col || PAL.white);
    var iu = (u1 - u0) * 0.28, iv = (v1 - v0) * 0.28;
    box(u0 + iu, v0 + iv, u1 - iu, v1 - iv, 4.4 * p, 8.2 * p, PAL.bone);
    box(u - 0.025, v - 0.025, u + 0.025, v + 0.025, 8.2 * p, 26 * p, PAL.metalB);
  }

  /* a box vehicle - truck, fire engine, ambulance. `bar` puts a light on top */
  function truck (u, v, along, body, bar) {
    var p = Q.fx / 32, a = 0.36, b = 0.17, col = body || PAL.white;
    var u0 = along ? u - a : u - b, u1 = along ? u + a : u + b;
    var v0 = along ? v - b : v - a, v1 = along ? v + b : v + a;
    box(u0, v0, u1, v1, 1.0 * p, 8.4 * p, col);
    if (along) box(u1 - 0.15, v0, u1, v1, 1.0 * p, 6.8 * p, mul(col, 0.86));
    else box(u0, v1 - 0.15, u1, v1, 1.0 * p, 6.8 * p, mul(col, 0.86));
    var ctx = Q.ctx;                                  // glazing band
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + 0.03, u1 - 0.03, 4.6 * p, 6.6 * p);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + 0.03, v1 - 0.03, 4.6 * p, 6.6 * p);
    ctx.fill();
    if (bar) box(u - 0.10, v - 0.05, u + 0.10, v + 0.05, 8.4 * p, 9.8 * p, bar);
  }

  /* a stack of containers n high */
  function stack (u, v, along, n, k) {
    var p = Q.fx / 32, a = 0.44, b = 0.21, i, hh = 7.2 * p;
    var u0 = along ? u - a : u - b, u1 = along ? u + a : u + b;
    var v0 = along ? v - b : v - a, v1 = along ? v + b : v + a;
    for (i = 0; i < n; i++) {
      box(u0, v0, u1, v1, i * hh, (i + 1) * hh - 0.5 * p,
        CONT[(hash(Q.x + ((u * 5) | 0) + i, Q.y + ((v * 5) | 0), k) * CONT.length) | 0]);
    }
  }

  /* ferris wheel: a vertical ring in the u-z plane with gondolas on the rim */
  function ferris (u, v, r, n, col) {
    var ctx = Q.ctx, i, a, w = 0.11;
    var rh = r * Q.fx * 0.5, hub = rh + Q.U * 0.55;    // hub high enough to clear
    var pu = [], ph = [];
    for (i = 0; i < n; i++) {
      a = TAU * i / n + 0.21;
      pu.push(u + Math.cos(a) * r); ph.push(hub + Math.sin(a) * rh);
    }
    ctx.fillStyle = css(mul(PAL.metalB, 0.9));         // two A-frames, one path
    ctx.beginPath();
    for (i = -1; i <= 1; i += 2) {
      var vv = v + i * w;
      for (var s = -1; s <= 1; s += 2) {
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + s * r * 0.72, vv, 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + s * r * 0.72 + 0.09, vv, 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + 0.04, vv, hub);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u - 0.04, vv, hub);
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.strokeStyle = css(col || PAL.signRed);         // rims and spokes
    ctx.lineWidth = Math.max(0.8, 1.5 * Q.sc);
    for (i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      for (var j = 0; j <= n; j++) {
        var q = j % n, X = G.ix(Q.cx, Q.fx, pu[q], v + i * w);
        var Y = G.iy(Q.cy, Q.fy, pu[q], v + i * w, ph[q]);
        if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = cssA(PAL.metalA, 0.85);
    ctx.lineWidth = Math.max(0.6, 0.9 * Q.sc);
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u, v, hub);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, pu[i], v, ph[i]);
    }
    ctx.stroke();
    box(u - 0.09, v - w, u + 0.09, v + w, hub - 4 * Q.sc, hub + 4 * Q.sc, PAL.metalA);
    var ord = [];                                      // gondolas, back to front
    for (i = 0; i < n; i++) ord.push(i);
    ord.sort(function (A, B) { return pu[A] - pu[B]; });
    for (i = 0; i < n; i++) {
      var g = ord[i], gc = BRIGHT[(hash(Q.x, Q.y + g, 470) * BRIGHT.length) | 0];
      box(pu[g] - 0.09, v - w - 0.04, pu[g] + 0.09, v + w + 0.04,
        ph[g] - 7 * Q.sc, ph[g] - 1.4 * Q.sc, gc);
    }
  }

  /* carousel under a striped canopy */
  function carousel (u, v, r) {
    var st = Q.U, i, a;
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u, v, r, 0, st * 0.34, PAL.plaza, 14);
    for (i = 0; i < 8; i++) {
      a = TAU * i / 8;
      var au = u + Math.cos(a) * r * 0.78, av = v + Math.sin(a) * r * 0.78;
      box(au - 0.035, av - 0.035, au + 0.035, av + 0.035, st * 0.34, st * 1.5,
        (i & 1) ? PAL.signRed : PAL.signYel);
    }
    var q = (st * 1.5) / Q.fy;
    G.dome(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u - q, v - q, r * 1.16, st * 0.85, PAL.signRed);
    box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, st * 2.35, st * 3.0, PAL.metalA);
  }

  /* market stall under a peaked awning. G.dome draws from the ground plane,
     so the cap is lifted by shifting u and v together - that keeps its screen
     x and raises it by exactly the counter height. */
  function tent (u, v, r, col) {
    var st = Q.U, hb = st * 0.85;
    box(u - r * 0.72, v - r * 0.72, u + r * 0.72, v + r * 0.72, 0, hb, PAL.bone);
    var q = hb / Q.fy;
    G.dome(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u - q, v - q, r * 2.0,
      Math.max(st * 1.15, r * Q.fx * 0.55), col || PAL.signBlue);
  }

  /* lattice pylon with two crossarms - switchyard and transmission runs */
  function pylon (u, v, h) {
    var w = 0.075, ctx = Q.ctx;
    box(u - w, v - w, u + w, v + w, 0, h, PAL.metalB);
    ctx.strokeStyle = cssA(PAL.steel, 0.9);
    ctx.lineWidth = Math.max(0.6, 0.9 * Q.sc);
    ctx.beginPath();
    for (var i = 0; i < 2; i++) {
      var hh = h * (0.72 + i * 0.18);
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u - 0.34, v, hh);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + 0.34, v, hh);
    }
    ctx.stroke();
  }

  /* ---- landmark: power plant ---- */
  ARCH.power = function () {
    var u0 = Q.u0 + 0.14, v0 = Q.v0 + 0.14, u1 = Q.u1 - 0.14, v1 = Q.v1 - 0.14;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.gravel);
    edgeKit(false);
    var wide = du >= dv;
    /* turbine hall */
    var hu1 = wide ? u0 + du * 0.46 : u1, hv1 = wide ? v1 : v0 + dv * 0.46;
    box(u0, v0, hu1, hv1, 0, st * 2.6, PAL.metalA);
    sawtooth(u0 + 0.04, v0 + 0.04, hu1 - 0.04, hv1 - 0.04, st * 2.6, st * 0.7,
      Math.max(3, Math.round((wide ? hv1 - v0 : hu1 - u0) * 1.1)), wide ? 0 : 1, PAL.metalB);
    fascia(wide ? 1 : 0, wide ? hu1 : hv1,
      wide ? v0 + 0.2 : u0 + 0.2, wide ? hv1 - 0.2 : hu1 - 0.2,
      st * 1.0, st * 1.5, PAL.signYel, 'POWER');
    /* two cooling towers, waisted by stacking drums */
    for (i = 0; i < 2; i++) {
      var cu = wide ? u0 + du * (0.66 + i * 0.24) : u0 + du * 0.30;
      var cv = wide ? v0 + dv * 0.34 : v0 + dv * (0.66 + i * 0.24);
      var r = Math.min(du, dv) * 0.19;
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, r, 0, st * 1.5, PAL.concreteB, 14);
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, r * 0.74, st * 1.5, st * 3.4, PAL.concrete, 14);
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, r * 0.88, st * 3.4, st * 3.9, PAL.concreteB, 14);
      var n = G.ringPts(G.buf, cu, cv, r * 0.86, 14);   // steam sitting in the throat
      G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, st * 4.0, cssA(PAL.white, 0.5));
      n = G.ringPts(G.buf, cu, cv, r * 1.05, 14);
      G.slab(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, st * 4.6, cssA(PAL.white, 0.28));
    }
    /* banded stack */
    var su = wide ? u0 + du * 0.52 : u1 - du * 0.14, sv = wide ? v1 - dv * 0.16 : v0 + dv * 0.52;
    for (i = 0; i < 5; i++) {
      G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, su, sv, 0.20 - i * 0.018,
        st * (0.9 * i), st * (0.9 * i + 0.9), (i & 1) ? PAL.signRed : PAL.concrete, 10);
    }
    /* switchyard */
    var yu = wide ? u1 - du * 0.22 : u0 + du * 0.08, yv = wide ? v1 - dv * 0.30 : v1 - dv * 0.22;
    for (i = 0; i < 3; i++) {
      if (wide) pylon(yu + i * 0.30, yv, st * 2.0);
      else pylon(yu, yv - i * 0.30, st * 2.0);
    }
    edgeKit(true);
  };

  /* ---- landmark: solar farm ---- */
  ARCH.solar = function () {
    var u0 = Q.u0 + 0.22, v0 = Q.v0 + 0.22, u1 = Q.u1 - 0.22, v1 = Q.v1 - 0.22;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, ctx = Q.ctx, i, j;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grassDark);
    edgeKit(false);
    /* Rows have to be far enough apart to see grass between them, or the
       whole array reads as one dark lake from three blocks away. */
    var rows = Math.max(2, Math.round(dv / 1.15)), d = dv / rows;
    var deep = d * 0.52, h0 = st * 0.26, h1 = st * 0.92;
    var uA = u0 + du * 0.04, uB = u1 - du * 0.30;      // service track down one side
    ctx.fillStyle = css(PAL.metalB);                   // posts, one path
    ctx.beginPath();
    for (j = 0; j < rows; j++) {
      var b0 = v0 + j * d + deep * 0.5;
      for (i = 0; i <= 3; i++) {
        var uu = uA + (uB - uA) * (i / 3);
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uu - 0.035, b0, 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uu + 0.035, b0, 0);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uu + 0.035, b0, h0 + 2);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uu - 0.035, b0, h0 + 2);
        ctx.closePath();
      }
    }
    ctx.fill();
    /* every panel is the same tilted plane, so they all take one fill */
    var g = ctx.createLinearGradient(G.ix(Q.cx, Q.fx, uA, v0), G.iy(Q.cy, Q.fy, uA, v0, h1),
      G.ix(Q.cx, Q.fx, uB, v1), G.iy(Q.cy, Q.fy, uB, v1, h0));
    g.addColorStop(0, css(PAL.solarLit)); g.addColorStop(0.45, css(PAL.solar));
    g.addColorStop(1, css(mul(PAL.solar, 0.78)));
    ctx.fillStyle = g;
    ctx.beginPath();
    for (j = 0; j < rows; j++) {
      var a0 = v0 + j * d, a1 = a0 + deep;
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, a0, h1);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, a0, h1);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, a1, h0);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, a1, h0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = css(PAL.metalA);                   // the top rail, catching sun
    ctx.beginPath();
    for (j = 0; j < rows; j++) {
      var c0 = v0 + j * d;
      G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, c0 - 0.03, h1 + 1.4);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, c0 - 0.03, h1 + 1.4);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uB, c0 + 0.03, h1);
      G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA, c0 + 0.03, h1);
      ctx.closePath();
    }
    ctx.fill();
    if (Q.sc > 0.6) {                                  // cell mullions
      ctx.strokeStyle = cssA(PAL.mullion, 0.34);
      ctx.lineWidth = Math.max(0.5, 0.7 * Q.sc);
      ctx.beginPath();
      for (j = 0; j < rows; j++) {
        var e0 = v0 + j * d, e1 = e0 + deep;
        for (i = 1; i < 4; i++) {
          var t = i / 4;
          G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA + (uB - uA) * t, e0, h1);
          G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, uA + (uB - uA) * t, e1, h0);
        }
      }
      ctx.stroke();
    }
    /* inverter house and a transformer, on the service track */
    var su0 = u1 - du * 0.24, sv0 = v0 + dv * 0.10;
    box(su0, sv0, su0 + du * 0.18, sv0 + dv * 0.16, 0, st * 1.0, PAL.bone);
    parapet(su0, sv0, su0 + du * 0.18, sv0 + dv * 0.16, st * 1.0, PAL.bone, PAL.metalA);
    pylon(u1 - du * 0.14, v1 - dv * 0.18, st * 1.9);
    treeLine(u0 + 0.2, v1 - 0.12, u1 - 0.2, v1 - 0.12, Math.max(2, Math.round(du)), 0.7, 486);
    edgeKit(true);
  };

  /* ---- landmark: wind farm ---- */
  ARCH.wind = function () {
    var u0 = Q.u0 + 0.4, v0 = Q.v0 + 0.4, u1 = Q.u1 - 0.4, v1 = Q.v1 - 0.4;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, ctx = Q.ctx, i, k;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var n = Math.max(2, Math.min(4, Math.round(Math.max(du, dv) / 1.6)));
    for (k = 0; k < n; k++) {
      var t = n === 1 ? 0.5 : k / (n - 1);
      var u = u0 + du * (0.15 + t * 0.7), v = v0 + dv * (0.2 + hash(Q.x, Q.y + k, 480) * 0.6);
      var H = st * (4.2 + hash(Q.x + k, Q.y, 481) * 1.4);
      G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u, v, 0.13, 0, H * 0.4, PAL.white, 8);
      G.drum(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u, v, 0.085, H * 0.4, H, PAL.bone, 8);
      box(u - 0.10, v - 0.06, u + 0.10, v + 0.06, H, H + 3.4 * Q.sc, PAL.metalA);
      var r = st * 2.0, a0 = hash(Q.x, Q.y + k, 482) * TAU;
      ctx.fillStyle = css(PAL.white);                  // three blades in the u-z plane
      ctx.beginPath();
      for (i = 0; i < 3; i++) {
        var a = a0 + TAU * i / 3;
        var tu = Math.cos(a) * (r / (Q.fx * 0.5)), th = Math.sin(a) * r;
        G.moveTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u - tu * 0.05, v, H + 1.6 * Q.sc + th * 0.05);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + tu, v, H + 1.6 * Q.sc + th);
        G.lineTo(ctx, Q.cx, Q.cy, Q.fx, Q.fy, u + tu * 0.06 + 0.055, v, H + 1.6 * Q.sc + th * 0.06);
        ctx.closePath();
      }
      ctx.fill();
    }
    treeLine(u0, v1 - 0.1, u1, v1 - 0.1, Math.max(2, Math.round(du)), 0.8, 484);
    edgeKit(true);
  };

  /* ---- landmark: marina ---- */
  ARCH.marina = function () {
    var u0 = Q.u0 + 0.1, v0 = Q.v0 + 0.1, u1 = Q.u1 - 0.1, v1 = Q.v1 - 0.1;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i, j;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    /* the basin goes on the side the river is on; failing that, on whichever
       side has no street. A marina with its back to the water is just a car park. */
    var w = Q.wat, r = Q.road, sd;
    if (w & 1) sd = 0; else if (w & 4) sd = 1; else if (w & 2) sd = 2; else if (w & 8) sd = 3;
    else if (!(r & 1)) sd = 0; else if (!(r & 4)) sd = 1; else if (!(r & 2)) sd = 2; else sd = 3;
    var horiz = (sd === 0 || sd === 2), fwd = (sd === 0 || sd === 1);
    var cut = 0.58;
    var bu0 = u0, bv0 = v0, bu1 = u1, bv1 = v1;         // basin
    var lu0 = u0, lv0 = v0, lu1 = u1, lv1 = v1;         // landward strip
    if (horiz) {
      if (fwd) { bu0 = u1 - du * cut; lu1 = bu0 - 0.10; } else { bu1 = u0 + du * cut; lu0 = bu1 + 0.10; }
    } else {
      if (fwd) { bv0 = v1 - dv * cut; lv1 = bv0 - 0.10; } else { bv1 = v0 + dv * cut; lv0 = bv1 + 0.10; }
    }
    padS(bu0, bv0, bu1, bv1, css(PAL.waterB), 0);
    padS(bu0 + 0.12, bv0 + 0.12, bu1 - 0.12, bv1 - 0.12, cssA(PAL.waterA, 0.75), 0.5);
    /* quay wall along the shore */
    if (horiz) box(fwd ? bu0 - 0.12 : bu1, v0, fwd ? bu0 : bu1 + 0.12, v1, 0, st * 0.34, PAL.concreteB);
    else box(u0, fwd ? bv0 - 0.12 : bv1, u1, fwd ? bv0 : bv1 + 0.12, 0, st * 0.34, PAL.concreteB);
    /* finger piers, running out from the quay, boats moored either side */
    var span = horiz ? (bv1 - bv0) : (bu1 - bu0);
    var reach = (horiz ? (bu1 - bu0) : (bv1 - bv0)) * 0.78;
    var np = Math.max(2, Math.round(span / 0.95));
    for (i = 0; i < np; i++) {
      var t = (i + 0.5) / np;
      var pa = (horiz ? bv0 : bu0) + span * t;          // across the shore
      var q0 = horiz ? (fwd ? bu0 : bu1 - reach) : (fwd ? bv0 : bv1 - reach);
      var q1 = q0 + reach;
      if (horiz) box(q0, pa - 0.08, q1, pa + 0.08, 0, st * 0.26, PAL.planter);
      else box(pa - 0.08, q0, pa + 0.08, q1, 0, st * 0.26, PAL.planter);
      for (j = 0; j < 2; j++) {
        if (hash(Q.x + i, Q.y + j, 490) < 0.24) continue;
        var col = [PAL.white, PAL.bone, PAL.signWht, PAL.signBlue][(hash(Q.x + i, Q.y + j, 491) * 4) | 0];
        var off = (j ? 0.30 : -0.30), mid = q0 + reach * 0.52;
        if (horiz) boat(mid, pa + off, Math.min(0.42, reach * 0.24), true, col);
        else boat(pa + off, mid, Math.min(0.42, reach * 0.24), false, col);
      }
    }
    /* clubhouse and a boardwalk on the landward strip */
    var cu0 = lu0 + (lu1 - lu0) * 0.12, cv0 = lv0 + (lv1 - lv0) * 0.12;
    var cu1 = cu0 + (lu1 - lu0) * (horiz ? 0.62 : 0.44);
    var cv1 = cv0 + (lv1 - lv0) * (horiz ? 0.44 : 0.62);
    box(cu0, cv0, cu1, cv1, 0, st * 1.4, PAL.white);
    G.gable(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu0, cv0, cu1, cv1, st * 1.4, st * 2.2,
      (cu1 - cu0) >= (cv1 - cv0) ? 0 : 1, PAL.signBlue);
    fascia(0, cv1, cu0 + 0.1, cu1 - 0.1, st * 0.55, st * 1.05, PAL.signBlue, 'MARINA');
    for (i = 0; i < 3; i++) {
      if (horiz) lamp(fwd ? bu0 - 0.22 : bu1 + 0.22, v0 + dv * (0.2 + i * 0.3));
      else lamp(u0 + du * (0.2 + i * 0.3), fwd ? bv0 - 0.22 : bv1 + 0.22);
    }
    treeLine(lu0 + 0.25, lv1 - 0.25, lu1 - 0.25, lv1 - 0.25,
      Math.max(2, Math.round(lu1 - lu0)), 0.86, 492);
    edgeKit(true);
  };

  /* ---- landmark: container port ---- */
  ARCH.port = function () {
    var u0 = Q.u0 + 0.1, v0 = Q.v0 + 0.1, u1 = Q.u1 - 0.1, v1 = Q.v1 - 0.1;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i, j;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.concreteB);
    edgeKit(false);
    var w = Q.wat, r = Q.road, sd;
    if (w & 1) sd = 0; else if (w & 4) sd = 1; else if (w & 2) sd = 2; else if (w & 8) sd = 3;
    else if (!(r & 1)) sd = 0; else if (!(r & 4)) sd = 1; else if (!(r & 2)) sd = 2; else sd = 3;
    var horiz = (sd === 0 || sd === 2), fwd = (sd === 0 || sd === 1);
    var depth = (horiz ? du : dv) * 0.34;               // quay apron
    var qa = horiz ? (fwd ? u1 - depth : u0 + depth) : (fwd ? v1 - depth : v0 + depth);
    if (horiz) padS(fwd ? qa : u0, v0, fwd ? u1 : qa, v1, css(PAL.asphaltLo), 0);
    else padS(u0, fwd ? qa : v0, u1, fwd ? v1 : qa, css(PAL.asphaltLo), 0);
    /* gantry cranes straddling the quay, boom out over the water */
    var span = horiz ? dv : du;
    var nc = Math.max(1, Math.round(span / 1.7));
    var legA = qa + (fwd ? -depth * 0.55 : depth * 0.55);
    var legB = qa + (fwd ? depth * 0.30 : -depth * 0.30);
    var H = st * 3.8;
    for (i = 0; i < nc; i++) {
      var t = (i + 0.5) / nc, ga = (horiz ? v0 : u0) + span * t;
      for (j = 0; j < 2; j++) {
        var lg = j ? legB : legA;
        if (horiz) {
          box(lg - 0.07, ga - 0.32, lg + 0.07, ga - 0.20, 0, H, PAL.signOrg);
          box(lg - 0.07, ga + 0.20, lg + 0.07, ga + 0.32, 0, H, PAL.signOrg);
        } else {
          box(ga - 0.32, lg - 0.07, ga - 0.20, lg + 0.07, 0, H, PAL.signOrg);
          box(ga + 0.20, lg - 0.07, ga + 0.32, lg + 0.07, 0, H, PAL.signOrg);
        }
      }
      var b0 = Math.min(legA, legB) - depth * 0.10, b1 = Math.max(legA, legB) + depth * 0.75;
      if (fwd) b1 = Math.max(legA, legB) + depth * 0.75; else b0 = Math.min(legA, legB) - depth * 0.75;
      if (horiz) {
        box(b0, ga - 0.10, b1, ga + 0.10, H, H + st * 0.36, PAL.signOrg);
        box(legB - 0.14, ga - 0.15, legB + 0.14, ga + 0.15, H - st * 0.62, H, PAL.metalA);
      } else {
        box(ga - 0.10, b0, ga + 0.10, b1, H, H + st * 0.36, PAL.signOrg);
        box(ga - 0.15, legB - 0.14, ga + 0.15, legB + 0.14, H - st * 0.62, H, PAL.metalA);
      }
    }
    /* container yard on the landward half, stacked back to front */
    var yu0 = u0, yv0 = v0, yu1 = u1, yv1 = v1;
    if (horiz) { if (fwd) yu1 = qa - 0.12; else yu0 = qa + 0.12; }
    else { if (fwd) yv1 = qa - 0.12; else yv0 = qa + 0.12; }
    var rows = Math.max(2, Math.round((yv1 - yv0) / 0.52));
    var cols = Math.max(2, Math.round((yu1 - yu0) / 1.05));
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var rr = hash(Q.x + i, Q.y + j, 500);
        if (rr < 0.20) continue;
        stack(yu0 + (yu1 - yu0) * ((i + 0.5) / cols), yv0 + (yv1 - yv0) * ((j + 0.5) / rows),
          true, 1 + ((rr * 3) | 0), 501 + i + j * 7);
      }
    }
    edgeKit(true);
  };

  /* ---- landmark: funfair ---- */
  ARCH.funfair = function () {
    var u0 = Q.u0 + 0.2, v0 = Q.v0 + 0.2, u1 = Q.u1 - 0.2, v1 = Q.v1 - 0.2;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.dirt);
    padS(u0, v0, u1, v1, cssA(PAL.grass, 0.55), 0.4);
    edgeKit(false);
    carousel(u0 + du * 0.26, v0 + dv * 0.28, Math.min(du, dv) * 0.16);
    /* swing tower */
    var su = u0 + du * 0.72, sv = v0 + dv * 0.24;
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, su, sv, 0.10, 0, st * 3.6, PAL.signWht, 8);
    G.drum(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, su, sv, 0.30, st * 3.6, st * 3.9, PAL.signRed, 10);
    for (i = 0; i < 3; i++) {
      var a = TAU * i / 3 + 0.4;
      box(su + Math.cos(a) * 0.34 - 0.04, sv + Math.sin(a) * 0.34 - 0.04,
        su + Math.cos(a) * 0.34 + 0.04, sv + Math.sin(a) * 0.34 + 0.04,
        st * 2.5, st * 2.9, PAL.signBlue);
    }
    /* food stalls along the midway */
    for (i = 0; i < 4; i++) {
      tent(u0 + du * (0.16 + i * 0.22), v1 - dv * 0.16, Math.min(du, dv) * 0.085,
        BRIGHT[(hash(Q.x, Q.y + i, 460) * BRIGHT.length) | 0]);
    }
    /* the wheel last: it is the tallest thing here */
    ferris(u0 + du * 0.44, v0 + dv * 0.62, Math.min(du, dv) * 0.34, 12, PAL.signRed);
    if (Q.sc > 0.5) { lamp(u0 + 0.3, v1 - 0.3); lamp(u1 - 0.3, v1 - 0.3); }
    edgeKit(true);
  };

  /* ---- landmark: fire station ---- */
  ARCH.fire = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.asphalt);
    edgeKit(false);
    var wide = du >= dv;
    var bu1 = wide ? u1 : u0 + du * 0.58, bv1 = wide ? v0 + dv * 0.58 : v1;
    var H = st * 2.1;
    box(u0, v0, bu1, bv1, 0, H, PAL.brickB);
    facade(u0, v0, bu1, bv1, H * 0.62, H - st * 0.2, 1, Q.win, 'grid');
    parapet(u0, v0, bu1, bv1, H, PAL.brickB, PAL.roofDark);
    /* appliance bays: tall dark openings with a red header */
    var side = wide ? 0 : 1, fixed = wide ? bv1 : bu1;
    var a0 = wide ? u0 + 0.12 : v0 + 0.12, a1 = wide ? bu1 - 0.12 : bv1 - 0.12;
    var nb = Math.max(2, Math.round((a1 - a0) / 0.85)), d = (a1 - a0) / nb;
    var ctx = Q.ctx;
    ctx.fillStyle = css(PAL.signDark);
    ctx.beginPath();
    for (i = 0; i < nb; i++) {
      G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, side, fixed,
        a0 + i * d + d * 0.12, a0 + (i + 1) * d - d * 0.12, st * 0.1, H * 0.55);
    }
    ctx.fill();
    fascia(side, fixed, a0, a1, H * 0.58, H * 0.80, PAL.signRed, 'FIRE');
    /* hose tower */
    var tu = wide ? bu1 - 0.5 : bu1 - 0.5, tv = wide ? v0 + 0.16 : bv1 - 0.5;
    box(tu - 0.22, tv - 0.22, tu + 0.22, tv + 0.22, 0, st * 3.4, PAL.brickA);
    parapet(tu - 0.22, tv - 0.22, tu + 0.22, tv + 0.22, st * 3.4, PAL.brickA, PAL.roofDark);
    /* engines on the apron */
    var pu = wide ? u0 + du * 0.25 : bu1 + 0.42, pv = wide ? bv1 + 0.42 : v0 + dv * 0.25;
    for (i = 0; i < 2; i++) {
      if (wide) truck(pu + i * 0.9, pv, true, PAL.signRed, PAL.signBlue);
      else truck(pu, pv + i * 0.9, false, PAL.signRed, PAL.signBlue);
    }
    edgeKit(true);
  };

  /* ---- landmark: police station ---- */
  ARCH.police = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var wide = du >= dv;
    var bu1 = wide ? u1 : u0 + du * 0.60, bv1 = wide ? v0 + dv * 0.60 : v1;
    var H = st * 2.8;
    var n = G.chamfPts(G.buf, u0, v0, bu1, bv1, Math.min(bu1 - u0, bv1 - v0) * 0.14);
    ext(n, 0, H, PAL.concrete);
    facade(u0 + 0.06, v0 + 0.06, bu1 - 0.06, bv1 - 0.06, st * 0.9, H - st * 0.3, 3, Q.win);
    box(u0, v0, bu1, bv1, H, H + st * 0.22, PAL.concreteB);
    fascia(wide ? 0 : 1, wide ? bv1 : bu1,
      wide ? u0 + 0.15 : v0 + 0.15, wide ? bu1 - 0.15 : bv1 - 0.15,
      st * 0.24, st * 0.78, PAL.signBlue, 'POLICE');
    canopy(wide ? u0 + du * 0.30 : bu1 - 0.05, wide ? bv1 - 0.05 : v0 + dv * 0.30,
      wide ? u0 + du * 0.62 : bu1 + 0.42, wide ? bv1 + 0.42 : v0 + dv * 0.62,
      st * 0.95, PAL.metalA);
    /* mast with the aerials */
    box(bu1 - 0.34, v0 + 0.12, bu1 - 0.26, v0 + 0.20, H, H + st * 1.9, PAL.metalB);
    /* cruisers */
    var pu = wide ? u0 + du * 0.20 : bu1 + 0.5, pv = wide ? bv1 + 0.5 : v0 + dv * 0.20;
    for (i = 0; i < 3; i++) {
      if (hash(Q.x, Q.y + i, 510) < 0.2) continue;
      if (wide) truck(pu + i * 0.62, pv, true, PAL.signWht, PAL.signBlue);
      else truck(pu, pv + i * 0.62, false, PAL.signWht, PAL.signBlue);
    }
    edgeKit(true);
  };

  /* ---- landmark: hospital ---- */
  ARCH.hospital = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    var du = u1 - u0, dv = v1 - v0, st = Q.U, ctx = Q.ctx, i;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    /* a cross-plan ward block: two crossed bars plus a tower over the crossing */
    var cu = u0 + du * 0.44, cv = v0 + dv * 0.44;
    var au = du * 0.20, av = dv * 0.20;
    var H = st * 3.2, Ht = st * 5.4;
    box(u0 + du * 0.06, cv - av, u0 + du * 0.82, cv + av, 0, H, PAL.bone);
    box(cu - au, v0 + dv * 0.06, cu + au, v0 + dv * 0.82, 0, H, PAL.bone);
    facade(u0 + du * 0.06, cv - av, u0 + du * 0.82, cv + av, st * 0.5, H - st * 0.3, 3, Q.win);
    facade(cu - au, v0 + dv * 0.06, cu + au, v0 + dv * 0.82, st * 0.5, H - st * 0.3, 3, Q.win);
    parapet(u0 + du * 0.06, cv - av, u0 + du * 0.82, cv + av, H, PAL.bone, PAL.metalA);
    parapet(cu - au, v0 + dv * 0.06, cu + au, v0 + dv * 0.82, H, PAL.bone, PAL.metalA);
    box(cu - au * 0.9, cv - av * 0.9, cu + au * 0.9, cv + av * 0.9, H, Ht, PAL.white);
    facade(cu - au * 0.9, cv - av * 0.9, cu + au * 0.9, cv + av * 0.9, H + st * 0.3, Ht - st * 0.3, 2, PAL.glassB);
    parapet(cu - au * 0.9, cv - av * 0.9, cu + au * 0.9, cv + av * 0.9, Ht, PAL.white, PAL.metalA);
    /* helipad on the tower roof */
    var hp = Ht + Math.max(1.2, 2.6 * Q.sc) * 0.8;
    var rr = Math.min(au, av) * 0.78;
    var n = G.ringPts(G.buf, cu, cv, rr, 14);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, hp, css(PAL.asphaltLo));
    n = G.ringPts(G.buf, cu, cv, rr * 0.82, 14);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, hp + 0.3, cssA(PAL.paint, 0.85));
    n = G.ringPts(G.buf, cu, cv, rr * 0.70, 14);
    G.slab(ctx, Q.cx, Q.cy, Q.fx, Q.fy, G.buf, n, hp + 0.6, css(PAL.asphaltLo));
    if (Q.sc > 0.7) {
      ctx.fillStyle = cssA(PAL.paint, 0.9);
      ctx.beginPath();
      var lift = (hp + 0.9) / Q.fy;                   // textFlat paints on the ground
      G.textFlat(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 'H',
        cu - rr * 0.26 - lift, cv - rr * 0.34 - lift, 0, rr * 0.11, rr * 0.11);
      ctx.fill();
    }
    /* red cross on the wall, and the ambulance canopy */
    var s = Math.min(au, av) * 0.5;
    ctx.fillStyle = css(PAL.signRed);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, cv + av, cu - s * 0.28, cu + s * 0.28, H * 0.42, H * 0.42 + st * 0.9);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, cv + av, cu - s * 0.8, cu + s * 0.8, H * 0.42 + st * 0.30, H * 0.42 + st * 0.60);
    ctx.fill();
    canopy(u0 + du * 0.10, cv + av + 0.02, u0 + du * 0.52, cv + av + 0.52, st * 1.0, PAL.metalA);
    truck(u0 + du * 0.22, cv + av + 0.30, true, PAL.signWht, PAL.signRed);
    truck(u0 + du * 0.44, cv + av + 0.30, true, PAL.signWht, PAL.signRed);
    roofSign('HOSPITAL', cu, cv + av * 0.9, 0, 5 * Q.sc, PAL.signRed, H + 2 * Q.sc, au * 1.8);
    treeLine(u1 - 0.26, v0 + 0.4, u1 - 0.26, v1 - 0.4, Math.max(2, Math.round(dv)), 0.86, 520);
    edgeKit(true);
  };

  /* ---- civic: public school with a yard ---- */
  ARCH.school = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = PAL.brickC, du = u1 - u0, dv = v1 - v0;
    var wide = du >= dv;
    var bu1 = wide ? u1 : u0 + du * 0.58, bv1 = wide ? v0 + dv * 0.58 : v1;
    var H = st * 2.4;
    var n = G.elPts(G.buf, u0, v0, bu1, bv1, (bu1 - u0) * 0.55, (bv1 - v0) * 0.62);
    ext(n, 0, H, col);
    facade(u0, v0, bu1, bv1, st * 0.5, H - st * 0.35, 2, PAL.glass, 'grid');
    parapet(u0, v0, bu1, bv1, H, col, PAL.roofGrey);
    roofKit(u0 + 0.1, v0 + 0.1, bu1 - 0.1, bv1 - 0.1, H + 3 * Q.sc);
    /* entrance and flagpole */
    var eu = wide ? (u0 + bu1) * 0.5 : bu1, ev = wide ? bv1 : (v0 + bv1) * 0.5;
    if (wide) canopy(eu - 0.30, ev - 0.02, eu + 0.30, ev + 0.20, st * 0.9);
    else canopy(eu - 0.02, ev - 0.30, eu + 0.20, ev + 0.30, st * 0.9);
    var ctx = Q.ctx, p1 = XY(u0 + 0.16, v1 - 0.16, 0), p2 = XY(u0 + 0.16, v1 - 0.16, 22 * Q.sc);
    ctx.strokeStyle = css(PAL.steel); ctx.lineWidth = Math.max(0.8, 1.2 * Q.sc);
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    ctx.fillStyle = css(PAL.signBlue);
    ctx.beginPath();
    ctx.moveTo(p2[0], p2[1]); ctx.lineTo(p2[0] + 9 * Q.sc, p2[1] + 2.5 * Q.sc);
    ctx.lineTo(p2[0], p2[1] + 5.5 * Q.sc); ctx.fill();
    /* playground / ball court on the rest of the plot */
    if (wide) { pad(u0 + 0.1, bv1 + 0.18, u1 - 0.1, v1 - 0.1, PAL.courtG, 0); }
    else { pad(bu1 + 0.18, v0 + 0.1, u1 - 0.1, v1 - 0.1, PAL.courtG, 0); }
    if (Q.sc > 0.6) {
      var qx = wide ? (u0 + u1) * 0.5 : (bu1 + u1) * 0.5;
      var qy = wide ? (bv1 + v1) * 0.5 : (v0 + v1) * 0.5;
      box(qx - 0.04, qy - 0.30, qx + 0.04, qy - 0.22, 0, 9 * Q.sc, PAL.metalB);
      box(qx - 0.16, qy - 0.34, qx + 0.16, qy - 0.18, 9 * Q.sc, 9.8 * Q.sc, PAL.white);
    }
    fascia(0, bv1, u0 + 0.2, bu1 - 0.2, H * 0.62, H * 0.82, PAL.signBlue, 'SCHOOL');
    edgeKit(true);
  };

  /* ---- civic: public clinic ---- */
  ARCH.clinic = function () {
    var m = 0.22, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = PAL.white, du = u1 - u0, dv = v1 - v0;
    var H = st * (2.6 + R(240) * 0.6);
    var bu1 = u1 - du * 0.24;
    box(u0, v0, bu1, v1, 0, H, col);
    facade(u0, v0, bu1, v1, st * 0.5, H - st * 0.3, Math.round(H / st), PAL.glass, 'grid');
    parapet(u0, v0, bu1, v1, H, col, PAL.roofGrey);
    box(bu1, v0 + dv * 0.10, u1, v1 - dv * 0.10, 0, st * 1.2, mix(col, PAL.glassG, 0.35));
    parapet(bu1, v0 + dv * 0.10, u1, v1 - dv * 0.10, st * 1.2, PAL.concrete, PAL.roofGrey);
    canopy(bu1 - 0.05, v1 - dv * 0.42, u1 + 0.16, v1 - dv * 0.06, st * 0.95);
    /* the cross, on the wall and again on the roof */
    var ctx = Q.ctx;
    ctx.fillStyle = css(PAL.signRed);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, (u0 + bu1) * 0.5 - 0.09, (u0 + bu1) * 0.5 + 0.09, H * 0.62, H * 0.80);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, (u0 + bu1) * 0.5 - 0.22, (u0 + bu1) * 0.5 + 0.22, H * 0.67, H * 0.75);
    ctx.fill();
    if (Q.sc > 0.55) {                                    // ambulance on the apron
      box(u1 - du * 0.18, v1 - dv * 0.30, u1 - du * 0.02, v1 - dv * 0.06, 1.4 * Q.sc, 8 * Q.sc, PAL.white);
      box(u1 - du * 0.16, v1 - dv * 0.28, u1 - du * 0.04, v1 - dv * 0.20, 8 * Q.sc, 9 * Q.sc, PAL.signRed);
    }
    roofKit(u0 + 0.1, v0 + 0.1, bu1 - 0.1, v1 - 0.1, H + 3 * Q.sc);
    edgeKit(true);
  };

  /* ---- civic: city grocery ---- */
  ARCH.market = function () {
    var m = 0.20, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = PAL.stucco;
    var H = st * 1.7;
    box(u0, v0, u1, v1, 0, H, col);
    var ctx = Q.ctx;
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + 0.08, u1 - 0.08, st * 0.12, st * 0.86);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + 0.08, v1 - 0.08, st * 0.12, st * 0.86);
    ctx.fill();
    fascia(0, v1, u0 + 0.08, u1 - 0.08, st * 0.90, st * 1.26, PAL.signGrn, 'GROCERY');
    fascia(1, u1, v0 + 0.08, v1 - 0.08, st * 0.90, st * 1.26, PAL.signGrn, 'CITY');
    /* striped awning and produce crates */
    var i;
    for (i = 0; i < 4; i++) {
      var a0 = u0 + 0.10 + i * ((u1 - u0 - 0.2) / 4);
      box(a0, v1, a0 + (u1 - u0 - 0.2) / 8, v1 + 0.16, st * 0.66, st * 0.80,
        (i & 1) ? PAL.signRed : PAL.white);
    }
    if (Q.sc > 0.6) {
      for (i = 0; i < 3; i++) {
        box(u0 + 0.16 + i * 0.24, v1 + 0.05, u0 + 0.32 + i * 0.24, v1 + 0.19, 0, 4 * Q.sc,
          [PAL.signOrg, PAL.signGrn, PAL.signRed][i]);
      }
    }
    parapet(u0, v0, u1, v1, H, col, PAL.roofGrey);
    roofKit(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, H + 3 * Q.sc);
    edgeKit(true); kerbCars(76);
  };

  /* ---- civic: childcare, the brightest roof on the block ---- */
  ARCH.creche = function () {
    var m = 0.22, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = PAL.bone;
    var bv1 = v0 + (v1 - v0) * 0.60;
    var H = st * 1.5;
    box(u0, v0, u1, bv1, 0, H, col);
    G.gable(Q.ctx, Q.cx, Q.cy, Q.fx, Q.fy, u0, v0, u1, bv1, H, H + st * 0.62, 0,
      R(250) < 0.5 ? PAL.signRed : PAL.signYel);
    glaze(0, bv1, u0 + 0.1, u1 - 0.1, st * 0.35, H - st * 0.25, 3, 1, PAL.glass);
    /* the yard: sandpit, slide and a climbing frame */
    pad(u0, bv1 + 0.06, u1, v1, PAL.sand, 0);
    if (Q.sc > 0.55) {
      var cy2 = (bv1 + v1) * 0.5;
      box(u0 + 0.18, cy2 - 0.10, u0 + 0.30, cy2 + 0.10, 0, 6 * Q.sc, PAL.signBlue);
      box(u0 + 0.30, cy2 - 0.06, u0 + 0.62, cy2 + 0.06, 2 * Q.sc, 6 * Q.sc, PAL.signYel);
      box(u1 - 0.34, cy2 - 0.14, u1 - 0.14, cy2 + 0.14, 0, 7 * Q.sc, PAL.signGrn);
      tree(u1 - 0.22, v1 - 0.16, 0.7, 0);
    }
    edgeKit(true);
  };

  /* ---- civic: social housing ---- */
  ARCH.social = function () {
    var m = 0.16, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.grass);
    edgeKit(false);
    var st = Q.U, col = mix(PAL.brickA, PAL.stucco, 0.35), du = u1 - u0, dv = v1 - v0;
    var wide = du >= dv;
    var H = st * (6.5 + R(260) * 2.5) * (0.72 + Q.ak * 0.28);
    var su0 = u0, sv0 = v0, su1 = wide ? u0 + du * 0.56 : u1, sv1 = wide ? v1 : v0 + dv * 0.56;
    mass(su0, sv0, su1, sv1, H, col, 'grid');
    var floors = Math.max(5, Math.round(H / st)), i, hh;
    if (Q.sc > 0.5) {
      for (i = 1; i < floors; i++) {
        hh = i * (H / floors);
        box(su0 + 0.05, sv1, su1 - 0.05, sv1 + 0.09, hh, hh + Math.max(0.9, 1.5 * Q.sc), mul(col, 1.1));
        box(su1, sv0 + 0.05, su1 + 0.09, sv1 - 0.05, hh, hh + Math.max(0.9, 1.5 * Q.sc), mul(col, 1.1));
      }
    }
    roofKit(su0 + 0.08, sv0 + 0.08, su1 - 0.08, sv1 - 0.08, H + 3 * Q.sc);
    /* community wing and a green courtyard */
    var wu0 = wide ? su1 + 0.16 : u0, wv0 = wide ? v0 : sv1 + 0.16;
    if (wide) { mass(wu0, wv0 + dv * 0.10, u1, v1 - dv * 0.30, st * 1.6, PAL.bone, 'grid'); }
    else { mass(u0 + du * 0.10, wv0, u1 - du * 0.30, v1, st * 1.6, PAL.bone, 'grid'); }
    if (Q.sc > 0.5) {
      tree(wide ? (su1 + u1) * 0.5 : (u0 + u1) * 0.72, wide ? v1 - dv * 0.14 : (sv1 + v1) * 0.5, 0.95, 0);
      tree(wide ? su1 + 0.24 : u1 - 0.24, wide ? v1 - dv * 0.30 : sv1 + 0.28, 0.8, 2);
    }
    fascia(0, sv1, su0 + 0.16, su1 - 0.16, st * 0.5, st * 0.8, PAL.signBlue, 'HOUSES');
    edgeKit(true); kerbCars(78);
  };

  /* ---- commercial: the supertalls ------------------------------------
     Only ever picked downtown (see pickArch). Both are built the same way:
     a podium with shops at grade so the tower has a street to stand on, then
     a stack of boxes each inset from the one below. The setbacks are the
     point - in an isometric view a single tall box just reads as a wide box,
     and it is the steps that read as height.                              */

  ARCH.spire = function () {
    var m = 0.26, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, ctx = Q.ctx;
    var du = u1 - u0, dv = v1 - v0;
    var glass = R(201) < 0.55 ? PAL.glassB : PAL.glassG;

    var Hp = st * (1.6 + R(202) * 0.6);
    var ch = Math.min(du, dv) * 0.14;
    var n = G.chamfPts(G.buf, u0, v0, u1, v1, ch);
    ext(n, 0, Hp, col);
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + ch, u1 - ch, st * 0.14, Hp * 0.66);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + ch, v1 - ch, st * 0.14, Hp * 0.66);
    ctx.fill();
    shopRow(0, v1, u0 + ch, u1 - ch, Hp * 0.70, Hp * 0.94, 203);
    shopRow(1, u1, v0 + ch, v1 - ch, Hp * 0.70, Hp * 0.94, 205);
    parapet(u0, v0, u1, v1, Hp, col);

    var cu = (u0 + u1) * 0.5, cv = (v0 + v1) * 0.5;
    var hw = du * 0.30, hh = dv * 0.30;
    var total = (7.0 + Q.lv * 1.1 + R(206) * 3.4) * st * Q.hc * Q.ak * (1 + Q.dt * 0.5);
    var H = Hp, k, tw, th, seg, a0, b0, a1, b1, cc, rows;
    for (k = 0; k < 3; k++) {
      tw = hw * (1 - k * 0.22); th = hh * (1 - k * 0.22);
      seg = total * (k === 0 ? 0.46 : (k === 1 ? 0.33 : 0.21));
      a0 = cu - tw; b0 = cv - th; a1 = cu + tw; b1 = cv + th;
      cc = Math.min(tw, th) * 0.26;
      n = G.chamfPts(G.buf, a0, b0, a1, b1, cc);
      ext(n, H, H + seg, k ? mix(col, glass, 0.16 * k) : col, 1);
      rows = Math.max(2, Math.round(seg / st));
      bands(0, b1, a0 + cc, a1 - cc, H + st * 0.3, H + seg - st * 0.3, rows, glass);
      bands(1, a1, b0 + cc, b1 - cc, H + st * 0.3, H + seg - st * 0.3, rows, glass);
      H += seg;
      if (k < 2) {                                   // the setback ledge itself
        box(a0 + cc * 0.5, b0 + cc * 0.5, a1 - cc * 0.5, b1 - cc * 0.5,
          H, H + Math.max(1, 1.6 * Q.sc), mul(col, 1.06));
      }
    }
    var mw = hw * 0.30, mh = hh * 0.30;
    box(cu - mw, cv - mh, cu + mw, cv + mh, H, H + st * 0.9, mul(col, 1.04));
    H += st * 0.9;
    G.post(ctx, Q.cx, Q.cy, Q.fx, Q.fy, cu, cv, Math.min(mw, mh) * 0.34,
      H, H + st * (1.4 + R(207) * 1.2), faces(PAL.steel));
    roofKit(cu - mw, cv - mh, cu + mw, cv + mh, H);
    edgeKit(true); kerbCars(208);
  };

  /* Stepped, art-deco: more steps, no mast, squatter than the spire. */
  ARCH.setback = function () {
    var m = 0.24, u0 = Q.u0 + m, v0 = Q.v0 + m, u1 = Q.u1 - m, v1 = Q.v1 - m;
    pad(Q.u0, Q.v0, Q.u1, Q.v1, PAL.plaza);
    edgeKit(false);
    var st = Q.U, col = Q.pal, ctx = Q.ctx;
    var du = u1 - u0, dv = v1 - v0;
    var glass = R(211) < 0.5 ? PAL.glassG : PAL.glassB;

    var Hp = st * (1.4 + R(212) * 0.5);
    ext(G.rectPts(G.buf, u0, v0, u1, v1), 0, Hp, col);
    ctx.fillStyle = css(PAL.glassDark);
    ctx.beginPath();
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 0, v1, u0 + 0.08, u1 - 0.08, st * 0.12, Hp * 0.68);
    G.wallQuad(ctx, Q.cx, Q.cy, Q.fx, Q.fy, 1, u1, v0 + 0.08, v1 - 0.08, st * 0.12, Hp * 0.68);
    ctx.fill();
    shopRow(0, v1, u0 + 0.08, u1 - 0.08, Hp * 0.72, Hp * 0.95, 213);
    parapet(u0, v0, u1, v1, Hp, col);

    var cu = (u0 + u1) * 0.5, cv = (v0 + v1) * 0.5;
    var total = (5.4 + Q.lv * 0.9 + R(214) * 2.6) * st * Q.hc * Q.ak * (1 + Q.dt * 0.45);
    var steps = 4, H = Hp, k, f, tw, th, seg, rows;
    for (k = 0; k < steps; k++) {
      f = 0.34 - k * 0.062;                          // each tier tighter
      tw = du * f; th = dv * f;
      seg = total * (0.40 - k * 0.075);
      ext(G.rectPts(G.buf, cu - tw, cv - th, cu + tw, cv + th), H, H + seg,
        mix(col, glass, 0.10 * k));
      rows = Math.max(1, Math.round(seg / st));
      bands(0, cv + th, cu - tw + 0.05, cu + tw - 0.05,
        H + st * 0.25, H + seg - st * 0.25, rows, glass);
      bands(1, cu + tw, cv - th + 0.05, cv + th - 0.05,
        H + st * 0.25, H + seg - st * 0.25, rows, glass);
      H += seg;
      box(cu - tw * 1.06, cv - th * 1.06, cu + tw * 1.06, cv + th * 1.06,
        H, H + Math.max(1, 1.5 * Q.sc), mul(col, 1.08));   // cornice
      H += Math.max(1, 1.5 * Q.sc);
    }
    roofKit(cu - du * 0.10, cv - dv * 0.10, cu + du * 0.10, cv + dv * 0.10, H);
    edgeKit(true); kerbCars(216);
  };

  /* ================================================================== *
   * public
   * ================================================================== */

  function palOf (L) {
    var r = hash(L.x0, L.y0, 33);
    if (CIVIC[L.kind]) return PAL.bone;
    if (L.kind === T.RES) return [PAL.brickA, PAL.brickB, PAL.brickC, PAL.stucco, PAL.sand, PAL.concrete][(r * 6) | 0];
    if (L.kind === T.IND) return [PAL.metalA, PAL.metalB, PAL.sand, PAL.roofGrey][(r * 4) | 0];
    // Saturated colour is a downtown thing. Out in the low-rise districts the
    // pale model-village palette IS the look, so this branch only widens as
    // the neighbourhood densifies: 10% out of town, 44% in the core.
    if (r < 0.10 + 0.34 * (L.dt || 0)) {
      return [PAL.teal, PAL.terracot, PAL.plum, PAL.signBlue, PAL.sage, PAL.clay,
        PAL.brickC, PAL.glassG][(hash(L.x0, L.y0, 34) * 8) | 0];
    }
    return [PAL.bone, PAL.concrete, PAL.white, PAL.stucco, PAL.sand,
      PAL.bone][(hash(L.x0, L.y0, 35) * 6) | 0];
  }

  function lotOf (s, x, y) {
    plan(s);
    var id = owner[y * GRID + x];
    return id < 0 ? null : lots[id];
  }

  /* 0 = not ours, 1 = this tile anchors a lot, -1 = swallowed by its lot */
  function role (s, x, y) {
    var L = lotOf(s, x, y);
    if (!L) return 0;
    return (x === L.x1 && y === L.y1) ? 1 : -1;
  }

  var ERR = 0;
  /* A canvas context that draws nothing.

     The ground phase runs exactly the same archetype code as the structure
     phase, but only the flat ground pads are meant to reach the canvas. Aiming
     everything else at this stub means no primitive has to be special-cased
     and none can leak through - including whatever an archetype reaches for
     next year. Built from the real prototype so it stays complete. */
  var NUL = (function () {
    var n = { canvas: { width: 1, height: 1 } };
    var stub = { addColorStop: function () {}, setTransform: function () {} };
    function nop () {}
    // The named surface, so the stub is complete under the headless smoke
    // harness too, where there is no CanvasRenderingContext2D to read.
    var M = ('save restore scale rotate translate transform setTransform ' +
      'resetTransform getTransform clearRect fillRect strokeRect beginPath ' +
      'closePath moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ' +
      'ellipse rect roundRect fill stroke clip fillText strokeText drawImage ' +
      'createImageData putImageData setLineDash getLineDash reset').split(' ');
    var P = ('fillStyle strokeStyle globalAlpha globalCompositeOperation ' +
      'lineWidth lineCap lineJoin miterLimit lineDashOffset shadowBlur ' +
      'shadowColor shadowOffsetX shadowOffsetY font textAlign textBaseline ' +
      'direction imageSmoothingEnabled imageSmoothingQuality filter ' +
      'letterSpacing wordSpacing fontKerning').split(' ');
    var i, k, d;
    for (i = 0; i < M.length; i++) n[M[i]] = nop;
    for (i = 0; i < P.length; i++) n[P[i]] = 0;
    // and whatever else the real context grew since, so nothing can leak
    var proto = typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype : null;
    if (proto) {
      var keys = Object.getOwnPropertyNames(proto);
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k === 'constructor' || k === 'canvas' || n[k] !== undefined) continue;
        d = Object.getOwnPropertyDescriptor(proto, k);
        n[k] = (d && typeof d.value === 'function') ? nop : 0;
      }
    }
    n.createLinearGradient = n.createRadialGradient =
      n.createConicGradient = function () { return stub; };
    n.createPattern = function () { return null; };
    n.measureText = function () { return { width: 0 }; };
    n.getImageData = function () {
      return { width: 1, height: 1, data: [0, 0, 0, 0] };
    };
    n.isPointInPath = n.isPointInStroke = function () { return false; };
    return n;
  })();

  /* Paint only this lot's ground plane. Called from render.js's ground pass,
     before the shadows; draw() then skips the same pads. */
  function drawGround (ctx, o) {
    Q.gp = 1; Q.gctx = ctx;
    try { draw(NUL, o); } finally { Q.gp = 0; Q.gctx = null; }
  }

  function draw (ctx, o) {
    var L = lotOf(o.s, o.x, o.y);
    if (!L) return;
    Q.ctx = ctx; Q.cx = o.cx; Q.cy = o.cy; Q.fx = o.fx; Q.fy = o.fy;
    Q.sc = o.scale; Q.U = UNIT * o.scale;
    Q.x = L.x0; Q.y = L.y0;                 // hash on the lot origin, not the anchor
    Q.lv = L.lv; Q.w = L.w; Q.h = L.h; Q.road = L.road; Q.wat = L.water | 0; Q.kind = L.kind;
    Q.dt = L.dt || 0;
    Q.hc = 0.60 + hash(L.x0, L.y0, 36) * 0.68;    // this block's height class
    // a single tile cannot carry a thirty-storey slab without looking like a
    // pencil, so tall archetypes scale with how much land the lot actually has
    var area = L.w * L.h;
    Q.ak = area >= 6 ? 1.05 : (area >= 4 ? 1 : (area >= 2 ? 0.80 : 0.58));
    Q.u0 = -2 * (L.w - 1) - 1; Q.v0 = -2 * (L.h - 1) - 1; Q.u1 = 1; Q.v1 = 1;
    Q.pal = palOf(L);
    // one glazing tint per block: a street of identical blue grids is what
    // made the first pass read as a bar chart rather than a city.
    Q.win = WINS[(hash(L.x0, L.y0, 37) * WINS.length) | 0];
    if (Q.kind === T.RES) Q.win = mix(Q.win, PAL.glass, 0.4);
    // a minority of roofs are a colour rather than grey felt
    var dr = hash(L.x0, L.y0, 38);
    Q.deck = dr < 0.10 ? mix(Q.pal, PAL.roofGrey, 0.55)
      : (dr < 0.17 ? mix(PAL.solar, PAL.roofGrey, 0.3)
        : (dr < 0.24 ? mix(PAL.treeA, PAL.roofGrey, 0.45) : PAL.roofGrey));
    // landmarks.js owns the hero structures. It draws on the public gfx API
    // with its own frame, so it needs none of the Q state above - only the
    // lot box and the scale.
    if (L.arch === 'hero' && MM.landmarks && MM.landmarks.draw) {
      try { MM.landmarks.draw(ctx, o, L, Q); } catch (e) {}
      return;
    }
    var fn = ARCH[L.arch] || ARCH.strip;
    try {
      fn();
    } catch (e) {
      if (ERR++ < 3 && typeof console !== 'undefined') {
        try { console.error('lots.' + L.arch + ': ' + e.message + '\n' + e.stack); } catch (e2) {}
      }
    }
  }

  /* Rough massing for the shadow and night-light passes: the lot's footprint
     in tiles plus a height in px at scale 1. Approximate on purpose - a
     shadow only needs the silhouette to land in roughly the right place. */
  var TALL = {
    strip: 2.2, atrium: 3.2, curve: 5.0, podium: 6.0, court: 3.0, mall: 2.4,
    campus: 3.0, rotunda: 4.0, row: 2.6, perim: 4.0, towers: 7.0,
    spire: 15.0, setback: 11.0, hero: 30.0,
    shed: 2.0, plant: 3.4, yard: 1.2,
    green: 0.4, pond: 0.4, sport: 0.6, plaza: 0.5,
    airport: 2.6, stadium: 3.2, depot: 2.0, power: 4.2, solar: 0.8, wind: 5.0,
    marina: 2.0, port: 3.6, funfair: 3.4, fire: 2.4, police: 3.0, hospital: 5.4,
    school: 2.4, clinic: 3.0, market: 1.8, creche: 1.6, social: 6.0
  };

  function shape (s, x, y) {
    var L = lotOf(s, x, y);
    if (!L || x !== L.x1 || y !== L.y1) return null;
    var hc = 0.60 + hash(L.x0, L.y0, 36) * 0.68;
    var area = L.w * L.h;
    var ak = area >= 6 ? 1.05 : (area >= 4 ? 1 : (area >= 2 ? 0.80 : 0.58));
    return {
      x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, w: L.w, h: L.h,
      kind: L.kind, arch: L.arch, lv: L.lv,
      // Downtown builds taller than the suburbs, but only on a lot with the
      // land to carry it - a 1x1 supertall reads as a pencil.
      top: (TALL[L.arch] || 2) * UNIT * (0.70 + 0.30 * hc) * ak *
        (1 + (area >= 4 ? (L.dt || 0) : 0) * 0.25)
    };
  }

  MM.lots = {
    plan: plan, role: role, draw: draw, ground: drawGround,
    lotOf: lotOf, lots: lots, shape: shape,
    pin: pin, clearPins: clearPins, ARCH: ARCH, UNIT: UNIT
  };
})(window.MM);

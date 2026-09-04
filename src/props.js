/* PROPS & STREET LIFE - trees, people, parked cars, street furniture.
   The most numerous layer in the renderer, so everything here is batched:
   colour strings are cached until the light changes, and blobs of the same
   colour are accumulated into one path and filled once. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx, PAL = G.PAL, CARS = G.CARS, T = MM.TILE;
  var hash = G.hash, ix = G.ix, iy = G.iy, prism = G.prism, mul = G.mul;
  var TAU = Math.PI * 2;
  var WARM = G.raw([255, 216, 148]);        // lamp head at night, unlit
  var WARM_A = 'rgba(255,216,148,0.20)';

  /* ---- source colours -------------------------------------------------- */
  var CLOTH = [
    [230,  78,  70], [ 56, 116, 208], [244, 186,  60], [238, 240, 234],
    [ 92, 176, 104], [148,  96, 196], [ 46,  54,  72], [236, 128, 170]
  ];
  var SKIN = [216, 170, 134];
  var PARA = [[232,  92,  80], [246, 190,  66], [ 70, 158, 220], [248, 248, 244]];
  var PROBE = [128, 128, 128];              // detects a light change in one concat

  /* ---- per-light colour cache ------------------------------------------
     css() builds a string every call. At 1500 tiles that is tens of
     thousands of concats a frame, so build the whole set once and reuse it
     until the light actually moves. */
  var _probe = null, C = null;

  function sync () {
    var pr = G.css(PROBE);
    if (C && pr === _probe) return;
    _probe = pr;
    var i, person = [], car = [], para = [G.css(mul(PAL.shade, 1.5))];
    for (i = 0; i < CLOTH.length; i++) person.push(G.css(CLOTH[i]));
    person.push(G.css(SKIN));                       // bucket 8 = heads
    for (i = 0; i < CARS.length; i++) car.push(G.faces(CARS[i]));
    for (i = 0; i < PARA.length; i++) para.push(G.css(PARA[i]));
    C = {
      person: person, car: car, parasol: para,
      trunk: G.css(PAL.trunk),
      tbase: [G.css(PAL.treeA), G.css(PAL.treeC), G.css(PAL.treeB)],
      thi: [G.css(mul(PAL.treeA, 1.26)), G.css(mul(PAL.treeC, 1.26)), G.css(mul(PAL.treeB, 1.26))],
      leaf: G.css(mul(PAL.treeB, 1.1)),
      dark: G.css(mul(PAL.shade, 1.6)),
      pole: G.css(mul(PAL.steel, 0.52)),
      head: G.css(mul(PAL.steel, 1.06)),
      steel: G.faces(PAL.steel),
      white: G.faces(PAL.white),
      conc: G.faces(PAL.concrete),
      concB: G.faces(PAL.concreteB),
      glass: G.faces(PAL.glass),
      glassD: G.css(PAL.glassDark),
      wood: G.faces([160, 118,  74]),
      bin: G.faces([ 66,  94,  84]),
      red: G.faces([216,  62,  52]),
      blue: G.faces([ 58, 128, 200]),
      yellow: G.faces([244, 190,  70])
    };
  }

  /* ---- tile-space edge points -----------------------------------------
     mask bit 0 = +x neighbour is road (the u=+1 edge), 1 = -x (u=-1),
     2 = +y (v=+1), 3 = -y (v=-1). Zero-alloc: result lands in _pu/_pv. */
  var _pu = 0, _pv = 0;
  function edgePt (e, t, off) {
    if (e < 2) { _pu = e ? -off : off; _pv = t; }
    else { _pu = t; _pv = (e === 3) ? -off : off; }
  }
  function pickEdge (mask, o, k) {
    if (!mask) return -1;
    var start = (hash(o.x, o.y, k) * 4) | 0, i, e;
    for (i = 0; i < 4; i++) { e = (start + i) & 3; if (mask & (1 << e)) return e; }
    return -1;
  }
  /* prefer a near (lower, unoccluded) edge for anything with detail */
  function nearEdge (mask, o, k) { return pickEdge((mask & 5) || mask, o, k); }

  /* ---- generic ellipse batcher ----------------------------------------
     Push blobs tagged with a colour bucket, flush once: one fill per
     colour instead of one fill per blob. */
  var BN = 0, BX = new Float64Array(48), BY = new Float64Array(48),
      BRX = new Float64Array(48), BRY = new Float64Array(48), BB = new Uint8Array(48);
  function bpush (x, y, rx, ry, b) {
    if (BN >= 48) return;
    BX[BN] = x; BY[BN] = y; BRX[BN] = rx; BRY[BN] = ry; BB[BN] = b; BN++;
  }
  function bflush (ctx, cols) {
    for (var b = 0; b < cols.length; b++) {
      var open = 0;
      for (var i = 0; i < BN; i++) {
        if (BB[i] !== b) continue;
        if (!open) { ctx.beginPath(); open = 1; }
        ctx.moveTo(BX[i] + BRX[i], BY[i]);          // new subpath, no join line
        ctx.ellipse(BX[i], BY[i], BRX[i], BRY[i], 0, 0, TAU);
      }
      if (open) { ctx.fillStyle = cols[b]; ctx.fill(); }
    }
    BN = 0;
  }
  function dot (ctx, x, y, rx, ry, col) {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  }

  /* ---- trees ----------------------------------------------------------
     Same batching trick. Colour jitter is quantised into 3 buckets
     (treeA / treeC / treeB) so a row of trees varies but still batches. */
  var TN = 0, TX = new Float64Array(12), TY = new Float64Array(12),
      TS = new Float64Array(12), TV = new Uint8Array(12), TB = new Uint8Array(12);
  function tpush (x, y, s, variant, bucket) {
    if (TN >= 12) return;
    TX[TN] = x; TY[TN] = y; TS[TN] = s; TV[TN] = variant & 3; TB[TN] = bucket % 3; TN++;
  }

  /* canopy subpaths for one tree. hi=1 draws only the sunward (up-left) blob. */
  function canopy (ctx, x, y, s, v, hi) {
    if (v === 1) {                                   // tall narrow
      if (hi) { ctx.moveTo(x + 0.06 * s, y - 1.26 * s); ctx.ellipse(x - 0.11 * s, y - 1.26 * s, 0.17 * s, 0.30 * s, 0, 0, TAU); }
      else { ctx.moveTo(x + 0.30 * s, y - 1.02 * s); ctx.ellipse(x, y - 1.02 * s, 0.30 * s, 0.54 * s, 0, 0, TAU); }
      return;
    }
    if (v === 2) {                                   // shrub / bush
      if (hi) { ctx.moveTo(x - 0.01 * s, y - 0.28 * s); ctx.ellipse(x - 0.18 * s, y - 0.28 * s, 0.17 * s, 0.13 * s, 0, 0, TAU); }
      else {
        ctx.moveTo(x + 0.12 * s, y - 0.18 * s); ctx.ellipse(x - 0.16 * s, y - 0.18 * s, 0.28 * s, 0.21 * s, 0, 0, TAU);
        ctx.moveTo(x + 0.39 * s, y - 0.13 * s); ctx.ellipse(x + 0.15 * s, y - 0.13 * s, 0.24 * s, 0.18 * s, 0, 0, TAU);
      }
      return;
    }
    if (v === 3) {                                   // conifer
      if (hi) {
        ctx.moveTo(x - 0.34 * s, y - 0.34 * s); ctx.lineTo(x, y - 1.30 * s);
        ctx.lineTo(x - 0.02 * s, y - 0.34 * s); ctx.closePath();
      } else {
        ctx.moveTo(x - 0.50 * s, y - 0.08 * s); ctx.lineTo(x, y - 0.86 * s);
        ctx.lineTo(x + 0.50 * s, y - 0.08 * s); ctx.closePath();
        ctx.moveTo(x - 0.38 * s, y - 0.34 * s); ctx.lineTo(x, y - 1.30 * s);
        ctx.lineTo(x + 0.38 * s, y - 0.34 * s); ctx.closePath();
      }
      return;
    }
    if (hi) { ctx.moveTo(x - 0.02 * s, y - 0.96 * s); ctx.ellipse(x - 0.18 * s, y - 0.96 * s, 0.26 * s, 0.23 * s, 0, 0, TAU); }
    else {                                           // round broadleaf
      ctx.moveTo(x + 0.46 * s, y - 0.76 * s); ctx.ellipse(x, y - 0.76 * s, 0.46 * s, 0.40 * s, 0, 0, TAU);
      ctx.moveTo(x + 0.47 * s, y - 0.54 * s); ctx.ellipse(x + 0.19 * s, y - 0.54 * s, 0.28 * s, 0.24 * s, 0, 0, TAU);
    }
  }

  function tflush (ctx) {
    if (!TN) return;
    var i, open = 0, tw, th, pass, b;
    for (i = 0; i < TN; i++) {                       // trunks (bushes have none)
      if (TV[i] === 2) continue;
      if (!open) { ctx.beginPath(); open = 1; }
      tw = TS[i] * 0.09;
      th = TS[i] * (TV[i] === 1 ? 0.64 : (TV[i] === 3 ? 0.26 : 0.46));
      ctx.moveTo(TX[i] - tw, TY[i]); ctx.lineTo(TX[i] - tw * 0.6, TY[i] - th);
      ctx.lineTo(TX[i] + tw * 0.6, TY[i] - th); ctx.lineTo(TX[i] + tw, TY[i]);
      ctx.closePath();
    }
    if (open) { ctx.fillStyle = C.trunk; ctx.fill(); }
    for (pass = 0; pass < 2; pass++) {
      for (b = 0; b < 3; b++) {
        open = 0;
        for (i = 0; i < TN; i++) {
          if (TB[i] !== b) continue;
          if (!open) { ctx.beginPath(); open = 1; }
          canopy(ctx, TX[i], TY[i], TS[i], TV[i], pass);
        }
        if (open) { ctx.fillStyle = (pass ? C.thi : C.tbase)[b]; ctx.fill(); }
      }
    }
    TN = 0;
  }

  function tree (ctx, o) {
    try {
      if (!ctx || !o) return;
      sync();
      var k = 900 + ((o.u * 7) | 0) * 3 + ((o.v * 11) | 0);
      tpush(ix(o.cx, o.fx, o.u, o.v), iy(o.cy, o.fy, o.u, o.v, 0),
        (o.size || 1) * 14 * (o.fx / 32), o.variant | 0,
        (hash(o.x, o.y, k) * 3) | 0);
      tflush(ctx);
    } catch (e) { /* a prop must never kill the frame */ }
  }

  /* ---- tree groups ----------------------------------------------------- */
  function parkTrees (ctx, o, budget) {
    var n = 3 + ((hash(o.x, o.y, 11) * 6) | 0);
    if (n > budget) n = budget;
    var p = o.fx / 32, i, a, b, c, u, v, variant;
    for (i = 0; i < n; i++) {
      a = hash(o.x, o.y, 20 + i); b = hash(o.x, o.y, 40 + i); c = hash(o.x, o.y, 60 + i);
      u = a * 1.6 - 0.8; v = b * 1.6 - 0.8;
      variant = c < 0.13 ? 3 : (c < 0.38 ? 2 : (c < 0.56 ? 1 : 0));
      tpush(ix(o.cx, o.fx, u, v), iy(o.cy, o.fy, u, v, 0),
        (0.68 + c * 0.6) * 14 * p, variant, (a * 3) | 0);
    }
    tflush(ctx);
  }

  /* neat line of trees along whichever kerbs the mask asks for.
     One species per tile: a real street planting looks like that, and it
     keeps the whole row down to three fills. */
  function streetTrees (ctx, o, edges, seed) {
    if (!edges) return;
    var p = o.fx / 32, e, i, cnt, h1, t;
    var bucket = (hash(o.x, o.y, seed) * 3) | 0;
    for (e = 0; e < 4; e++) {
      if (!(edges & (1 << e))) continue;
      cnt = 1 + ((hash(o.x, o.y, seed + e) * 2) | 0);
      for (i = 0; i < cnt; i++) {
        h1 = hash(o.x, o.y, seed + e * 17 + i * 5 + 3);
        if (h1 < 0.24) continue;                     // gaps, so it is not a hedge
        t = ((i + 0.5) / cnt) * 1.32 - 0.66;
        edgePt(e, t, 0.78);
        tpush(ix(o.cx, o.fx, _pu, _pv), iy(o.cy, o.fy, _pu, _pv, 0),
          (0.74 + h1 * 0.34) * 14 * p, h1 < 0.44 ? 1 : 0, bucket);
      }
    }
    tflush(ctx);
  }

  function loneTrees (ctx, o) {
    var h0 = hash(o.x, o.y, 5);
    if (h0 > 0.42) return;
    var p = o.fx / 32, n = 1 + ((h0 * 7) | 0), i, a, b, u, v;
    var bucket = (hash(o.x, o.y, 6) * 3) | 0;      // one clump, one species
    if (n > 3) n = 3;
    for (i = 0; i < n; i++) {
      a = hash(o.x, o.y, 7 + i * 3); b = hash(o.x, o.y, 8 + i * 3);
      u = a * 1.2 - 0.6; v = b * 1.2 - 0.6;
      tpush(ix(o.cx, o.fx, u, v), iy(o.cy, o.fy, u, v, 0),
        (0.6 + b * 0.55) * 14 * p, b < 0.45 ? 2 : 0, bucket);
    }
    tflush(ctx);
  }

  /* ---- parked cars ------------------------------------------------------
     body prism (3 fills) plus one batched dark glass band across the row. */
  function parked (ctx, o) {
    if (hash(o.x, o.y, 31) > 0.4) return;
    var e = pickEdge(o.mask, o, 33);
    if (e < 0) return;
    var p = o.fx / 32, n = 2 + ((hash(o.x, o.y, 35) * 3) | 0), i, t, ci, F, iu, iv;
    var along = (e < 2), off = (e === 1 || e === 3) ? -0.5 : 0.5;
    var u0, v0, u1, v1, open = 0;
    for (i = 0; i < n; i++) {
      t = (i - (n - 1) * 0.5) * 0.46;
      if (along) { u0 = off - 0.20; u1 = off + 0.20; v0 = t - 0.21; v1 = t + 0.21; }
      else { u0 = t - 0.21; u1 = t + 0.21; v0 = off - 0.20; v1 = off + 0.20; }
      ci = (hash(o.x, o.y, 37 + i) * CARS.length) | 0;
      F = C.car[ci];
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u0, v0, u1, v1, 1.0 * p, 6.0 * p, F);
      if (!open) { ctx.beginPath(); open = 1; }      // glass band across the roofs
      iu = (u1 - u0) * 0.24; iv = (v1 - v0) * 0.24;
      G.moveTo(ctx, o.cx, o.cy, o.fx, o.fy, u0 + iu, v0 + iv, 6.0 * p);
      G.lineTo(ctx, o.cx, o.cy, o.fx, o.fy, u1 - iu, v0 + iv, 6.0 * p);
      G.lineTo(ctx, o.cx, o.cy, o.fx, o.fy, u1 - iu, v1 - iv, 6.0 * p);
      G.lineTo(ctx, o.cx, o.cy, o.fx, o.fy, u0 + iu, v1 - iv, 6.0 * p);
      ctx.closePath();
    }
    if (open) { ctx.fillStyle = C.glassD; ctx.fill(); }
  }

  /* ---- people -----------------------------------------------------------
     Static, hashed, ~5px tall. Bodies batch by clothing colour, heads all
     share bucket 8, so ten people cost at most nine fills. */
  function people (ctx, o) {
    var n = Math.round((o.busy || 0) * (1.4 + o.level * 0.8) * 2.0);
    if (o.kind === T.PARK) n += 2;
    if (o.kind === T.ROAD && n > 2) n = 2;
    if (n > 10) n = 10;
    if (n <= 0) return;
    var p = o.fx / 32, e = nearEdge(o.mask, o, 81), i, a, b, c, u, v, x, y;
    var pal = (hash(o.x, o.y, 82) * 8) | 0;   // 3 of the 8 shirt colours per tile
    for (i = 0; i < n; i++) {
      a = hash(o.x, o.y, 100 + i * 3); b = hash(o.x, o.y, 101 + i * 3); c = hash(o.x, o.y, 102 + i * 3);
      if (e >= 0 && c < 0.6) { edgePt(e, a * 1.4 - 0.7, 0.56 + b * 0.16); u = _pu; v = _pv; }
      else { u = a * 1.4 - 0.7; v = b * 1.4 - 0.7; }
      x = ix(o.cx, o.fx, u, v); y = iy(o.cy, o.fy, u, v, 0);
      bpush(x, y - 1.9 * p, 0.95 * p, 1.55 * p, (pal + ((c * 3) | 0)) % 8);
      bpush(x, y - 3.9 * p, 0.78 * p, 0.74 * p, 8);
    }
    bflush(ctx, C.person);
  }

  /* ---- cafe parasols ---------------------------------------------------- */
  function parasols (ctx, o) {
    var p = o.fx / 32, n = 2 + ((hash(o.x, o.y, 55) * 3) | 0);
    var bu = hash(o.x, o.y, 56) * 0.8 - 0.4, bv = hash(o.x, o.y, 57) * 0.8 - 0.4;
    var sq = o.fy / o.fx, i, a, b, u, v, x, y, r;
    for (i = 0; i < n; i++) {
      a = hash(o.x, o.y, 60 + i * 2); b = hash(o.x, o.y, 61 + i * 2);
      u = bu + a * 0.5 - 0.25; v = bv + b * 0.5 - 0.25;
      x = ix(o.cx, o.fx, u, v); y = iy(o.cy, o.fy, u, v, 0);
      r = (4.0 + a * 1.8) * p;
      bpush(x, y - 3.4 * p, 0.5 * p, 3.4 * p, 0);                 // stem, bucket 0 = drawn first
      bpush(x, y - 8.4 * p, r, r * sq, 1 + ((b * 4) | 0));
    }
    bflush(ctx, C.parasol);
  }

  /* ---- street furniture -------------------------------------------------
     One item per tile, chosen by hash. Everything is a prism with a cached
     face triple, so no css() work per item. */
  function furniture (ctx, o, e) {
    var p = o.fx / 32, h = hash(o.x, o.y, 73);
    edgePt(e, hash(o.x, o.y, 74) - 0.5, 0.66);
    var u = _pu, v = _pv, du, dv, x, y;
    if (h < 0.30) {                                   // bench
      if (e < 2) { du = 0.055; dv = 0.24; } else { du = 0.24; dv = 0.055; }
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u - du, v - dv, u + du, v + dv, 1.6 * p, 3.0 * p, C.wood);
    } else if (h < 0.50) {                            // litter bin
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.07, v - 0.07, u + 0.07, v + 0.07, 0, 4.4 * p, C.bin);
    } else if (h < 0.70) {                            // planter with a shrub
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.11, v - 0.11, u + 0.11, v + 0.11, 0, 3.2 * p, C.concB);
      x = ix(o.cx, o.fx, u, v); y = iy(o.cy, o.fy, u, v, 3.2 * p);
      dot(ctx, x, y - 1.4 * p, 3.0 * p, 2.2 * p, C.leaf);
    } else if (h < 0.86) {                            // fire hydrant
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.042, v - 0.042, u + 0.042, v + 0.042, 0, 3.2 * p, C.red);
    } else {                                          // bollard
      prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.038, v - 0.038, u + 0.038, v + 0.038, 0, 3.4 * p, C.conc);
    }
  }

  /* ---- street lamp: stroked pole, small head, warm dot after dark ------- */
  function lamp (ctx, o, e) {
    var p = o.fx / 32;
    edgePt(e, hash(o.x, o.y, 91) * 1.1 - 0.55, 0.86);
    var x = ix(o.cx, o.fx, _pu, _pv), y = iy(o.cy, o.fy, _pu, _pv, 0);
    var hx = x - 3.2 * p, hy = y - 16.2 * p;
    ctx.strokeStyle = C.pole;
    ctx.lineWidth = Math.max(0.6, 0.9 * p);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y - 15.0 * p); ctx.lineTo(hx, hy);
    ctx.stroke();
    var lit = G.night() > 0.4;
    if (lit) dot(ctx, hx, hy, 4.2 * p, 3.0 * p, WARM_A);
    dot(ctx, hx, hy + 0.4 * p, 1.7 * p, 1.1 * p, lit ? WARM : C.head);
  }

  /* ---- bus shelter ------------------------------------------------------ */
  function shelter (ctx, o) {
    var p = o.fx / 32, e = nearEdge(o.mask, o, 41);
    var u = 0, v = 0, du = 0.46, dv = 0.20;
    if (e >= 0) { edgePt(e, 0, 0.34); u = _pu; v = _pv; if (e >= 2) { du = 0.20; dv = 0.46; } }
    prism(ctx, o.cx, o.cy, o.fx, o.fy, u - du, v - dv, u + du, v + dv, 0.5 * p, 9.0 * p, C.glass);
    prism(ctx, o.cx, o.cy, o.fx, o.fy, u - du - 0.06, v - dv - 0.06, u + du + 0.06, v + dv + 0.06,
      9.0 * p, 10.6 * p, C.white);
    var sx = ix(o.cx, o.fx, u + du + 0.16, v), sy = iy(o.cy, o.fy, u + du + 0.16, v, 0);
    ctx.strokeStyle = C.pole; ctx.lineWidth = Math.max(0.6, 0.9 * p);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 11 * p); ctx.stroke();
    dot(ctx, sx, sy - 12.0 * p, 2.0 * p, 1.6 * p, C.blue[0]);
  }

  /* ---- flag on civic buildings ------------------------------------------ */
  function flag (ctx, o, warm) {
    var p = o.fx / 32;
    var x = ix(o.cx, o.fx, 0.62, -0.62), y = iy(o.cy, o.fy, 0.62, -0.62, 0);
    ctx.strokeStyle = C.pole; ctx.lineWidth = Math.max(0.6, 0.9 * p);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 20 * p); ctx.stroke();
    ctx.fillStyle = warm ? C.red[0] : C.blue[0];
    ctx.beginPath();
    ctx.moveTo(x, y - 20 * p); ctx.lineTo(x + 7 * p, y - 17.6 * p); ctx.lineTo(x, y - 15.4 * p);
    ctx.closePath(); ctx.fill();
  }

  /* ---- odds and ends ---------------------------------------------------- */
  function bikeRack (ctx, o, e) {
    var p = o.fx / 32, i, t, x, y;
    edgePt(e, -0.28, 0.6);
    var x0 = ix(o.cx, o.fx, _pu, _pv), y0 = iy(o.cy, o.fy, _pu, _pv, 0);
    edgePt(e, 0.28, 0.6);
    var x1 = ix(o.cx, o.fx, _pu, _pv), y1 = iy(o.cy, o.fy, _pu, _pv, 0);
    ctx.strokeStyle = C.pole; ctx.lineWidth = Math.max(0.6, 0.9 * p);
    ctx.beginPath();
    for (i = 0; i < 3; i++) {
      t = i / 2; x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t;
      ctx.moveTo(x - 2 * p, y); ctx.lineTo(x - 2 * p, y - 4 * p);
      ctx.lineTo(x + 2 * p, y - 4 * p); ctx.lineTo(x + 2 * p, y);
    }
    ctx.stroke();
  }

  function bike (ctx, o, u, v) {
    var p = o.fx / 32, x = ix(o.cx, o.fx, u, v), y = iy(o.cy, o.fy, u, v, 0);
    ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(0.6, 0.8 * p);
    ctx.beginPath();
    ctx.moveTo(x - 3 * p, y - 1.4 * p); ctx.lineTo(x, y - 3.6 * p); ctx.lineTo(x + 3 * p, y - 1.4 * p);
    ctx.moveTo(x - 1.6 * p, y - 1.4 * p); ctx.ellipse(x - 3 * p, y - 1.4 * p, 1.4 * p, 1.0 * p, 0, 0, TAU);
    ctx.moveTo(x + 4.4 * p, y - 1.4 * p); ctx.ellipse(x + 3 * p, y - 1.4 * p, 1.4 * p, 1.0 * p, 0, 0, TAU);
    ctx.stroke();
  }

  function foodCart (ctx, o, u, v) {
    var p = o.fx / 32;
    prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.17, v - 0.12, u + 0.17, v + 0.12, 1.2 * p, 6.2 * p, C.white);
    prism(ctx, o.cx, o.cy, o.fx, o.fy, u - 0.23, v - 0.18, u + 0.23, v + 0.18, 8.4 * p, 9.4 * p, C.red);
  }

  function dish (ctx, o) {
    var p = o.fx / 32;
    var x = ix(o.cx, o.fx, -0.58, 0.58), y = iy(o.cy, o.fy, -0.58, 0.58, 0);
    ctx.strokeStyle = C.pole; ctx.lineWidth = Math.max(0.6, 0.9 * p);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 5 * p); ctx.stroke();
    dot(ctx, x, y - 6.6 * p, 2.6 * p, 2.0 * p, C.white[0]);
  }

  /* ---- public: ground pass (drawn under the building) -------------------
     Street trees split by depth: the far kerbs (-x, -y) belong here so the
     building occludes them correctly; the near kerbs are done in fringe(). */
  function ground (ctx, o) {
    try {
      if (!ctx || !o) return;
      var k = o.kind, sc = o.scale;
      if (k === T.WATER) return;
      sync();
      if (k === T.PARK) { parkTrees(ctx, o, sc < 0.55 ? 4 : 8); return; }
      if (sc < 0.55) return;
      if (k !== T.ROAD) streetTrees(ctx, o, o.mask & 10, 200);
      if (k === T.EMPTY) { loneTrees(ctx, o); return; }
      if (k === T.COM || k === T.IND || k === T.GROCERY) parked(ctx, o);
    } catch (e) { /* never kill the frame */ }
  }

  /* ---- public: fringe pass (drawn over the building base) --------------- */
  function fringe (ctx, o) {
    try {
      if (!ctx || !o) return;
      var k = o.kind, sc = o.scale;
      if (k === T.WATER || sc < 0.55) return;
      sync();
      if (k !== T.ROAD) streetTrees(ctx, o, o.mask & 5, 300);    // near kerbs
      if (sc < 0.9) return;

      var busy = o.busy || 0, e = nearEdge(o.mask, o, 51);
      if (k === T.BUS) shelter(ctx, o);
      if (k === T.SCHOOL || k === T.CLINIC) flag(ctx, o, k === T.CLINIC);
      if ((k === T.GROCERY || k === T.COM) && hash(o.x, o.y, 53) < 0.34) parasols(ctx, o);

      if (e >= 0) {
        if (hash(o.x, o.y, 72) < 0.42) furniture(ctx, o, e);
        if (hash(o.x, o.y, 90) < 0.32) lamp(ctx, o, e);
        if (busy > 0.4 && hash(o.x, o.y, 95) < 0.14) bikeRack(ctx, o, e);
      }
      if (busy > 0.35 && hash(o.x, o.y, 96) < 0.16) bike(ctx, o, hash(o.x, o.y, 97) * 1.1 - 0.55, 0.55);
      if ((k === T.COM || k === T.GROCERY) && busy > 0.5 && hash(o.x, o.y, 98) < 0.12) {
        foodCart(ctx, o, -0.5, hash(o.x, o.y, 99) * 0.8 - 0.4);
      }
      if ((k === T.RES || k === T.TOWER) && o.level > 2 && hash(o.x, o.y, 94) < 0.12) dish(ctx, o);

      people(ctx, o);
    } catch (e2) { /* never kill the frame */ }
  }

  /* ---- public: batched trees -------------------------------------------
     tree() flushes on every call, which is right for a one-off but costs
     ~3 fills per trunk when lots.js plants a whole avenue. Push the run,
     then flush it once. */
  function treePush (ctx, o) {
    try {
      if (!ctx || !o) return;
      sync();
      if (TN >= 12) tflush(ctx);
      var k = 900 + ((o.u * 7) | 0) * 3 + ((o.v * 11) | 0);
      tpush(ix(o.cx, o.fx, o.u, o.v), iy(o.cy, o.fy, o.u, o.v, 0),
        (o.size || 1) * 14 * (o.fx / 32), o.variant | 0,
        (hash(o.x, o.y, k) * 3) | 0);
    } catch (e) { /* a prop must never kill the frame */ }
  }
  function treeFlush (ctx) { try { tflush(ctx); } catch (e) {} }

  MM.props = { ground: ground, fringe: fringe, tree: tree,
    treePush: treePush, treeFlush: treeFlush };
})(window.MM);

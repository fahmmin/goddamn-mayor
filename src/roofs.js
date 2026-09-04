/* MAYOR MAMDANI - rooftop detail.
   MM.roofs.draw(ctx, o) paints everything sitting on a building's roof plane:
   parapet, solar, HVAC, skylights, gardens, water towers, helipads, markings.

   Rules kept here: deterministic (gfx.hash only, never Math.random), zero
   allocation per tile (module scratch buffers), canvas paths only, batched by
   colour, and hard LOD cut-offs because ~1500 roofs may be visible at once. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx || {}, PAL = G.PAL || {}, TILE = MM.TILE || {};
  var TAU = Math.PI * 2;

  /* ================= per-frame colour cache ==========================
     css() bakes in the current time-of-day light, so colours cannot be
     cached across frames. They CAN be cached across the ~1500 draw()
     calls inside one frame: probe one colour, rebuild only when it moves. */
  var KEY = null, C = null;

  function buildColours () {
    var css = G.css, mix = G.mix, mul = G.mul, f = G.faces, W = PAL.white;
    C = {
      deck: {},
      lipT: css(mix(PAL.concrete, W, 0.55)),
      lipL: css(mul(PAL.concrete, G.LM)),
      lipR: css(mul(PAL.concrete, G.RM)),
      lipI: css(mul(PAL.concreteB, 0.64)),
      /* panel styles: 0 = photovoltaic, 1 = sawtooth glazing */
      panT: [css(mix(PAL.solar, PAL.solarLit, 0.66)), css(mix(PAL.glass, W, 0.30))],
      panE: [css(mul(PAL.solar, 0.52)), css(mul(PAL.glassDark, 0.68))],
      /* box styles: 0 grey plant, 1 white head-house, 2 dark vent, 3 steel duct, 4 concrete */
      box: [f(PAL.roofGrey), f(W), f(PAL.roofDark), f(PAL.steel), f(PAL.concreteB)],
      /* flat styles: 0 glass 1 lit-glass 2 lawn 3 white paint 4 yellow paint
                      5 red 6 lawn-dark 7 concrete pad 8 tar 9 soil */
      flt: [css(PAL.glass), G.raw([255, 234, 178]), css(PAL.grass), css(PAL.paint),
        css(PAL.paintYel), css([206, 72, 66]), css(PAL.grassDark), css(PAL.concreteB),
        css(mul(PAL.roofDark, 0.70)), css(PAL.trunk)],
      /* disc styles: 0 bush 1 bush-lit 2 fan 3 white */
      dsc: [css(PAL.treeA), css(PAL.treeB), css(mul(PAL.roofDark, 0.78)), css(W)],
      /* cylinder styles: [top, body] */
      cyl: [[css(W), css(mul(W, G.LM))], [css(PAL.steel), css(mul(PAL.steel, G.LM))],
        [css(PAL.concreteB), css(mul(PAL.concreteB, G.LM))]],
      pad: css(mul(PAL.roofDark, 0.62)),
      ring: G.night() > 0.32 ? G.raw([255, 112, 96]) : css([212, 78, 68]),
      mast: css(mul(PAL.roofDark, 0.85))
    };
    var D = C.deck;
    D[TILE.RES]       = f(mix(PAL.roofGrey, [216, 182, 156], 0.40));
    D[TILE.COM]       = f(mix(PAL.concrete, W, 0.55));
    D[TILE.IND]       = f(mix(PAL.roofDark, PAL.roofGrey, 0.45));
    D[TILE.TOWER]     = f(mix(PAL.concrete, PAL.steel, 0.30));
    D[TILE.SCHOOL]    = f(mix(PAL.concreteB, [214, 186, 120], 0.28));
    D[TILE.CLINIC]    = f(W);
    D[TILE.GROCERY]   = f(mix(W, [232, 138, 92], 0.42));
    D[TILE.CHILDCARE] = f(mix(W, [244, 186, 72], 0.45));
    D[TILE.BUS]       = f(mix(W, [92, 158, 224], 0.38));
    C.deckDef = f(PAL.roofGrey);
  }

  /* ================= scratch buffers (never reallocated) ============== */
  var BOX = [], nB = 0;              // u0,v0,u1,v1,hb,ht,style
  var PAN = [], nP = 0, pMask = 0;   // u0,v0,u1,v1,h,tilt,style
  var FLT = [], nF = 0;              // u0,v0,u1,v1,h,style
  var DSC = [], nD = 0;              // u,v,r,h,style
  var CYL = [], nC = 0;              // u,v,r,hb,ht,style
  var USED = [];                     // cell occupancy
  var heli = 0, heliU = 0, heliV = 0, heliR = 0;

  var Q = { cx: 0, cy: 0, fx: 32, fy: 16, x: 0, y: 0, seed: 0, top: 0, sc: 1, lv: 0 };

  function box (a0, b0, a1, b1, hb, ht, s) {
    BOX[nB] = a0; BOX[nB + 1] = b0; BOX[nB + 2] = a1; BOX[nB + 3] = b1;
    BOX[nB + 4] = hb; BOX[nB + 5] = ht; BOX[nB + 6] = s; nB += 7;
  }
  function pan (a0, b0, a1, b1, h, t, s) {
    PAN[nP] = a0; PAN[nP + 1] = b0; PAN[nP + 2] = a1; PAN[nP + 3] = b1;
    PAN[nP + 4] = h; PAN[nP + 5] = t; PAN[nP + 6] = s; nP += 7; pMask |= (1 << s);
  }
  function flt (a0, b0, a1, b1, h, s) {
    FLT[nF] = a0; FLT[nF + 1] = b0; FLT[nF + 2] = a1; FLT[nF + 3] = b1;
    FLT[nF + 4] = h; FLT[nF + 5] = s; nF += 6;
  }
  function dsc (u, v, r, h, s) {
    DSC[nD] = u; DSC[nD + 1] = v; DSC[nD + 2] = r; DSC[nD + 3] = h; DSC[nD + 4] = s; nD += 5;
  }
  function cyl (u, v, r, hb, ht, s) {
    CYL[nC] = u; CYL[nC + 1] = v; CYL[nC + 2] = r; CYL[nC + 3] = hb;
    CYL[nC + 4] = ht; CYL[nC + 5] = s; nC += 6;
  }

  /* ================= projection (always through gfx) ================== */
  function PX (u, v) { return G.ix(Q.cx, Q.fx, u, v); }
  function PY (u, v, h) { return G.iy(Q.cy, Q.fy, u, v, h); }

  function quad (ctx, a0, b0, a1, b1, h) {
    ctx.moveTo(PX(a0, b0), PY(a0, b0, h));
    ctx.lineTo(PX(a1, b0), PY(a1, b0, h));
    ctx.lineTo(PX(a1, b1), PY(a1, b1, h));
    ctx.lineTo(PX(a0, b1), PY(a0, b1, h));
    ctx.closePath();
  }
  /* face at constant v, spanning u0..u1, from hb up to ht */
  function faceV (ctx, a0, a1, v, hb, ht) {
    ctx.moveTo(PX(a0, v), PY(a0, v, ht));
    ctx.lineTo(PX(a1, v), PY(a1, v, ht));
    ctx.lineTo(PX(a1, v), PY(a1, v, hb));
    ctx.lineTo(PX(a0, v), PY(a0, v, hb));
    ctx.closePath();
  }
  /* face at constant u, spanning v0..v1 */
  function faceU (ctx, b0, b1, u, hb, ht) {
    ctx.moveTo(PX(u, b0), PY(u, b0, ht));
    ctx.lineTo(PX(u, b1), PY(u, b1, ht));
    ctx.lineTo(PX(u, b1), PY(u, b1, hb));
    ctx.lineTo(PX(u, b0), PY(u, b0, hb));
    ctx.closePath();
  }
  /* tilted panel: high edge at v0, low edge at v1 */
  function tilt (ctx, a0, b0, a1, b1, h, t) {
    ctx.moveTo(PX(a0, b0), PY(a0, b0, h + t));
    ctx.lineTo(PX(a1, b0), PY(a1, b0, h + t));
    ctx.lineTo(PX(a1, b1), PY(a1, b1, h));
    ctx.lineTo(PX(a0, b1), PY(a0, b1, h));
    ctx.closePath();
  }
  function arc (ctx, u, v, r, h) {
    var x = PX(u, v), y = PY(u, v, h), rx = r * Q.fx * 0.5, ry = r * Q.fy * 0.5;
    if (rx < 0.4) rx = 0.4;
    if (ry < 0.3) ry = 0.3;
    if (ctx.ellipse) { ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); }
    else { ctx.moveTo(x - rx, y); ctx.lineTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); }
    ctx.closePath();
  }

  /* deterministic per-tile noise; k = slot, j = sub-draw */
  function rnd (k, j) {
    return G.hash(Q.x * 61 + k, Q.y * 131 + j, Q.seed + k * 977 + j * 131);
  }

  /* ================= batched flushes ================================= */
  function flushFlat (ctx) {
    if (!nF) return;
    var i, st = -1;
    for (i = 0; i < nF; i += 6) {
      if (FLT[i + 5] !== st) {
        if (st >= 0) ctx.fill();
        st = FLT[i + 5]; ctx.fillStyle = C.flt[st]; ctx.beginPath();
      }
      quad(ctx, FLT[i], FLT[i + 1], FLT[i + 2], FLT[i + 3], FLT[i + 4]);
    }
    ctx.fill();
  }

  function flushPan (ctx) {
    if (!nP) return;
    var i, s, lip = Q.fy * 0.055, edge = Q.sc >= 0.78;   // drop the frame sliver when zoomed out
    for (s = 0; s < 2; s++) {
      if (!(pMask & (1 << s))) continue;
      if (edge) {
        ctx.fillStyle = C.panE[s]; ctx.beginPath();
        for (i = 0; i < nP; i += 7) {
          if (PAN[i + 6] === s) faceV(ctx, PAN[i], PAN[i + 2], PAN[i + 3], PAN[i + 4] - lip, PAN[i + 4]);
        }
        ctx.fill();
      }
      ctx.fillStyle = C.panT[s]; ctx.beginPath();
      for (i = 0; i < nP; i += 7) {
        if (PAN[i + 6] === s) tilt(ctx, PAN[i], PAN[i + 1], PAN[i + 2], PAN[i + 3], PAN[i + 4], PAN[i + 5]);
      }
      ctx.fill();
    }
  }

  /* Three passes (right faces, left faces, tops) with run-length colour
     batching. Boxes are emitted in diagonal cell order so the runs already
     read roughly back-to-front.
     ponytail: no true depth sort - rooftop items are small and cell-separated,
     so the worst case is a couple of px of overlap. Add a sort only if roofs
     ever grow overlapping masses. */
  function pass (ctx, w) {
    var i, st = -1;
    for (i = 0; i < nB; i += 7) {
      if (BOX[i + 6] !== st) {
        if (st >= 0) ctx.fill();
        st = BOX[i + 6]; ctx.fillStyle = C.box[st][w]; ctx.beginPath();
      }
      if (w === 2) faceU(ctx, BOX[i + 1], BOX[i + 3], BOX[i + 2], BOX[i + 4], BOX[i + 5]);
      else if (w === 1) faceV(ctx, BOX[i], BOX[i + 2], BOX[i + 3], BOX[i + 4], BOX[i + 5]);
      else quad(ctx, BOX[i], BOX[i + 1], BOX[i + 2], BOX[i + 3], BOX[i + 5]);
    }
    ctx.fill();
  }
  function flushBox (ctx) { if (nB) { pass(ctx, 2); pass(ctx, 1); pass(ctx, 0); } }

  function flushCyl (ctx) {
    for (var i = 0; i < nC; i += 6) {
      G.post(ctx, Q.cx, Q.cy, Q.fx, Q.fy, CYL[i], CYL[i + 1], CYL[i + 2],
        CYL[i + 3], CYL[i + 4], C.cyl[CYL[i + 5]]);
    }
  }

  function flushDsc (ctx) {
    if (!nD) return;
    var i, st = -1;
    for (i = 0; i < nD; i += 5) {
      if (DSC[i + 4] !== st) {
        if (st >= 0) ctx.fill();
        st = DSC[i + 4]; ctx.fillStyle = C.dsc[st]; ctx.beginPath();
      }
      arc(ctx, DSC[i], DSC[i + 1], DSC[i + 2], DSC[i + 3]);
    }
    ctx.fill();
  }

  /* ================= roof features ===================================
     Each feature gets a sub-rect of the footprint and a slot id for hashing.
     They only push into the scratch buffers - nothing draws yet. */

  function fAC (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top, fy = Q.fy;
    var n = 1 + ((rnd(k, 1) * 3.4) | 0);
    var w = Math.min(0.22, su * 0.40), d = Math.min(0.22, sv * 0.40);
    var spanU = Math.max(0, su - w), spanV = Math.max(0, sv - d);
    for (var i = 0; i < n; i++) {
      var h = fy * (0.15 + rnd(k, 2 + i) * 0.15);
      var uu = a0 + rnd(k, 10 + i) * spanU, vv = b0 + rnd(k, 20 + i) * spanV;
      box(uu, vv, uu + w, vv + d, t, t + h, 0);
      if (Q.sc >= 1.1 && rnd(k, 30 + i) < 0.5) dsc(uu + w * 0.5, vv + d * 0.5, w * 0.52, t + h + 0.3, 2);
    }
  }

  function fVent (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top, fy = Q.fy;
    var n = 2 + ((rnd(k, 1) * 3) | 0);
    for (var i = 0; i < n; i++) {
      var w = 0.05 + rnd(k, 40 + i) * 0.05;
      var uu = a0 + rnd(k, 11 + i) * Math.max(0, su - w * 2);
      var vv = b0 + rnd(k, 21 + i) * Math.max(0, sv - w * 2);
      box(uu, vv, uu + w * 2, vv + w * 2, t, t + fy * (0.09 + rnd(k, 31 + i) * 0.22), 2);
    }
  }

  function fSky (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top + 0.6, lit = G.night() > 0.34;
    var n = 1 + ((rnd(k, 1) * 3) | 0);
    var w = Math.min(0.30, su * 0.62), d = Math.min(0.18, sv * 0.34);
    for (var i = 0; i < n; i++) {
      var uu = a0 + rnd(k, 12 + i) * Math.max(0, su - w);
      var vv = b0 + rnd(k, 22 + i) * Math.max(0, sv - d);
      flt(uu, vv, uu + w, vv + d, t, (lit && rnd(k, 32 + i) < 0.55) ? 1 : 0);
    }
  }

  function fGarden (a0, b0, a1, b1, k) {
    var t = Q.top + 0.5, su = a1 - a0, sv = b1 - b0;
    var m = Math.min(su, sv) * 0.08;
    flt(a0 + m, b0 + m, a1 - m, b1 - m, t, 6);
    flt(a0 + m * 2.4, b0 + m * 2.4, a1 - m * 2.4, b1 - m * 2.4, t + 0.5, 2);
    if (Q.sc < 1.0) return;
    var n = 2 + ((rnd(k, 1) * 3) | 0);
    for (var i = 0; i < n; i++) {
      var r = 0.07 + rnd(k, 33 + i) * 0.06;
      dsc(a0 + m * 3 + rnd(k, 13 + i) * Math.max(0, su - m * 6),
        b0 + m * 3 + rnd(k, 23 + i) * Math.max(0, sv - m * 6),
        r, t + Q.fy * 0.06, rnd(k, 43 + i) < 0.5 ? 0 : 1);
    }
  }

  function fStair (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top;
    var w = su * (0.42 + rnd(k, 1) * 0.22), d = sv * (0.42 + rnd(k, 2) * 0.22);
    var uu = a0 + rnd(k, 3) * (su - w), vv = b0 + rnd(k, 4) * (sv - d);
    box(uu, vv, uu + w, vv + d, t, t + Q.fy * (0.36 + rnd(k, 5) * 0.30), rnd(k, 6) < 0.55 ? 1 : 0);
  }

  function fMech (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top, fy = Q.fy;
    var m = Math.min(su, sv) * 0.12;
    var h = fy * (0.26 + rnd(k, 1) * 0.22);
    box(a0 + m, b0 + m, a1 - m, b1 - m, t, t + h, rnd(k, 2) < 0.5 ? 4 : 0);
    var w = Math.min(0.10, su * 0.18);
    box(a0 + m * 2, b0 + m * 2, a0 + m * 2 + w, b0 + m * 2 + w, t + h, t + h + fy * 0.14, 2);
    if (Q.sc >= 1.1) dsc((a0 + a1) * 0.5, (b0 + b1) * 0.5, Math.min(su, sv) * 0.16, t + h + 0.3, 2);
  }

  function fDuct (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top, fy = Q.fy;
    var n = 2 + ((rnd(k, 1) * 2) | 0);
    var along = su >= sv;
    for (var i = 0; i < n; i++) {
      var w = 0.07 + rnd(k, 14 + i) * 0.05;
      var hh = fy * (0.12 + rnd(k, 24 + i) * 0.10);
      if (along) {
        var vv = b0 + (i + 0.5) / n * sv - w;
        box(a0 + su * 0.04, vv, a1 - su * 0.04, vv + w * 2, t, t + hh, 3);
      } else {
        var uu = a0 + (i + 0.5) / n * su - w;
        box(uu, b0 + sv * 0.04, uu + w * 2, b1 - sv * 0.04, t, t + hh, 3);
      }
    }
  }

  function fSilo (a0, b0, a1, b1, k) {
    var r = Math.min(a1 - a0, b1 - b0) * 0.72;
    cyl((a0 + a1) * 0.5, (b0 + b1) * 0.5, r, Q.top, Q.top + Q.fy * (0.45 + rnd(k, 1) * 0.55), 2);
  }

  function fDish (a0, b0, a1, b1, k) {
    var cu = (a0 + a1) * 0.5, cv = (b0 + b1) * 0.5, t = Q.top;
    var s = Math.min(a1 - a0, b1 - b0);
    var h = Q.fy * (0.18 + rnd(k, 1) * 0.12);
    cyl(cu, cv, s * 0.14, t, t + h, 1);
    dsc(cu, cv, s * 0.30, t + h + Q.fy * 0.10, 3);
  }

  function fSolar (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top + Q.fy * 0.06;
    var rows = G.clamp(Math.round(sv / (Q.sc >= 0.78 ? 0.24 : 0.55)), 1, 6) | 0;
    var step = sv / rows, gap = Math.min(step * 0.30, 0.06);
    var tl = Q.fy * (0.11 + rnd(k, 1) * 0.05);
    for (var i = 0; i < rows; i++) {
      var vv = b0 + i * step;
      pan(a0 + su * 0.04, vv, a1 - su * 0.04, vv + step - gap, t, tl, 0);
    }
  }

  function fSaw (a0, b0, a1, b1) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top;
    var rows = G.clamp(Math.round(sv / 0.28), 1, 5) | 0;
    var step = sv / rows, gap = Math.min(step * 0.22, 0.05);
    var tl = Q.fy * 0.20;
    for (var i = 0; i < rows; i++) {
      var vv = b0 + i * step;
      box(a0 + su * 0.03, vv, a1 - su * 0.03, vv + (step - gap) * 0.30, t, t + tl, 4);
      pan(a0 + su * 0.03, vv, a1 - su * 0.03, vv + step - gap, t, tl, 1);
    }
  }

  function fCourt (a0, b0, a1, b1, k) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top + 0.5;
    var lw = Math.min(su, sv) * 0.045, mu = (a0 + a1) * 0.5, mv = (b0 + b1) * 0.5;
    flt(a0, b0, a1, b1, t, 7);
    t += 0.4;
    flt(a0, b0, a1, b0 + lw, t, 3);
    flt(a0, b1 - lw, a1, b1, t, 3);
    flt(a0, b0, a0 + lw, b1, t, 3);
    flt(a1 - lw, b0, a1, b1, t, 3);
    if (rnd(k, 1) < 0.5) flt(a0, mv - lw * 0.5, a1, mv + lw * 0.5, t, 4);
    else flt(mu - lw * 0.5, b0, mu + lw * 0.5, b1, t, 4);
  }

  function fCross (a0, b0, a1, b1) {
    var su = a1 - a0, sv = b1 - b0, t = Q.top + 0.5;
    var s = Math.min(su, sv), m = s * 0.14, aw = s * 0.16;
    var cu = (a0 + a1) * 0.5, cv = (b0 + b1) * 0.5;
    flt(a0 + m, b0 + m, a1 - m, b1 - m, t, 3);
    flt(cu - aw, b0 + m * 1.8, cu + aw, b1 - m * 1.8, t + 0.4, 5);
    flt(a0 + m * 1.8, cv - aw, a1 - m * 1.8, cv + aw, t + 0.4, 5);
  }

  function fTank (a0, b0, a1, b1, k) {
    var cu = (a0 + a1) * 0.5, cv = (b0 + b1) * 0.5, t = Q.top, fy = Q.fy;
    var r = Math.min(a1 - a0, b1 - b0) * 0.62;
    var legs = fy * (0.24 + rnd(k, 1) * 0.18), tank = fy * (0.42 + rnd(k, 2) * 0.24);
    var lw = r * 0.16;
    box(cu - r * 0.55, cv - r * 0.55, cu - r * 0.55 + lw, cv + r * 0.55, t, t + legs, 2);
    box(cu + r * 0.55 - lw, cv - r * 0.55, cu + r * 0.55, cv + r * 0.55, t, t + legs, 2);
    cyl(cu, cv, r, t + legs, t + legs + tank, 0);
  }

  function fHeli (a0, b0, a1, b1) {
    heli = 1;
    heliU = (a0 + a1) * 0.5; heliV = (b0 + b1) * 0.5;
    heliR = Math.min(a1 - a0, b1 - b0) * 0.46;
  }

  function place (id, a0, b0, a1, b1, k) {
    switch (id) {
      case 1: fAC(a0, b0, a1, b1, k); break;
      case 2: fVent(a0, b0, a1, b1, k); break;
      case 3: fSky(a0, b0, a1, b1, k); break;
      case 4: fGarden(a0, b0, a1, b1, k); break;
      case 5: fStair(a0, b0, a1, b1, k); break;
      case 6: fMech(a0, b0, a1, b1, k); break;
      case 7: fDuct(a0, b0, a1, b1, k); break;
      case 8: fSilo(a0, b0, a1, b1, k); break;
      case 9: fDish(a0, b0, a1, b1, k); break;
      case 10: fSolar(a0, b0, a1, b1, k); break;
      case 11: fSaw(a0, b0, a1, b1); break;
      case 12: fHeli(a0, b0, a1, b1); break;
      case 13: fCourt(a0, b0, a1, b1, k); break;
      case 14: fCross(a0, b0, a1, b1); break;
      case 15: fTank(a0, b0, a1, b1, k); break;
    }
  }

  /* ================= per-kind kits ==================================
     Weighting is by repetition - the laziest weighted table there is. */
  var SMALL = {}, BIG = {};
  SMALL[TILE.RES]       = [1, 1, 2, 3, 4, 5, 2, 0];
  SMALL[TILE.COM]       = [1, 1, 2, 3, 5, 9, 3, 0];
  SMALL[TILE.IND]       = [2, 2, 7, 7, 1, 8, 5, 0];
  SMALL[TILE.TOWER]     = [1, 1, 2, 3, 5, 6, 9, 0];
  SMALL[TILE.SCHOOL]    = [1, 2, 3, 3, 5, 4, 2, 0];
  SMALL[TILE.CLINIC]    = [1, 1, 2, 3, 6, 5, 3, 0];
  SMALL[TILE.GROCERY]   = [1, 2, 2, 3, 0, 0, 1, 2];
  SMALL[TILE.CHILDCARE] = [2, 3, 4, 0, 1, 2, 0, 3];
  SMALL[TILE.BUS]       = [2, 2, 0, 3, 0, 2, 0, 0];
  BIG[TILE.RES]         = [10, 4, 4, 6];
  BIG[TILE.COM]         = [10, 10, 6, 12];
  BIG[TILE.IND]         = [11, 11, 7, 10];
  BIG[TILE.TOWER]       = [10, 10, 12, 6];
  BIG[TILE.SCHOOL]      = [13, 10, 4, 13];
  BIG[TILE.CLINIC]      = [14, 10, 6, 14];
  BIG[TILE.GROCERY]     = [10, 10, 6, 3];
  BIG[TILE.CHILDCARE]   = [4, 4, 10, 3];
  BIG[TILE.BUS]         = [3, 10, 3, 3];

  /* ================= entry point ===================================== */
  function draw (ctx, o) {
    if (!ctx || !o || !G.css) return;
    var kind = o.kind;
    if (kind === TILE.PARK || kind === TILE.WATER || kind === TILE.ROAD ||
        kind === TILE.EMPTY || kind === TILE.BULLDOZE) return;
    var top = +o.top || 0;
    if (!(top > 1.5)) return;                       // plazas / ground-level: no roof
    var fx = +o.fx, fy = +o.fy;
    if (!(fx > 0) || !(fy > 0)) return;
    var u0 = +o.u0, v0 = +o.v0, u1 = +o.u1, v1 = +o.v1;
    if (!(u1 - u0 > 0.10) || !(v1 - v0 > 0.10)) return;
    var sc = +o.scale || 1;

    var key = G.css(PAL.white) + '|' + ((G.night() * 12) | 0);
    if (key !== KEY) { KEY = key; buildColours(); }

    Q.cx = +o.cx; Q.cy = +o.cy; Q.fx = fx; Q.fy = fy;
    Q.x = o.x | 0; Q.y = o.y | 0; Q.seed = o.seed | 0;
    Q.top = top; Q.sc = sc; Q.lv = G.clamp(o.level | 0, 0, 4);

    var deck = C.deck[kind] || C.deckDef;

    /* ---- parapet ---------------------------------------------------
       Deck first, then the inner faces, then the lip cap, then the two
       outer faces: the cap has to paint over the deck's south overrun. */
    var ph = Math.max(1.1, fy * 0.11);
    var lw = Math.min(0.11, (u1 - u0) * 0.16, (v1 - v0) * 0.16);
    var iu0 = u0 + lw, iv0 = v0 + lw, iu1 = u1 - lw, iv1 = v1 - lw;

    ctx.fillStyle = deck[0];
    ctx.beginPath(); quad(ctx, iu0, iv0, iu1, iv1, top); ctx.fill();

    ctx.fillStyle = C.lipI;
    ctx.beginPath();
    faceV(ctx, iu0, iu1, iv0, top, top + ph);
    faceU(ctx, iv0, iv1, iu0, top, top + ph);
    ctx.fill();

    ctx.fillStyle = C.lipT;
    ctx.beginPath();
    quad(ctx, u0, v0, u1, iv0, top + ph);
    quad(ctx, u0, iv1, u1, v1, top + ph);
    quad(ctx, u0, iv0, iu0, iv1, top + ph);
    quad(ctx, iu1, iv0, u1, iv1, top + ph);
    ctx.fill();

    ctx.fillStyle = C.lipL;
    ctx.beginPath(); faceV(ctx, u0, u1, v1, top, top + ph); ctx.fill();
    ctx.fillStyle = C.lipR;
    ctx.beginPath(); faceU(ctx, v0, v1, u1, top, top + ph); ctx.fill();

    if (sc < 0.5) return;                            // far zoom: parapet only

    /* ---- working area ---------------------------------------------- */
    var m = Math.min(0.05, (iu1 - iu0) * 0.06, (iv1 - iv0) * 0.06);
    var a0 = iu0 + m, b0 = iv0 + m, a1 = iu1 - m, b1 = iv1 - m;
    var su = a1 - a0, sv = b1 - b0;
    if (su < 0.10 || sv < 0.10) return;

    nB = nP = nF = nD = nC = 0; pMask = 0; heli = 0;

    var small = SMALL[kind] || SMALL[TILE.COM];
    var big = BIG[kind] || BIG[TILE.COM];
    var tall = top > fy * 3.0 && Q.lv >= 2;

    if (sc < 0.78) {
      /* mid zoom: one big mass plus a head-house, nothing small */
      var id = big[(rnd(1, 1) * big.length) | 0];
      if (id === 12 || id === 3) id = 10;
      place(id, a0, b0, a1, b1 - sv * 0.32, 1);
      fStair(a0 + su * 0.25, b1 - sv * 0.30, a1 - su * 0.25, b1, 2);
    } else {
      var nu = G.clamp(Math.round(su / 0.70), 1, 4) | 0;
      var nv = G.clamp(Math.round(sv / 0.70), 1, 4) | 0;
      var cu = su / nu, cv = sv / nv;
      var cells = nu * nv, i, ci, ri, d, k;
      for (i = 0; i < cells; i++) USED[i] = 0;

      var bigLeft = cells >= 6 ? 2 : 1;
      var wantTank = (kind === TILE.RES || kind === TILE.TOWER) && rnd(7, 7) < 0.24;

      /* diagonal sweep => emitted back-to-front */
      for (d = 0; d <= nu + nv - 2; d++) {
        for (ri = 0; ri < nv; ri++) {
          ci = d - ri;
          if (ci < 0 || ci >= nu) continue;
          i = ri * nu + ci;
          if (USED[i]) continue;
          k = i + 1;

          /* claim a 2x2 block first - solar, helipads and courts want area */
          if (bigLeft > 0 && ci + 1 < nu && ri + 1 < nv &&
              !USED[i + 1] && !USED[i + nu] && !USED[i + nu + 1] &&
              rnd(k, 50) < 0.62) {
            var bid = big[(rnd(k, 51) * big.length) | 0];
            if (bid === 12 && !(tall && (kind === TILE.COM || kind === TILE.TOWER))) bid = 10;
            USED[i] = USED[i + 1] = USED[i + nu] = USED[i + nu + 1] = 1;
            place(bid, a0 + ci * cu, b0 + ri * cv, a0 + (ci + 2) * cu, b0 + (ri + 2) * cv, k);
            bigLeft--;
            continue;
          }

          USED[i] = 1;
          if (wantTank) {                            // classic NYC cylinder
            wantTank = false;
            fTank(a0 + ci * cu, b0 + ri * cv, a0 + (ci + 1) * cu, b0 + (ri + 1) * cv, k);
            continue;
          }
          var sid = small[(rnd(k, 52) * small.length) | 0];
          /* low-level lots stay scruffy: gardens and silos need investment */
          if ((sid === 4 || sid === 8) && rnd(k, 53) > 0.18 + Q.lv * 0.20) sid = 2;
          place(sid, a0 + ci * cu + cu * 0.06, b0 + ri * cv + cv * 0.06,
            a0 + (ci + 1) * cu - cu * 0.06, b0 + (ri + 1) * cv - cv * 0.06, k);
        }
      }
    }

    flushFlat(ctx);
    flushPan(ctx);
    flushBox(ctx);
    flushCyl(ctx);
    flushDsc(ctx);

    /* ---- helipad: at most one per roof, so drawn straight ----------- */
    if (heli) {
      var ht = top + 0.8;
      ctx.fillStyle = C.pad;
      ctx.beginPath(); arc(ctx, heliU, heliV, heliR, ht); ctx.fill();
      ctx.strokeStyle = C.ring;
      ctx.lineWidth = Math.max(0.8, fy * 0.05);
      ctx.beginPath(); arc(ctx, heliU, heliV, heliR * 0.82, ht + 0.3); ctx.stroke();
      var bw = heliR * 0.11, ax = heliR * 0.32, ay = heliR * 0.42;
      ctx.fillStyle = C.flt[3];
      ctx.beginPath();
      quad(ctx, heliU - ax - bw, heliV - ay, heliU - ax + bw, heliV + ay, ht + 0.5);
      quad(ctx, heliU + ax - bw, heliV - ay, heliU + ax + bw, heliV + ay, ht + 0.5);
      quad(ctx, heliU - ax, heliV - bw, heliU + ax, heliV + bw, ht + 0.5);
      ctx.fill();
    }

    /* ---- roof-edge antennae on tall towers -------------------------- */
    if (sc >= 1.0 && top > fy * 4.0 && (kind === TILE.TOWER || kind === TILE.COM)) {
      ctx.strokeStyle = C.mast;
      ctx.lineWidth = Math.max(0.8, fy * 0.04);
      ctx.beginPath();
      for (var j = 0; j < 2; j++) {
        var au = iu0 + (iu1 - iu0) * (0.12 + rnd(90, j) * 0.76);
        var av = iv0 + (iv1 - iv0) * (j ? 0.12 : 0.88);
        var mx = PX(au, av);
        ctx.moveTo(mx, PY(au, av, top));
        ctx.lineTo(mx, PY(au, av, top + fy * (0.5 + rnd(91, j) * 0.7)));
      }
      ctx.stroke();
    }
  }

  MM.roofs = { draw: draw };
})(window.MM);

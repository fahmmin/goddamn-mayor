/* src/light.js - the sun, and everything that reflects it.

   render.js bakes the city at fixed noon into an offscreen cache, so lighting
   splits in two and this file owns both halves:

     baked  - reflect()  water mirrors, a pure function of the grid, drawn
              inside the static pass so buildings occlude them correctly.
     live   - sky() shimmer() glow(), drawn over the blit, so they
              track the clock without costing a cache rebuild.

   Projection matches render.js exactly: ix = (x-y)*fx + ox, iy = (x+y)*fy + oy - h.
   A mirror in the ground plane is just h -> -h, which is why a water tile m
   steps up-screen from a building shows that building at height 2*m*fy.      */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.GRID || 48, T = MM.TILE || {};
  var HW = 32, HH = 16, TAU = Math.PI * 2;

  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp (a, b, t) { return a + (b - a) * t; }
  function mix (a, b, t) {
    return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0];
  }
  function rgba (c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' +
      (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  }
  function hash (x, y, k) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ---- the light itself ---------------------------------------------- */

  var SUN_CORE = [255, 248, 222], SUN_GOLD = [255, 164, 74];
  var SKY_HI   = [154, 206, 244], SKY_LO   = [44, 62, 112];
  var BOUNCE   = [190, 156, 112];          // warm light kicked back off the street
  var MOON     = [222, 232, 250];
  var DEEP     = [30, 74, 108];            // water with no sky in it

  /* Shared sun. render.js fills this once a frame from _daynight; every pass
     below reads it, so the glint on a tower and the glitter on the river
     always agree about where the sun is. */
  var sun = {
    elev: 1, day: 1, gold: 0,
    u: 0, v: 1,            // azimuth as a tile-space direction, pointing at the sun
    kU: 0, kV: 1,          // how lit the +u / +v wall planes are
    sx: 0, sy: 0, r: 1     // screen position and radius of the disc
  };

  /* The shading in gfx.js makes the +v (screen-left) face the bright one, so
     the key light lives over +v and only swings across +u through the day:
     mornings glint off the right-hand faces, evenings off the left. */
  function update (R) {
    var elev = R.elev, a = (R.phase - 0.5) * Math.PI * 0.9;
    sun.elev = elev;
    sun.day = clamp(elev * 1.6 + 0.24, 0, 1);
    sun.gold = R.golden;
    sun.u = -Math.sin(a) * 0.88;
    sun.v = Math.cos(a);
    var up = clamp(elev, 0, 1);
    sun.kU = clamp(sun.u, 0, 1) * up;
    sun.kV = clamp(sun.v, 0, 1) * up;
    sun.sx = R.w * 0.5 + (sun.u - sun.v) * R.w * 0.34;
    sun.sy = R.h * (0.90 - 0.86 * up);
    sun.r = Math.max(R.w, R.h) * 0.5;
  }

  /* current sky colour, for anything that reflects the sky rather than the sun */
  function skyTone () {
    var c = mix(SKY_LO, SKY_HI, sun.day);
    return sun.gold > 0.02 ? mix(c, SUN_GOLD, sun.gold * 0.45) : c;
  }

  /* ---- 1. the source: sun / moon disc over the sky gradient ----------- */

  function sky (ctx, R) {
    var up = sun.elev, g;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (up > -0.16) {                        // sun: core, then a wide haze
      var lo = clamp((up + 0.16) / 0.3, 0, 1);
      var warm = mix(SUN_CORE, SUN_GOLD, clamp(1 - up * 1.4, 0, 1));
      g = ctx.createRadialGradient(sun.sx, sun.sy, 0, sun.sx, sun.sy, sun.r);
      g.addColorStop(0, rgba(warm, 0.55 * lo));
      g.addColorStop(0.10, rgba(warm, 0.22 * lo));
      g.addColorStop(0.42, rgba(warm, 0.06 * lo));
      g.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, R.w, R.h);
      var rr = Math.max(6, R.h * 0.026);
      g = ctx.createRadialGradient(sun.sx, sun.sy, 0, sun.sx, sun.sy, rr);
      g.addColorStop(0, rgba(SUN_CORE, 0.95 * lo));
      g.addColorStop(0.6, rgba(warm, 0.55 * lo));
      g.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sun.sx - rr, sun.sy - rr, rr * 2, rr * 2);
    } else {                                 // moon: the night's key light
      var mx = R.w - sun.sx, my = R.h * 0.16, mr = Math.max(5, R.h * 0.018);
      g = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 7);
      g.addColorStop(0, rgba(MOON, 0.80));
      g.addColorStop(0.14, rgba(MOON, 0.30));
      g.addColorStop(1, rgba(MOON, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, R.w, R.h);
    }
    ctx.restore();
  }

  /* ---- 2. baked: water mirrors --------------------------------------- */

  /* Tones the river borrows from whatever is standing over it. A reflection is
     always darker and flatter than the thing reflected. */
  var REF = [[214, 208, 196], [206, 216, 224], [222, 198, 180], [196, 206, 200]];

  function reflect (ctx, R, s) {
    var LT = MM.lots, n = R._nWat, b = R._bWat;
    if (!n || !LT || !LT.lotOf || !LT.shape) return;
    LT.plan(s);
    var g = s.grid, sc = R.scale, fx = HW * sc, fy = HH * sc, ox = R.ox, oy = R.oy;
    var tone = skyTone();
    for (var k = 0; k < n; k++) {
      var i = b[k], x = i % G, y = (i / G) | 0;
      // straight up the screen from a water tile is (x-m, y-m): same screen x,
      // 2*m*fy higher. The first structure up that column is what we mirror.
      for (var m = 1; m <= 6; m++) {
        var px = x - m, py = y - m;
        if (px < 0 || py < 0) break;
        var t = g[py * G + px];
        if (t === T.WATER || t === T.ROAD || t === T.BUS || t === T.EMPTY) continue;
        var L = LT.lotOf(s, px, py);
        if (!L) break;
        var sh = LT.shape(s, L.x1, L.y1);
        if (!sh || sh.top < 16) break;
        var h = 2 * m * fy, top = sh.top * sc;   // height of the reflected point
        if (h >= top) break;
        var f = 1 - h / top;
        var c = mix(mix(REF[(hash(L.x0, L.y0, 5) * 4) | 0], tone, 0.34), DEEP, 0.42);
        var cx = (x - y) * fx + ox, cy = (x + y) * fy + oy;
        // A lot rarely fills its tile, so keep the smear narrower than the
        // diamond or the river reads as a painted stripe.
        ctx.fillStyle = rgba(c, 0.16 + 0.34 * f * f);
        ctx.beginPath();
        ctx.moveTo(cx, cy - fy * 0.86);
        ctx.lineTo(cx + fx * 0.78, cy);
        ctx.lineTo(cx, cy + fy * 0.86);
        ctx.lineTo(cx - fx * 0.78, cy);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }

  /* ---- 3. live: water surface ----------------------------------------
     Water is baked into the cache, so anything drawn here lands on top of the
     blit with no depth test. A building south of the river overlaps the river
     tiles north of it, so restrict the live pass to tiles with nothing tall
     standing in front of them. Rebuilt only when the grid changes.          */

  var openMask = null, openRev = -1;
  function openWater (s) {
    if (openRev === (s.rev | 0) && openMask) return openMask;
    openRev = s.rev | 0;
    if (!openMask) openMask = new Uint8Array(G * G);
    var g = s.grid, x, y, m, t, ok;
    for (y = 0; y < G; y++) {
      for (x = 0; x < G; x++) {
        if (g[y * G + x] !== T.WATER) { openMask[y * G + x] = 0; continue; }
        ok = 1;
        for (m = 1; m <= 4 && ok; m++) {
          if (x + m >= G || y + m >= G) break;
          t = g[(y + m) * G + x + m];
          if (t !== T.WATER && t !== T.ROAD && t !== T.EMPTY && t !== T.BUS) ok = 0;
        }
        openMask[y * G + x] = ok;
      }
    }
    return openMask;
  }

  /* Screen coords of the visible open-water tiles, collected once and reused
     by every pass below. Clipping to a few hundred diamonds cost more than
     everything else in the frame put together, so the sheen is a plain path
     fill instead and the crests and sparkles simply stay inside their tile. */
  var _wxy = new Float32Array(4096);

  /* Three fills, whatever the size of the river: one sheen, one for both wave
     trains, one for every sparkle. Zoomed out past the whole-map view those
     three still cost ~20ms, because the river is then a thousand tiles wide
     on screen - so below 0.62 the pass drops out and the baked mirrors and
     the baked wave texture carry the water on their own. */
  function shimmer (ctx, R, s) {
    var n = R._nWat, b = R._bWat, sc = R.scale;
    if (!n || sc < 0.62) return;
    var open = openWater(s);
    var fx = HW * sc, fy = HH * sc, ox = R.ox, oy = R.oy;
    var W = R.w, H = R.h, t = R.clock * 0.0011, k, i, x, y, cx, cy;
    var P = _wxy, m = 0;

    ctx.save();
    ctx.beginPath();
    for (k = 0; k < n && m < P.length - 3; k++) {
      i = b[k];
      if (!open[i]) continue;
      x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      if (cx < -fx * 2 || cx > W + fx * 2 || cy < -fy * 2 || cy > H + fy * 2) continue;
      P[m] = cx; P[m + 1] = cy; P[m + 2] = x; P[m + 3] = y; m += 4;
      ctx.moveTo(cx, cy - fy); ctx.lineTo(cx + fx, cy);
      ctx.lineTo(cx, cy + fy); ctx.lineTo(cx - fx, cy);
      ctx.closePath();
    }
    if (!m) { ctx.restore(); return; }

    // pass 1 - the sky the water is looking at: cool up the screen, warm at
    // the horizon, which is what stops a river reading as flat blue paint
    var tone = skyTone();
    var sg = ctx.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, rgba(tone, 0.30 + 0.18 * sun.day));
    sg.addColorStop(1, rgba(mix(tone, BOUNCE, 0.5), 0.10));
    ctx.fillStyle = sg;
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';

    // pass 2 - two wave trains at different speeds, one path. Filled quads,
    // not strokes: Chromium antialiases every sub-path of a stroke on its own.
    var crest = mix(tone, SUN_CORE, 0.30 + 0.4 * sun.day);
    var cw = Math.max(0.8, 0.7 * sc), ax = fx * 0.50, ay = fy * 0.25;
    ctx.fillStyle = rgba(crest, 0.10 * (0.5 + 0.5 * sun.day));
    ctx.beginPath();
    for (var pass = 0; pass < 2; pass++) {
      for (k = 0; k < m; k += 4) {
        cx = P[k]; cy = P[k + 1]; x = P[k + 2]; y = P[k + 3];
        var yy = cy + fy * (pass
          ? Math.sin(t * 0.68 + x * 1.4 - y * 0.8 + 2.1) * 0.26
          : Math.sin(t + x * 0.9 + y * 1.35) * 0.36);
        ctx.moveTo(cx - ax, yy - ay - cw);
        ctx.lineTo(cx + ax, yy + ay - cw);
        ctx.lineTo(cx + ax, yy + ay + cw);
        ctx.lineTo(cx - ax, yy - ay + cw);
        ctx.closePath();
      }
    }
    ctx.fill();

    // pass 3 - sun glitter. The specular path runs down the screen column
    // under the sun, so weight every sparkle by how near that column it sits.
    if (sun.elev > -0.05) {
      var glit = mix(SUN_CORE, SUN_GOLD, clamp(1 - sun.elev * 1.4, 0, 1));
      // A real glitter path is broad, because the surface is rough: too tight
      // a lobe and the sparkles only ever appear when the river happens to sit
      // under the sun's own screen column, which is most of the time nowhere.
      var band = W * 0.62, up = clamp(sun.elev, 0, 1);
      var gw = Math.max(0.9, 0.9 * sc);
      ctx.fillStyle = rgba(glit, 0.42);
      ctx.beginPath();
      for (k = 0; k < m; k += 4) {
        cx = P[k]; cy = P[k + 1]; x = P[k + 2]; y = P[k + 3];
        var d = (cx - sun.sx) / band;
        if (Math.exp(-d * d) * (0.30 + 0.70 * up) < 0.17) continue;
        var seed = hash(x, y, 17);
        // twinkle: each sparkle has its own phase and only shows near its peak
        if (Math.sin(t * 3.1 + seed * TAU) * 0.5 + 0.5 < 0.60) continue;
        var len = fx * (0.05 + 0.13 * seed);
        var jx = cx + (hash(x, y, 31) - 0.5) * (fx * 0.7 - len * 2);
        var jy = cy + (hash(x, y, 47) - 0.5) * fy * 0.7;
        ctx.moveTo(jx - len, jy);            // a lens, which glints better
        ctx.lineTo(jx, jy - gw);             // than a capsule anyway
        ctx.lineTo(jx + len, jy);
        ctx.lineTo(jx, jy + gw);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---- 5. live: the wash over everything ------------------------------
     render.js's _tint does the flat ambient multiply. This adds the part that
     has a direction to it: light pouring in from wherever the sun actually is. */
  function glow (ctx, R) {
    var a = 0.10 * sun.day + 0.42 * sun.gold;
    if (a < 0.015) return;
    var warm = mix(SUN_CORE, SUN_GOLD, clamp(1 - sun.elev * 1.2, 0, 1));
    var g = ctx.createRadialGradient(sun.sx, sun.sy, 0, sun.sx, sun.sy, sun.r * 1.6);
    g.addColorStop(0, rgba(warm, a));
    g.addColorStop(0.45, rgba(warm, a * 0.34));
    g.addColorStop(1, rgba(warm, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, R.w, R.h);
    ctx.restore();
  }

  MM.light = {
    sun: sun, update: update, skyTone: skyTone,
    sky: sky, reflect: reflect, shimmer: shimmer, glow: glow
  };
})(window.MM);

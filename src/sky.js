/* src/sky.js - everything above the rooftops and out on the water.

   Balloons, airliners, a traffic helicopter, river boats and birds. All of
   it is drawn live over the static cache, so it moves without invalidating
   anything, and all of it is a pure function of the renderer clock - there
   is no state to save and nothing to desync.

   Screen mapping matches render.js: ix = (x-y)*fx + ox, iy = (x+y)*fy + oy - h,
   with fx = 32*scale and fy = 16*scale.                                     */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.GRID || 48, T = MM.TILE || {};
  var TAU = Math.PI * 2;
  var HW = 32, HH = 16;

  function lerp (a, b, t) { return a + (b - a) * t; }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgba (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
  function mul (c, k) { return [(c[0] * k) | 0, (c[1] * k) | 0, (c[2] * k) | 0]; }

  /* balloon liveries - two colours and a gore stripe each */
  var LIVERY = [
    [[232, 84, 72], [246, 202, 74]], [[62, 114, 200], [248, 248, 244]],
    [[68, 168, 108], [246, 202, 74]], [[242, 148, 52], [230, 84, 62]],
    [[150, 108, 148], [136, 198, 226]], [[246, 202, 74], [68, 168, 108]]
  ];

  /* ------------------------------------------------------------------ *
   * the river, found once per plan so boats know where to sail
   * ------------------------------------------------------------------ */
  var lanes = new Float32Array(G * 2);   // [centre, width] per row
  var laneRows = [];
  var laneRev = -1;

  function findRiver (s) {
    if (laneRev === (s.rev | 0) && laneRows.length) return;
    laneRev = s.rev | 0;
    laneRows.length = 0;
    var g = s.grid, x, y, a, b;
    for (y = 0; y < G; y++) {
      a = -1; b = -1;
      for (x = 0; x < G; x++) {
        if (g[y * G + x] === T.WATER) { if (a < 0) a = x; b = x; }
      }
      if (a >= 0 && b - a >= 2) {
        lanes[y * 2] = (a + b) * 0.5;
        lanes[y * 2 + 1] = b - a + 1;
        laneRows.push(y);
      } else { lanes[y * 2] = -1; lanes[y * 2 + 1] = 0; }
    }
  }

  function laneAt (y) {                   // interpolated river centre
    var y0 = Math.floor(y), y1 = y0 + 1, t = y - y0;
    y0 = clamp(y0, 0, G - 1); y1 = clamp(y1, 0, G - 1);
    var a = lanes[y0 * 2], b = lanes[y1 * 2];
    if (a < 0 || b < 0) return a < 0 ? b : a;
    return lerp(a, b, t);
  }

  /* ------------------------------------------------------------------ *
   * pieces
   * ------------------------------------------------------------------ */

  /* a hot-air balloon: envelope, gores, ropes, basket, burner */
  function balloon (ctx, px, py, r, liv, night) {
    var A = liv[0], B = liv[1], i;
    var top = py - r * 2.55;
    ctx.fillStyle = rgba(A, 1);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.bezierCurveTo(px - r * 1.18, py - r * 0.85, px - r * 1.12, py - r * 2.3, px, top);
    ctx.bezierCurveTo(px + r * 1.12, py - r * 2.3, px + r * 1.18, py - r * 0.85, px, py);
    ctx.fill();
    for (i = -1; i <= 1; i += 2) {        // two gores in the second colour
      var o = i * r * 0.52;
      ctx.fillStyle = rgba(B, 1);
      ctx.beginPath();
      ctx.moveTo(px + o * 0.12, py - r * 0.12);
      ctx.bezierCurveTo(px + o - r * 0.26, py - r * 0.9, px + o - r * 0.22, py - r * 2.2, px + o * 0.30, top + r * 0.06);
      ctx.bezierCurveTo(px + o * 0.30 + r * 0.22, top + r * 0.5, px + o + r * 0.24, py - r * 0.95, px + o * 0.12, py - r * 0.12);
      ctx.fill();
    }
    ctx.fillStyle = rgba(mul(A, 0.66), 0.55);       // shaded right cheek
    ctx.beginPath();
    ctx.moveTo(px + r * 0.5, py - r * 0.35);
    ctx.bezierCurveTo(px + r * 1.16, py - r * 1.0, px + r * 1.05, py - r * 2.2, px + r * 0.24, top + r * 0.1);
    ctx.bezierCurveTo(px + r * 0.86, py - r * 1.6, px + r * 0.9, py - r * 0.9, px + r * 0.5, py - r * 0.35);
    ctx.fill();
    var bw = r * 0.42, bh = r * 0.40, by = py + r * 0.52;
    ctx.strokeStyle = 'rgba(80,70,60,0.85)';
    ctx.lineWidth = Math.max(0.6, r * 0.055);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.5, py - r * 0.06); ctx.lineTo(px - bw, by);
    ctx.moveTo(px + r * 0.5, py - r * 0.06); ctx.lineTo(px + bw, by);
    ctx.stroke();
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(px - bw, by, bw * 2, bh);
    ctx.fillStyle = '#6d4c2b';
    ctx.fillRect(px - bw, by + bh * 0.62, bw * 2, bh * 0.38);
    if (night > 0.25) {                              // the burner, lit
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,168,72,' + (0.5 * night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py + r * 0.28, r * 0.7, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /* an airliner seen from above and behind, with a contrail */
  function airliner (ctx, px, py, k, dir, night) {
    var d = dir ? -1 : 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';       // contrail
    ctx.lineWidth = Math.max(1, k * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px - d * k * 0.9, py + k * 0.08);
    ctx.lineTo(px - d * k * 7.5, py + k * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#f4f6f8';
    ctx.beginPath();                                  // fuselage
    ctx.moveTo(px + d * k * 1.5, py);
    ctx.lineTo(px - d * k * 1.1, py + k * 0.26);
    ctx.lineTo(px - d * k * 1.5, py + k * 0.18);
    ctx.lineTo(px - d * k * 1.2, py - k * 0.10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#dfe4e9';
    ctx.beginPath();                                  // wings
    ctx.moveTo(px + d * k * 0.35, py + k * 0.04);
    ctx.lineTo(px - d * k * 0.9, py + k * 1.15);
    ctx.lineTo(px - d * k * 1.25, py + k * 1.05);
    ctx.lineTo(px - d * k * 0.35, py + k * 0.02);
    ctx.lineTo(px - d * k * 1.0, py - k * 0.95);
    ctx.lineTo(px - d * k * 1.3, py - k * 0.82);
    ctx.lineTo(px - d * k * 0.55, py + k * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3e72c8';
    ctx.beginPath();                                  // tail
    ctx.moveTo(px - d * k * 1.15, py + k * 0.20);
    ctx.lineTo(px - d * k * 1.75, py + k * 0.44);
    ctx.lineTo(px - d * k * 1.72, py + k * 0.12);
    ctx.closePath(); ctx.fill();
    if (night > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,86,64,' + (0.8 * night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px - d * k * 0.9, py + k * 1.1, k * 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(150,255,160,' + (0.8 * night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px - d * k * 1.0, py - k * 0.9, k * 0.13, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* the traffic helicopter, rotor smeared into a disc */
  function chopper (ctx, px, py, k, spin, night) {
    ctx.save();
    ctx.fillStyle = '#2f3b4c';
    ctx.beginPath(); ctx.ellipse(px, py, k * 0.9, k * 0.52, 0, 0, TAU); ctx.fill();
    ctx.fillRect(px - k * 2.6, py - k * 0.10, k * 1.9, k * 0.20);
    ctx.beginPath();
    ctx.moveTo(px - k * 2.7, py - k * 0.55);
    ctx.lineTo(px - k * 2.3, py - k * 0.55);
    ctx.lineTo(px - k * 2.4, py + k * 0.18);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,205,240,0.9)';
    ctx.beginPath(); ctx.ellipse(px + k * 0.34, py - k * 0.05, k * 0.36, k * 0.26, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(210,220,232,0.55)';
    ctx.lineWidth = Math.max(0.8, k * 0.13);
    ctx.beginPath();
    ctx.ellipse(px, py - k * 0.62, k * 2.5, k * 0.5 + k * 0.35 * Math.abs(Math.cos(spin)), 0, 0, TAU);
    ctx.stroke();
    if (night > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,72,64,' + (0.4 + 0.5 * Math.abs(Math.sin(spin * 0.7))).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py + k * 0.4, k * 0.24, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* a river boat: hull, wheelhouse, wake */
  function vessel (ctx, px, py, k, tug, night) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = Math.max(1, k * 0.20);
    ctx.beginPath();
    ctx.moveTo(px - k * 1.6, py + k * 0.30);
    ctx.lineTo(px - k * 4.2, py + k * 0.95);
    ctx.moveTo(px - k * 1.6, py + k * 0.30);
    ctx.lineTo(px - k * 3.6, py - k * 0.55);
    ctx.stroke();
    ctx.fillStyle = tug ? '#c8503f' : '#f0f2f2';
    ctx.beginPath();
    ctx.moveTo(px + k * 1.9, py);
    ctx.lineTo(px + k * 0.5, py + k * 0.62);
    ctx.lineTo(px - k * 1.5, py + k * 0.34);
    ctx.lineTo(px - k * 1.0, py - k * 0.32);
    ctx.lineTo(px + k * 0.9, py - k * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = tug ? '#efe6d6' : '#3e72c8';
    ctx.fillRect(px - k * 0.9, py - k * 0.85, k * 1.1, k * 0.72);
    if (tug) { ctx.fillStyle = '#3a4048'; ctx.fillRect(px - k * 0.1, py - k * 1.35, k * 0.28, k * 0.55); }
    if (night > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,220,150,' + (0.7 * night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px - k * 0.4, py - k * 0.9, k * 0.42, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * the pass
   * ------------------------------------------------------------------ */
  function draw (ctx, o) {
    var s = o.s, sc = o.scale, fx = HW * sc, fy = HH * sc;
    var ox = o.ox, oy = o.oy, W = o.w, H = o.h;
    var night = o.N, cl = o.clock, i;
    var wide = sc > 0.42;

    /* --- clouds: slow, huge, and always above everything -------------
       High over the map, not pinned to the window. Everything in this file
       is placed in tile space and an altitude for the same reason: the
       moment one actor is placed against the viewport it slides across the
       rooftops on a pan and gives the whole illusion away. */
    var cn = wide ? 5 : 3;
    ctx.save();
    for (i = 0; i < cn; i++) {
      var ct = (cl * 0.000011 + i * 0.211) % 1;
      var cu = -12 + ct * (G + 24), cv = (i * 9.7) % G;
      // Well clear of the skyline. In world space a cloud has a real height
      // over the ground rather than a fixed place at the top of the window,
      // and at 520px it sat among the towers as a smear of haze.
      var calt = (980 + ((i * 79) % 220)) * sc + Math.sin(cl * 0.0002 + i) * 8;
      var cx = (cu - cv) * fx + ox, cy = (cu + cv) * fy + oy - calt;
      var cr = (34 + (i % 3) * 16) * (0.8 + sc * 0.4);
      if (cx < -cr * 3 || cx > W + cr * 3 || cy < -cr * 3 || cy > H + cr * 3) continue;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.20 + 0.12 * (1 - night)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.62, 0, TAU);
      ctx.arc(cx + cr * 0.62, cy + cr * 0.10, cr * 0.46, 0, TAU);
      ctx.arc(cx - cr * 0.58, cy + cr * 0.14, cr * 0.40, 0, TAU);
      ctx.arc(cx + cr * 0.16, cy - cr * 0.30, cr * 0.44, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    /* --- boats on the river ------------------------------------------ */
    findRiver(s);
    if (laneRows.length > 6 && wide) {
      var span = laneRows.length;
      for (i = 0; i < 4; i++) {
        var bt = (cl * 0.0000135 * (1 + (i % 2) * 0.35) + i * 0.29) % 1;
        var dirUp = (i & 1) === 0;
        var yy = laneRows[0] + (dirUp ? bt : 1 - bt) * (span - 1);
        var xx = laneAt(yy) + ((i % 3) - 1) * 0.9;
        var px = (xx - yy) * fx + ox, py = (xx + yy) * fy + oy;
        if (px < -120 || px > W + 120 || py < -80 || py > H + 80) continue;
        vessel(ctx, px, py, 7 * sc, (i & 2) === 0, night);
      }
    }

    /* --- balloons ----------------------------------------------------- */
    var bn = wide ? 4 : 2;
    for (i = 0; i < bn; i++) {
      var t = (cl * 0.0000062 * (1 + (i % 3) * 0.22) + i * 0.263) % 1;
      var wx = -6 + t * (G + 12);
      var wy = (G * 0.16 + i * G * 0.21) % G;
      var alt = (150 + ((i * 53) % 90)) * sc + Math.sin(cl * 0.00043 + i * 2.1) * 9 * sc;
      var bx = (wx - wy) * fx + ox, by = (wx + wy) * fy + oy - alt;
      if (bx < -110 || bx > W + 110 || by < -140 || by > H + 60) continue;
      balloon(ctx, bx, by, (14 + (i % 3) * 4) * Math.max(0.55, sc), LIVERY[i % LIVERY.length], night);
    }

    /* --- an airliner on the approach, and the traffic helicopter ------
       Tile space and an altitude, exactly like the balloons above. Pinned to
       the viewport instead, an aircraft slides across the rooftops whenever
       the camera pans - the city reads as sliding under a painted sticker
       rather than as a plane flying over a city. The approach runs along +x
       (nose screen-right, dir 0); the departure runs along +y, which on an
       isometric screen travels left, hence dir 1. */
    var at = (cl * 0.0000255) % 1;
    var au = -10 + at * (G + 20), av = G * 0.30;
    var aalt = (330 + Math.sin(at * 3.1) * 26) * sc;
    var apx = (au - av) * fx + ox, apy = (au + av) * fy + oy - aalt;
    if (apx > -160 && apx < W + 160 && apy > -120 && apy < H + 120) {
      airliner(ctx, apx, apy, 13 * Math.max(0.7, sc), 0, night);
    }
    if (wide) {
      var at2 = (cl * 0.0000181 + 0.5) % 1;
      var bu = G * 0.66, bv = -10 + at2 * (G + 20);
      var balt = (250 + Math.cos(at2 * 2.6) * 20) * sc;
      var bpx = (bu - bv) * fx + ox, bpy = (bu + bv) * fy + oy - balt;
      if (bpx > -160 && bpx < W + 160 && bpy > -120 && bpy < H + 120) {
        airliner(ctx, bpx, bpy, 10 * Math.max(0.7, sc), 1, night);
      }
    }
    if (wide) {
      var ht = cl * 0.00021;
      var hu = G * 0.5 + Math.cos(ht) * G * 0.34;
      var hv = G * 0.5 + Math.sin(ht * 1.3) * G * 0.30;
      var hpx = (hu - hv) * fx + ox, hpy = (hu + hv) * fy + oy - 210 * sc;
      if (hpx > -90 && hpx < W + 90 && hpy > -90 && hpy < H + 90) {
        chopper(ctx, hpx, hpy, 9 * Math.max(0.7, sc), cl * 0.05, night);
      }
    }

    /* --- birds -------------------------------------------------------- */
    if (night < 0.55 && wide) {
      ctx.save();
      ctx.strokeStyle = 'rgba(46,54,66,0.55)';
      ctx.lineWidth = Math.max(0.8, 1.1 * sc);
      ctx.beginPath();
      for (i = 0; i < 11; i++) {
        var ft = (cl * 0.000048 + i * 0.0917) % 1;
        // birds fly over the city too, not over the window
        var du2 = G + 6 - ft * (G + 12), dv2 = (i * 4.37) % G;
        var dalt = (70 + ((i * 37) % 90)) * sc + Math.sin(cl * 0.0016 + i * 1.7) * 7;
        var fx2 = (du2 - dv2) * fx + ox, fy2 = (du2 + dv2) * fy + oy - dalt;
        if (fx2 < -40 || fx2 > W + 40 || fy2 < -40 || fy2 > H + 40) continue;
        var r = 3.2 + (i % 3) * 1.1;
        var flap = 0.35 + 0.5 * Math.abs(Math.sin(cl * 0.009 + i));
        ctx.moveTo(fx2 - r, fy2 + r * flap);
        ctx.quadraticCurveTo(fx2 - r * 0.4, fy2 - r * flap * 0.7, fx2, fy2);
        ctx.quadraticCurveTo(fx2 + r * 0.4, fy2 - r * flap * 0.7, fx2 + r, fy2 + r * flap);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  MM.sky = { draw: draw };
})(window.MM);

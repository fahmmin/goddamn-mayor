/* Shared isometric drawing kit + the daylight palette.
   Owned by the lead. render.js, roofs.js, props.js and ground.js all draw
   through these helpers so everything shares one projection and one light. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  /* ---- tile space -----------------------------------------------------
     A tile's ground diamond has its CENTRE at (cx, cy) and vertices at
     N (cx, cy-fy)   E (cx+fx, cy)   S (cx, cy+fy)   W (cx-fx, cy).
     Tile-local (u,v) each run -1..1 across the tile square:
        u = -1..1 runs NW->SE (the "right"/east axis)
        v = -1..1 runs NE->SW (the "left"/south axis)
     u and v may exceed 1 to describe a building spanning several tiles.
     h is height in screen px, straight up.                              */
  function ix (cx, fx, u, v) { return cx + (u - v) * fx * 0.5; }
  function iy (cy, fy, u, v, h) { return cy + (u + v) * fy * 0.5 - (h || 0); }

  function moveTo (ctx, cx, cy, fx, fy, u, v, h) { ctx.moveTo(ix(cx, fx, u, v), iy(cy, fy, u, v, h)); }
  function lineTo (ctx, cx, cy, fx, fy, u, v, h) { ctx.lineTo(ix(cx, fx, u, v), iy(cy, fy, u, v, h)); }

  /* flat polygon on the ground plane (or at constant height h) */
  function flat (ctx, cx, cy, fx, fy, pts, h) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      (i ? lineTo : moveTo)(ctx, cx, cy, fx, fy, p[0], p[1], h);
    }
    ctx.closePath();
  }

  /* axis-aligned box in tile space, from height hb up to ht.
     F = [topCss, leftCss, rightCss]. Draws only the faces a viewer can see. */
  function prism (ctx, cx, cy, fx, fy, u0, v0, u1, v1, hb, ht, F) {
    // right face: the u = u1 edge
    ctx.fillStyle = F[2];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u1, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
    lineTo(ctx, cx, cy, fx, fy, u1, v0, hb);
    ctx.closePath(); ctx.fill();
    // left face: the v = v1 edge
    ctx.fillStyle = F[1];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, hb);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
    ctx.closePath(); ctx.fill();
    // top
    ctx.fillStyle = F[0];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u0, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, ht);
    ctx.closePath(); ctx.fill();
  }

  /* upright cylinder-ish post (tank, silo, pole) */
  function post (ctx, cx, cy, fx, fy, u, v, r, hb, ht, F) {
    var x = ix(cx, fx, u, v), yT = iy(cy, fy, u, v, ht), yB = iy(cy, fy, u, v, hb);
    var rx = r * fx * 0.5, ry = r * fy * 0.5;
    ctx.fillStyle = F[1];
    ctx.beginPath();
    ctx.moveTo(x - rx, yT); ctx.lineTo(x - rx, yB);
    ctx.ellipse ? ctx.ellipse(x, yB, rx, ry, 0, Math.PI, 0, true) : ctx.lineTo(x + rx, yB);
    ctx.lineTo(x + rx, yT); ctx.closePath(); ctx.fill();
    ctx.fillStyle = F[0];
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(x, yT, rx, ry, 0, 0, Math.PI * 2);
    else { ctx.moveTo(x - rx, yT); ctx.lineTo(x, yT - ry); ctx.lineTo(x + rx, yT); ctx.lineTo(x, yT + ry); }
    ctx.closePath(); ctx.fill();
  }

  /* deterministic noise - never Math.random, or the city flickers */
  function hash (x, y, k) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp (a, b, t) { return a + (b - a) * t; }
  function mul (c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mix (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  /* ---- light ----------------------------------------------------------
     render.js calls setLight() once a frame; css() then returns a colour
     with the current time-of-day applied, so every module matches. */
  var _rm = 1, _gm = 1, _bm = 1, _night = 0;
  function setLight (rm, gm, bm, night) { _rm = rm; _gm = gm; _bm = bm; _night = night || 0; }
  function css (c) {
    return 'rgb(' + (clamp(c[0] * _rm, 0, 255) | 0) + ',' +
      (clamp(c[1] * _gm, 0, 255) | 0) + ',' + (clamp(c[2] * _bm, 0, 255) | 0) + ')';
  }
  function cssA (c, a) {
    return 'rgba(' + (clamp(c[0] * _rm, 0, 255) | 0) + ',' +
      (clamp(c[1] * _gm, 0, 255) | 0) + ',' + (clamp(c[2] * _bm, 0, 255) | 0) + ',' + a + ')';
  }
  /* unlit - for anything that emits its own light (windows, neon, headlights) */
  function raw (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function night () { return _night; }

  /* ---- specular -------------------------------------------------------
     Lambert alone gives every wall facing the same way the same flat tone,
     which is what makes a box read as a box. A sun direction plus a tight
     lobe on top of the diffuse term is the whole difference between "shaded"
     and "lit": walls square to the sun go hot, walls raking away fall off
     fast, and a drum picks up a highlight that travels round it.

     The camera never moves, so the half-vector is constant and the lobe is
     just a power of dot(normal, sun) - no per-pixel work, no extra draw call,
     and painter's order comes free because this rides inside the existing
     wall fill. The city is baked at noon (see render.js _daynight), so the
     default sun points at noon; setSun is the art-direction knob.           */
  var _su = 0.10, _sv = 1, _sgain = 0.30, _sroof = 0.06;
  function setSun (u, v, gain, roof) {
    var m = Math.sqrt(u * u + v * v) || 1;
    _su = u / m; _sv = v / m;
    if (gain !== undefined) _sgain = gain;
    if (roof !== undefined) _sroof = roof;
  }
  /* nu, nv must be a unit face normal in tile space */
  function spec (nu, nv) {
    var d = nu * _su + nv * _sv;
    return d <= 0 ? 0 : _sgain * d * d * d;
  }

  /* face triple from one top colour: [top, left, right] */
  var LM = 0.78, RM = 0.60;                  // daylight ambient occlusion
  function faces (top) {
    return [css(mul(top, 1 + _sroof)),
      css(mul(top, LM + spec(0, 1))),
      css(mul(top, RM + spec(1, 0)))];
  }

  /* ---- daylight diorama palette --------------------------------------
     Bright, saturated, model-village. Buildings are pale; the ground reads
     as dark asphalt and vivid lawn so the whole thing pops. */
  var PAL = {
    grass:     [126, 186, 88],
    grassDark: [ 98, 158, 68],
    lot:       [176, 178, 168],
    lotEdge:   [150, 154, 146],
    asphalt:   [ 74,  78,  84],
    asphaltLo: [ 64,  68,  74],
    curb:      [186, 188, 184],
    paint:     [244, 244, 238],
    paintYel:  [240, 198,  72],
    plaza:     [206, 202, 190],
    waterA:    [ 74, 156, 200],
    waterB:    [ 46, 122, 172],
    treeA:     [ 74, 152,  76],
    treeB:     [ 98, 182,  92],
    treeC:     [ 56, 124,  64],
    trunk:     [111,  84,  58],
    shade:     [ 30,  40,  52],
    concrete:  [222, 220, 212],
    concreteB: [200, 198, 190],
    steel:     [176, 182, 190],
    glass:     [136, 198, 226],
    glassDark: [ 92, 148, 182],
    solar:     [ 44,  58,  92],
    solarLit:  [ 92, 130, 180],
    white:     [246, 246, 242],
    roofGrey:  [188, 190, 186],
    /* --- block-scale palette: materials the archetypes in lots.js use --- */
    brickA:    [196, 126,  98],   brickB:    [172, 104,  86],
    brickC:    [214, 168, 132],   stucco:    [238, 226, 206],
    sand:      [226, 208, 170],   bone:      [242, 240, 232],
    teal:      [ 96, 176, 176],   sage:      [166, 194, 158],
    terracot:  [212, 124,  86],   plum:      [150, 108, 148],
    glassG:    [150, 200, 196],   glassB:    [124, 176, 214],
    mullion:   [206, 210, 212],   spandrel:  [ 92, 118, 138],
    metalA:    [206, 210, 214],   metalB:    [162, 168, 176],
    parkLot:   [ 86,  90,  96],   stall:     [232, 232, 224],
    hedge:     [ 92, 148,  80],   planter:   [148, 116,  92],
    courtB:    [ 74, 138, 190],   courtG:    [ 96, 158, 106],
    clay:      [198, 122,  92],   pond:      [ 92, 168, 202],
    signRed:   [230,  84,  62],   signOrg:   [242, 148,  52],
    signBlue:  [ 62, 114, 200],   signGrn:   [ 68, 168, 108],
    signYel:   [246, 202,  74],   signWht:   [248, 248, 244],
    signDark:  [ 46,  54,  66],   canopy:    [232, 234, 232],
    dirt:      [178, 158, 128],   gravel:    [166, 164, 156],
    roofDark:  [126, 130, 132]
  };

  /* cheerful car paint - the reference is full of primary colours */
  var CARS = [
    [232,  84,  72], [244, 176,  52], [ 68, 148, 232], [ 86, 190, 118],
    [246, 246, 244], [ 54,  62,  78], [238, 128,  62], [156, 108, 208],
    [ 64, 196, 200], [226,  96, 156]
  ];

  /* ==================================================================== *
   * high-detail kit
   * Everything below exists so a building can be something other than a
   * box: curved office slabs, drums, domes, pitched roofs, glazing grids
   * and extruded signage. lots.js draws whole city blocks out of these.
   * ==================================================================== */

  var TAU2 = Math.PI * 2;
  var BM = 0.44;                       // a face angled away from the light

  /* footprints live in flat [u0,v0,u1,v1,...] buffers so nothing allocates
     per building. Wind them counter-clockwise: outward normal of the edge
     p0->p1 is then (dv, -du), and a face is visible when nu + nv > 0.     */
  var _pb = new Float64Array(512);     // shared footprint scratch
  var _pc = new Float64Array(512);     // second scratch, for nested shapes
  var _wi = new Int32Array(96), _wd = new Float64Array(96);
  var _tb = new Float64Array(1536);     // collected letter boxes

  function rectPts (b, u0, v0, u1, v1) {
    b[0] = u0; b[1] = v0; b[2] = u1; b[3] = v0;
    b[4] = u1; b[5] = v1; b[6] = u0; b[7] = v1;
    return 4;
  }

  /* chamfered rectangle - the cheapest way to stop a block reading as a cube */
  function chamfPts (b, u0, v0, u1, v1, c) {
    b[0] = u0 + c; b[1] = v0; b[2] = u1 - c; b[3] = v0;
    b[4] = u1; b[5] = v0 + c; b[6] = u1; b[7] = v1 - c;
    b[8] = u1 - c; b[9] = v1; b[10] = u0 + c; b[11] = v1;
    b[12] = u0; b[13] = v1 - c; b[14] = u0; b[15] = v0 + c;
    return 8;
  }

  /* append an arc of `seg` steps; returns the new point count */
  function arcTo (b, n, u, v, r, a0, a1, seg) {
    for (var k = 0; k <= seg; k++) {
      var a = a0 + (a1 - a0) * (k / seg);
      b[n * 2] = u + Math.cos(a) * r;
      b[n * 2 + 1] = v + Math.sin(a) * r;
      n++;
    }
    return n;
  }

  function ringPts (b, u, v, r, seg) {
    for (var k = 0, n = 0; k < seg; k++, n++) {
      var a = k / seg * TAU2;
      b[n * 2] = u + Math.cos(a) * r;
      b[n * 2 + 1] = v + Math.sin(a) * r;
    }
    return seg;
  }

  /* annular sector: the curved office slab that gives the skyline its bends */
  function bandPts (b, u, v, r0, r1, a0, a1, seg) {
    var n = arcTo(b, 0, u, v, r1, a0, a1, seg);
    return arcTo(b, n, u, v, r0, a1, a0, seg);
  }

  /* L-plan, arm widths wu (along u) and wv (along v), corner at (u0,v0) */
  function elPts (b, u0, v0, u1, v1, wu, wv) {
    b[0] = u0; b[1] = v0; b[2] = u1; b[3] = v0;
    b[4] = u1; b[5] = v0 + wv; b[6] = u0 + wu; b[7] = v0 + wv;
    b[8] = u0 + wu; b[9] = v1; b[10] = u0; b[11] = v1;
    return 6;
  }

  /* ---- extrusion ------------------------------------------------------
     One convex-or-mildly-concave footprint pushed from hb up to ht. Each
     wall is shaded by the direction it faces, so a drum gets a gradient
     round its side instead of two flat tones. Walls paint back to front. */
  function extrude (ctx, cx, cy, fx, fy, b, n, hb, ht, top, seam) {
    var m = 0, i, j, e, f, du, dv, nu, nv, mag, k, ti, td;
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      du = b[j * 2] - b[i * 2]; dv = b[j * 2 + 1] - b[i * 2 + 1];
      if (dv - du <= 1e-9) continue;                       // faces away
      _wi[m] = i; _wd[m] = b[i * 2] + b[i * 2 + 1] + b[j * 2] + b[j * 2 + 1];
      if (++m >= 96) break;
    }
    for (i = 1; i < m; i++) {                              // back to front
      ti = _wi[i]; td = _wd[i]; j = i - 1;
      while (j >= 0 && _wd[j] > td) { _wi[j + 1] = _wi[j]; _wd[j + 1] = _wd[j]; j--; }
      _wi[j + 1] = ti; _wd[j + 1] = td;
    }
    for (i = 0; i < m; i++) {
      e = _wi[i]; f = (e + 1) % n;
      du = b[f * 2] - b[e * 2]; dv = b[f * 2 + 1] - b[e * 2 + 1];
      nu = dv; nv = -du;
      mag = (nu < 0 ? -nu : nu) + (nv < 0 ? -nv : nv);
      if (mag < 1e-9) continue;
      nu /= mag; nv /= mag;
      k = (nu > 0 ? nu * RM : -nu * BM) + (nv > 0 ? nv * LM : -nv * BM) + spec(nu, nv);
      ctx.fillStyle = ctx.strokeStyle = css(mul(top, k));
      ctx.beginPath();
      moveTo(ctx, cx, cy, fx, fy, b[e * 2], b[e * 2 + 1], ht);
      lineTo(ctx, cx, cy, fx, fy, b[f * 2], b[f * 2 + 1], ht);
      lineTo(ctx, cx, cy, fx, fy, b[f * 2], b[f * 2 + 1], hb);
      lineTo(ctx, cx, cy, fx, fy, b[e * 2], b[e * 2 + 1], hb);
      ctx.closePath();
      ctx.fill();
      // A curve is many near-coplanar walls and antialiasing leaves hairlines
      // between them; a hard-edged box does not, and the stroke is not free.
      if (seam) { ctx.lineWidth = 0.7; ctx.stroke(); }
    }
    ctx.fillStyle = ctx.strokeStyle = css(mul(top, 1 + _sroof));
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, b[0], b[1], ht);
    for (i = 1; i < n; i++) lineTo(ctx, cx, cy, fx, fy, b[i * 2], b[i * 2 + 1], ht);
    ctx.closePath();
    ctx.fill();
    if (seam) { ctx.lineWidth = 0.7; ctx.stroke(); }
  }

  /* flat polygon fill at height h, footprint buffer form */
  function slab (ctx, cx, cy, fx, fy, b, n, h, style) {
    ctx.fillStyle = style;
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, b[0], b[1], h);
    for (var i = 1; i < n; i++) lineTo(ctx, cx, cy, fx, fy, b[i * 2], b[i * 2 + 1], h);
    ctx.closePath();
    ctx.fill();
  }

  /* upright drum: silo, rotunda, water tank, column */
  function drum (ctx, cx, cy, fx, fy, u, v, r, hb, ht, top, seg) {
    var n = ringPts(_pb, u, v, r, seg || 14);
    extrude(ctx, cx, cy, fx, fy, _pb, n, hb, ht, top, 1);
  }

  /* ---- wall planes ----------------------------------------------------
     side 0: the plane v = fixed, facing +v (screen-left face), a runs on u
     side 1: the plane u = fixed, facing +u (screen-right face), a runs on v
     Path-only, so a caller can batch a whole facade into one fill.        */
  function wallQuad (ctx, cx, cy, fx, fy, side, fixed, a0, a1, h0, h1) {
    if (side === 0) {
      moveTo(ctx, cx, cy, fx, fy, a0, fixed, h0);
      lineTo(ctx, cx, cy, fx, fy, a1, fixed, h0);
      lineTo(ctx, cx, cy, fx, fy, a1, fixed, h1);
      lineTo(ctx, cx, cy, fx, fy, a0, fixed, h1);
    } else {
      moveTo(ctx, cx, cy, fx, fy, fixed, a0, h0);
      lineTo(ctx, cx, cy, fx, fy, fixed, a1, h0);
      lineTo(ctx, cx, cy, fx, fy, fixed, a1, h1);
      lineTo(ctx, cx, cy, fx, fy, fixed, a0, h1);
    }
    ctx.closePath();
  }

  /* glazing grid on one wall plane. Path-only and batchable. */
  function winGrid (ctx, cx, cy, fx, fy, side, fixed, a0, a1, h0, h1, cols, rows, ia, ih) {
    var da = (a1 - a0) / cols, dh = (h1 - h0) / rows, c, r, aa, hh;
    ia = ia === undefined ? 0.22 : ia;
    ih = ih === undefined ? 0.24 : ih;
    for (c = 0; c < cols; c++) {
      aa = a0 + c * da;
      for (r = 0; r < rows; r++) {
        hh = h0 + r * dh;
        wallQuad(ctx, cx, cy, fx, fy, side, fixed,
          aa + da * ia, aa + da * (1 - ia), hh + dh * ih, hh + dh * (1 - ih));
      }
    }
  }

  /* Curtain wall: a glazed band per storey, broken by vertical mullions.
     One unbroken ribbon per floor reads as a barcode from a distance; the
     mullions are what make it read as a building with windows in it. */
  function ribbon (ctx, cx, cy, fx, fy, side, fixed, a0, a1, h0, h1, bands, ih) {
    var dh = (h1 - h0) / bands, span = a1 - a0, r, c, hh, aa;
    var cols = Math.max(2, Math.round(span * 3.4));
    var da = span / cols;
    ih = ih === undefined ? 0.34 : ih;
    for (r = 0; r < bands; r++) {
      hh = h0 + r * dh;
      for (c = 0; c < cols; c++) {
        aa = a0 + c * da;
        wallQuad(ctx, cx, cy, fx, fy, side, fixed,
          aa + da * 0.10, aa + da * 0.90, hh + dh * ih, hh + dh * (1 - ih * 0.42));
      }
    }
  }

  /* ---- roofs ----------------------------------------------------------
     along 0: ridge runs along u (constant v), along 1: ridge runs along v */
  function gable (ctx, cx, cy, fx, fy, u0, v0, u1, v1, hb, ht, along, top) {
    var F = faces(top), mid;
    ctx.fillStyle = F[1];
    if (along === 0) {
      mid = (v0 + v1) * 0.5;
      ctx.beginPath();                                   // sunlit slope, +v
      moveTo(ctx, cx, cy, fx, fy, u0, mid, ht);
      lineTo(ctx, cx, cy, fx, fy, u1, mid, ht);
      lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
      lineTo(ctx, cx, cy, fx, fy, u0, v1, hb);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = F[2];                              // gable end, +u
      ctx.beginPath();
      moveTo(ctx, cx, cy, fx, fy, u1, v0, hb);
      lineTo(ctx, cx, cy, fx, fy, u1, mid, ht);
      lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
      ctx.closePath(); ctx.fill();
    } else {
      mid = (u0 + u1) * 0.5;
      ctx.fillStyle = F[2];
      ctx.beginPath();                                   // slope facing +u
      moveTo(ctx, cx, cy, fx, fy, mid, v0, ht);
      lineTo(ctx, cx, cy, fx, fy, mid, v1, ht);
      lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
      lineTo(ctx, cx, cy, fx, fy, u1, v0, hb);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = F[1];                              // gable end, +v
      ctx.beginPath();
      moveTo(ctx, cx, cy, fx, fy, u0, v1, hb);
      lineTo(ctx, cx, cy, fx, fy, mid, v1, ht);
      lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
      ctx.closePath(); ctx.fill();
    }
  }

  /* glass dome / rotunda cap. Silhouette + gradient + meridians: cheaper
     and rounder than stacking rings, and it reads at any zoom. */
  function dome (ctx, cx, cy, fx, fy, u, v, r, h, top, lit) {
    var x = ix(cx, fx, u, v), yb = iy(cy, fy, u, v, 0);
    var rx = r * fx * 0.5, ry = r * fy * 0.5;
    if (rx < 1.5) return;
    ctx.beginPath();
    if (ctx.ellipse) {
      ctx.ellipse(x, yb, rx, h, 0, Math.PI, TAU2);
      ctx.ellipse(x, yb, rx, ry, 0, 0, Math.PI);
    } else {
      ctx.moveTo(x - rx, yb); ctx.lineTo(x, yb - h); ctx.lineTo(x + rx, yb);
      ctx.lineTo(x, yb + ry);
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(x - rx * 0.7, yb - h, x + rx * 0.8, yb + ry);
    g.addColorStop(0, css(mul(top, 1.06)));
    g.addColorStop(0.45, css(top));
    g.addColorStop(1, css(mul(top, 0.62)));
    ctx.fillStyle = g;
    ctx.fill();
    if (rx > 7) {                                        // meridians + a latitude
      ctx.strokeStyle = cssA(mul(top, 1.25), 0.55);
      ctx.lineWidth = Math.max(0.6, rx * 0.035);
      for (var k = -2; k <= 2; k++) {
        var t = k / 2.6;
        ctx.beginPath();
        ctx.moveTo(x, yb - h);
        ctx.quadraticCurveTo(x + rx * t * 1.25, yb - h * 0.42,
          x + rx * t, yb + ry * Math.sqrt(Math.max(0, 1 - t * t)) * 0.85);
        ctx.stroke();
      }
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(x, yb - h * 0.52, rx * 0.84, ry * 0.84 + h * 0.10, 0, 0, TAU2);
      ctx.stroke();
    }
    if (lit) {                                           // sun glint
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(x - rx * 0.34, yb - h * 0.62, rx * 0.26, h * 0.20, -0.5, 0, TAU2);
      ctx.fill();
    }
  }

  /* ---- type -----------------------------------------------------------
     5x7 bitmap, one row per byte, bit 4 leftmost. Big rooftop letters and
     shop fascias are most of what makes the reference read as a city with
     tenants rather than a pile of blocks.                                 */
  var FONT = {
    'A': [14, 17, 17, 31, 17, 17, 17], 'B': [30, 17, 30, 17, 17, 17, 30],
    'C': [14, 17, 16, 16, 16, 17, 14], 'D': [30, 17, 17, 17, 17, 17, 30],
    'E': [31, 16, 30, 16, 16, 16, 31], 'F': [31, 16, 30, 16, 16, 16, 16],
    'G': [14, 17, 16, 23, 17, 17, 15], 'H': [17, 17, 17, 31, 17, 17, 17],
    'I': [14, 4, 4, 4, 4, 4, 14],      'J': [7, 2, 2, 2, 2, 18, 12],
    'K': [17, 18, 20, 24, 20, 18, 17], 'L': [16, 16, 16, 16, 16, 16, 31],
    'M': [17, 27, 21, 21, 17, 17, 17], 'N': [17, 25, 21, 19, 17, 17, 17],
    'O': [14, 17, 17, 17, 17, 17, 14], 'P': [30, 17, 17, 30, 16, 16, 16],
    'Q': [14, 17, 17, 17, 21, 18, 13], 'R': [30, 17, 17, 30, 20, 18, 17],
    'S': [15, 16, 16, 14, 1, 1, 30],   'T': [31, 4, 4, 4, 4, 4, 4],
    'U': [17, 17, 17, 17, 17, 17, 14], 'V': [17, 17, 17, 17, 17, 10, 4],
    'W': [17, 17, 17, 21, 21, 27, 17], 'X': [17, 17, 10, 4, 10, 17, 17],
    'Y': [17, 17, 10, 4, 4, 4, 4],     'Z': [31, 1, 2, 4, 8, 16, 31],
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14],
    '2': [14, 17, 1, 2, 4, 8, 31],     '3': [31, 2, 4, 2, 1, 17, 14],
    '4': [2, 6, 10, 18, 31, 2, 2],     '5': [31, 16, 30, 1, 1, 17, 14],
    '6': [6, 8, 16, 30, 17, 17, 14],   '7': [31, 1, 2, 4, 8, 8, 8],
    '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
    '-': [0, 0, 0, 31, 0, 0, 0],       '.': [0, 0, 0, 0, 0, 12, 12],
    '&': [12, 18, 20, 8, 21, 18, 13],  '+': [0, 4, 4, 31, 4, 4, 0],
    "'": [4, 4, 0, 0, 0, 0, 0],        '/': [1, 2, 2, 4, 8, 8, 16],
    ' ': [0, 0, 0, 0, 0, 0, 0]
  };

  /* merge each glyph into as few rectangles as possible, once, forever.
     [c0, rowFromBottom0, c1, rowFromBottom1] in a 5 x 7 cell box. */
  var GCACHE = {};
  function glyphRects (ch) {
    var got = GCACHE[ch];
    if (got) return got;
    var rows = FONT[ch];
    if (!rows) { GCACHE[ch] = null; return null; }
    var used = [0, 0, 0, 0, 0, 0, 0], out = [], r, c, w, hh, ok, k;
    for (r = 0; r < 7; r++) {
      for (c = 0; c < 5; c++) {
        var bit = 1 << (4 - c);
        if (!(rows[r] & bit) || (used[r] & bit)) continue;
        w = 0;
        while (c + w < 5 && (rows[r] & (1 << (4 - c - w))) && !(used[r] & (1 << (4 - c - w)))) w++;
        hh = 1;
        while (r + hh < 7) {
          ok = true;
          for (k = 0; k < w; k++) {
            var b2 = 1 << (4 - c - k);
            if (!(rows[r + hh] & b2) || (used[r + hh] & b2)) { ok = false; break; }
          }
          if (!ok) break;
          hh++;
        }
        for (var rr = 0; rr < hh; rr++) for (k = 0; k < w; k++) used[r + rr] |= 1 << (4 - c - k);
        out.push([c, 7 - r - hh, c + w, 7 - r]);
      }
    }
    GCACHE[ch] = out;
    return out;
  }

  function textWidth (text) { return text.length * 6 - 1; }   // in glyph cells

  /* Extruded standing letters. dir 0 advances along +u with the faces
     showing on +v; dir 1 advances along +v showing on +u. `size` is the
     cap height in screen px; hb is the height the letters stand on. */
  function text3D (ctx, cx, cy, fx, fy, text, u, v, dir, size, thick, hb, top) {
    var cell = size / 7;
    var pxU = Math.sqrt(fx * fx + fy * fy) * 0.5;
    var cu = cell / pxU;                                  // one cell, in u units
    var F = faces(top), q, i, k, g, rr, a0, a1, h0, h1, n = text.length;
    var RB = _tb, m = 0;                                  // collected boxes
    // +u runs right across the screen but +v runs left, so a line set along v
    // has to advance backwards and mirror, or it comes out reversed. Letters
    // are also emitted far-to-near so they overlap the right way round.
    var sg = dir === 1 ? -1 : 1;
    text = String(text).toUpperCase();
    for (q = 0; q < n; q++) {
      i = dir === 1 ? n - 1 - q : q;
      g = glyphRects(text.charAt(i));
      if (!g) continue;
      var adv = sg * i * 6 * cu;
      for (k = 0; k < g.length; k++) {
        rr = g[k];
        a0 = adv + sg * rr[0] * cu; a1 = adv + sg * rr[2] * cu;
        if (a0 > a1) { var t = a0; a0 = a1; a1 = t; }
        h0 = hb + rr[1] * cell; h1 = hb + rr[3] * cell;
        if (m + 6 > RB.length) continue;
        if (dir === 0) { RB[m] = u + a0; RB[m + 1] = v; RB[m + 2] = u + a1; RB[m + 3] = v + thick; }
        else { RB[m] = u; RB[m + 1] = v + a0; RB[m + 2] = u + thick; RB[m + 3] = v + a1; }
        RB[m + 4] = h0; RB[m + 5] = h1; m += 6;
      }
    }
    // A word is a plate of thin boxes in one plane: its faces never overlap
    // each other, so all the right faces, then all the left, then all the
    // tops can go down as three paths instead of three fills per rectangle.
    for (var f = 0; f < 3; f++) {
      ctx.fillStyle = F[f === 0 ? 2 : (f === 1 ? 1 : 0)];
      ctx.beginPath();
      for (k = 0; k < m; k += 6) {
        var U0 = RB[k], V0 = RB[k + 1], U1 = RB[k + 2], V1 = RB[k + 3];
        var HB = RB[k + 4], HT = RB[k + 5];
        if (f === 0) {
          moveTo(ctx, cx, cy, fx, fy, U1, V0, HT); lineTo(ctx, cx, cy, fx, fy, U1, V1, HT);
          lineTo(ctx, cx, cy, fx, fy, U1, V1, HB); lineTo(ctx, cx, cy, fx, fy, U1, V0, HB);
        } else if (f === 1) {
          moveTo(ctx, cx, cy, fx, fy, U1, V1, HT); lineTo(ctx, cx, cy, fx, fy, U0, V1, HT);
          lineTo(ctx, cx, cy, fx, fy, U0, V1, HB); lineTo(ctx, cx, cy, fx, fy, U1, V1, HB);
        } else {
          moveTo(ctx, cx, cy, fx, fy, U0, V0, HT); lineTo(ctx, cx, cy, fx, fy, U1, V0, HT);
          lineTo(ctx, cx, cy, fx, fy, U1, V1, HT); lineTo(ctx, cx, cy, fx, fy, U0, V1, HT);
        }
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  /* Flat lettering painted on a wall plane (shop fascia, logo board).
     Path-only: set a fill style and call fill() after. */
  function textWall (ctx, cx, cy, fx, fy, side, fixed, text, a0, hBase, cellA, cellH) {
    var i, k, g, rr, sg = side === 1 ? -1 : 1;   // the +u face reads leftward
    text = String(text).toUpperCase();
    for (i = 0; i < text.length; i++) {
      g = glyphRects(text.charAt(i));
      if (!g) continue;
      var adv = a0 + sg * i * 6 * cellA;
      for (k = 0; k < g.length; k++) {
        rr = g[k];
        wallQuad(ctx, cx, cy, fx, fy, side, fixed,
          adv + sg * rr[0] * cellA, adv + sg * rr[2] * cellA,
          hBase + rr[1] * cellH, hBase + rr[3] * cellH);
      }
    }
  }

  /* Flat lettering painted on the ground (or any deck) at height h. */
  function textFlat (ctx, cx, cy, fx, fy, text, u, v, dir, cellU, cellV) {
    var i, k, g, rr, h = arguments.length > 10 ? arguments[10] : 0;
    text = String(text).toUpperCase();
    for (i = 0; i < text.length; i++) {
      g = glyphRects(text.charAt(i));
      if (!g) continue;
      var adv = i * 6 * cellU;
      for (k = 0; k < g.length; k++) {
        rr = g[k];
        var A0 = u + adv + rr[0] * cellU, A1 = u + adv + rr[2] * cellU;
        var B0 = v + rr[1] * cellV, B1 = v + rr[3] * cellV;
        if (dir === 0) {
          moveTo(ctx, cx, cy, fx, fy, A0, B0, h); lineTo(ctx, cx, cy, fx, fy, A1, B0, h);
          lineTo(ctx, cx, cy, fx, fy, A1, B1, h); lineTo(ctx, cx, cy, fx, fy, A0, B1, h);
        } else {
          moveTo(ctx, cx, cy, fx, fy, B0, A0, h); lineTo(ctx, cx, cy, fx, fy, B0, A1, h);
          lineTo(ctx, cx, cy, fx, fy, B1, A1, h); lineTo(ctx, cx, cy, fx, fy, B1, A0, h);
        }
        ctx.closePath();
      }
    }
  }

  MM.gfx = {
    ix: ix, iy: iy, moveTo: moveTo, lineTo: lineTo, flat: flat,
    prism: prism, post: post,
    rectPts: rectPts, chamfPts: chamfPts, elPts: elPts, ringPts: ringPts,
    bandPts: bandPts, arcTo: arcTo, buf: _pb, buf2: _pc,
    extrude: extrude, slab: slab, drum: drum, dome: dome, gable: gable,
    wallQuad: wallQuad, winGrid: winGrid, ribbon: ribbon,
    text3D: text3D, textWall: textWall, textFlat: textFlat,
    glyphRects: glyphRects, textWidth: textWidth,
    hash: hash, clamp: clamp, lerp: lerp, mul: mul, mix: mix,
    setLight: setLight, setSun: setSun, spec: spec,
    css: css, cssA: cssA, raw: raw, faces: faces, night: night,
    PAL: PAL, CARS: CARS, LM: LM, RM: RM
  };
})(window.MM);

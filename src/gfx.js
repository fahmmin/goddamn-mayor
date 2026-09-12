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
  var coverage = null;
  function setCoverage (ctx) { coverage = ctx; }

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
  function prism (ctx, cx, cy, fx, fy, u0, v0, u1, v1, hb, ht, F, material) {
    // right face: the u = u1 edge
    ctx.fillStyle = F[2];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u1, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
    lineTo(ctx, cx, cy, fx, fy, u1, v0, hb);
    ctx.closePath(); ctx.fill();
    if (MM.materials) MM.materials.wall(ctx, ix(cx, fx, u1, v0), iy(cy, fy, u1, v0, hb),
      ix(cx, fx, u1, v1), iy(cy, fy, u1, v1, hb), ht - hb, fx / 32, material == null ? 1 : material);
    // left face: the v = v1 edge
    ctx.fillStyle = F[1];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, hb);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, hb);
    ctx.closePath(); ctx.fill();
    if (MM.materials) MM.materials.wall(ctx, ix(cx, fx, u1, v1), iy(cy, fy, u1, v1, hb),
      ix(cx, fx, u0, v1), iy(cy, fy, u0, v1, hb), ht - hb, fx / 32, material == null ? 1 : material);
    // top
    ctx.fillStyle = F[0];
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, u0, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v0, ht);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, ht);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, ht);
    ctx.closePath(); ctx.fill();
    if (coverage && ht > 5 * fx / 32) {
      var g = coverage;
      g.beginPath();
      moveTo(g, cx, cy, fx, fy, u0, v0, ht);
      lineTo(g, cx, cy, fx, fy, u1, v0, ht);
      lineTo(g, cx, cy, fx, fy, u1, v0, hb);
      lineTo(g, cx, cy, fx, fy, u1, v1, hb);
      lineTo(g, cx, cy, fx, fy, u0, v1, hb);
      lineTo(g, cx, cy, fx, fy, u0, v1, ht);
      g.closePath(); g.fill();
    }
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
  var _lightRev = 0;
  function setLight (rm, gm, bm, night) {
    if (rm !== _rm || gm !== _gm || bm !== _bm) _lightRev++;
    _rm = rm; _gm = gm; _bm = bm; _night = night || 0;
  }
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
  /* A roof faces the whole sky and the sun; a wall sees a slice of one and
     grazes the other. With the roof at 1.06 and the sunward wall at 1.08 the
     two came out the same value, which is what flattened a block into a
     silhouette - three faces, two tones. Keep them a clear step apart. */
  var _su = 0.10, _sv = 1, _sgain = 0.18, _sroof = 0.05;
  function setSun (u, v, gain, roof) {
    var m = Math.sqrt(u * u + v * v) || 1;
    _su = u / m; _sv = v / m;
    if (gain !== undefined) _sgain = gain;
    if (roof !== undefined) _sroof = roof;
  }
  /* Where a shadow lands on the ground, and how dark.

     The sun sits screen-upper-left, so a shadow falls down and to the right -
     towards the camera, which is the only place an isometric shadow can be
     seen at all. `len` is the ground reach per pixel of drawn height; `x, y`
     is the unit direction it reaches in. render.js casts the building
     silhouettes and props.js the trees, and both read this, so a tree and the
     block behind it agree about where the sun is.

     Baked at noon like the rest of the static cache: a long dawn shadow under
     a midday facade reads as a bug. */
  var CAST = {
    x: 0.75, y: 0.66, len: 0.76,
    tint: 'rgba(38,46,74,0.40)',           // the long throw - cool, sky-lit
    foot: 'rgba(28,36,62,0.58)'            // the contact seam at the wall
  };

  /* nu, nv must be a unit face normal in tile space */
  function spec (nu, nv) {
    var d = nu * _su + nv * _sv;
    return d <= 0 ? 0 : _sgain * d * d * d;
  }

  /* ---- the colour of the light, per face ------------------------------
     Value alone is not what makes a lit face read as lit. A roof square to
     the sun takes the sun's colour and goes warm; a wall turned away from it
     is lit by the sky alone and goes blue. Grading the three faces apart
     chromatically as well as in value is most of the difference between a
     flat palette and something that looks lit - and it costs nothing, since
     these multipliers fold into the same one that css() already applies.

     Indexed the way every face triple in the codebase is: top, +v (left,
     towards the sun), +u (right, turned away). */
  var FL = [
    [1.050, 1.018, 0.940],                   // top: full sun
    [1.020, 1.004, 0.982],                   // +v: grazing sun
    [0.938, 0.972, 1.082]                    // +u: sky only
  ];
  function lit (c, k, f) {
    var m = FL[f];
    return [c[0] * k * m[0], c[1] * k * m[1], c[2] * k * m[2]];
  }

  /* face triple from one top colour: [top, left, right] */
  var LM = 0.74, RM = 0.63;                  // daylight ambient occlusion
  function faces (top) {
    return [css(lit(top, 1 + _sroof, 0)),
      css(lit(top, LM + spec(0, 1), 1)),
      css(lit(top, RM + spec(1, 0), 2))];
  }

  /* ---- daylight diorama palette --------------------------------------
     Bright, saturated, model-village. Buildings are pale; the ground reads
     as dark asphalt and vivid lawn so the whole thing pops. */
  var PAL = {
    grass:     [116, 148, 72],
    grassDark: [ 76, 109, 52],
    lot:       [176, 178, 168],
    lotEdge:   [150, 154, 146],
    asphalt:   [ 66,  70,  69],
    asphaltLo: [ 49,  55,  53],
    curb:      [186, 188, 184],
    paint:     [244, 244, 238],
    paintYel:  [240, 198,  72],
    plaza:     [206, 202, 190],
    waterA:    [ 57, 120, 137],
    waterB:    [ 34,  89, 111],
    treeA:     [ 63, 111,  52],
    treeB:     [ 94, 139,  61],
    treeC:     [ 40,  88,  52],
    trunk:     [111,  84,  58],
    shade:     [ 30,  40,  52],
    concrete:  [222, 220, 212],
    concreteB: [200, 198, 190],
    steel:     [176, 182, 190],
    glass:     [106, 146, 156],
    glassDark: [ 55,  88, 103],
    solar:     [ 44,  58,  92],
    solarLit:  [ 92, 130, 180],
    white:     [246, 246, 242],
    roofGrey:  [188, 190, 186],
    /* --- block-scale palette: materials the archetypes in lots.js use --- */
    brickA:    [171, 119,  91],   brickB:    [145,  92,  72],
    brickC:    [194, 156, 116],   stucco:    [224, 212, 185],
    sand:      [226, 208, 170],   bone:      [242, 240, 232],
    teal:      [ 96, 176, 176],   sage:      [166, 194, 158],
    terracot:  [212, 124,  86],   plum:      [150, 108, 148],
    glassG:    [115, 157, 147],   glassB:    [ 93, 141, 163],
    mullion:   [206, 210, 212],   spandrel:  [ 92, 118, 138],
    metalA:    [206, 210, 214],   metalB:    [162, 168, 176],
    parkLot:   [ 86,  90,  96],   stall:     [232, 232, 224],
    hedge:     [ 69, 108,  51],   planter:   [148, 116,  92],
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
      if (MM.materials) MM.materials.wall(ctx,
        ix(cx, fx, b[e * 2], b[e * 2 + 1]), iy(cy, fy, b[e * 2], b[e * 2 + 1], hb),
        ix(cx, fx, b[f * 2], b[f * 2 + 1]), iy(cy, fy, b[f * 2], b[f * 2 + 1], hb),
        ht - hb, fx / 32, top[0] > top[2] * 1.2 && top[0] < 218 ? 0 : 1);
      if (coverage && ht > 5 * fx / 32) {
        coverage.beginPath();
        moveTo(coverage, cx, cy, fx, fy, b[e * 2], b[e * 2 + 1], ht);
        lineTo(coverage, cx, cy, fx, fy, b[f * 2], b[f * 2 + 1], ht);
        lineTo(coverage, cx, cy, fx, fy, b[f * 2], b[f * 2 + 1], hb);
        lineTo(coverage, cx, cy, fx, fy, b[e * 2], b[e * 2 + 1], hb);
        coverage.closePath(); coverage.fill();
      }
    }
    ctx.fillStyle = ctx.strokeStyle = css(mul(top, 1 + _sroof));
    ctx.beginPath();
    moveTo(ctx, cx, cy, fx, fy, b[0], b[1], ht);
    for (i = 1; i < n; i++) lineTo(ctx, cx, cy, fx, fy, b[i * 2], b[i * 2 + 1], ht);
    ctx.closePath();
    ctx.fill();
    if (seam) { ctx.lineWidth = 0.7; ctx.stroke(); }
    if (coverage && ht > 5 * fx / 32) {
      coverage.beginPath(); moveTo(coverage, cx, cy, fx, fy, b[0], b[1], ht);
      for (i = 1; i < n; i++) lineTo(coverage, cx, cy, fx, fy, b[i * 2], b[i * 2 + 1], ht);
      coverage.closePath(); coverage.fill();
    }
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

  /* ---- vehicles -------------------------------------------------------
     A car is two boxes and a greenhouse: a long low chassis, a shorter cabin
     set back from the nose, and that cabin's sides drawn in glass rather than
     paint. The glass is what does the work - a single box in body colour
     reads as a crate whatever you do to its proportions, and the moment the
     upper half goes dark the same silhouette reads as a car seen from above.

     Traffic only ever runs on the four cardinal directions, so both boxes are
     axis aligned and prism() can do the shading. That is what keeps this
     cheap enough for every vehicle on the map, every frame.

     (au, av) is the heading in tile space - one of them is 0 and the other
     +/-1. Plan dimensions are in the same half-tile (u,v) units the buildings
     use; heights are in px at scale 1, so the caller scales by fx/32.

     What makes or breaks it is the ratio: the cabin has to be clearly shorter
     and narrower than the chassis, so that bonnet and boot both show. Sized
     anywhere near the chassis it stops being a greenhouse and the pair read
     as two slabs stacked on a kerb.                                         */
  var VEH = {
    /* halfLen  halfWid  sill  waist  roof  cabinBack  cabinNose  cabinInset */
    sedan: [0.36, 0.160, 0.5, 4.8, 7.1, -0.23, 0.06, 0.046],
    van:   [0.38, 0.175, 0.5, 4.6, 9.0, -0.30, 0.20, 0.030],
    bus:   [0.56, 0.185, 0.6, 3.4, 9.8, -0.50, 0.49, 0.014],
    // a rail car: longer than a bus, and almost all of it is glass
    train: [0.62, 0.175, 1.4, 3.0, 10.4, -0.56, 0.56, 0.012]
  };

  /* The liveries, built once per light change and shared by the traffic in
     render.js and the parked cars in props.js - so a given car is the same
     car whether it happens to be moving. paint[i] is the body, glass[i] the
     cabin: the body colour dragged most of the way to dark glass, which
     keeps a red car's greenhouse faintly red instead of uniformly grey. */
  var _vrev = -1, _paint = null, _glass = null, _tire = null;
  function carPaint () {
    if (_vrev !== _lightRev) {
      _vrev = _lightRev;
      _paint = []; _glass = [];
      for (var i = 0; i < CARS.length; i++) {
        _paint.push(faces(CARS[i]));
        _glass.push(faces(mix(CARS[i], PAL.glassDark, 0.74)));
      }
      _tire = css(mul(PAL.shade, 1.25));
    }
    return { paint: _paint, glass: _glass, tire: _tire };
  }

  /* F is the body's faces() triple, Gl the cabin's (glass down the sides,
     body colour on the roof); tire is a flat css colour, p = fx / 32. */
  function car (ctx, cx, cy, fx, fy, au, av, K, F, Gl, tire, p) {
    var hl = K[0], hw = K[1];
    var sill = K[2] * p, waist = K[3] * p, roof = K[4] * p;
    var along = au !== 0, s = along ? au : av;
    var cb = K[5] * s, cn = K[6] * s;
    var c0 = cb < cn ? cb : cn, c1 = cb < cn ? cn : cb;

    /* the running gear: one dark pad under the body. Four separate wheels at
       six pixels a car is four fills spent on two pixels of tyre. */
    ctx.fillStyle = tire;
    ctx.beginPath();
    quad(ctx, cx, cy, fx, fy, along, -hl * 0.96, -hw * 0.82, hl * 0.96, hw * 0.82, sill);
    ctx.fill();

    vbox(ctx, cx, cy, fx, fy, along, -hl, hl, hw, sill, waist, F);
    vbox(ctx, cx, cy, fx, fy, along, c0, c1, hw - K[7], waist, roof, Gl);
  }

  /* one axis-aligned quad in the vehicle's own frame, a = along, b = across */
  function quad (ctx, cx, cy, fx, fy, along, a0, b0, a1, b1, h) {
    var u0 = along ? a0 : b0, v0 = along ? b0 : a0;
    var u1 = along ? a1 : b1, v1 = along ? b1 : a1;
    moveTo(ctx, cx, cy, fx, fy, u0, v0, h);
    lineTo(ctx, cx, cy, fx, fy, u1, v0, h);
    lineTo(ctx, cx, cy, fx, fy, u1, v1, h);
    lineTo(ctx, cx, cy, fx, fy, u0, v1, h);
    ctx.closePath();
  }

  function vbox (ctx, cx, cy, fx, fy, along, a0, a1, hw, hb, ht, F) {
    if (along) prism(ctx, cx, cy, fx, fy, a0, -hw, a1, hw, hb, ht, F, 0);
    else prism(ctx, cx, cy, fx, fy, -hw, a0, hw, a1, hb, ht, F, 0);
  }

  MM.gfx = {
    ix: ix, iy: iy, moveTo: moveTo, lineTo: lineTo, flat: flat,
    car: car, VEH: VEH, carPaint: carPaint,
    prism: prism, post: post,
    rectPts: rectPts, chamfPts: chamfPts, elPts: elPts, ringPts: ringPts,
    bandPts: bandPts, arcTo: arcTo, buf: _pb, buf2: _pc,
    extrude: extrude, slab: slab, drum: drum, dome: dome, gable: gable,
    wallQuad: wallQuad, winGrid: winGrid, ribbon: ribbon,
    text3D: text3D, textWall: textWall, textFlat: textFlat,
    glyphRects: glyphRects, textWidth: textWidth,
    hash: hash, clamp: clamp, lerp: lerp, mul: mul, mix: mix,
    setLight: setLight, setSun: setSun, setCoverage: setCoverage, spec: spec, CAST: CAST, FL: FL,
    css: css, cssA: cssA, raw: raw, faces: faces, night: night,
    PAL: PAL, CARS: CARS, LM: LM, RM: RM
  };
})(window.MM);

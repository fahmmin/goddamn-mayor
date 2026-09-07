/* src/landmarks.js - hero structures.

   A landmark is the one building on the map that is allowed to break the
   height rules, so it does not belong in the lots.js archetype table with the
   offices and the brownstones. lots.js hands a lot here when its archetype is
   'hero'; everything below draws on the public MM.gfx API with its own frame,
   so none of lots.js's private drawing state is needed.

   Placement is by MM.lots.pin, the same mechanism the airport, stadium and
   marina already use, and like those it is set by the city plan in demo.js -
   never auto-placed, or a tower the player built would silently turn into a
   monument.

   gfx tile space: one tile = 2 units, so a w x h lot spans
       u = -2(w-1)-1 .. 1,  v = -2(h-1)-1 .. 1
   relative to its anchor (max corner). Heights are screen px.             */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx, PAL = G.PAL;
  var hash = G.hash, css = G.css, faces = G.faces, mul = G.mul, mix = G.mix;
  var UNIT = 15;                       // one storey in px at scale 1, as lots.js

  /* wrought iron: warmer and darker than the steel the bridges use */
  var IRON = mix(PAL.metalA, PAL.trunk, 0.38);

  /* ------------------------------------------------------------------ *
   * kit
   * ------------------------------------------------------------------ */

  /* A leg that leans inward as it rises. gfx.extrude takes one footprint from
     hb to ht, so it draws prisms, never frusta - a taper has to be stacked out
     of short segments whose centre and width both interpolate. */
  function leg (ctx, F, su, sv, eu, ev, r0, r1, h0, h1, segs, col) {
    var k, t0, t1, cu, cv, r, hA, hB;
    for (k = 0; k < segs; k++) {
      t0 = k / segs; t1 = (k + 1) / segs;
      cu = su + (eu - su) * t0; cv = sv + (ev - sv) * t0;
      r = r0 + (r1 - r0) * t0;
      hA = h0 + (h1 - h0) * t0;
      hB = h0 + (h1 - h0) * t1;
      // overlap each segment into the next so the stack has no hairline seams
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - r, cv - r, cu + r, cv + r,
        hA, hB + (h1 - h0) / segs * 0.35, faces(col));
    }
  }

  /* Cross-bracing between the legs at two corners, following their lean. The
     legs converge on the stage top, not on the tower's centre line, so the
     spread has to be interpolated the same way the legs are - bracing to the
     centre splays the lattice into a cone. */
  function brace (ctx, F, ca, cb, s0, s1, h0, h1, rows, col, w) {
    var k, t0, t1, sA, sB, hA, hB;
    ctx.strokeStyle = css(col);
    ctx.lineWidth = w;
    ctx.beginPath();
    for (k = 0; k < rows; k++) {
      t0 = k / rows; t1 = (k + 1) / rows;
      sA = s0 + (s1 - s0) * t0; sB = s0 + (s1 - s0) * t1;
      hA = h0 + (h1 - h0) * t0; hB = h0 + (h1 - h0) * t1;
      pt(ctx, F, ca, sA, hA, 1); pt(ctx, F, cb, sB, hB, 0);
      pt(ctx, F, cb, sA, hA, 1); pt(ctx, F, ca, sB, hB, 0);
    }
    ctx.stroke();
  }

  /* move/line to the point on corner `c` at spread `s` and height `h` */
  function pt (ctx, F, c, s, h, move) {
    var u = F.cu + c[0] * s, v = F.cv + c[1] * s;
    var x = G.ix(F.cx, F.fx, u, v), y = G.iy(F.cy, F.fy, u, v, h);
    if (move) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }

  /* observation deck: a slab that oversails its stage, plus a parapet */
  function deck (ctx, F, r, h, t, col) {
    var u = F.cu, v = F.cv;
    var b = G.buf, n = G.rectPts(b, u - r, v - r, u + r, v + r);
    G.slab(ctx, F.cx, F.cy, F.fx, F.fy, b, n, h, css(mul(col, 1.10)));
    G.prism(ctx, F.cx, F.cy, F.fx, F.fy, u - r, v - r, u + r, v + r,
      h, h + t, faces(mul(col, 0.92)));
    n = G.rectPts(b, u - r * 0.86, v - r * 0.86, u + r * 0.86, v + r * 0.86);
    G.slab(ctx, F.cx, F.cy, F.fx, F.fy, b, n, h + t * 0.92, css(PAL.roofGrey));
  }

  /* ------------------------------------------------------------------ *
   * the tower
   * ------------------------------------------------------------------ */

  /* Corner signs, far first: the near legs must paint over the far ones, and
     inside a single lot there is no diagonal sweep to lean on. */
  var CORN = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  function tower (ctx, F) {
    var st = F.st, sc = F.sc, col = IRON, sp = F.span;
    var cu = F.cu, cv = F.cv, i;

    /* the esplanade it stands on */
    var b = G.buf2, n = G.rectPts(b, F.u0 + 0.12, F.v0 + 0.12, F.u1 - 0.12, F.v1 - 0.12);
    G.slab(ctx, F.cx, F.cy, F.fx, F.fy, b, n, 0, css(PAL.plaza));

    var total = F.top;
    var H1 = total * 0.30, H2 = total * 0.62, H3 = total * 0.87;
    // Spreads, as a fraction of the lot. A lattice leg is slender: at the
    // first pass these were 0.085 of a 6-unit lot, i.e. half a tile thick,
    // and the tower read as an oil rig.
    var s0 = sp * 0.28, s1 = sp * 0.100, s2 = sp * 0.044;
    var r0 = sp * 0.028, r1 = sp * 0.017, r2 = sp * 0.011;
    var segs = sc > 0.8 ? 10 : 6;
    var lw = Math.max(0.5, 0.8 * sc), bc = mul(col, 0.80);

    /* stage 1: four splayed feet leaning in to the first platform */
    for (i = 0; i < 4; i++) {
      leg(ctx, F, cu + CORN[i][0] * s0, cv + CORN[i][1] * s0,
        cu + CORN[i][0] * s1, cv + CORN[i][1] * s1, r0, r1, 0, H1, segs, col);
    }
    if (sc > 0.45) {
      brace(ctx, F, CORN[3], CORN[1], s0, s1, 0, H1, 4, bc, lw);   // +u face
      brace(ctx, F, CORN[3], CORN[2], s0, s1, 0, H1, 4, bc, lw);   // +v face
      /* the arch under the first platform - the tower's signature */
      ctx.strokeStyle = css(mul(col, 0.88));
      ctx.lineWidth = Math.max(0.8, 1.8 * sc);
      var ah = H1 * 0.46;
      for (i = 0; i < 2; i++) {
        var ca = CORN[3], cb = i ? CORN[1] : CORN[2];
        var ax = G.ix(F.cx, F.fx, cu + ca[0] * s0, cv + ca[1] * s0);
        var ay = G.iy(F.cy, F.fy, cu + ca[0] * s0, cv + ca[1] * s0, ah * 0.22);
        var bx = G.ix(F.cx, F.fx, cu + cb[0] * s0, cv + cb[1] * s0);
        var by = G.iy(F.cy, F.fy, cu + cb[0] * s0, cv + cb[1] * s0, ah * 0.22);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) * 0.5, (ay + by) * 0.5 - ah, bx, by);
        ctx.stroke();
      }
    }
    deck(ctx, F, s1 * 1.7, H1, Math.max(1.2, st * 0.14), col);

    /* stage 2 */
    for (i = 0; i < 4; i++) {
      leg(ctx, F, cu + CORN[i][0] * s1, cv + CORN[i][1] * s1,
        cu + CORN[i][0] * s2, cv + CORN[i][1] * s2, r1, r2, H1, H2, segs, col);
    }
    if (sc > 0.55) {
      brace(ctx, F, CORN[3], CORN[1], s1, s2, H1, H2, 4, bc, lw * 0.8);
      brace(ctx, F, CORN[3], CORN[2], s1, s2, H1, H2, 4, bc, lw * 0.8);
    }
    deck(ctx, F, s2 * 1.9, H2, Math.max(1, st * 0.11), col);

    /* stage 3: a single tapering shaft to the lantern */
    G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, s2 * 0.95, H2, H3, mul(col, 1.04), 8);
    deck(ctx, F, s2 * 1.3, H3, Math.max(1, st * 0.09), col);

    /* lantern and mast */
    G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, s2 * 0.70, H3, H3 + st * 0.6, PAL.bone, 8);
    G.post(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, s2 * 0.26,
      H3 + st * 0.6, total, faces(PAL.steel));

    /* the beacon is a light source, so it must not take the ambient tint */
    if (sc > 0.5) {
      var bx2 = G.ix(F.cx, F.fx, cu, cv), by2 = G.iy(F.cy, F.fy, cu, cv, total);
      var nn = G.night ? G.night() : 0;
      ctx.fillStyle = 'rgba(255,72,64,' + (0.45 + 0.5 * nn).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(bx2, by2, Math.max(1.4, 2.2 * sc), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var ARCH = { hero: tower };

  /* ------------------------------------------------------------------ *
   * entry point - called from lots.js draw() for a 'hero' lot
   * ------------------------------------------------------------------ */

  function draw (ctx, o, L, Q) {
    var fn = ARCH[L.arch];
    if (!fn) return;
    var sc = o.scale;
    var u0 = -2 * (L.w - 1) - 1, v0 = -2 * (L.h - 1) - 1;
    var F = {
      ctx: ctx, cx: o.cx, cy: o.cy, fx: o.fx, fy: o.fy, sc: sc,
      st: UNIT * sc,
      u0: u0, v0: v0, u1: 1, v1: 1,
      cu: (u0 + 1) * 0.5, cv: (v0 + 1) * 0.5,
      span: Math.min(1 - u0, 1 - v0),
      // Take the height straight from lots.shape, so the landmark, the window
      // lights in render.js and the water reflections in light.js all agree
      // about how tall it is. shape() reports scale-1 px, hence the * sc.
      top: (MM.lots && MM.lots.shape
        ? ((MM.lots.shape(o.s, o.x, o.y) || {}).top || UNIT * 30)
        : UNIT * 30) * sc
    };
    fn(ctx, F);
  }

  MM.landmarks = { draw: draw, ARCH: ARCH };
})(window.MM);

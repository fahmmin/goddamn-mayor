/* src/landmarks.js - hero structures.

   A landmark is the one building on the map that is allowed to break the
   height rules, so it does not belong in the lots.js archetype table with the
   offices and the brownstones. lots.js hands a lot here when its archetype is
   a landmark archetype; everything below draws on the public MM.gfx API with
   its own frame,
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

  /* ------------------------------------------------------------------ *
   * more wonders
   *
   * Each one gets the same frame the tower does and draws through the same
   * public gfx kit, so adding one is adding a function and a name - no new
   * private state, and nothing in lots.js to teach.
   * ------------------------------------------------------------------ */

  /* the paved ground a monument stands on, inset from the lot edge */
  function plinth (ctx, F, col, inset) {
    inset = inset === undefined ? 0.12 : inset;
    var b = G.buf2, n = G.rectPts(b, F.u0 + inset, F.v0 + inset, F.u1 - inset, F.v1 - inset);
    G.slab(ctx, F.cx, F.cy, F.fx, F.fy, b, n, 0, css(col));
  }

  /* A disc lying in a wall plane - clock faces, rose windows. gfx has no
     helper for this because nothing else needs one: a circle on a vertical
     face projects to a sheared ellipse, and walking it as a polygon in
     (u, v, h) lets the shared projection do that shear for free.
     side 0 = the v = fixed face, side 1 = the u = fixed face. */
  function wallDisc (ctx, F, side, fixed, a, h, r, rp, col, seg) {
    var k, th, aa, hh;
    ctx.fillStyle = css(col);
    ctx.beginPath();
    for (k = 0; k < seg; k++) {
      th = k / seg * Math.PI * 2;
      aa = a + Math.cos(th) * r; hh = h + Math.sin(th) * rp;
      if (side === 0) (k ? G.lineTo : G.moveTo)(ctx, F.cx, F.cy, F.fx, F.fy, aa, fixed, hh);
      else (k ? G.lineTo : G.moveTo)(ctx, F.cx, F.cy, F.fx, F.fy, fixed, aa, hh);
    }
    ctx.closePath(); ctx.fill();
  }

  /* ---- the great pyramid ---------------------------------------------
     A true smooth-sided pyramid needs a frustum, and gfx extrudes prisms.
     Stepping it is not a workaround: the mastaba courses are what make the
     thing read as cut stone at forty pixels rather than as a grey cone. */
  function pyramid (ctx, F) {
    var n = F.sc > 0.6 ? 14 : 8, i, t0, t1, r, col = PAL.sand;
    var base = F.span * 0.46, t = F.top;
    plinth(ctx, F, PAL.dirt, 0.08);
    for (i = 0; i < n; i++) {
      t0 = i / n; t1 = (i + 1) / n;
      r = base * (1 - t0 * 0.95);
      // overlap into the course above, or the steps show a hairline of sky
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, F.cu - r, F.cv - r, F.cu + r, F.cv + r,
        t * t0, t * t1 + t / n * 0.3, faces(i & 1 ? col : mul(col, 0.965)));
    }
    // the capstone catches the sun the rest of the limestone has lost
    r = base * 0.06;
    G.prism(ctx, F.cx, F.cy, F.fx, F.fy, F.cu - r, F.cv - r, F.cu + r, F.cv + r,
      t * 0.98, t * 1.03, faces(mix(PAL.sand, PAL.white, 0.5)));
  }

  /* ---- the triumphal arch --------------------------------------------
     Two piers and an attic. The opening is the gap between the piers, not a
     hole cut in a wall - at this scale you would never see through a hole,
     and two solids read as an arch where one solid with a notch does not. */
  function arcde (ctx, F) {
    var sp = F.span, t = F.top, cu = F.cu, cv = F.cv;
    var pw = sp * 0.13, gap = sp * 0.21, hP = t * 0.74;
    var stone = PAL.bone, trim = mul(PAL.sand, 0.98);
    plinth(ctx, F, PAL.plaza, 0.10);
    // far pier first: inside one lot there is no diagonal sweep to order them
    var k, cvv;
    for (k = 0; k < 2; k++) {
      cvv = cv + (k ? gap : -gap);
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - pw, cvv - pw, cu + pw, cvv + pw,
        0, hP, faces(stone));
      // cornice band, so the piers do not read as two plain posts
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - pw * 1.18, cvv - pw * 1.18,
        cu + pw * 1.18, cvv + pw * 1.18, hP * 0.93, hP, faces(trim));
    }
    // the attic spans both piers and is what turns them into one monument
    G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - pw * 1.1, cv - gap - pw * 1.1,
      cu + pw * 1.1, cv + gap + pw * 1.1, hP, t * 0.95, faces(stone));
    G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - pw * 1.25, cv - gap - pw * 1.25,
      cu + pw * 1.25, cv + gap + pw * 1.25, t * 0.95, t, faces(trim));
    // No vault disc: the gap between the piers already is the opening, and a
    // disc drawn on the near pier just reads as a porthole punched in stone.
  }

  /* ---- the clock tower ------------------------------------------------ */
  function clock (ctx, F) {
    var sp = F.span, t = F.top, cu = F.cu, cv = F.cv, i;
    var r = sp * 0.19, stone = mix(PAL.sand, PAL.stucco, 0.4);
    var hS = t * 0.66, hB = t * 0.82;
    plinth(ctx, F, PAL.plaza, 0.14);
    /* The shaft, as courses of one single width. A band set proud of the shaft
       shows its own top face, and in this projection a top face is the lit
       one - so every course came out a bright diamond and the tower read as a
       stack of shelves. The courses have to be colour, not relief. */
    var courses = F.sc > 0.5 ? 8 : 4;
    for (i = 0; i < courses; i++) {
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - r, cv - r, cu + r, cv + r,
        hS * (i / courses), hS * ((i + 1) / courses) + 0.4,
        faces(i & 1 ? mul(stone, 0.955) : stone));
    }
    // The clock, on both faces you can see. Two plain pale discs read as a
    // pair of eyes, so each dial is small and sunk in a dark surround.
    if (F.sc > 0.4) {
      var cy2 = hS * 0.86, cr = r * 0.40, cp = F.st * 0.34;
      wallDisc(ctx, F, 1, cu + r, cv, cy2, cr * 1.34, cp * 1.34, mul(stone, 0.62), 16);
      wallDisc(ctx, F, 0, cv + r, cu, cy2, cr * 1.34, cp * 1.34, mul(stone, 0.58), 16);
      wallDisc(ctx, F, 1, cu + r, cv, cy2, cr, cp, PAL.bone, 16);
      wallDisc(ctx, F, 0, cv + r, cu, cy2, cr, cp, mul(PAL.bone, 0.96), 16);
      wallDisc(ctx, F, 1, cu + r, cv, cy2, cr * 0.20, cp * 0.20, PAL.signDark, 8);
      wallDisc(ctx, F, 0, cv + r, cu, cy2, cr * 0.20, cp * 0.20, PAL.signDark, 8);
    }
    // belfry, then the spire: a stack of shrinking courses to a finial
    G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - r * 1.12, cv - r * 1.12,
      cu + r * 1.12, cv + r * 1.12, hS, hB, faces(mul(stone, 0.97)));
    var n = F.sc > 0.6 ? 9 : 5, t0, t1, rr;
    for (i = 0; i < n; i++) {
      t0 = i / n; t1 = (i + 1) / n;
      rr = r * 1.12 * (1 - t0 * 0.92);
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - rr, cv - rr, cu + rr, cv + rr,
        hB + (t - hB) * t0, hB + (t - hB) * t1 + 0.4, faces(mul(PAL.teal, 0.86)));
    }
  }

  /* ---- the pagoda -----------------------------------------------------
     Five tiers, each a vermilion body under an eave that oversails it. The
     oversail is the whole silhouette: bodies alone stack into a ziggurat. */
  function pagoda (ctx, F) {
    var sp = F.span, t = F.top, cu = F.cu, cv = F.cv, i;
    var tiers = 5, body = [178, 72, 60], roof = mix(PAL.roofDark, PAL.teal, 0.30);
    var b = G.buf2, n;
    plinth(ctx, F, PAL.plaza, 0.12);
    for (i = 0; i < tiers; i++) {
      var t0 = i / tiers, t1 = (i + 1) / tiers;
      var r = sp * 0.20 * (1 - t0 * 0.52);
      var h0 = t * t0, h1 = t * (t0 + (t1 - t0) * 0.62);
      G.prism(ctx, F.cx, F.cy, F.fx, F.fy, cu - r, cv - r, cu + r, cv + r,
        h0, h1, faces(i & 1 ? body : mul(body, 1.06)));
      // the eave: a chamfered slab with a lip, oversailing the body it covers
      var e = r * 1.62;
      n = G.chamfPts(b, cu - e, cv - e, cu + e, cv + e, e * 0.30);
      G.extrude(ctx, F.cx, F.cy, F.fx, F.fy, b, n, h1, h1 + F.st * 0.16, roof, 1);
      n = G.chamfPts(b, cu - e * 0.72, cv - e * 0.72, cu + e * 0.72, cv + e * 0.72, e * 0.22);
      G.slab(ctx, F.cx, F.cy, F.fx, F.fy, b, n,
        h1 + F.st * 0.30, css(mul(roof, 1.12)));
    }
    G.post(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, sp * 0.022,
      t * 0.94, t * 1.10, faces(mix(PAL.signYel, PAL.sand, 0.35)));
  }

  /* ---- the arena ------------------------------------------------------
     An outer drum of arcaded stone, the seating stepping down inside it, and
     sand on the floor. Drawn outside in, so the near wall paints last and
     you are looking into a bowl rather than at a ring. */
  function arena (ctx, F) {
    var sp = F.span, t = F.top, cu = F.cu, cv = F.cv, i;
    var stone = mix(PAL.sand, PAL.concrete, 0.35);
    var r = sp * 0.44, seg = F.sc > 0.6 ? 20 : 12;
    plinth(ctx, F, PAL.plaza, 0.06);
    G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, r, 0, t, stone, seg);
    // two string courses mark the arcade tiers a real facade would have
    for (i = 1; i < 3; i++) {
      G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, r * 1.03,
        t * (i / 3), t * (i / 3) + F.st * 0.10, mul(stone, 0.93), seg);
    }
    /* The bowl, as concentric drums each shorter than the last. gfx.drum caps
       its top, so one outer wall on its own is a tub: what turns it into an
       amphitheatre is the rings inside it, drawn after and stepping down, each
       cap reading as a tier of seating. Sand last, at the bottom. */
    var TIER = [[0.86, 0.80], [0.71, 0.60], [0.57, 0.40], [0.44, 0.22]];
    for (i = 0; i < TIER.length; i++) {
      G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, r * TIER[i][0], 0, t * TIER[i][1],
        mul(stone, 0.94 - i * 0.045), seg);
    }
    G.drum(ctx, F.cx, F.cy, F.fx, F.fy, cu, cv, r * 0.34, 0, t * 0.10,
      mix(PAL.sand, PAL.dirt, 0.45), seg);
  }

  var ARCH = {
    hero: tower, pyramid: pyramid, arcde: arcde,
    clock: clock, pagoda: pagoda, arena: arena
  };

  /* ------------------------------------------------------------------ *
   * entry point - called from lots.js draw() for any lot whose archetype
   * this module claims
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

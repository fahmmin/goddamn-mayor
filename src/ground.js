/* Ground plane: roads, empty lots, building aprons, water, parks.
   Owned by the ground artist. Everything draws flat at height 0; buildings
   land on top afterwards.

   All geometry is expressed in gfx tile space: u runs -1..1 toward +x,
   v runs -1..1 toward +y, so a tile is the square |u|<=1, |v|<=1 and
   nothing here ever leaves it. Deterministic - MM.gfx.hash only. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.gfx, P = G.PAL, T = MM.TILE || {};
  var hash = G.hash, css = G.css, mix = G.mix;

  /* mask bit d -> neighbour offset, and the tile-space unit vector of dir d */
  var DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  var DU = [1, -1, 0, 0], DV = [0, 0, 1, -1];
  /* which half of the carriageway a stop bar sits on, rotationally consistent */
  var SB = [1, -1, -1, 1];
  /* three points along a quarter arc, as (alongA, alongB) weights */
  var ARC = [0.076, 0.617, 0.293, 0.293, 0.617, 0.076];

  /* ---- tile-space primitives ------------------------------------------
     These add a closed sub-path only - no beginPath, no fill - so a caller
     can batch several shapes of one colour into a single fill().          */

  function rect (ctx, o, u0, v0, u1, v1) {
    var t;
    if (u0 > u1) { t = u0; u0 = u1; u1 = t; }
    if (v0 > v1) { t = v0; v0 = v1; v1 = t; }
    var cx = o.cx, cy = o.cy, hx = o.fx * 0.5, hy = o.fy * 0.5;
    ctx.moveTo(cx + (u0 - v0) * hx, cy + (u0 + v0) * hy);
    ctx.lineTo(cx + (u1 - v0) * hx, cy + (u1 + v0) * hy);
    ctx.lineTo(cx + (u1 - v1) * hx, cy + (u1 + v1) * hy);
    ctx.lineTo(cx + (u0 - v1) * hx, cy + (u0 + v1) * hy);
    ctx.closePath();
  }

  function quad (ctx, o, u0, v0, u1, v1, u2, v2, u3, v3) {
    var cx = o.cx, cy = o.cy, hx = o.fx * 0.5, hy = o.fy * 0.5;
    ctx.moveTo(cx + (u0 - v0) * hx, cy + (u0 + v0) * hy);
    ctx.lineTo(cx + (u1 - v1) * hx, cy + (u1 + v1) * hy);
    ctx.lineTo(cx + (u2 - v2) * hx, cy + (u2 + v2) * hy);
    ctx.lineTo(cx + (u3 - v3) * hx, cy + (u3 + v3) * hy);
    ctx.closePath();
  }

  function tile (ctx, o) { rect(ctx, o, -1, -1, 1, 1); }

  /* rect in approach-relative coords: a = distance along dir d (positive is
     toward that neighbour), b = across it. Lets one bit of code serve all
     four approaches of a junction. */
  function dRect (ctx, o, d, a0, b0, a1, b1) {
    var s = (d & 1) ? -1 : 1;
    if (d < 2) rect(ctx, o, s * a0, b0, s * a1, b1);
    else rect(ctx, o, b0, s * a0, b1, s * a1);
  }

  /* single vertex in approach-relative coords */
  function dv (ctx, o, d, a, b, moveIt) {
    var s = (d & 1) ? -1 : 1, u, v;
    if (d < 2) { u = s * a; v = b; } else { u = b; v = s * a; }
    var X = o.cx + (u - v) * o.fx * 0.5, Y = o.cy + (u + v) * o.fy * 0.5;
    if (moveIt) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }

  function bits (m) { return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1); }

  /* ---- colour cache ---------------------------------------------------
     css() rebuilds a string every call and we run 1500+ tiles a frame, so
     resolve the whole palette once per lighting change instead. */
  var _key = '', C = {};
  function pal () {
    var k = css(P.asphalt) + G.night();
    if (k === _key) return C;
    _key = k;
    var nt = G.night(), i;

    C.asphalt   = css(P.asphalt);
    C.asphaltLo = css(P.asphaltLo);
    C.patch     = css(mix(P.asphalt, P.curb, 0.16));
    C.curb      = css(P.curb);

    var pt = mix(P.paint, P.asphalt, 0.24 * nt);   // markings dim a touch at night
    C.paint     = css(pt);
    C.paintSoft = css(mix(pt, P.lotEdge, 0.40));
    C.bike      = css(mix([138, 98, 78], P.asphalt, 0.32));

    C.grass = [];
    for (i = 0; i < 6; i++) C.grass[i] = css(mix(P.grassDark, P.grass, 0.06 + i * 0.176));
    C.dirt      = css(mix(P.lotEdge, [154, 126, 92], 0.60));

    C.lot       = css(P.lot);
    C.lotEdge   = css(P.lotEdge);

    C.padA      = css(P.plaza);
    C.padB      = css(mix(P.plaza, P.lotEdge, 0.45));
    C.padYard   = css(mix(P.lot, P.lotEdge, 0.50));
    C.walk      = css(mix(P.plaza, P.concrete, 0.60));
    C.padEdge   = css(mix(P.lotEdge, P.asphaltLo, 0.22));

    C.waterA    = css(P.waterA);
    C.waterB    = css(P.waterB);
    C.waterLit  = css(mix(P.waterA, P.white, 0.44));

    C.plaza     = css(P.plaza);
    C.plazaEdge = css(mix(P.plaza, P.lotEdge, 0.55));
    C.sand      = css(mix(P.lot, [208, 192, 152], 0.55));
    C.court     = css(mix([86, 134, 120], P.grassDark, 0.22));
    C.path      = css(mix(P.plaza, P.lot, 0.35));
    return C;
  }

  /* ---- road ----------------------------------------------------------- */

  function road (ctx, o) {
    var c = pal(), m = o.mask | 0, sc = o.scale || 1, x = o.x, y = o.y, d, i;

    /* asphalt */
    ctx.fillStyle = c.asphalt;
    ctx.beginPath(); tile(ctx, o); ctx.fill();

    /* every side without a road neighbour gets a dark gutter and a pale kerb,
       so a run of road reads as a raised strip between blocks */
    if (m !== 15) {
      ctx.fillStyle = c.asphaltLo;
      ctx.beginPath();
      for (d = 0; d < 4; d++) if (!(m & (1 << d))) dRect(ctx, o, d, 0.74, -1, 1, 1);
      ctx.fill();
      ctx.fillStyle = c.curb;
      ctx.beginPath();
      for (d = 0; d < 4; d++) if (!(m & (1 << d))) dRect(ctx, o, d, 0.90, -1, 1, 1);
      ctx.fill();
    }

    if (sc < 0.7) return;                        // LOD: surfaces + kerbs only

    var n = bits(m);
    var uAxis = (m & 3) === 3, vAxis = (m & 12) === 12;
    var straight = n === 2 && (uAxis || vAxis);
    var ax = uAxis ? 0 : 2;

    ctx.fillStyle = c.paint;
    ctx.beginPath();
    if (n >= 3) {
      /* junction: no centre line through the middle. Zebra ladder set back on
         every approach, bars perpendicular to the approach, plus a stop bar. */
      for (d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        for (i = 0; i < 4; i++) {
          var a = 0.55 + i * 0.095;
          dRect(ctx, o, d, a - 0.030, -0.70, a + 0.030, 0.70);
        }
        dRect(ctx, o, d, 0.455, SB[d] * 0.06, 0.505, SB[d] * 0.70);
      }
    } else if (straight) {
      /* dashed centre line, period 1.0 in tile space so dashes flow unbroken
         from tile to tile */
      dRect(ctx, o, ax, -0.85, -0.035, -0.45, 0.035);
      dRect(ctx, o, ax, 0.15, -0.035, 0.55, 0.035);
    } else if (n === 2) {
      /* corner: dashes riding the quarter arc between the two open edges */
      var p = -1, q = -1;
      for (d = 0; d < 4; d++) if (m & (1 << d)) { if (p < 0) p = d; else q = d; }
      for (i = 0; i < 3; i++) {
        var ka = ARC[i * 2], kb = ARC[i * 2 + 1];
        var cu = DU[p] * ka + DU[q] * kb, cv = DV[p] * ka + DV[q] * kb;
        rect(ctx, o, cu - 0.072, cv - 0.072, cu + 0.072, cv + 0.072);
      }
    } else if (n === 1) {
      for (d = 0; d < 4; d++) if (m & (1 << d)) dRect(ctx, o, d, 0.22, -0.035, 0.72, 0.035);
    }
    ctx.fill();

    if (sc < 1.0) return;

    /* Bike lane, keyed on the street's cross-axis only so a whole street gets
       one. Keyed per tile it just reads as a stray bar on one square. */
    if (straight && hash(uAxis ? 0 : x, uAxis ? y : 0, 55) < 0.14) {
      ctx.fillStyle = c.bike;
      ctx.beginPath();
      if (uAxis) rect(ctx, o, -1, 0.44, 1, 0.70);
      else rect(ctx, o, 0.44, -1, 0.70, 1);
      ctx.fill();
      ctx.fillStyle = c.paintSoft;
      ctx.beginPath();
      if (uAxis) rect(ctx, o, -1, 0.42, 1, 0.46);
      else rect(ctx, o, 0.42, -1, 0.46, 1);
      ctx.fill();
    }

    /* sparse street detail - roughly one tile in ten */
    var hd = hash(x, y, 91);
    if (hd >= 0.10) return;

    if (hd < 0.035) {                            // manhole
      ctx.fillStyle = c.asphaltLo;
      ctx.beginPath();
      rect(ctx, o, -0.15, -0.15, 0.15, 0.15);
      ctx.fill();
      ctx.fillStyle = c.patch;
      ctx.beginPath();
      rect(ctx, o, -0.09, -0.09, 0.09, 0.09);
      ctx.fill();
    } else if (hd < 0.072) {                     // patch of fresh repair asphalt
      var pu = (hash(x, y, 92) - 0.5) * 0.7, pv = (hash(x, y, 93) - 0.5) * 0.7;
      ctx.fillStyle = c.patch;
      ctx.beginPath();
      rect(ctx, o, pu - 0.30, pv - 0.26, pu + 0.30, pv + 0.26);
      ctx.fill();
    } else if (straight) {                       // painted turn arrow
      ctx.fillStyle = c.paint;
      ctx.beginPath();
      dRect(ctx, o, ax, -0.06, -0.045, 0.36, 0.045);
      dv(ctx, o, ax, 0.34, -0.15, 1);
      dv(ctx, o, ax, 0.34, 0.15, 0);
      dv(ctx, o, ax, 0.62, 0, 0);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ---- empty lot ------------------------------------------------------- */

  function parking (ctx, o, c, sc) {
    ctx.fillStyle = c.lot;
    ctx.beginPath(); tile(ctx, o); ctx.fill();
    ctx.fillStyle = c.lotEdge;
    ctx.beginPath();
    rect(ctx, o, -1, -1, 1, -0.87); rect(ctx, o, -1, 0.87, 1, 1);
    rect(ctx, o, -1, -1, -0.87, 1); rect(ctx, o, 0.87, -1, 1, 1);
    ctx.fill();
    if (sc < 0.7) return;
    ctx.fillStyle = c.paintSoft;
    ctx.beginPath();
    var uu = hash(o.x, o.y, 23) < 0.5;
    for (var i = 0; i < 5; i++) {
      var b = -0.72 + i * 0.36;
      if (uu) rect(ctx, o, -0.62, b - 0.024, 0.62, b + 0.024);
      else rect(ctx, o, b - 0.024, -0.62, b + 0.024, 0.62);
    }
    ctx.fill();
  }

  function lot (ctx, o) {
    var c = pal(), sc = o.scale || 1, x = o.x, y = o.y;
    var h = hash(x, y, 17);
    if (h < 0.09) { parking(ctx, o, c, sc); return; }

    var gi = (hash(x, y, 3) * 6) | 0;
    ctx.fillStyle = c.grass[gi];
    ctx.beginPath(); tile(ctx, o); ctx.fill();
    if (sc < 0.7) return;

    var du = (hash(x, y, 5) - 0.5) * 0.9, dvv = (hash(x, y, 6) - 0.5) * 0.9;
    if (h < 0.18) {                              // scrub / bare dirt
      ctx.fillStyle = c.dirt;
      ctx.beginPath();
      rect(ctx, o, du - 0.40, dvv - 0.36, du + 0.40, dvv + 0.36);
      ctx.fill();
      return;
    }
    /* mown patch, toned relative to this tile's own grass so the step stays
       subtle instead of stamping a dark square on a pale tile */
    ctx.fillStyle = c.grass[gi < 2 ? gi + 2 : gi - 2];
    ctx.beginPath();
    rect(ctx, o, du - 0.34, dvv - 0.30, du + 0.34, dvv + 0.30);
    ctx.fill();
  }

  /* ---- building apron -------------------------------------------------- */

  function pad (ctx, o) {
    var c = pal(), m = o.mask | 0, sc = o.scale || 1, d;

    ctx.fillStyle = (o.kind === T.IND) ? c.padYard
      : (hash(o.x, o.y, 11) < 0.5 ? c.padA : c.padB);
    ctx.beginPath(); tile(ctx, o); ctx.fill();

    if (m) {
      /* wider pavement plus a kerb on every side that meets a road - this is
         what seats the building into the street instead of onto grass */
      ctx.fillStyle = c.walk;
      ctx.beginPath();
      for (d = 0; d < 4; d++) if (m & (1 << d)) dRect(ctx, o, d, 0.56, -1, 1, 1);
      ctx.fill();
      ctx.fillStyle = c.curb;
      ctx.beginPath();
      for (d = 0; d < 4; d++) if (m & (1 << d)) dRect(ctx, o, d, 0.89, -1, 1, 1);
      ctx.fill();
    }

    if (sc < 0.7 || m === 15) return;
    ctx.fillStyle = c.padEdge;
    ctx.beginPath();
    for (d = 0; d < 4; d++) if (!(m & (1 << d))) dRect(ctx, o, d, 0.93, -1, 1, 1);
    if (sc >= 1.0) {                             // a couple of paving joints
      rect(ctx, o, -0.90, -0.014, 0.90, 0.014);
      rect(ctx, o, -0.014, -0.90, 0.014, 0.90);
    }
    ctx.fill();
  }

  /* ---- water ----------------------------------------------------------- */

  function water (ctx, o) {
    var c = pal(), sc = o.scale || 1;
    ctx.fillStyle = c.waterA;
    ctx.beginPath(); tile(ctx, o); ctx.fill();

    var t = (o.t || 0) * 0.0012;
    var ph = Math.sin(t + o.x * 0.9 + o.y * 1.35) * 0.46;
    ctx.fillStyle = c.waterB;
    ctx.beginPath();
    rect(ctx, o, -0.88, ph - 0.11, 0.88, ph + 0.11);
    ctx.fill();
    if (sc < 0.7) return;

    var p2 = Math.sin(t * 0.7 + o.x * 1.4 - o.y * 0.8 + 2.1) * 0.38 + 0.32;
    ctx.fillStyle = c.waterLit;
    ctx.beginPath();
    rect(ctx, o, -0.60, p2 - 0.045, 0.60, p2 + 0.045);
    ctx.fill();
  }

  /* ---- park ------------------------------------------------------------
     Variant is keyed off coarse coords so a 2x2 block agrees and a run of
     park tiles reads as one park rather than a repeated stamp. */

  function pvar (x, y) {
    var h = hash(x >> 1, y >> 1, 41);
    return h < 0.13 ? 1 : (h < 0.26 ? 2 : (h < 0.36 ? 3 : 0));
  }

  /* band along every side whose neighbour is a different park variant */
  function rim (ctx, o, want, a0) {
    for (var d = 0; d < 4; d++) {
      if (pvar(o.x + DX[d], o.y + DY[d]) !== want) dRect(ctx, o, d, a0, -1, 1, 1);
    }
  }

  /* Winding path. Its centre line lives in a 3-row band and is a smooth
     function of world x, so neighbouring tiles agree on the shared edge.
     Drawn in four spans; a span that leaves the tile is simply skipped, which
     is what keeps the path inside the diamond without needing a clip. */
  function walkPath (ctx, o, c) {
    var x = o.x, y = o.y;
    var band = Math.floor(y / 3) * 3 + 1, phase = band * 0.7;
    var W = 0.24, lim = 1 - W, i;
    var v0, v1, u0, any = false;
    var off = 2 * (band - y);
    v1 = off + 2.2 * Math.sin((x - 0.5) * 0.55 + phase);
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      v0 = v1;
      v1 = off + 2.2 * Math.sin((x - 0.25 + i * 0.25) * 0.55 + phase);
      if (v0 < -lim || v0 > lim || v1 < -lim || v1 > lim) continue;
      u0 = -1 + i * 0.5;
      quad(ctx, o, u0, v0 - W, u0 + 0.5, v1 - W, u0 + 0.5, v1 + W, u0, v0 + W);
      any = true;
    }
    if (any) { ctx.fillStyle = c.path; ctx.fill(); }
  }

  function park (ctx, o) {
    var c = pal(), sc = o.scale || 1, x = o.x, y = o.y, d;

    ctx.fillStyle = c.grass[(hash(x, y, 3) * 6) | 0];
    ctx.beginPath(); tile(ctx, o); ctx.fill();
    if (sc < 0.55) return;

    var kind = pvar(x, y);

    if (kind === 1) {                            // pond, sandy rim on the outside
      ctx.fillStyle = c.waterA;
      ctx.beginPath(); rect(ctx, o, -0.92, -0.92, 0.92, 0.92); ctx.fill();
      ctx.fillStyle = c.sand;
      ctx.beginPath(); rim(ctx, o, 1, 0.78); ctx.fill();
      if (sc < 1.0) return;
      var ph = Math.sin(x * 1.1 + y * 0.7) * 0.34;
      ctx.fillStyle = c.waterLit;
      ctx.beginPath(); rect(ctx, o, -0.46, ph - 0.04, 0.46, ph + 0.04); ctx.fill();
      return;
    }

    if (kind === 2) {                            // paved plaza
      ctx.fillStyle = c.plaza;
      ctx.beginPath(); rect(ctx, o, -0.94, -0.94, 0.94, 0.94); ctx.fill();
      ctx.fillStyle = c.plazaEdge;
      ctx.beginPath();
      rim(ctx, o, 2, 0.80);
      if (sc >= 1.0) {
        rect(ctx, o, -0.94, -0.016, 0.94, 0.016);
        rect(ctx, o, -0.016, -0.94, 0.016, 0.94);
      }
      ctx.fill();
      return;
    }

    if (kind === 3) {                            // sports court with painted lines
      ctx.fillStyle = c.court;
      ctx.beginPath(); rect(ctx, o, -0.92, -0.92, 0.92, 0.92); ctx.fill();
      if (sc < 0.7) return;
      ctx.fillStyle = c.paint;
      ctx.beginPath();
      for (d = 0; d < 4; d++) {
        if (pvar(x + DX[d], y + DY[d]) !== 3) dRect(ctx, o, d, 0.80, -0.92, 0.86, 0.92);
      }
      if (x & 1) rect(ctx, o, -1, -1, -0.97, 1);   // halfway line down the block
      if (y & 1) rect(ctx, o, -1, -1, 1, -0.97);
      ctx.fill();
      return;
    }

    if (sc >= 0.7) walkPath(ctx, o, c);
  }

  MM.ground = { road: road, lot: lot, pad: pad, water: water, park: park };
})(window.MM);

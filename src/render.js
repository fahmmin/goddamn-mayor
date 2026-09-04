/* src/render.js - isometric city renderer. Owned by the RENDERER agent.
   Canvas paths only: no images, no fonts, no deps. Safe under CSP default-src 'self'. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * constants
   * ------------------------------------------------------------------ */
  var T   = MM.TILE || {};                 // guarded so the file can be eval'd headless
  var G   = MM.GRID || 48;
  var TPD = MM.TICKS_PER_DAY || 24;

  var HW = 32, HH = 16;                    // tile half-width / half-height @ scale 1
  var UNIT = 22;                           // one storey in px @ scale 1
  var MAX_V = 80;                          // vehicle cap
  var MAX_P = 150;                         // pedestrian cap
  var MIN_S = 0.35, MAX_S = 2.6;
  var TAU = Math.PI * 2;
  var NO_DASH = [];
  var CACHE_M = 192;                       // static-cache margin in css px

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // d ^ 1 == reverse
  var DIRSCRATCH = [0, 0, 0, 0];
  var RING_R = [1.9, 1.05, 0.34], RING_A = [0.05, 0.08, 0.42];

  function inB (x, y) { return x >= 0 && y >= 0 && x < G && y < G; }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp (a, b, t) { return a + (b - a) * t; }

  /* deterministic per-tile noise - never Math.random, so nothing flickers */
  function hash2 (x, y) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hash3 (x, y, z) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /* seeded LCG for vehicle spawning - stable, never Math.random */
  var _seed = 0x9e3779b9;
  function rnd () { _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0; return _seed / 4294967296; }

  /* ------------------------------------------------------------------ *
   * palette - "late-night New York from a rooftop"
   * ------------------------------------------------------------------ */
  var PAL = {
    lot:      [118, 172, 92],     // lawn, not void
    lotEdge:  [162, 206, 124],
    padA:     [212, 208, 198],    // pale pavement apron
    padB:     [198, 194, 184],
    curb:     [196, 198, 194],
    road:     [74, 78, 84],       // dark asphalt
    dash:     [244, 244, 238],
    waterA:   [74, 156, 200],
    waterLit: [176, 226, 246],
    park:     [116, 180, 84],
    treeA:    [74, 152, 76],
    treeB:    [104, 188, 96],
    trunk:    [111, 84, 58],
    shade:    [46, 62, 74],
    pole:     [150, 156, 164],
    glass:    [136, 198, 226],
    steel:    [178, 184, 192],
    cab:      [244, 190, 44],
    cabTop:   [255, 214, 96],
    bus:      [56, 108, 200],
    busTop:   [104, 158, 236],
    dark:     [96, 100, 106],
    roofRed:  [226, 92, 76],
    roofYel:  [246, 202, 78],
    flag:     [238, 192, 66],
    cross:    [226, 78, 70],
    awningA:  [248, 244, 232],
    awningB:  [230, 96, 122],
    winDark:  [126, 158, 180]
  };

  /* untinted accents (they are light sources, ambient must not darken them) */
  var HOT = {
    winWarm: '255,206,138',
    winCool: '206,230,255',
    winDim:  '255,176,96',
    neonC:   '84,236,255',
    neonM:   '255,96,214',
    lamp:    '255,172,84',
    head:    '255,238,206',
    tail:    '255,86,64',
    beacon:  '255,72,64'
  };

  // Daylight ambient occlusion. Much gentler than a night scene: in the
  // reference the sunlit sides stay pale and only the shaded face goes grey.
  var LM = 0.80, RM = 0.63;                 // left face / right face darkening
  function mul (c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function box (top) { return [top, mul(top, LM), mul(top, RM)]; }

  // Pale campus buildings with a little sector tint, the way the reference
  // reads: mostly white/cream, colour carried by roofs, props and signage.
  var FACE = {};
  FACE[T.RES]       = box([236, 222, 206]);  // warm cream brick
  FACE[T.COM]       = box([228, 236, 242]);  // cool white glass
  FACE[T.IND]       = box([214, 208, 192]);
  FACE[T.TOWER]     = box([238, 240, 240]);
  FACE[T.GROCERY]   = box([242, 226, 232]);
  FACE[T.CHILDCARE] = box([232, 230, 246]);
  FACE[T.CLINIC]    = box([248, 248, 246]);
  FACE[T.SCHOOL]    = box([240, 228, 200]);
  FACE[T.BUS]       = box([222, 230, 238]);
  FACE[T.PARK]      = box([116, 180, 84]);
  var FACE_DEF      = box([230, 230, 228]);

  /* [ base storeys, storeys per level, footprint fraction ] */
  // Footprints deliberately leave a margin: the reference reads as a model
  // village because you can see pavement, trees and parked cars between the
  // buildings. Filling the plot turns the city into one solid mass.
  var SHAPE = {};
  SHAPE[T.RES]       = [1.05, 0.60, 0.64];
  SHAPE[T.COM]       = [1.25, 0.92, 0.62];
  SHAPE[T.IND]       = [0.85, 0.30, 0.72];   // squat and wide
  SHAPE[T.TOWER]     = [3.10, 1.20, 0.56];   // tallest thing in the borough
  SHAPE[T.GROCERY]   = [1.10, 0.00, 0.68];
  SHAPE[T.CHILDCARE] = [0.95, 0.00, 0.64];
  SHAPE[T.CLINIC]    = [1.55, 0.00, 0.66];
  SHAPE[T.SCHOOL]    = [1.35, 0.00, 0.70];
  SHAPE[T.BUS]       = [0.42, 0.00, 0.40];
  SHAPE[T.PARK]      = [0.00, 0.00, 0.90];
  var SHAPE_DEF      = [1.00, 0.25, 0.66];

  /* A minority of blocks carry a saturated identity colour, the way a real
     campus has its branded buildings. Everything else stays pale. */
  var ACCENT = [
    [ 74, 168, 168], [232, 118,  92], [238, 196,  86], [ 96, 118, 200],
    [186,  92, 132], [ 92, 168, 110], [212, 128,  64], [120, 104, 188]
  ];

  var WINDOWED = {};
  WINDOWED[T.RES]   = 'winWarm';
  WINDOWED[T.COM]   = 'winCool';
  WINDOWED[T.TOWER] = 'winWarm';
  WINDOWED[T.IND]   = 'winDim';

  /* overlay heat ramp, 8 buckets, built once */
  var RAMP = [];
  (function () {
    for (var q = 0; q < 8; q++) {
      var t = q / 7;
      RAMP.push('hsla(' + Math.round(214 - t * 214) + ',86%,' +
        Math.round(40 + t * 20) + '%,' + (0.08 + t * 0.40).toFixed(3) + ')');
    }
  })();

  /* ------------------------------------------------------------------ *
   * Renderer
   * ------------------------------------------------------------------ */
  function Renderer (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    this.scale = 1;
    this.ox = 0; this.oy = 0;
    this.w = 1; this.h = 1; this.dpr = 1;

    this.hover = null;
    this.overlay = 'none';

    this.clock = 0;          // animation clock (ms), advanced by dtMs
    this.phase = 0.78;       // eased day phase 0..1 (0 = midnight)
    this.L = 0; this.N = 1; this.golden = 0; this.elev = -1;

    this._C = {};            // per-frame tinted colour strings
    this._F = {};            // per-frame tinted face triples
    for (var k in FACE) this._F[k] = ['', '', ''];
    this._Fdef = ['', '', ''];
    this._vig = null;
    this._frames = 0;

    var N = G * G;
    this._bLot = new Int32Array(N); this._nLot = 0;
    this._bWat = new Int32Array(N); this._nWat = 0;
    this._bPadA = new Int32Array(N); this._nPadA = 0;
    this._bPadB = new Int32Array(N); this._nPadB = 0;
    this._bRoad = new Int32Array(N); this._nRoad = 0;
    this._bBld = new Int32Array(N); this._nBld = 0;
    this._bAll = new Int32Array(N); this._nAll = 0;

    this._field = new Uint8Array(N);
    this._fieldKey = '';
    this._fieldT = -1e9;

    this._roads = new Int32Array(N); this._nRoads = 0;
    this._busT = new Int32Array(N); this._nBusT = 0;
    this._netT = -1e9;

    this._lit = null; this._litN = 0; this._litKey = '';
    this._veh = [];
    this._vhead = new Int32Array(2 * G);
    this._vnext = new Int32Array(MAX_V + MAX_P);
    this._lampBuf = new Float64Array(1600);

    // offscreen cache for the static city (see _renderStatic)
    this._cc = document.createElement('canvas');
    this._cctx = null;
    this._lc = document.createElement('canvas');     // window lights, same frame
    this._lctx = null;
    this._cacheKey = '';
    this._cacheOx = 0; this._cacheOy = 0; this._cacheW = 0; this._cacheH = 0;
    this._skipVeh = false;

    this.resize();
  }

  /* ---------- viewport ---------------------------------------------- */

  Renderer.prototype.resize = function () {
    var c = this.canvas;
    var r = c.getBoundingClientRect();
    var w = r.width, h = r.height;
    // Fall back to the window when the canvas has no author CSS size yet
    // (300x150 is the intrinsic default). Never fights real stylesheet sizing.
    if (w < 4 || h < 4 || (w === 300 && h === 150)) {
      w = window.innerWidth || 1024;
      h = window.innerHeight || 640;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w; this.h = h; this.dpr = dpr;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // setting .width wipes state
    this._buildVignette();
  };

  Renderer.prototype._buildVignette = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.20,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.58)');
    this._vig = g;
  };

  Renderer.prototype.panBy = function (dx, dy) { this.ox += dx; this.oy += dy; };

  Renderer.prototype.zoomAt = function (px, py, delta) {
    var r = this.canvas.getBoundingClientRect();
    var mx = px - r.left, my = py - r.top;
    var old = this.scale;
    var next = clamp(old * (delta > 0 ? 1.14 : 1 / 1.14), MIN_S, MAX_S);
    if (next === old) return;
    var k = next / old;
    this.ox = mx - (mx - this.ox) * k;      // keep the world point under the cursor put
    this.oy = my - (my - this.oy) * k;
    this.scale = next;
  };

  Renderer.prototype.centerOn = function (tx, ty) {
    var s = this.scale;
    this.ox = this.w * 0.5 - (tx - ty) * HW * s;
    this.oy = this.h * 0.5 - (tx + ty) * HH * s;
  };

  /* Exact inverse of the projection: a tile's diamond maps to the unit
     square around its integer coords, so rounding is the whole trick. */
  Renderer.prototype.screenToTile = function (px, py) {
    var r = this.canvas.getBoundingClientRect();
    var s = this.scale;
    var a = (px - r.left - this.ox) / (HW * s);   // x - y
    var b = (py - r.top - this.oy) / (HH * s);    // x + y
    var x = Math.round((a + b) * 0.5);
    var y = Math.round((b - a) * 0.5);
    return inB(x, y) ? { x: x, y: y } : null;
  };

  /* ---------- day / night -------------------------------------------- */

  Renderer.prototype._daynight = function (s, dt) {
    var target = (((s.tick | 0) % TPD) + TPD) % TPD / TPD;
    var d = target - this.phase;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    this.phase += d * Math.min(1, dt * 0.003);
    if (this.phase < 0) this.phase += 1; else if (this.phase >= 1) this.phase -= 1;

    var elev = Math.sin((this.phase - 0.25) * TAU);   // -1 midnight .. +1 noon
    var L = clamp(elev * 1.45 + 0.30, 0, 1);
    var golden = Math.exp(-elev * elev * 9) * (elev > -0.25 ? 1 : 0);
    this.elev = elev; this.L = L; this.N = 1 - L; this.golden = golden;

    // The city itself is always lit for noon. This is a deliberate trade: the
    // brief is a bright daylight diorama, and any light that varies has to be
    // baked into the static cache, which then repaints as the sun moves - a
    // full cycle cost ~90 repaints and 30ms/frame average, i.e. a slideshow.
    // Time of day is carried by the sky and the vignette instead, which are
    // drawn live and cost one gradient each.
    // ponytail: static city light. If night colour is wanted back, cache the
    // city neutral and composite the tint onto a second canvas per light
    // bucket, rather than re-rendering 1900 tiles of detail.
    this._rm = 1.02; this._gm = 1.01; this._bm = 1.00;

    // hand the same light to gfx so ground.js / roofs.js / props.js match
    if (MM.gfx) MM.gfx.setLight(this._rm, this._gm, this._bm, this.N);
    // and to light.js, which owns the sun everything reflective points at
    if (MM.light) MM.light.update(this);
  };

  Renderer.prototype._palette = function () {
    var rm = this._rm, gm = this._gm, bm = this._bm, C = this._C, k, c;
    // Civic blocks and props do not go through gfx.faces, so pick the same
    // specular up here: top, +v face, +u face. Keeps a one-tile clinic lit
    // the same way as the tower next door.
    var Gs = MM.gfx && MM.gfx.spec;
    var SP = Gs ? [1 + 0.06, 1 + Gs(0, 1) / LM, 1 + Gs(1, 0) / RM] : [1, 1, 1];
    for (k in PAL) {
      c = PAL[k];
      C[k] = 'rgb(' + (clamp(c[0] * rm, 0, 255) | 0) + ',' +
        (clamp(c[1] * gm, 0, 255) | 0) + ',' + (clamp(c[2] * bm, 0, 255) | 0) + ')';
    }
    for (k in FACE) {
      var src = FACE[k], dst = this._F[k];
      for (var f = 0; f < 3; f++) {
        c = src[f];
        dst[f] = 'rgb(' + (clamp(c[0] * rm * SP[f], 0, 255) | 0) + ',' +
          (clamp(c[1] * gm * SP[f], 0, 255) | 0) + ',' + (clamp(c[2] * bm * SP[f], 0, 255) | 0) + ')';
      }
    }
    for (f = 0; f < 3; f++) {
      c = FACE_DEF[f];
      this._Fdef[f] = 'rgb(' + (clamp(c[0] * rm * SP[f], 0, 255) | 0) + ',' +
        (clamp(c[1] * gm * SP[f], 0, 255) | 0) + ',' + (clamp(c[2] * bm * SP[f], 0, 255) | 0) + ')';
    }
  };

  Renderer.prototype._faces = function (type) { return this._F[type] || this._Fdef; };

  /* ---------- visible-tile collection -------------------------------- */

  Renderer.prototype._collect = function (s) {
    var g = s.grid, sc = this.scale, fx = HW * sc, fy = HH * sc;
    var hMax = 220 * sc;
    var aMin = (-this.ox) / fx - 1.4;
    var aMax = (this.w - this.ox) / fx + 1.4;
    var dMin = Math.max(0, Math.floor((-this.oy) / fy - 1.5));
    var dMax = Math.min(2 * G - 2, Math.ceil((this.h + hMax - this.oy) / fy + 1.5));

    var nLot = 0, nWat = 0, nA = 0, nB = 0, nR = 0, nBld = 0, nAll = 0;
    var bLot = this._bLot, bWat = this._bWat, bA = this._bPadA, bB = this._bPadB;
    var bR = this._bRoad, bBld = this._bBld, bAll = this._bAll;

    for (var d = dMin; d <= dMax; d++) {
      var x0 = Math.max(0, d - G + 1, Math.ceil((aMin + d) * 0.5));
      var x1 = Math.min(G - 1, d, Math.floor((aMax + d) * 0.5));
      for (var x = x0; x <= x1; x++) {
        var y = d - x;
        var i = y * G + x;
        var t = g[i];
        bAll[nAll++] = i;
        if (t === T.EMPTY) bLot[nLot++] = i;
        else if (t === T.WATER) bWat[nWat++] = i;
        else if (t === T.ROAD) { bR[nR++] = i; }
        else {
          if (hash2(x, y) < 0.5) bA[nA++] = i; else bB[nB++] = i;
          bBld[nBld++] = i;
        }
      }
    }
    this._nLot = nLot; this._nWat = nWat; this._nPadA = nA; this._nPadB = nB;
    this._nRoad = nR; this._nBld = nBld; this._nAll = nAll;
  };

  Renderer.prototype._diamonds = function (list, n, color) {
    if (!n) return;
    var ctx = this.ctx, sc = this.scale, fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var k = 0; k < n; k++) {
      var i = list[k], x = i % G, y = (i / G) | 0;
      var cx = (x - y) * fx + ox, cy = (x + y) * fy + oy;
      ctx.moveTo(cx, cy - fy);
      ctx.lineTo(cx + fx, cy);
      ctx.lineTo(cx, cy + fy);
      ctx.lineTo(cx - fx, cy);
      ctx.closePath();
    }
    ctx.fill();
  };

  /* ---------- ground -------------------------------------------------- */

  Renderer.prototype._ground = function (s) {
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy, k, i, x, y, cx, cy;

    this._diamonds(this._bLot, this._nLot, C.lot);
    this._diamonds(this._bPadA, this._nPadA, C.padA);
    this._diamonds(this._bPadB, this._nPadB, C.padB);
    this._diamonds(this._bWat, this._nWat, C.waterA);
    this._diamonds(this._bRoad, this._nRoad, C.curb);

    // detail layer: lawns, parking bays, pavement aprons, water shimmer
    var GD = MM.ground, o;
    if (GD) {
      o = { x: 0, y: 0, cx: 0, cy: 0, fx: fx, fy: fy, mask: 0, kind: 0, scale: sc, t: this.clock };
      var pass = [[this._bLot, this._nLot, GD.lot], [this._bPadA, this._nPadA, GD.pad],
        [this._bPadB, this._nPadB, GD.pad], [this._bWat, this._nWat, GD.water]];
      for (var p = 0; p < 4; p++) {
        var buf = pass[p][0], n = pass[p][1], fn = pass[p][2];
        if (typeof fn !== 'function') continue;
        for (k = 0; k < n; k++) {
          i = buf[k]; x = i % G; y = (i / G) | 0;
          o.x = x; o.y = y;
          o.cx = (x - y) * fx + ox; o.cy = (x + y) * fy + oy;
          o.kind = s.grid[i];
          o.mask = p === 1 || p === 2 ? this._mask(s, x, y) : 0;
          try { fn(ctx, o); } catch (e) { /* one bad tile must not kill the frame */ }
        }
      }
    }

    // stray trees and bushes on vacant land, so empty blocks aren't bare
    if (MM.props && MM.props.ground && this._nLot) {
      var po = { x: 0, y: 0, kind: T.EMPTY, level: 0, cx: 0, cy: 0, fx: fx, fy: fy, mask: 0, scale: sc, busy: 0 };
      for (k = 0; k < this._nLot; k++) {
        i = this._bLot[k]; x = i % G; y = (i / G) | 0;
        po.x = x; po.y = y;
        po.cx = (x - y) * fx + ox; po.cy = (x + y) * fy + oy;
        po.mask = this._mask(s, x, y);
        try { MM.props.ground(ctx, po); } catch (e) {}
      }
    }

    // unzoned lots: faint dotted outline so the buildable area reads
    if (sc > 0.42 && this._nLot && this._nLot < 1600) {
      ctx.save();
      ctx.strokeStyle = C.lotEdge;
      ctx.globalAlpha = 0.20;
      ctx.lineWidth = 1;
      ctx.setLineDash([2 * sc, 3.2 * sc]);
      ctx.beginPath();
      for (k = 0; k < this._nLot; k++) {
        i = this._bLot[k]; x = i % G; y = (i / G) | 0;
        cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
        ctx.moveTo(cx, cy - fy);
        ctx.lineTo(cx + fx, cy);
        ctx.lineTo(cx, cy + fy);
        ctx.lineTo(cx - fx, cy);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.restore();
    }

    // Water mirrors. Baked, not live: they depend only on the grid, and drawing
    // them here - before roads and structures - is what makes a building on the
    // near bank correctly occlude the reflection of one on the far bank.
    // (The moving crests and the sun glitter are live, in MM.light.shimmer.)
    if (this._nWat && MM.light) MM.light.reflect(ctx, this, s);
  };

  /* ---------- roads --------------------------------------------------- */

  /* bitmask of neighbours a road should visually connect to */
  Renderer.prototype._link = function (g, x, y) {
    var m = 0;
    for (var k = 0; k < 4; k++) {
      var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
      if (!inB(nx, ny)) continue;
      var t = g[ny * G + nx];
      if (t === T.ROAD || t === T.BUS) m |= 1 << k;
    }
    return m;
  };
  /* driveable neighbours only */
  Renderer.prototype._mask = function (s, x, y) {
    var g = s.grid, m = 0;
    for (var k = 0; k < 4; k++) {
      var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
      if (inB(nx, ny) && g[ny * G + nx] === T.ROAD) m |= 1 << k;
    }
    return m;
  };

  Renderer.prototype._roadPass = function (s) {
    var n = this._nRoad;
    if (!n) return;
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy, g = s.grid;
    var W = 0.34, k, i, x, y, cx, cy, m;

    // asphalt: centre pad + an arm toward every connected neighbour
    ctx.fillStyle = C.road;
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRoad[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      m = this._link(g, x, y);
      // centre square (world-aligned, so it looks iso-correct)
      ctx.moveTo(cx, cy - 2 * W * fy);
      ctx.lineTo(cx + 2 * W * fx, cy);
      ctx.lineTo(cx, cy + 2 * W * fy);
      ctx.lineTo(cx - 2 * W * fx, cy);
      ctx.closePath();
      if (m & 1) this._arm(cx, cy, fx, fy, 1, 0, W);
      if (m & 2) this._arm(cx, cy, fx, fy, -1, 0, W);
      if (m & 4) this._arm(cx, cy, fx, fy, 0, 1, W);
      if (m & 8) this._arm(cx, cy, fx, fy, 0, -1, W);
    }
    ctx.fill();

    if (sc < 0.5) return;

    // dashed centre lines
    ctx.save();
    ctx.strokeStyle = C.dash;
    ctx.globalAlpha = 0.38 + 0.30 * this.N;
    ctx.lineWidth = Math.max(1, 1.1 * sc);
    ctx.setLineDash([3.4 * sc, 4.6 * sc]);
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRoad[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      m = this._link(g, x, y);
      for (var q = 0; q < 4; q++) {
        if (!(m & (1 << q))) continue;
        var dx = DIRS[q][0], dy = DIRS[q][1];
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (dx - dy) * fx * 0.5, cy + (dx + dy) * fy * 0.5);
      }
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.restore();

    // proper surface + lane markings + zebra crossings, per tile
    if (MM.ground && MM.ground.road) {
      var ro = { x: 0, y: 0, cx: 0, cy: 0, fx: fx, fy: fy, mask: 0, kind: T.ROAD, scale: sc, t: this.clock };
      for (k = 0; k < n; k++) {
        i = this._bRoad[k]; x = i % G; y = (i / G) | 0;
        ro.x = x; ro.y = y;
        ro.cx = (x - y) * fx + ox; ro.cy = (x + y) * fy + oy;
        ro.mask = this._link(g, x, y);
        try { MM.ground.road(ctx, ro); } catch (e) {}
      }
    }

    this._lampPoles(s);
  };

  /* one road arm: a world-space ribbon from the tile centre to its edge */
  Renderer.prototype._arm = function (cx, cy, fx, fy, dx, dy, W) {
    var ctx = this.ctx;
    var px = -dy, py = dx;                       // world perpendicular
    var ax = (dx - dy) * fx * 0.5, ay = (dx + dy) * fy * 0.5;
    var bx = (px - py) * fx * W, by = (px + py) * fy * W;
    ctx.moveTo(cx + bx, cy + by);
    ctx.lineTo(cx + ax + bx, cy + ay + by);
    ctx.lineTo(cx + ax - bx, cy + ay - by);
    ctx.lineTo(cx - bx, cy - by);
    ctx.closePath();
  };

  /* sodium street lamps - only worth drawing once the sun is down */
  Renderer.prototype._lampPoles = function () {
    if (this.scale < 0.5) return;
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy, n = this._nRoad, k, i, x, y;
    var lit = this._lampBuf, nl = 0;
    for (k = 0; k < n && nl < lit.length - 1; k++) {
      i = this._bRoad[k]; x = i % G; y = (i / G) | 0;
      if (hash2(x, y + 911) < 0.74) continue;
      lit[nl++] = (x - y) * fx + ox;
      lit[nl++] = (x + y) * fy + oy;
    }
    if (!nl) return;
    var head = 13 * sc;

    ctx.save();
    ctx.strokeStyle = C.pole;
    ctx.lineWidth = Math.max(1, 1.2 * sc);
    ctx.beginPath();
    for (k = 0; k < nl; k += 2) {
      var px = lit[k] + fx * 0.66, py = lit[k + 1];
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - head);
    }
    ctx.stroke();
    ctx.fillStyle = C.paint;                 // the lamp head itself
    ctx.beginPath();
    for (k = 0; k < nl; k += 2) {
      ctx.moveTo(lit[k] + fx * 0.66 + 2.2 * sc, lit[k + 1] - head);
      ctx.arc(lit[k] + fx * 0.66, lit[k + 1] - head, 2.2 * sc, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  };

  /* ---------- overlays ------------------------------------------------ */

  Renderer.prototype._computeField = function (s) {
    var f = this._field, g = s.grid, lv = s.level, x, y, i, a, b, xx, yy, t;
    f.fill(0);
    if (this.overlay === 'traffic') {
      var tf = 0.32 + (s.traffic || 0) / 100 * 0.88;
      for (y = 0; y < G; y++) {
        for (x = 0; x < G; x++) {
          i = y * G + x;
          if (g[i] !== T.ROAD && g[i] !== T.BUS) continue;
          var dens = 0;
          for (b = -2; b <= 2; b++) {
            for (a = -2; a <= 2; a++) {
              xx = x + a; yy = y + b;
              if (!inB(xx, yy)) continue;
              t = g[yy * G + xx];
              if (t === T.RES || t === T.COM || t === T.IND || t === T.TOWER) dens += 1 + lv[yy * G + xx] * 0.45;
            }
          }
          f[i] = clamp(dens / 22 * 255 * tf, 0, 255) | 0;
        }
      }
    } else {                                       // pollution
      var pf = 0.35 + (s.pollution || 0) / 100 * 0.95;
      for (y = 0; y < G; y++) {
        for (x = 0; x < G; x++) {
          i = y * G + x;
          t = g[i];
          var amt = t === T.IND ? 60 + lv[i] * 22 : (t === T.ROAD ? 10 : 0);
          if (!amt) continue;
          var rad = t === T.IND ? 4 : 1;
          for (b = -rad; b <= rad; b++) {
            for (a = -rad; a <= rad; a++) {
              xx = x + a; yy = y + b;
              if (!inB(xx, yy)) continue;
              var dist = Math.abs(a) + Math.abs(b);
              var v = f[yy * G + xx] + amt * pf / (1 + dist * 0.9);
              f[yy * G + xx] = v > 255 ? 255 : v | 0;
            }
          }
        }
      }
      for (i = 0; i < f.length; i++) if (g[i] === T.PARK) f[i] = (f[i] * 0.35) | 0;
    }
  };

  Renderer.prototype._overlayPass = function (s) {
    var mode = this.overlay;
    if (!mode || mode === 'none') return;
    var useField = mode !== 'value';
    if (useField) {
      var key = mode + '|' + (s.traffic | 0) + '|' + (s.pollution | 0);
      if (key !== this._fieldKey || this.clock - this._fieldT > 600) {
        this._fieldKey = key; this._fieldT = this.clock;
        this._computeField(s);
      }
    }
    var src = useField ? this._field : s.pow;
    if (!src) return;
    var ctx = this.ctx, sc = this.scale, fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var list = this._bAll, n = this._nAll, last = -1;
    ctx.save();
    for (var k = 0; k < n; k++) {
      var i = list[k];
      var q = src[i] >> 5;
      if (q <= 0) continue;
      if (q !== last) { ctx.fillStyle = RAMP[q]; last = q; }
      var x = i % G, y = (i / G) | 0;
      var cx = (x - y) * fx + ox, cy = (x + y) * fy + oy;
      ctx.beginPath();
      ctx.moveTo(cx, cy - fy);
      ctx.lineTo(cx + fx, cy);
      ctx.lineTo(cx, cy + fy);
      ctx.lineTo(cx - fx, cy);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------- shadows ------------------------------------------------- */

  Renderer.prototype._shadows = function (s) {
    var alpha = 0.30;
    if (!this._nBld) return;
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    // The cached city is lit for noon, so its shadows are cast for noon too:
    // a long dawn shadow baked under a midday facade reads as a bug.
    var sun = -0.34, stretch = 0.42;

    var LT = MM.lots;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.shade;
    ctx.beginPath();
    for (var k = 0; k < this._nBld; k++) {
      var i = this._bBld[k], x = i % G, y = (i / G) | 0;
      var h, cx, cy, ax, ay;

      // A block-scale building casts one shadow the size of its whole lot,
      // not nine tile-sized ones. lots.js knows the footprint and roughly how
      // tall the thing on it ends up.
      if (LT) {
        var role = LT.role(s, x, y);
        if (role === -1) continue;              // its anchor draws the shadow
        if (role === 1) {
          var lot = LT.shape(s, x, y);
          if (!lot || lot.top < 6) continue;
          h = lot.top * sc;
          var m = 0.30;                         // lots leave a setback; so does the shadow
          var ta = lot.x0 - 0.5 + m, tb = lot.y0 - 0.5 + m;
          var tc = lot.x1 + 0.5 - m, td = lot.y1 + 0.5 - m;
          var sx = sun * h * stretch * 0.9 + ox, sy = h * stretch * 0.34 + oy;
          ctx.moveTo((ta - tb) * fx + sx, (ta + tb) * fy + sy);
          ctx.lineTo((tc - tb) * fx + sx, (tc + tb) * fy + sy);
          ctx.lineTo((tc - td) * fx + sx, (tc + td) * fy + sy);
          ctx.lineTo((ta - td) * fx + sx, (ta + td) * fy + sy);
          ctx.closePath();
          continue;
        }
      }

      var t = s.grid[i];
      var sh = SHAPE[t] || SHAPE_DEF;
      h = (sh[0] + sh[1] * (s.level[i] || 0)) * UNIT * sc;
      if (h < 1) continue;
      var f = sh[2];
      cx = (x - y) * fx + ox + sun * h * stretch * 0.9;
      cy = (x + y) * fy + oy + h * stretch * 0.34;
      ax = fx * f * 1.06; ay = fy * f * 1.06;
      ctx.moveTo(cx, cy - ay);
      ctx.lineTo(cx + ax, cy);
      ctx.lineTo(cx, cy + ay);
      ctx.lineTo(cx - ax, cy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };

  /* ---------- extruded blocks ---------------------------------------- */

  /* add a parallelogram on a visible side face.
     side 0 = right (E->S, darkest), side 1 = left (S->W).
     u runs along the base edge, v runs up (0 base .. 1 roof). */
  Renderer.prototype._fq = function (cx, cy, fx, fy, h, side, u0, u1, v0, v1) {
    var ctx = this.ctx, ax, ay, bx, by;
    if (side === 0) { ax = cx + fx; ay = cy; bx = -fx; by = fy; }
    else { ax = cx; ay = cy + fy; bx = -fx; by = -fy; }
    var x0 = ax + bx * u0, y0 = ay + by * u0;
    var x1 = ax + bx * u1, y1 = ay + by * u1;
    ctx.moveTo(x0, y0 - v0 * h);
    ctx.lineTo(x1, y1 - v0 * h);
    ctx.lineTo(x1, y1 - v1 * h);
    ctx.lineTo(x0, y0 - v1 * h);
    ctx.closePath();
  };

  Renderer.prototype._box = function (cx, cy, fx, fy, h, F) {
    var ctx = this.ctx;
    ctx.fillStyle = F[2];                       // right face - darkest
    ctx.beginPath();
    ctx.moveTo(cx + fx, cy - h);
    ctx.lineTo(cx, cy + fy - h);
    ctx.lineTo(cx, cy + fy);
    ctx.lineTo(cx + fx, cy);
    ctx.fill();
    ctx.fillStyle = F[1];                       // left face
    ctx.beginPath();
    ctx.moveTo(cx, cy + fy - h);
    ctx.lineTo(cx - fx, cy - h);
    ctx.lineTo(cx - fx, cy);
    ctx.lineTo(cx, cy + fy);
    ctx.fill();
    ctx.fillStyle = F[0];                       // roof
    ctx.beginPath();
    ctx.moveTo(cx, cy - fy - h);
    ctx.lineTo(cx + fx, cy - h);
    ctx.lineTo(cx, cy + fy - h);
    ctx.lineTo(cx - fx, cy - h);
    ctx.fill();
  };

  Renderer.prototype._roof = function (cx, cy, fx, fy, h, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - fy - h);
    ctx.lineTo(cx + fx, cy - h);
    ctx.lineTo(cx, cy + fy - h);
    ctx.lineTo(cx - fx, cy - h);
    ctx.fill();
  };

  /* lit-window grid on both visible faces */
  Renderer.prototype._windows = function (x, y, kind, cx, cy, fx, fy, h) {
    var sc = this.scale;
    if (sc < 0.5 || h < 10 * sc) return;
    var ctx = this.ctx;
    var rows = clamp(Math.round(h / (11 * sc)), 1, 10);
    var cols = h > 46 * sc ? 3 : 2;
    var night = this.N;
    var litFrac = 0.08 + 0.52 * night;
    var t = this.clock * 0.001;
    var side, c, r, u0, u1, v0, v1, seed;

    // dark glass first (one path, one fill) - skipped when zoomed out
    if (sc > 0.62) {
      ctx.fillStyle = this._C.winDark;
      ctx.beginPath();
      for (side = 0; side < 2; side++) {
        for (c = 0; c < cols; c++) {
          u0 = (c + 0.22) / cols; u1 = (c + 0.78) / cols;
          for (r = 0; r < rows; r++) {
            v0 = (r + 0.24) / rows; v1 = (r + 0.74) / rows;
            this._fq(cx, cy, fx, fy, h, side, u0, u1, v0, v1);
          }
        }
      }
      ctx.fill();
    }

    // then whatever is switched on
    ctx.fillStyle = 'rgba(' + HOT[kind] + ',' + (0.32 + 0.62 * night).toFixed(3) + ')';
    ctx.beginPath();
    var any = false;
    for (side = 0; side < 2; side++) {
      for (c = 0; c < cols; c++) {
        u0 = (c + 0.22) / cols; u1 = (c + 0.78) / cols;
        for (r = 0; r < rows; r++) {
          seed = side * 97 + c * 13 + r;
          var hv = hash3(x, y, seed);
          if (hv >= litFrac) continue;
          // a small share of windows blink slowly on and off at night
          if (night > 0.3 && hash3(x, y, seed + 601) > 0.93) {
            if (Math.sin(t * 0.35 + hv * 40) < 0) continue;
          }
          v0 = (r + 0.24) / rows; v1 = (r + 0.74) / rows;
          this._fq(cx, cy, fx, fy, h, side, u0, u1, v0, v1);
          any = true;
        }
      }
    }
    if (any) ctx.fill();
  };

  /* ---------- one structure ------------------------------------------ */

  /* Should this tile be swallowed into a 2x2 campus building?
     0 = draw normally, 1 = this tile is the anchor and draws all four,
     -1 = already covered by its anchor, skip. The anchor is the block's
     max corner, so painter's order by (x+y) still puts it in the right place.
     Only developed zone tiles merge: a young city keeps its fine grain, a
     mature one grows the big campus blocks the reference is full of. */
  Renderer.prototype._mergeRole = function (s, x, y) {
    var t = s.grid[MM.idx(x, y)];
    if (t !== T.RES && t !== T.COM && t !== T.IND) return 0;
    var bx = x - (x & 1), by = y - (y & 1);
    if (bx + 1 >= G || by + 1 >= G) return 0;
    var g = s.grid, lv = s.level, dx, dy, j;
    for (dx = 0; dx < 2; dx++) {
      for (dy = 0; dy < 2; dy++) {
        j = MM.idx(bx + dx, by + dy);
        if (g[j] !== t || (lv[j] || 0) < 2) return 0;
      }
    }
    return (x === bx + 1 && y === by + 1) ? 1 : -1;
  };

  /* A building as 1-3 stacked volumes rather than one cube. Silhouette
     variety is most of what separates a model village from a bar chart.
     Returns the height of the highest roof surface, for roofs.js. */
  Renderer.prototype._massing = function (x, y, lv, cx, cy, fx, fy, u0, v0, u1, v1, h, F, span) {
    var ctx = this.ctx, gfx = MM.gfx;
    if (!gfx) { this._box(cx, cy, fx * u1, fy * v1, h, F); return h; }
    var r = hash2(x * 3 + 11, y * 5 + 7), r2 = hash2(x + 91, y * 7 + 5);
    var du = u1 - u0, dv = v1 - v0;

    if (span > 1 || lv >= 3) {
      var podium = h * (0.32 + r * 0.20);
      gfx.prism(ctx, cx, cy, fx, fy, u0, v0, u1, v1, 0, podium, F);
      var iu = du * (0.13 + r * 0.10), iv = dv * (0.11 + r2 * 0.12);
      gfx.prism(ctx, cx, cy, fx, fy, u0 + iu, v0 + iv, u1 - iu * 0.55, v1 - iv * 0.55, podium, h, F);
      if (r2 > 0.45) {                       // low wing, so the plan isn't a rectangle
        gfx.prism(ctx, cx, cy, fx, fy, u0, v1 - dv * 0.33, u0 + du * 0.40, v1,
          0, podium + (h - podium) * 0.26, F);
      }
      return h;
    }
    if (r < 0.32) {                          // L-plan: two bars of unequal height
      var hb = h * (0.68 + r2 * 0.42);
      gfx.prism(ctx, cx, cy, fx, fy, u0, v0, u1, v0 + dv * 0.58, 0, h, F);
      gfx.prism(ctx, cx, cy, fx, fy, u0, v0 + dv * 0.44, u0 + du * 0.55, v1, 0, hb, F);
      return h > hb ? h : hb;
    }
    gfx.prism(ctx, cx, cy, fx, fy, u0, v0, u1, v1, 0, h, F);
    return h;
  };

  Renderer.prototype._structure = function (s, x, y, i) {
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var t = s.grid[i], lv = s.level[i] || 0;
    var sh = SHAPE[t] || SHAPE_DEF;
    var F = this._faces(t);
    var fxT = HW * sc, fyT = HH * sc;
    var cx = (x - y) * fxT + this.ox, cy = (x + y) * fyT + this.oy;
    var f = sh[2];
    var fx = fxT * f, fy = fyT * f;
    var h = (sh[0] + sh[1] * lv) * UNIT * sc;
    var night = this.N;

    // Identical heights across a level made whole blocks read as one slab.
    if (t === T.RES || t === T.COM || t === T.IND) {
      h *= 0.76 + hash2(x * 7 + 3, y * 11 + 5) * 0.56;
      if (MM.gfx && hash2(x + 313, y + 77) < 0.13) {
        F = MM.gfx.faces(ACCENT[(hash2(x + 7, y + 13) * ACCENT.length) | 0]);
      }
    }

    if (t === T.PARK) { this._park(x, y, cx, cy, fxT, fyT); return; }

    var role = this._mergeRole(s, x, y);
    if (role === -1) return;                    // drawn as part of its 2x2 campus
    var span = role === 1 ? 2 : 1;
    var back = (span - 1) * 2;                  // extra tiles this mass reaches back
    var u1 = f, v1 = f, u0 = -f - back, v0 = -f - back;

    var top = this._massing(x, y, lv, cx, cy, fxT, fyT, u0, v0, u1, v1, h, F, span);

    if (MM.roofs && MM.roofs.draw) {
      MM.roofs.draw(ctx, {
        x: x, y: y, kind: t, level: lv, cx: cx, cy: cy, fx: fxT, fy: fyT, top: top,
        u0: u0, v0: v0, u1: u1, v1: v1, scale: sc,
        seed: (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) & 1023
      });
    }
    if (span > 1) return;                       // campuses skip the tile-scale trim below

    var wk = WINDOWED[t];
    if (wk) this._windows(x, y, wk, cx, cy, fx, fy, h);

    if (t === T.COM && sc > 0.45) {
      // cyan / magenta neon band near the crown, plus a lick of glow
      var neon = hash2(x, y + 41) < 0.5 ? HOT.neonC : HOT.neonM;
      var a = 0.02 + 0.86 * night;      // signage is lit at night, not at noon
      ctx.fillStyle = 'rgba(' + neon + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.06, 0.94, 0.80, 0.87);
      this._fq(cx, cy, fx, fy, h, 1, 0.06, 0.94, 0.80, 0.87);
      ctx.fill();
      if (night > 0.15) {
        ctx.fillStyle = 'rgba(' + neon + ',' + (0.10 * night).toFixed(3) + ')';
        ctx.beginPath();
        this._fq(cx, cy, fx, fy, h, 0, -0.04, 1.04, 0.72, 0.95);
        this._fq(cx, cy, fx, fy, h, 1, -0.04, 1.04, 0.72, 0.95);
        ctx.fill();
      }
      if (lv >= 3) {                                  // rooftop mast
        ctx.strokeStyle = C.steel;
        ctx.lineWidth = Math.max(1, 1.2 * sc);
        ctx.beginPath();
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx, cy - h - 12 * sc);
        ctx.stroke();
      }
    } else if (t === T.TOWER) {
      // setback crown + blinking aviation beacon
      var f2 = 0.62, h2 = 1.15 * UNIT * sc;
      this._box(cx, cy - h, fx * f2, fy * f2, h2, F);
      if (sc > 0.45) {
        var blink = (Math.sin(this.clock * 0.0022 + hash2(x, y) * 6.28) > 0.5) ? 1 : 0.18;
        ctx.fillStyle = 'rgba(' + HOT.beacon + ',' + (0.35 + 0.6 * blink).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(cx, cy - h - h2 - 2 * sc, Math.max(1.2, 2.1 * sc), 0, TAU);
        ctx.fill();
      }
    } else if (t === T.IND) {
      // chimney on the north corner
      var chx = cx - fx * 0.34, chy = cy - fy * 0.34;
      var cw = fx * 0.16, cd = fy * 0.16, ch = (10 + lv * 3) * sc;
      this._box(chx, chy, cw, cd, ch, F);
      this._roof(chx, chy, cw, cd, ch, C.dark);
      this._plume(chx, chy - ch, 1.0, x, y);
    } else if (t === T.CLINIC) {
      ctx.fillStyle = C.cross;
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.30, 0.70, 0.50, 0.60);
      this._fq(cx, cy, fx, fy, h, 0, 0.44, 0.56, 0.36, 0.74);
      ctx.fill();
      if (night > 0.2) {
        ctx.fillStyle = 'rgba(' + HOT.winCool + ',' + (0.30 * night).toFixed(3) + ')';
        ctx.beginPath();
        this._fq(cx, cy, fx, fy, h, 1, 0.15, 0.85, 0.18, 0.40);
        ctx.fill();
      }
    } else if (t === T.SCHOOL) {
      // flagpole with a slowly waving pennant
      var px = cx, py = cy - h - fy;
      var ph = 16 * sc;
      ctx.strokeStyle = C.pole;
      ctx.lineWidth = Math.max(1, 1.2 * sc);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - ph);
      ctx.stroke();
      var wav = Math.sin(this.clock * 0.003 + x + y) * 1.6 * sc;
      ctx.fillStyle = C.flag;
      ctx.beginPath();
      ctx.moveTo(px, py - ph);
      ctx.lineTo(px + 9 * sc, py - ph + 2.5 * sc + wav);
      ctx.lineTo(px, py - ph + 5.5 * sc);
      ctx.fill();
      ctx.fillStyle = C.awningA;
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.36, 0.64, 0.00, 0.34);   // double doors
      ctx.fill();
    } else if (t === T.GROCERY) {
      // striped awning across the storefront
      ctx.fillStyle = C.awningA;
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.05, 0.95, 0.26, 0.44);
      this._fq(cx, cy, fx, fy, h, 1, 0.05, 0.95, 0.26, 0.44);
      ctx.fill();
      ctx.fillStyle = C.awningB;
      ctx.beginPath();
      for (var q = 0; q < 3; q++) {
        var u = 0.05 + q * 0.30;
        this._fq(cx, cy, fx, fy, h, 0, u, u + 0.15, 0.26, 0.44);
        this._fq(cx, cy, fx, fy, h, 1, u, u + 0.15, 0.26, 0.44);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(' + HOT.winWarm + ',' + (0.20 + 0.55 * night).toFixed(3) + ')';
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.10, 0.90, 0.05, 0.24);
      ctx.fill();
    } else if (t === T.CHILDCARE) {
      // bright pitched roof - the one primary-coloured thing on the block
      var apex = cy - h - fy - 9 * sc;
      var rc = hash2(x, y + 7) < 0.5 ? C.roofYel : C.roofRed;
      ctx.fillStyle = rc;
      ctx.beginPath();
      ctx.moveTo(cx + fx, cy - h);
      ctx.lineTo(cx, cy + fy - h);
      ctx.lineTo(cx, apex);
      ctx.fill();
      ctx.save();
      ctx.fillStyle = C.roofRed === rc ? C.roofYel : C.roofRed;
      ctx.globalAlpha *= 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy + fy - h);
      ctx.lineTo(cx - fx, cy - h);
      ctx.lineTo(cx, apex);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(' + HOT.winWarm + ',' + (0.25 + 0.5 * night).toFixed(3) + ')';
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.20, 0.44, 0.28, 0.68);
      this._fq(cx, cy, fx, fy, h, 0, 0.56, 0.80, 0.28, 0.68);
      ctx.fill();
    } else if (t === T.BUS) {
      // glazed shelter + sign pole
      ctx.fillStyle = 'rgba(' + HOT.winCool + ',' + (0.22 + 0.34 * night).toFixed(3) + ')';
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.12, 0.88, 0.15, 0.86);
      this._fq(cx, cy, fx, fy, h, 1, 0.12, 0.88, 0.15, 0.86);
      ctx.fill();
      this._roof(cx, cy, fx * 1.35, fy * 1.35, h, C.steel);
      var bx = cx + fxT * 0.52, by = cy + fyT * 0.16;
      ctx.strokeStyle = C.pole;
      ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - 17 * sc);
      ctx.stroke();
      ctx.fillStyle = C.dash;
      ctx.beginPath();
      ctx.arc(bx, by - 19 * sc, Math.max(1.6, 3 * sc), 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype._park = function (x, y, cx, cy, fx, fy) {
    var ctx = this.ctx, C = this._C, sc = this.scale;
    ctx.fillStyle = C.park;
    ctx.beginPath();
    ctx.moveTo(cx, cy - fy);
    ctx.lineTo(cx + fx, cy);
    ctx.lineTo(cx, cy + fy);
    ctx.lineTo(cx - fx, cy);
    ctx.fill();
    if (sc < 0.4) return;
    var n = 2 + ((hash2(x, y) * 3) | 0);
    for (var k = 0; k < n; k++) {
      var ux = (hash3(x, y, k * 3 + 1) - 0.5) * 1.1;
      var uy = (hash3(x, y, k * 3 + 2) - 0.5) * 1.1;
      var bx = cx + (ux - uy) * fx, by = cy + (ux + uy) * fy;
      var th = (11 + hash3(x, y, k * 3 + 3) * 7) * sc;
      var tw = th * 0.36;
      ctx.strokeStyle = C.trunk;
      ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - th * 0.35);
      ctx.stroke();
      ctx.fillStyle = C.treeA;
      ctx.beginPath();
      ctx.moveTo(bx, by - th);
      ctx.lineTo(bx + tw, by - th * 0.22);
      ctx.lineTo(bx - tw, by - th * 0.22);
      ctx.fill();
      ctx.fillStyle = C.treeB;
      ctx.beginPath();
      ctx.moveTo(bx, by - th);
      ctx.lineTo(bx - tw * 0.55, by - th * 0.3);
      ctx.lineTo(bx - tw * 0.05, by - th * 0.3);
      ctx.fill();
    }
  };

  /* rising steam - fully procedural, no particle state, no flicker */
  Renderer.prototype._plume = function (px, py, strength, x, y) {
    var sc = this.scale;
    if (sc < 0.42) return;
    var ctx = this.ctx;
    var base = this.clock * 0.00028 + hash2(x, y) * 3.1;
    for (var k = 0; k < 3; k++) {
      var p = (base + k * 0.334) % 1;
      var r = (2.2 + p * 8) * sc * strength;
      var a = 0.16 * (1 - p) * strength * (0.5 + 0.5 * this.N);
      if (a < 0.01) continue;
      ctx.fillStyle = 'rgba(198,210,232,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px + Math.sin(p * 3 + k) * 3 * sc, py - p * 26 * sc, r, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype._manholes = function () {
    if (this.scale < 0.5 || !this._nRoad) return;
    var sc = this.scale, fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    for (var k = 0; k < this._nRoad; k++) {
      var i = this._bRoad[k], x = i % G, y = (i / G) | 0;
      if (hash2(x + 313, y) < 0.972) continue;
      this._plume((x - y) * fx + ox, (x + y) * fy + oy, 0.7, x + 313, y);
    }
  };

  /* ---------- traffic -------------------------------------------------- */

  Renderer.prototype._rebuildNet = function (s) {
    var g = s.grid, nr = 0, nb = 0;
    for (var i = 0; i < g.length; i++) {
      if (g[i] === T.ROAD) this._roads[nr++] = i;
      else if (g[i] === T.BUS) this._busT[nb++] = i;
    }
    this._nRoads = nr; this._nBusT = nb;
  };

  Renderer.prototype._pickDir = function (m, cur) {
    if (!m) return cur < 0 ? 0 : cur;
    if (cur >= 0 && (m & (1 << cur)) && rnd() < 0.62) return cur;
    var rev = cur >= 0 ? (cur ^ 1) : -1, n = 0;
    for (var k = 0; k < 4; k++) if ((m & (1 << k)) && k !== rev) DIRSCRATCH[n++] = k;
    if (!n) return rev >= 0 ? rev : 0;
    return DIRSCRATCH[(rnd() * n) | 0];
  };

  Renderer.prototype._spawn = function (s, v, nearBus) {
    if (!this._nRoads) return false;
    var i = -1;
    if (nearBus && this._nBusT) {                    // buses start life near a stop
      var b = this._busT[(rnd() * this._nBusT) | 0];
      var bx = b % G, by = (b / G) | 0;
      for (var k = 0; k < 4; k++) {
        var nx = bx + DIRS[k][0], ny = by + DIRS[k][1];
        if (inB(nx, ny) && s.grid[ny * G + nx] === T.ROAD) { i = ny * G + nx; break; }
      }
    }
    if (i < 0) i = this._roads[(rnd() * this._nRoads) | 0];
    var x = i % G, y = (i / G) | 0;
    var m = this._mask(s, x, y);
    if (!m) return false;
    var d = this._pickDir(m, -1);
    v.x = x; v.y = y; v.d = d; v.dx = DIRS[d][0]; v.dy = DIRS[d][1]; v.t = rnd();
    return true;
  };

  Renderer.prototype._traffic = function (s, dt) {
    var veh = this._veh;
    // The first wantV entries drive, the rest walk. Kind is derived from the
    // index every frame so a zoom that changes the pedestrian budget never
    // turns a walker into a taxi mid-street.
    var wantV = Math.min(MAX_V, (this._nRoads * 0.32) | 0);
    var wantP = this.scale < 0.55 ? 0 : Math.min(MAX_P, (this._nRoads * 0.55) | 0);
    var want = wantV + wantP;
    while (veh.length > want) veh.pop();
    var guardSpawn = 0;
    while (veh.length < want && guardSpawn++ < 12) {
      var vk = (this._nBusT > 0 && rnd() < 0.18) ? 1 : 0;
      var nv = { x: 0, y: 0, dx: 1, dy: 0, d: 0, t: 0, kind: vk, vk: vk,
        jit: 0.8 + rnd() * 0.45, lane: rnd() < 0.5 ? -1 : 1, tone: (rnd() * 6) | 0 };
      if (!this._spawn(s, nv, vk === 1)) break;
      veh.push(nv);
    }

    var spd = 0.00115 * (1 - Math.min(0.72, (s.traffic || 0) / 140));
    var head = this._vhead;
    head.fill(-1);
    for (var k = 0; k < veh.length; k++) {
      var v = veh[k];
      v.kind = k < wantV ? v.vk : 2;
      v.t += spd * dt * v.jit * (v.kind === 2 ? 0.30 : (v.kind ? 0.8 : 1));
      var guard = 0;
      while (v.t >= 1 && guard++ < 4) {
        v.t -= 1;
        var nx = v.x + v.dx, ny = v.y + v.dy;
        if (!inB(nx, ny) || s.grid[ny * G + nx] !== T.ROAD) {
          if (!this._spawn(s, v, v.kind === 1)) v.t = 0;
          break;
        }
        v.x = nx; v.y = ny;
        v.d = this._pickDir(this._mask(s, nx, ny), v.d);
        v.dx = DIRS[v.d][0]; v.dy = DIRS[v.d][1];
      }
      var dg = clamp((v.x + v.dx * v.t + v.y + v.dy * v.t) | 0, 0, 2 * G - 1);
      this._vnext[k] = head[dg];
      head[dg] = k;
    }
  };

  Renderer.prototype._drawVehDiag = function (d) {
    if (this._skipVeh) return;                 // static pass: traffic is drawn live
    var k = this._vhead[d];
    if (k < 0) return;
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var night = this.N;
    while (k >= 0) {
      var v = this._veh[k];
      // pedestrians walk the kerb, traffic keeps to the right-hand lane
      var lat = v.kind === 2 ? 0.40 * v.lane : 0.17;
      var wx = v.x + v.dx * v.t - v.dy * lat;
      var wy = v.y + v.dy * v.t + v.dx * lat;
      var cx = (wx - wy) * fx + ox, cy = (wx + wy) * fy + oy;
      if (v.kind === 2) {
        if (cx > -20 && cx < this.w + 20 && cy > -20 && cy < this.h + 30) this._person(cx, cy, v, sc, night);
        k = this._vnext[k];
        continue;
      }
      if (cx > -30 && cx < this.w + 30 && cy > -30 && cy < this.h + 40) {
        var hl = (v.kind ? 0.26 : 0.17), hw = v.kind ? 0.095 : 0.08;
        var dx = v.dx, dy = v.dy, px = -dy, py = dx;
        var axx = (dx - dy) * fx * hl, axy = (dx + dy) * fy * hl;
        var bxx = (px - py) * fx * hw, bxy = (px + py) * fy * hw;
        var bh = (v.kind ? 6.4 : 4.2) * sc;

        ctx.fillStyle = C.tire;
        ctx.beginPath();
        ctx.moveTo(cx + axx + bxx, cy + axy + bxy);
        ctx.lineTo(cx + axx - bxx, cy + axy - bxy);
        ctx.lineTo(cx - axx - bxx, cy - axy - bxy);
        ctx.lineTo(cx - axx + bxx, cy - axy + bxy);
        ctx.fill();

        ctx.fillStyle = v.kind ? C.bus : C.cab;
        ctx.beginPath();
        ctx.moveTo(cx + axx + bxx, cy + axy + bxy - bh * 0.55);
        ctx.lineTo(cx + axx - bxx, cy + axy - bxy - bh * 0.55);
        ctx.lineTo(cx - axx - bxx, cy - axy - bxy - bh * 0.55);
        ctx.lineTo(cx - axx + bxx, cy - axy + bxy - bh * 0.55);
        ctx.fill();

        ctx.fillStyle = v.kind ? C.busTop : C.cabTop;
        ctx.beginPath();
        ctx.moveTo(cx + axx * 0.72 + bxx * 0.8, cy + axy * 0.72 + bxy * 0.8 - bh);
        ctx.lineTo(cx + axx * 0.72 - bxx * 0.8, cy + axy * 0.72 - bxy * 0.8 - bh);
        ctx.lineTo(cx - axx * 0.72 - bxx * 0.8, cy - axy * 0.72 - bxy * 0.8 - bh);
        ctx.lineTo(cx - axx * 0.72 + bxx * 0.8, cy - axy * 0.72 + bxy * 0.8 - bh);
        ctx.fill();

        if (night > 0.25 && sc > 0.5) {
          ctx.fillStyle = 'rgba(' + HOT.head + ',' + (0.55 * night).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(cx + axx * 1.5, cy + axy * 1.5 - bh * 0.5, Math.max(1, 1.5 * sc), 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(' + HOT.tail + ',' + (0.5 * night).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(cx - axx * 1.5, cy - axy * 1.5 - bh * 0.5, Math.max(1, 1.2 * sc), 0, TAU);
          ctx.fill();
        }
      }
      k = this._vnext[k];
    }
  };

  /* A person: two pixels of coat, one of head. At this scale that is all a
     figure needs - what sells it is that there are hundreds of them and
     they are all walking somewhere. */
  var COATS = ['#e4574a', '#3f6fd0', '#f0a83c', '#4aa86a', '#8f5fc0', '#e6e2da'];
  var SKINS = ['#e8bb92', '#c58f62', '#8d5a3b', '#f0d2ad'];
  Renderer.prototype._person = function (cx, cy, v, sc, night) {
    var ctx = this.ctx;
    var bob = Math.sin(this.clock * 0.011 + v.jit * 9) * 0.7 * sc;
    var w = Math.max(1, 1.7 * sc), h = Math.max(2.4, 5.0 * sc);
    ctx.fillStyle = COATS[v.tone % COATS.length];
    ctx.fillRect(cx - w * 0.5, cy - h + bob, w, h * 0.72);
    ctx.fillStyle = SKINS[(v.tone + (v.lane > 0 ? 1 : 2)) % SKINS.length];
    ctx.fillRect(cx - w * 0.42, cy - h - w * 0.7 + bob, w * 0.84, w * 0.8);
    if (night > 0.4) return;
    ctx.fillStyle = 'rgba(30,40,52,0.22)';
    ctx.fillRect(cx - w * 0.7, cy - 0.6 * sc, w * 1.4, Math.max(1, 1.1 * sc));
  };

  /* ---------- structures pass (back to front, traffic interleaved) ---- */

  Renderer.prototype._structures = function (s) {
    var n = this._nBld, vd = 0, k, ctx = this.ctx, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var P = MM.props, traf = (s.traffic || 0) / 100;
    var o = P ? { x: 0, y: 0, kind: 0, level: 0, cx: 0, cy: 0, fx: fx, fy: fy, mask: 0, scale: sc, busy: 0 } : null;
    // Zoned land is drawn a whole block at a time by lots.js: it groups
    // neighbouring tiles into lots and draws each as one designed complex.
    // Civic buildings are still one tile, one model, and fall through below.
    var LT = MM.lots, lo = LT ? { s: s, x: 0, y: 0, cx: 0, cy: 0, fx: fx, fy: fy, scale: sc } : null;
    // Bridges are elevated over water, so they have to paint between what is
    // behind them and what is in front. This sweep already orders by diagonal
    // for traffic; riding along with it gets that ordering for nothing.
    var BR = MM.bridges, bo = null;
    if (BR) { try { BR.plan(s); } catch (e) { BR = null; } }
    if (BR) bo = { ox: ox, oy: oy, fx: fx, fy: fy, scale: sc };

    for (k = 0; k < n; k++) {
      var i = this._bBld[k], x = i % G, y = (i / G) | 0, d = x + y;
      while (vd <= d) {
        if (bo) { try { BR.drawDiag(ctx, bo, vd); } catch (e) {} }
        this._drawVehDiag(vd); vd++;
      }

      if (LT) {
        var lr = LT.role(s, x, y);
        if (lr === -1) continue;                 // its lot's anchor draws it
        if (lr === 1) {
          lo.s = s; lo.x = x; lo.y = y;
          lo.cx = (x - y) * fx + ox; lo.cy = (x + y) * fy + oy;
          LT.draw(ctx, lo);
          continue;
        }
      }

      if (o) {
        var lv = s.level[i] || 0;
        o.x = x; o.y = y; o.kind = s.grid[i]; o.level = lv;
        o.cx = (x - y) * fx + ox; o.cy = (x + y) * fy + oy;
        o.mask = this._mask(s, x, y);
        o.busy = clamp(lv * 0.15 + traf * 0.4, 0, 1);
        if (P.ground) { try { P.ground(ctx, o); } catch (e) {} }
      }
      this._structure(s, x, y, i);
      if (o && P.fringe) { try { P.fringe(ctx, o); } catch (e) {} }
    }
    while (vd < 2 * G) {
      if (bo) { try { BR.drawDiag(ctx, bo, vd); } catch (e) {} }
      this._drawVehDiag(vd); vd++;
    }
  };

  /* ---------- hover / selection -------------------------------------- */

  Renderer.prototype._hoverPass = function (s) {
    var hv = this.hover;
    if (!hv || !inB(hv.x, hv.y)) return;
    var ctx = this.ctx, sc = this.scale;
    var fx = HW * sc, fy = HH * sc;
    var cx = (hv.x - hv.y) * fx + this.ox, cy = (hv.x + hv.y) * fy + this.oy;
    var i = hv.y * G + hv.x, cur = s.grid[i], sel = s.selected;
    var info = MM.TILE_INFO ? MM.TILE_INFO[sel] : null;

    var valid;
    if (cur === T.WATER) valid = false;
    else if (sel === T.BULLDOZE) valid = cur !== T.EMPTY && s.treasury >= (info ? info.cost : 0);
    else if (info) valid = cur !== sel && s.treasury >= info.cost;
    else valid = false;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - fy);
    ctx.lineTo(cx + fx, cy);
    ctx.lineTo(cx, cy + fy);
    ctx.lineTo(cx - fx, cy);
    ctx.closePath();
    ctx.fillStyle = valid ? 'rgba(86,226,138,0.20)' : 'rgba(232,72,64,0.22)';
    ctx.fill();
    var pulse = 0.72 + 0.28 * Math.sin(this.clock * 0.006);
    ctx.strokeStyle = 'rgba(255,190,86,' + pulse.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.4, 2 * sc);
    ctx.stroke();
    ctx.restore();
  };

  /* ================================================================== *
   * light after dark
   *
   * The cached city is baked at noon (see _daynight): re-rendering 1900
   * tiles of detail every time the sun moves cost a slideshow. So night
   * happens here instead, in screen space, over the blit - one multiply
   * for the ambient colour, then additive passes for everything that is
   * its own light source. The whole thing is four fills plus one path.
   * ================================================================== */

  var NIGHT_TINT = [64, 84, 148];
  var DUSK_WARM  = [64, 34, 10];             // added, not multiplied

  Renderer.prototype._tint = function () {
    var n = this.N, gd = this.golden;
    if (n < 0.02 && gd < 0.02) return;
    var ctx = this.ctx;
    ctx.save();
    if (n > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(0.90, n * 0.96);
      ctx.fillStyle = rgbs(NIGHT_TINT);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (gd > 0.02) {                         // low sun: warm light, not a filter
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * gd;
      ctx.fillStyle = rgbs(DUSK_WARM);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  };

  /* Per-lot window geometry, rebuilt only when the plan changes. Five
     numbers a lot: anchor tile, size in tiles, and roof height in px at
     scale 1. Everything else is derived at draw time, so a pan or a zoom
     costs no rebuild. */
  Renderer.prototype._rebuildLights = function (s) {
    var LT = MM.lots;
    this._litN = 0;
    if (!LT || !LT.shape) return;
    LT.plan(s);
    var L = LT.lots, n = L.length, k, need = n * 5;
    if (!this._lit || this._lit.length < need) this._lit = new Float32Array(Math.max(64, need));
    var a = this._lit, w = 0;
    for (k = 0; k < n; k++) {
      var lot = L[k], sh = LT.shape(s, lot.x1, lot.y1);
      if (!sh || sh.top < 18) continue;      // parks and yards have no windows
      a[w] = lot.x1; a[w + 1] = lot.y1; a[w + 2] = lot.w; a[w + 3] = lot.h; a[w + 4] = sh.top;
      w += 5;
    }
    this._litN = w;
  };

  /* Painting 4000 window quads costs ~10ms - too much to repeat every frame
     for an image that only changes when the camera does. Bake the whole layer
     into the cache canvas at full brightness; the clock then only scales the
     alpha of one blit. */
  Renderer.prototype._paintWindows = function (s) {
    if (!MM.gfx) return;
    var key = (s.rev | 0) + '|' + (MM.lots && MM.lots.lots ? MM.lots.lots.length : 0);
    if (key !== this._litKey) { this._litKey = key; this._rebuildLights(s); }
    if (!this._litN) return;

    var ctx = this.ctx, sc = this.scale, fx = HW * sc, fy = HH * sc;
    var ox = this.ox, oy = this.oy, a = this._lit, W = this.w, H = this.h;
    var Gg = MM.gfx, k, c, r;
    ctx.save();
    ctx.beginPath();
    for (k = 0; k < this._litN; k += 5) {
      var x = a[k], y = a[k + 1], lw = a[k + 2], lh = a[k + 3], top = a[k + 4] * sc;
      var cx = (x - y) * fx + ox, cy = (x + y) * fy + oy;
      // a lot is at most three tiles deep, so this box comfortably contains it
      if (cx < -4 * fx - lw * fx || cx > W + 4 * fx + lh * fx) continue;
      if (cy - top < -4 * fy || cy > H + 4 * fy) continue;
      var u0 = -2 * (lw - 1) - 1, v0 = -2 * (lh - 1) - 1;
      // Supertalls are ~220px at scale 1; a 9-row cap spread over that height
      // made the windows read as storey-high slabs.
      var rows = clamp(Math.round(top / (22 * sc)), 1, 18);
      var h0 = top * 0.12, h1 = top * 0.94;
      var dh = (h1 - h0) / rows;
      var colsL = clamp(Math.round(lw * 2.6), 2, 9), du = (1 - u0) / colsL;
      var colsR = clamp(Math.round(lh * 2.6), 2, 9), dv = (1 - v0) / colsR;
      for (r = 0; r < rows; r++) {
        var hh = h0 + r * dh, ha = hh + dh * 0.26, hb = hh + dh * 0.74;
        for (c = 0; c < colsL; c++) {
          if (hash3(x * 7 + c, y * 5 + r, 3) > 0.34) continue;
          var uu = u0 + c * du;
          Gg.wallQuad(ctx, cx, cy, fx, fy, 0, 1, uu + du * 0.26, uu + du * 0.74, ha, hb);
        }
        for (c = 0; c < colsR; c++) {
          if (hash3(x * 11 + c, y * 3 + r, 9) > 0.34) continue;
          var vv = v0 + c * dv;
          Gg.wallQuad(ctx, cx, cy, fx, fy, 1, 1, vv + dv * 0.26, vv + dv * 0.74, ha, hb);
        }
      }
    }
    ctx.fillStyle = 'rgb(' + HOT.winWarm + ')';
    ctx.fill();
    ctx.restore();
  };

  /* Street lamps glow live. The poles are baked into the cache with the
     rest of the furniture; only the light moves with the clock. */
  Renderer.prototype._lampGlow = function () {
    var glow = this.N;
    if (glow < 0.10 || this.scale < 0.5) return;
    var ctx = this.ctx, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var n = this._nRoad, lit = this._lampBuf, nl = 0, k, i, x, y;
    for (k = 0; k < n && nl < lit.length - 1; k++) {
      i = this._bRoad[k]; x = i % G; y = (i / G) | 0;
      if (hash2(x, y + 911) < 0.74) continue;
      var px = (x - y) * fx + ox + fx * 0.66, py = (x + y) * fy + oy;
      if (px < -40 || px > this.w + 40 || py < -40 || py > this.h + 60) continue;
      lit[nl++] = px; lit[nl++] = py;
    }
    if (!nl) return;
    var head = 13 * sc;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var q = 0; q < 3; q++) {
      var rr = head * RING_R[q];
      ctx.fillStyle = 'rgba(' + HOT.lamp + ',' + (RING_A[q] * glow).toFixed(3) + ')';
      ctx.beginPath();
      for (k = 0; k < nl; k += 2) {
        ctx.moveTo(lit[k] + rr, lit[k + 1] - head);
        ctx.arc(lit[k], lit[k + 1] - head, rr, 0, TAU);
      }
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------- frame --------------------------------------------------- */

  /* Draw the unchanging city into the offscreen cache. Everything that moves -
     traffic, steam, the hover cursor - is drawn live on top of the blit. */
  Renderer.prototype._renderStatic = function (s) {
    var M = CACHE_M, dpr = Math.min(this.dpr || 1, 2);
    var W = this.w + 2 * M, H = this.h + 2 * M;
    var cc = this._cc;
    var cw = Math.max(1, Math.round(W * dpr)), ch = Math.max(1, Math.round(H * dpr));
    if (cc.width !== cw || cc.height !== ch) { cc.width = cw; cc.height = ch; this._cctx = null; }
    if (!this._cctx) this._cctx = cc.getContext('2d');
    var lc = this._lc;
    if (lc.width !== cw || lc.height !== ch) { lc.width = cw; lc.height = ch; this._lctx = null; }
    if (!this._lctx) this._lctx = lc.getContext('2d');

    // Draw a viewport-plus-margin of city, remembering where the camera was.
    // Panning then blits this at an offset instead of re-rendering, so a drag
    // stays smooth until the camera walks past the margin.
    var live = this.ctx, ox0 = this.ox, oy0 = this.oy, w0 = this.w, h0 = this.h;
    this.ctx = this._cctx;
    this.ox += M; this.oy += M; this.w = W; this.h = H;

    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);            // transparent: the sky is drawn live
    this._skipVeh = true;

    var n0 = this.N;
    this.N = 0;                           // the cached city is always at noon
    if (MM.gfx) MM.gfx.setLight(this._rm, this._gm, this._bm, 0);

    this._collect(s);
    this._ground(s);
    this._roadPass(s);
    this._overlayPass(s);
    this._shadows(s);

    var dim = this.overlay && this.overlay !== 'none';
    if (dim) ctx.globalAlpha = 0.55;
    this._structures(s);
    if (dim) ctx.globalAlpha = 1;

    // the window-light layer, same camera, painted at full brightness
    this.ctx = this._lctx;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, W, H);
    if (this.scale >= 0.42) this._paintWindows(s);

    this._skipVeh = false;
    this.N = n0;
    this.ctx = live;
    this.ox = ox0; this.oy = oy0; this.w = w0; this.h = h0;
    this._cacheOx = ox0; this._cacheOy = oy0; this._cacheW = W; this._cacheH = H;
  };

  Renderer.prototype.draw = function (s, dtMs) {
    var dt = dtMs > 0 ? (dtMs > 200 ? 200 : dtMs) : 16;
    this.clock += dt;
    this._frames++;

    // keep the backing store in step with a CSS-driven resize we were not told about
    if ((this._frames & 15) === 0) {
      var r = this.canvas.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 &&
        (Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1)) this.resize();
    }

    if (!s || !s.grid) return;

    this._daynight(s, dt);
    this._palette();

    if (this.clock - this._netT > 400) { this._netT = this.clock; this._rebuildNet(s); }
    this._traffic(s, dt);

    var ctx = this.ctx, L = this.L, gold = this.golden;

    // sky (viewport-relative, so it is never cached)
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, rgbs(lerp3([18, 27, 52], [96, 164, 228], L)));
    var bot = lerp3([34, 40, 62], [198, 226, 244], L);
    bot = lerp3(bot, [236, 158, 92], gold * 0.7);
    g.addColorStop(1, rgbs(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    if (MM.light) MM.light.sky(ctx, this);   // the disc the whole scene points at

    // The city is deterministic: every prop, roof and marking depends only on
    // the camera, the grid and the light. Redrawing 1400 tiles of detail every
    // frame to produce a pixel-identical image cost ~190ms. Render the static
    // layers once into an offscreen canvas and blit. The light is bucketed so
    // the day/night lerp does not invalidate every frame, and pan is absorbed
    // by the margin rather than by a re-render.
    var ov = this.overlay || 'none';
    // Key on the LIGHT, not on the clock. L saturates at 0 through most of the
    // night and at 1 through most of the day, so these multipliers are literally
    // constant for long stretches and the cache survives them; only dawn and
    // dusk actually repaint. Keying on phase re-rendered every 0.3s forever.
    var key = this.scale.toFixed(3) + '|' + this.w + 'x' + this.h + '|' +
      (s.rev | 0) + '|' + ov + '|' +
      // no light term: the cached city does not change with the clock
      // the heatmaps are recomputed daily, so they alone track the calendar
      (ov === 'none' ? '' : '|' + (s.day | 0));

    var dx = this.ox - this._cacheOx, dy = this.oy - this._cacheOy;
    var slipped = Math.abs(dx) > CACHE_M - 8 || Math.abs(dy) > CACHE_M - 8;
    if (key !== this._cacheKey || slipped || !this._cacheW) {
      this._renderStatic(s);
      this._cacheKey = key;
      dx = 0; dy = 0;
    }
    ctx.drawImage(this._cc, dx - CACHE_M, dy - CACHE_M, this._cacheW, this._cacheH);

    // The water surface is live, over the blit and under the traffic.
    if (MM.light) MM.light.shimmer(ctx, this, s);

    for (var d = 0; d < 2 * G; d++) this._drawVehDiag(d);

    this._manholes();

    // Sky and water live above the city and below the light: a balloon at
    // dusk should take the same tint the rooftops do.
    if (MM.sky) {
      this._sky = this._sky || {};
      var K = this._sky;
      K.s = s; K.clock = this.clock; K.ox = this.ox; K.oy = this.oy;
      K.scale = this.scale; K.w = this.w; K.h = this.h;
      K.L = this.L; K.N = this.N; K.golden = this.golden;
      try { MM.sky.draw(ctx, K); } catch (e) { /* ambience must never kill a frame */ }
    }

    this._tint(s);
    if (MM.light) MM.light.glow(ctx, this);      // directional wash from the sun
    if (this.N > 0.10 && this.scale >= 0.42) {   // lit windows, one blit
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, 0.72 * this.N);
      ctx.drawImage(this._lc, dx - CACHE_M, dy - CACHE_M, this._cacheW, this._cacheH);
      ctx.restore();
    }
    this._lampGlow();

    this._hoverPass(s);

    if (this._vig) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.35 * this.N;
      ctx.fillStyle = this._vig;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

  };

  function lerp3 (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgbs (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  MM.Renderer = Renderer;
})(window.MM);

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
  var CACHE_M = 192;                       // smallest static-cache margin, css px
  /* Device-pixel cap for the city cache (~40MB at 4 bytes a pixel). The grid
     is only 48x48, so at ordinary zooms the whole city fits inside this and a
     pan never rebuilds anything - which is the entire point, because a rebuild
     is most of a second. The cap is what stops that turning into a quarter of
     a gigabyte of canvas when someone zooms all the way in. */
  var CACHE_PX = 10e6;
  /* When the whole city is *nearly* affordable, buy it by softening the cache
     rather than by giving up coverage: half a device pixel of sharpness on a
     static image is a far better trade than a 600ms freeze every time the
     camera moves. Below this, coverage is the thing that gets dropped - and
     that is the zoomed-right-in case, where sharpness is what you came for
     and there are few enough tiles on screen to rebuild cheaply. */
  var CACHE_DPR_MIN = 1.0;
  /* How far the cached image may be stretched before it has to be redrawn mid
     gesture. Generous, and deliberately lopsided: shrinking the cached image
     only supersamples it and stays sharp, while blowing it up goes soft, so
     the two ends are not worth the same tolerance. A whole wheel burst rides
     on one image and sharpens the moment the wheel stops - which is how a map
     behaves, and much better than the alternative of a 750ms rebuild landing
     in the middle of the gesture. */
  var BLIT_MIN = 0.12, BLIT_MAX = 3.00;
  /* The same bargain, made for a much longer gesture. The shell rides the
     camera from a whole-city 0.40 out at the title to 1.60 down in the blocks,
     and it does it in one unbroken scroll - a 4x sweep, which crosses BLIT_MAX
     partway along the airfield-to-downtown leg and dropped a 200ms rebuild
     into the middle of the ride, at the same point on the line every single
     time. Nothing there is a hole: the image is only soft, and it is soft
     while the camera is flying past it behind a swaying window. So a
     cinematic camera gets a wider window and sharpens when the ride stops -
     see `cinematic` in draw(). */
  var RIDE_MIN = 0.04, RIDE_MAX = 9.00;
  /* How long the camera has to be still before the cache is redrawn at the
     scale it is now being shown at. Short enough to feel immediate at the end
     of a wheel spin, long enough not to fire inside one. */
  var SETTLE_MS = 180;
  /* The window-light layer is a bloom - soft glows blitted additively at less
     than full alpha - so it carries no detail worth a device pixel. Holding it
     at half the cache's resolution is invisible and takes a second full-size
     canvas off the books.

     That matters more than it sounds. Chromium keeps 2D canvases on the GPU
     only up to a memory budget, and silently drops the lot to software past
     it - at roughly ten times the cost. The city cache, its light layer, the
     shadow layer and the live canvas are all large and all live at once, so
     total canvas memory is a real constraint here, not an afterthought:
     tools/perf.js reports it for that reason. */
  var LIGHT_RES = 0.5;

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // d ^ 1 == reverse
  var DIRSCRATCH = [0, 0, 0, 0];
  var RAILSCRATCH = [0, 0, 0, 0];
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
    ballast:  [132, 124, 112],    // crushed stone under the sleepers
    sleeper:  [ 92,  74,  58],
    rail:     [186, 190, 196],
    railCar:  [206, 210, 214],    // stainless rolling stock

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
  // Matched to gfx.js so a civic block sits in the same light as a lot.
  var LM = 0.74, RM = 0.63;                 // left face / right face darkening
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
  FACE[T.STATION]   = box([224, 216, 238]);
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
  SHAPE[T.STATION]   = [0.90, 0.00, 0.74];
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

    this.scale = 0.9;
    this.ox = 0; this.oy = 0;
    this.w = 1; this.h = 1; this.dpr = 1;

    this.hover = null;
    this.pick = null;                        // src/inspect.js owns this
    this.overlay = 'none';
    /* Set while something other than a player is flying the camera - the
       shell's ride, and the flight out of it. src/shell.js owns this; all it
       buys is a wider stretch window on the static cache (see draw()), so a
       long sweep does not stop to redraw the city halfway down it. */
    this.cinematic = false;
    /* A city to draw INSTEAD of the one the caller passes, for the length of
       the title screen. src/shell.js owns this too. See draw(). */
    this.showing = null;

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
    this._bRail = new Int32Array(N); this._nRail = 0;
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
    /* Monotonic, never reused. An agent's id is its identity for as long as
       it is in the city - including across the respawn that teleports it to
       a fresh road when it runs out of street - which is the one property
       src/ens.js needs to hand it a stable name. */
    this._vid = 0;
    this._vhead = new Int32Array(2 * G);
    this._vnext = new Int32Array(MAX_V + MAX_P);
    this._lampBuf = new Float64Array(1600);

    // offscreen cache for the static city (see _renderStatic)
    this._cc = document.createElement('canvas');
    this._cctx = null;
    this._lc = document.createElement('canvas');     // window lights, same frame
    this._lctx = null;
    this._shc = document.createElement('canvas');    // shadow layer, blurred on blit
    this._shctx = null;
    this._cacheKey = '';
    this._cacheOx = 0; this._cacheOy = 0; this._cacheW = 0; this._cacheH = 0;
    this._cacheMx = CACHE_M; this._cacheMy = CACHE_M;
    this._cacheScale = 0; this._cacheDpr = 1;
    // the region the cache actually holds, in camera-independent screen units
    this._covL = 0; this._covR = 0; this._covT = 0; this._covB = 0;
    this._still = 0;                 // frames the camera has been at rest
    this._settleMs = 0;
    this._kx = 0; this._ky = 0; this._kv = 0; this._kboost = 1;
    this._flx = 0; this._fly = 0;
    this._cacheRev = -1; this._look = null; this._lookPrev = null;
    this._clipR = null;
    this._lastOx = NaN; this._lastOy = NaN; this._lastScale = NaN;
    this._skipVeh = false;

    // baked full-screen washes (see _bakeAtmo)
    this._bgL = null; this._bgLx = null;
    this._addL = null; this._addLx = null;
    this._ovL = null; this._ovLx = null;
    this._atmoKey = ''; this._addOn = false;
    this._lampSprite = null; this._lampKey = '';

    this.buildMode = false;
    this._bindNavigation();

    this.resize();
  }

  // Exploration is the default. Capture only the gestures owned here, leaving
  // the existing build/road-painting handlers intact when a tool is selected.
  Renderer.prototype._bindNavigation = function () {
    var self = this, drag = null, touches = new Map(), pinch = 0, touchMoved = false;
    this.canvas.addEventListener('mousedown', function (e) {
      if (self.buildMode || e.button !== 0) return;
      self.stopPan(); drag = { x: e.clientX, y: e.clientY };
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
    this.canvas.addEventListener('mousemove', function (e) {
      if (!drag && self.buildMode) return;
      if (drag) { self.panBy(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; }
      self.hover = null;
      if (drag) e.stopImmediatePropagation();
    }, true);
    window.addEventListener('mouseup', function () { drag = null; });
    window.addEventListener('blur', function () { drag = null; touches.clear(); });
    this.canvas.addEventListener('mouseleave', function () { drag = null; });
    this.canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      e.preventDefault(); self.stopPan();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
      if (self.canvas.setPointerCapture) self.canvas.setPointerCapture(e.pointerId);
      if (touches.size === 1) touchMoved = false;
      if (touches.size > 1) { touchMoved = true; var a = Array.from(touches.values()); pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    }, { passive: false });
    this.canvas.addEventListener('pointermove', function (e) {
      var p = touches.get(e.pointerId); if (!p) return;
      e.preventDefault();
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > 6) touchMoved = true;
      if (touches.size === 1) { if (touchMoved) self.panBy(dx, dy); }
      else {
        var a = Array.from(touches.values()), distance = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (distance > 0 && pinch > 0) {
          var rect = self.canvas.getBoundingClientRect(), mx = (a[0].x + a[1].x) / 2 - rect.left, my = (a[0].y + a[1].y) / 2 - rect.top;
          var old = self.scale; self.scale = clamp(old * distance / pinch, MIN_S, MAX_S);
          self.ox = mx - (mx - self.ox) * self.scale / old; self.oy = my - (my - self.oy) * self.scale / old;
        }
        pinch = distance;
      }
    }, { passive: false });
    function end (e) {
      var p = touches.get(e.pointerId); if (!p) return;
      // A tap places one tile; drags and pinches never spend city funds.
      if (e.type !== 'pointercancel' && !touchMoved && self.buildMode && MM.state && MM.build && !MM.state.pending && !MM.state.gameOver) {
        var t = self.screenToTile(e.clientX, e.clientY);
        if (t) {
          var result = MM.build(MM.state, t.x, t.y, MM.state.selected);
          if (result.ok && MM.audio) MM.audio.play('place');
          else if (result.msg && MM.ui) MM.ui.toast(result.msg, 'bad');
        }
      }
      touches.delete(e.pointerId); pinch = 0;
    }
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  };

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
    var dpr = Math.min(window.devicePixelRatio || 1, MM.visuals ? MM.visuals.profile.dpr : 2);
    // Rotation and browser resizing keep the same world point at the centre.
    if (this.w > 1 && this.h > 1) { this.ox += (w - this.w) * .5; this.oy += (h - this.h) * .5; }
    this.w = w; this.h = h; this.dpr = dpr;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // setting .width wipes state
    this._atmoKey = '';                            // the washes are viewport-sized
  };

  /* The vignette is a radial gradient over the whole viewport - the single
     most expensive fill in the frame at 3.6ms. It is now baked into the
     over-layer instead of being evaluated live, so this only builds the
     gradient object, into whichever context is doing the baking. */
  Renderer.prototype._buildVignette = function (ctx) {
    var w = this.w, h = this.h;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.20,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.58)');
    return g;
  };

  Renderer.prototype.panBy = function (dx, dy) { this.ox += dx; this.oy += dy; };

  /* ---------- camera motion --------------------------------------------
     Crossing the map was a chore quite apart from the frame rate. A drag
     moved the view one pixel per pixel of mouse, and an arrow key jumped 60px
     per key-repeat - which the operating system sits on for half a second
     before it starts, and then delivers unevenly. The city is some three
     thousand pixels across at scale 1. Neither is a way to get across it.

     So the camera gets a velocity instead of a position. Held keys accelerate
     it, a flick of the mouse hands it momentum, and both are integrated here
     against the frame's own dt: the renderer is the only thing that sees
     every frame, and pixels per second is the only honest unit for "how fast
     does the map move". game.js just says which way.                       */
  var PAN_SPD   = 1800;      // px/s at full tilt on the keyboard
  var PAN_BOOST = 2.75;      // ... and with shift held: the whole map in a second
  var PAN_RAMP  = 9;         // how quickly it gets up to that, per second
  var FLING_K   = 3.6;       // how quickly a thrown map slows down, per second
  var FLING_MIN = 14;        // px/s at which it has stopped
  var FLING_MAX = 7000;      // and the fastest a throw can be

  /* Which way the held keys are pointing, as a unit vector. */
  Renderer.prototype.panHold = function (dx, dy, boost) {
    this._kx = dx || 0; this._ky = dy || 0;
    this._kboost = boost ? PAN_BOOST : 1;
    if (this._kx || this._ky) { this._flx = 0; this._fly = 0; }
  };

  /* Throw the map, in px/s. */
  Renderer.prototype.fling = function (vx, vy) {
    var m = Math.sqrt(vx * vx + vy * vy);
    if (m < FLING_MIN) return;
    if (m > FLING_MAX) { vx = vx / m * FLING_MAX; vy = vy / m * FLING_MAX; }
    this._flx = vx; this._fly = vy;
  };

  Renderer.prototype.stopPan = function () { this._flx = 0; this._fly = 0; this._kv = 0; };

  Renderer.prototype._camera = function (dt) {
    var t = dt / 1000;
    if (t > 0.1) t = 0.1;                  // never fast-forward after a stall

    // keyboard: ease up to speed, so a tap nudges and a hold sprints
    var want = (this._kx || this._ky) ? 1 : 0;
    this._kv += (want - this._kv) * Math.min(1, PAN_RAMP * t);
    if (this._kv > 0.002) {
      var sp = PAN_SPD * this._kboost * this._kv * t;
      this.ox += this._kx * sp; this.oy += this._ky * sp;
    }

    // and the throw, decaying exponentially
    if (this._flx || this._fly) {
      this.ox += this._flx * t; this.oy += this._fly * t;
      var k = Math.exp(-FLING_K * t);
      this._flx *= k; this._fly *= k;
      if (Math.abs(this._flx) + Math.abs(this._fly) < FLING_MIN) { this._flx = 0; this._fly = 0; }
    }

    this.clampCamera();
  };

  /* Keep some city on screen. Without this a good throw sends the map into
     the void and the player has to go looking for it. */
  Renderer.prototype.clampCamera = function () {
    var box = this._cityBox();
    var mx = this.w * 0.34, my = this.h * 0.34;   // how much may leave the frame
    var lo = mx - box.r, hi = this.w - mx - box.l;
    if (lo > hi) { lo = hi = (lo + hi) * 0.5; }
    if (this.ox < lo) { this.ox = lo; this._flx = 0; }
    else if (this.ox > hi) { this.ox = hi; this._flx = 0; }
    lo = my - box.b; hi = this.h - my - box.t;
    if (lo > hi) { lo = hi = (lo + hi) * 0.5; }
    if (this.oy < lo) { this.oy = lo; this._fly = 0; }
    else if (this.oy > hi) { this.oy = hi; this._fly = 0; }
  };

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
    this.clampCamera();
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

  /* ---------- entity picking ------------------------------------------ *
   *
   * screenToTile answers "what GROUND is under the cursor". That is the wrong
   * question for a city with height: point at the fortieth floor of a tower
   * and the ground under your cursor is a block behind the building you are
   * plainly looking at.
   *
   * The projection makes the right question cheap. cx depends only on x-y and
   * cy only on x+y, so stepping one tile down the (+1,+1) diagonal moves a
   * tile exactly 2*HH*scale px DOWN the screen and not one px sideways. A
   * building k steps down that diagonal therefore stands under the cursor iff
   * it is tall enough to reach back up: top*scale >= 2*k*HH*scale, i.e.
   * top >= 32k, with the scale cancelling out entirely.
   *
   * Marching k from far to near and taking the first hit returns the frontmost
   * candidate - which is precisely the one painter's order drew last, and so
   * the one actually visible. No pick buffer, no second render pass, no id
   * channel to keep in step with the art.
   * ------------------------------------------------------------------- */

  var PICK_K = 20;          // 20 * 32px of storey - taller than any archetype
  var PICK_R = 11;          // px: how near the cursor a street agent counts as hit

  Renderer.prototype.pickAt = function (s, px, py) {
    if (!s) return null;
    var r = this.canvas.getBoundingClientRect();
    var lx = px - r.left, ly = py - r.top;

    /* Street life first, and on screen distance rather than on tiles: a
       pedestrian is three pixels of coat standing on a road the cursor is
       also over, so any tile-based test would always lose to the road. */
    var veh = this._veh, best = null, bestD = PICK_R * PICK_R;
    for (var i = 0; i < veh.length; i++) {
      var v = veh[i];
      if (v.sx < -1000) continue;                 // not drawn this frame
      var dx = v.sx - lx, dy = v.sy - ly, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) return { kind: 'agent', agent: best, x: best.x | 0, y: best.y | 0 };

    var t = this.screenToTile(px, py);
    if (!t) return null;
    if (MM.lots && MM.lots.lotOf && MM.lots.shape) {
      for (var k = PICK_K; k >= 0; k--) {
        var tx = t.x + k, ty = t.y + k;
        if (!inB(tx, ty)) continue;
        var L = MM.lots.lotOf(s, tx, ty);
        if (!L) continue;
        if (k > 0) {
          var sh = MM.lots.shape(s, L.x1, L.y1);
          if (!sh || sh.top < 2 * HH * k) continue;
        }
        return { kind: 'parcel', x: tx, y: ty, lot: L };
      }
    }
    return { kind: 'tile', x: t.x, y: t.y };
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
    this._rm = 1.00; this._gm = 0.995; this._bm = 0.98;

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
    var SP = Gs ? [1 + 0.05, 1 + Gs(0, 1) / LM, 1 + Gs(1, 0) / RM] : [1, 1, 1];
    // and the same warm-sun / cool-sky grading gfx.faces applies, so a civic
    // block one tile wide is lit like the tower next door
    var FL = (MM.gfx && MM.gfx.FL) || [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    for (k in PAL) {
      c = PAL[k];
      C[k] = 'rgb(' + (clamp(c[0] * rm, 0, 255) | 0) + ',' +
        (clamp(c[1] * gm, 0, 255) | 0) + ',' + (clamp(c[2] * bm, 0, 255) | 0) + ')';
    }
    for (k in FACE) {
      var src = FACE[k], dst = this._F[k];
      for (var f = 0; f < 3; f++) {
        c = src[f];
        dst[f] = 'rgb(' + (clamp(c[0] * rm * SP[f] * FL[f][0], 0, 255) | 0) + ',' +
          (clamp(c[1] * gm * SP[f] * FL[f][1], 0, 255) | 0) + ',' +
          (clamp(c[2] * bm * SP[f] * FL[f][2], 0, 255) | 0) + ')';
      }
    }
    for (f = 0; f < 3; f++) {
      c = FACE_DEF[f];
      this._Fdef[f] = 'rgb(' + (clamp(c[0] * rm * SP[f] * FL[f][0], 0, 255) | 0) + ',' +
        (clamp(c[1] * gm * SP[f] * FL[f][1], 0, 255) | 0) + ',' +
        (clamp(c[2] * bm * SP[f] * FL[f][2], 0, 255) | 0) + ')';
    }
    // The two fleets that are not a random livery: the cab and the bus. Their
    // colours live in this file's PAL, so gfx.carPaint cannot build them.
    if (MM.gfx && MM.gfx.faces) {
      var GD = MM.gfx.PAL.glassDark, mx = MM.gfx.mix;
      this._vehF = [MM.gfx.faces(PAL.cab), MM.gfx.faces(PAL.bus), MM.gfx.faces(PAL.railCar)];
      this._vehG = [MM.gfx.faces(mx(PAL.cab, GD, 0.74)), MM.gfx.faces(mx(PAL.bus, GD, 0.74)),
        MM.gfx.faces(mx(PAL.railCar, GD, 0.80))];
    }
  };

  Renderer.prototype._faces = function (type) { return this._F[type] || this._Fdef; };

  /* ---------- visible-tile collection -------------------------------- */

  /* Which tiles can paint into a rect. Defaults to the whole target, but a
     partial repaint passes its own, and then only the tiles that can reach
     into it get collected - so every pass below is limited for free.

     A tile paints well outside its own diamond, in two directions, and both
     have to be allowed for or a patch shows a seam:
       up-screen   a tower stands hMax px out of its tile, so tiles BELOW the
                   rect can paint into it;
       down-right  a shadow is thrown that way, so tiles ABOVE and LEFT of the
                   rect can paint into it too.                               */
  Renderer.prototype._collect = function (s, R) {
    var g = s.grid, sc = this.scale, fx = HW * sc, fy = HH * sc;
    var hMax = 220 * sc;
    var rx0 = R ? R.x0 : 0, y0 = R ? R.y0 : 0;
    var rx1 = R ? R.x1 : this.w, y1 = R ? R.y1 : this.h;
    // how far a shadow travels down and to the right of whatever casts it
    var shX = hMax * CAST.len * CAST.x, shY = hMax * CAST.len * CAST.y;
    var aMin = (rx0 - shX - this.ox) / fx - 1.4;
    var aMax = (rx1 - this.ox) / fx + 1.4;
    var dMin = Math.max(0, Math.floor((y0 - shY - this.oy) / fy - 1.5));
    var dMax = Math.min(2 * G - 2, Math.ceil((y1 + hMax - this.oy) / fy + 1.5));

    var nLot = 0, nWat = 0, nA = 0, nB = 0, nR = 0, nBld = 0, nAll = 0, nRl = 0;
    var bLot = this._bLot, bWat = this._bWat, bA = this._bPadA, bB = this._bPadB;
    var bR = this._bRoad, bBld = this._bBld, bAll = this._bAll, bRl = this._bRail;

    // For a partial repaint, test each candidate against its own height
    // rather than the tallest building in the game. That is the difference
    // between a five-tile edit collecting four hundred tiles and forty.
    var top = R ? this._top : null;
    var ox = this.ox, oy = this.oy, lxr = CAST.len * CAST.x, lyr = CAST.len * CAST.y;

    for (var d = dMin; d <= dMax; d++) {
      var x0 = Math.max(0, d - G + 1, Math.ceil((aMin + d) * 0.5));
      var x1 = Math.min(G - 1, d, Math.floor((aMax + d) * 0.5));
      var cy = d * fy + oy;
      for (var x = x0; x <= x1; x++) {
        var y = d - x;
        var i = y * G + x;
        if (top) {
          // what this tile actually paints: its diamond, whatever stands on
          // it (up-screen) and the shadow that throws (down and right)
          var hh = top[i] * sc;
          if (cy - hh > y1 || cy + fy + hh * lyr < y0) continue;
          var cx = (x - y) * fx + ox;
          if (cx - fx * 3 > rx1 || cx + fx + hh * lxr < rx0) continue;
        }
        var t = g[i];
        bAll[nAll++] = i;
        if (t === T.EMPTY) bLot[nLot++] = i;
        else if (t === T.WATER) bWat[nWat++] = i;
        else if (t === T.ROAD) { bR[nR++] = i; }
        // Track is ground, not a structure: left in the building buckets it
        // got a pad and a massing box and the line ran as a wall of sheds.
        else if (t === T.RAIL) { bRl[nRl++] = i; }
        else {
          if (hash2(x, y) < 0.5) bA[nA++] = i; else bB[nB++] = i;
          bBld[nBld++] = i;
        }
      }
    }
    this._nLot = nLot; this._nWat = nWat; this._nPadA = nA; this._nPadB = nB;
    this._nRoad = nR; this._nBld = nBld; this._nAll = nAll; this._nRail = nRl;
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

    // Every lot paints its own share of the ground - lawn, forecourt, plaza -
    // and the whole ground plane has to be down before _shadows runs, or each
    // lot would paint over the shadow falling across it. lots.js splits those
    // flat pads out into this phase and skips them when it draws the buildings.
    if (MM.lots && MM.lots.ground && this._nBld) {
      var go = { s: s, x: 0, y: 0, cx: 0, cy: 0, fx: fx, fy: fy, scale: sc };
      for (k = 0; k < this._nBld; k++) {
        i = this._bBld[k]; x = i % G; y = (i / G) | 0;
        if (MM.lots.role(s, x, y) !== 1) continue;
        go.x = x; go.y = y;
        go.cx = (x - y) * fx + ox; go.cy = (x + y) * fy + oy;
        try { MM.lots.ground(ctx, go); } catch (e) {}
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
  /* Track links to track and to stations, never to a road. Rail crossing a
     street is a level crossing, not a junction, so the two networks are laid
     out by separate masks and simply overlap where they meet. */
  Renderer.prototype._railLink = function (g, x, y) {
    var m = 0;
    for (var k = 0; k < 4; k++) {
      var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
      if (!inB(nx, ny)) continue;
      var t = g[ny * G + nx];
      if (t === T.RAIL || t === T.STATION) m |= 1 << k;
    }
    return m;
  };

  /* Ballast, sleepers, rails - three passes, one path and one fill or stroke
     each, so a line across the map costs three draws however long it is. An
     isolated tile has no neighbour to take its bearing from, so it lies on
     the x axis and reads as a stub of track rather than as a grey diamond. */
  Renderer.prototype._railPass = function (s) {
    var n = this._nRail;
    if (!n) return;
    var ctx = this.ctx, C = this._C, sc = this.scale;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy, g = s.grid;
    var W = 0.30, k, i, x, y, cx, cy, m, d, dx, dy, px, py, j, tt;

    // The tile's own ground first. Rail is the one tile kind that is neither
    // a lot, a road nor water, so nothing else lays a diamond under it - and
    // the cache is cleared transparent, so the corners showed open sky.
    ctx.fillStyle = C.lot;
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRail[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      ctx.moveTo(cx, cy - fy);
      ctx.lineTo(cx + fx, cy);
      ctx.lineTo(cx, cy + fy);
      ctx.lineTo(cx - fx, cy);
      ctx.closePath();
    }
    ctx.fill();

    ctx.fillStyle = C.ballast;
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRail[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      m = this._railLink(g, x, y) || 3;              // a lone tile runs on x
      ctx.moveTo(cx, cy - 2 * W * fy);
      ctx.lineTo(cx + 2 * W * fx, cy);
      ctx.lineTo(cx, cy + 2 * W * fy);
      ctx.lineTo(cx - 2 * W * fx, cy);
      ctx.closePath();
      for (d = 0; d < 4; d++) {
        if (m & (1 << d)) this._arm(cx, cy, fx, fy, DIRS[d][0], DIRS[d][1], W);
      }
    }
    ctx.fill();

    if (sc < 0.45) return;                           // below this it is a line

    ctx.strokeStyle = C.sleeper;                     // sleepers, across the run
    ctx.lineWidth = Math.max(0.6, 1.4 * sc);
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRail[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      m = this._railLink(g, x, y) || 3;
      for (d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        dx = DIRS[d][0]; dy = DIRS[d][1]; px = -dy; py = dx;
        for (j = 1; j <= 2; j++) {
          tt = j * 0.24;                             // along the half-arm
          ctx.moveTo(cx + (dx * tt - dy * tt) * fx + (px - py) * fx * 0.20,
            cy + (dx * tt + dy * tt) * fy + (px + py) * fy * 0.20);
          ctx.lineTo(cx + (dx * tt - dy * tt) * fx - (px - py) * fx * 0.20,
            cy + (dx * tt + dy * tt) * fy - (px + py) * fy * 0.20);
        }
      }
    }
    ctx.stroke();

    ctx.strokeStyle = C.rail;                        // the two rails
    ctx.lineWidth = Math.max(0.5, 0.85 * sc);
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = this._bRail[k]; x = i % G; y = (i / G) | 0;
      cx = (x - y) * fx + ox; cy = (x + y) * fy + oy;
      m = this._railLink(g, x, y) || 3;
      for (d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        dx = DIRS[d][0]; dy = DIRS[d][1]; px = -dy; py = dx;
        for (j = -1; j <= 1; j += 2) {
          var bx = (px - py) * fx * 0.12 * j, by = (px + py) * fy * 0.12 * j;
          ctx.moveTo(cx + bx, cy + by);
          ctx.lineTo(cx + (dx - dy) * fx * 0.5 + bx, cy + (dx + dy) * fy * 0.5 + by);
        }
      }
    }
    ctx.stroke();
  };

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

  /* ---------- ground grain ---------------------------------------------
     A lawn painted as one flat fill reads as paper, and a lot's own pads
     cover whatever texture ground.js laid under them. One soft blob per
     tile - light or dark, placed and sized off the tile hash so it never
     moves - breaks the fill up without adding a colour to the palette.
     Two paths, two fills, whatever the size of the city.

     `source-atop` for the same reason the shadows use it: the grain belongs
     on ground that is already painted, not on the open sky past the shore. */

  Renderer.prototype._dapple = function (s) {
    var sc = this.scale;
    if (sc < 0.5 || !this._nAll) return;
    var ctx = this.ctx, fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var n = this._nAll, buf = this._bAll, pass, k, i, x, y, a, b, r;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? 'rgba(255,250,226,0.055)' : 'rgba(18,26,44,0.055)';
      ctx.beginPath();
      for (k = 0; k < n; k++) {
        i = buf[k]; x = i % G; y = (i / G) | 0;
        if ((hash2(x + pass * 97, y + pass * 31) < 0.42)) continue;
        a = (hash2(x + 11, y + pass * 7) - 0.5) * 1.1;
        b = (hash2(x + pass * 53, y + 19) - 0.5) * 1.1;
        r = 0.30 + hash2(x + 3, y + pass * 23) * 0.34;
        ctx.moveTo((a - b + r) * fx + (x - y) * fx + ox, (a + b) * fy + (x + y) * fy + oy);
        ctx.ellipse((a - b) * fx + (x - y) * fx + ox, (a + b) * fy + (x + y) * fy + oy,
          r * fx, r * fy * 1.15, 0, 0, TAU);
      }
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------- shadows -------------------------------------------------
     A cast shadow is the footprint swept along the sun's ground direction -
     the convex hull of the footprint and the same footprint pushed out by
     the building's height. Everything writes into one offscreen layer at
     full opacity, so overlapping shadows union instead of stacking into
     black blotches, and the layer is blitted back through a blur: soft
     edges everywhere for the price of one filtered drawImage.

     `source-atop` keeps the result on ground that is already painted and
     off the open sky, which is what makes a shadow near the map edge stop
     at the shoreline instead of hanging in the air.

     The cached city is lit for noon, so its shadows are cast for noon too:
     a long dawn shadow baked under a midday facade reads as a bug. The sun
     sits screen-upper-left (see gfx.setSun), so shadows fall down and to
     the right, towards the camera, where they can actually be seen.        */

  var CAST = (MM.gfx && MM.gfx.CAST) ||
    { x: 0.75, y: 0.66, len: 0.62, tint: 'rgb(38,46,74)', cast: 0.34, foot: 0.34 };

  /* Convex hull of a footprint and its offset copy, as one subpath.
     Andrew's monotone chain over the 8 corners - shared scratch, no
     allocation, and it stays correct if the sun direction ever moves. */
  var _hx = new Float64Array(8), _hy = new Float64Array(8);
  var _hi = new Int32Array(8), _hs = new Int32Array(20);

  function sweptPath (ctx, n, dx, dy) {
    var m = n * 2, i, j, v, t, k = 0, lower;
    for (i = 0; i < n; i++) { _hx[n + i] = _hx[i] + dx; _hy[n + i] = _hy[i] + dy; }
    for (i = 0; i < m; i++) _hi[i] = i;
    for (i = 1; i < m; i++) {                    // sort by x, then y
      v = _hi[i]; j = i - 1;
      while (j >= 0 && (_hx[_hi[j]] > _hx[v] ||
        (_hx[_hi[j]] === _hx[v] && _hy[_hi[j]] > _hy[v]))) { _hi[j + 1] = _hi[j]; j--; }
      _hi[j + 1] = v;
    }
    for (i = 0; i < m; i++) {                    // lower chain
      t = _hi[i];
      while (k >= 2 && cross3(_hs[k - 2], _hs[k - 1], t) <= 0) k--;
      _hs[k++] = t;
    }
    lower = k + 1;
    for (i = m - 2; i >= 0; i--) {               // upper chain
      t = _hi[i];
      while (k >= lower && cross3(_hs[k - 2], _hs[k - 1], t) <= 0) k--;
      _hs[k++] = t;
    }
    k--;                                          // the chain closes on itself
    ctx.moveTo(_hx[_hs[0]], _hy[_hs[0]]);
    for (i = 1; i < k; i++) ctx.lineTo(_hx[_hs[i]], _hy[_hs[i]]);
    ctx.closePath();
  }

  function cross3 (a, b, c) {
    return (_hx[b] - _hx[a]) * (_hy[c] - _hy[a]) - (_hy[b] - _hy[a]) * (_hx[c] - _hx[a]);
  }

  /* the four screen corners of a tile-space rectangle, into the hull scratch */
  function footprint (a, b, c, d, fx, fy, ox, oy) {
    _hx[0] = (a - b) * fx + ox; _hy[0] = (a + b) * fy + oy;
    _hx[1] = (c - b) * fx + ox; _hy[1] = (c + b) * fy + oy;
    _hx[2] = (c - d) * fx + ox; _hy[2] = (c + d) * fy + oy;
    _hx[3] = (a - d) * fx + ox; _hy[3] = (a + d) * fy + oy;
  }

  /* Walk every caster once, handing each one's footprint and height to fn.
     Both shadow passes need the same list, and role() is not free. */
  Renderer.prototype._casters = function (s, fn) {
    var sc = this.scale, fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy;
    var LT = MM.lots, n = this._nBld, k, i, x, y, h, lot, role, t, sh, f;
    for (k = 0; k < n; k++) {
      i = this._bBld[k]; x = i % G; y = (i / G) | 0;
      if (LT) {
        role = LT.role(s, x, y);
        if (role === -1) continue;               // its anchor casts for it
        if (role === 1) {
          // A block-scale building casts one shadow the size of its whole
          // lot, not nine tile-sized ones. lots.js knows the footprint and
          // roughly how tall the thing on it ends up.
          lot = LT.shape(s, x, y);
          if (!lot) continue;
          h = lot.top * sc;
          if (h < 2) continue;                   // a lawn casts nothing
          footprint(lot.x0 - 0.5 + 0.24, lot.y0 - 0.5 + 0.24,
            lot.x1 + 0.5 - 0.24, lot.y1 + 0.5 - 0.24, fx, fy, ox, oy);
          fn(h);
          continue;
        }
      }
      t = s.grid[i];
      sh = SHAPE[t] || SHAPE_DEF;
      h = (sh[0] + sh[1] * (s.level[i] || 0)) * UNIT * sc;
      if (h < 2) continue;
      f = sh[2] * 0.5;
      footprint(x - f, y - f, x + f, y + f, fx, fy, ox, oy);
      fn(h);
    }
  };

  /* the cast silhouettes on their own, for tools/shlayer.js */
  Renderer.prototype._shadowPaths = function (g, s, cast) {
    var lx = CAST.len * CAST.x, ly = CAST.len * CAST.y;
    this._casters(s, function (h) { sweptPath(g, 4, cast ? h * lx : 0, cast ? h * ly : 0); });
  };

  /* The layer is built at half resolution and blown back up on the blit.
     A blur costs a pass over every pixel, and at full size the two of them
     were the most expensive thing in a rebuild by a wide margin - a quarter
     of the pixels is a quarter of the cost, and the upscale softens the
     edges the blur was there to soften anyway. */
  var SH_RES = 0.5;

  Renderer.prototype._shadows = function (s) {
    if (!this._nBld) return;
    var sc = this.scale;
    if (sc < 0.26) return;                       // finer than the blur can carry
    var ctx = this.ctx, W = this.w, H = this.h;
    var dpr = Math.min(this.dpr || 1, 2) * SH_RES;
    var cw = Math.max(1, Math.round(W * dpr)), chh = Math.max(1, Math.round(H * dpr));
    var shc = this._shc;
    if (shc.width !== cw || shc.height !== chh) { shc.width = cw; shc.height = chh; this._shctx = null; }
    if (!this._shctx) this._shctx = shc.getContext('2d');
    var g = this._shctx;

    // A partial repaint only needs the shadows inside its own rect. Clearing
    // and blitting the whole layer for a one-tile edit was most of what a
    // patch cost - the layer is as big as the cache, and the blit carries a
    // blur.
    var R = this._clipR;
    var rx = R ? R.x0 : 0, ry = R ? R.y0 : 0;
    var rw = R ? R.x1 - R.x0 : W, rh = R ? R.y1 - R.y0 : H;

    var lx = CAST.len * CAST.x, ly = CAST.len * CAST.y;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(rx, ry, rw, rh);

    // Two darkness levels, no stacking, and no composite mode.
    //
    // Within a single fill() overlapping subpaths union rather than pile up,
    // which is what stops a street of shadows turning into black blotches.
    // Getting the same between the two levels wants the seam to sit over the
    // throw, which this used to buy with `destination-over` on the seam pass.
    //
    // It buys it by drawing the throws first instead. The two are identical -
    // destination-over(seam, throw) and source-over(throw, seam) are the same
    // Porter-Duff term - but `destination-over` has to read the destination,
    // and on a canvas this size Chromium answers that by copying the whole
    // surface. It was 113ms of a 158ms repaint, on every tile placed.
    //
    // The contact seam is the tight one - a building without it reads as a
    // decal on the lawn - and the blur then blends the two into a falloff.
    g.fillStyle = CAST.tint;
    g.beginPath();
    this._casters(s, function (h) { sweptPath(g, 4, h * lx, h * ly); });
    g.fill();

    g.fillStyle = CAST.foot;
    g.beginPath();
    this._casters(s, function (h) {
      var r = h * 0.10; if (r > 5 * sc) r = 5 * sc;
      sweptPath(g, 4, r * CAST.x, r * CAST.y);
    });
    g.fill();

    // The blur rides out on the blit. It was worth building a second layer to
    // blur into at one point, back when this pass also carried a
    // `destination-over` that forced a whole-surface copy; with that gone the
    // sibling canvas bought a couple of milliseconds and cost ten megabytes
    // of canvas, which is the wrong way round - see LIGHT_RES on why total
    // canvas memory is the thing that decides whether any of this is fast.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.filter = 'blur(' + Math.max(0.7, 1.25 * sc).toFixed(2) + 'px)';
    ctx.drawImage(shc, rx * dpr, ry * dpr, rw * dpr, rh * dpr, rx, ry, rw, rh);
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
    } else if (t === T.STATION) {
      // a long glazed concourse under a barrel canopy, plus the platform edge
      ctx.fillStyle = 'rgba(' + HOT.winCool + ',' + (0.26 + 0.42 * night).toFixed(3) + ')';
      ctx.beginPath();
      this._fq(cx, cy, fx, fy, h, 0, 0.10, 0.90, 0.30, 0.92);
      this._fq(cx, cy, fx, fy, h, 1, 0.10, 0.90, 0.30, 0.92);
      ctx.fill();
      this._roof(cx, cy, fx * 1.22, fy * 1.22, h, C.steel);
      // the canopy ribs, so the roof reads as a train shed and not a lid
      ctx.strokeStyle = C.pole;
      ctx.lineWidth = Math.max(0.7, 1.1 * sc);
      ctx.beginPath();
      for (var ri = -1; ri <= 1; ri++) {
        var rq = ri * 0.42;
        ctx.moveTo(cx + (rq - 0.62) * fx, cy + (rq + 0.62) * fy - h);
        ctx.lineTo(cx + (rq + 0.62) * fx, cy + (rq - 0.62) * fy - h);
      }
      ctx.stroke();
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
    /* Where this one is FROM. A pedestrian hanging off a building rather than
       off a district is what makes ada.1422-canal.downtown.cityhall.eth a true
       statement instead of a decorative one, and the road they spawned on is
       almost always kerbside to the block they live in. Resolved once, here,
       because they walk - re-deriving it from wherever they have got to would
       rename them mid-street. */
    v.home = this._homeNear(s, x, y);
    return true;
  };

  /* The first lot touching this road tile, or {x:-1} if the road runs past
     open land. lotOf() is a plan lookup behind a rev cache, so this is eight
     array reads once per spawn.
     Diagonals are included because a corner block is genuinely on the street
     it faces: with orthogonals only, every agent spawning on a junction came
     out belonging to nobody, and half the city walked around nameless above
     district level. */
  var HOME8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  Renderer.prototype._homeNear = function (s, x, y) {
    if (!MM.lots || !MM.lots.lotOf) return { x: -1, y: -1 };
    for (var k = 0; k < 8; k++) {
      var nx = x + HOME8[k][0], ny = y + HOME8[k][1];
      if (!inB(nx, ny)) continue;
      if (MM.lots.lotOf(s, nx, ny)) return { x: nx, y: ny };
    }
    return { x: -1, y: -1 };
  };

  Renderer.prototype._traffic = function (s, dt) {
    var veh = this._veh;
    // The first wantV entries drive, the rest walk. Kind is derived from the
    // index every frame so a zoom that changes the pedestrian budget never
    // turns a walker into a taxi mid-street.
    var profile = MM.visuals && MM.visuals.profile;
    var wantV = Math.min(profile ? profile.vehicles : MAX_V, (this._nRoads * 0.32) | 0);
    var wantP = this.scale < 0.55 ? 0 : Math.min(profile ? profile.people : MAX_P, (this._nRoads * 0.55) | 0);
    var want = wantV + wantP;
    while (veh.length > want) veh.pop();
    var guardSpawn = 0;
    while (veh.length < want && guardSpawn++ < 12) {
      var vk = (this._nBusT > 0 && rnd() < 0.18) ? 1 : 0;
      var nv = { x: 0, y: 0, dx: 1, dy: 0, d: 0, t: 0, kind: vk, vk: vk,
        jit: 0.8 + rnd() * 0.45, lane: rnd() < 0.5 ? -1 : 1, tone: (rnd() * 10) | 0,
        id: ++this._vid, home: null, sx: -1e4, sy: -1e4 };
      if (!this._spawn(s, nv, vk === 1)) break;
      veh.push(nv);
    }

    var spd = 0.00115 * (1 - Math.min(0.72, (s.traffic || 0) / 140));
    // Clear last frame's screen points up front: an agent that goes behind a
    // tower this frame must stop being pickable this frame, not next.
    for (var c = 0; c < veh.length; c++) { veh[c].sx = -1e4; veh[c].sy = -1e4; }
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

  /* ---------- trains ----------------------------------------------------
     Rolling stock walks the rail graph the way traffic walks the road graph.
     The difference is that a train is a consist, not a vehicle: the cars
     behind the leader are placed by stepping back along the route it has
     actually taken, so they follow it round a bend instead of sliding
     through the corner on the diagonal.                                    */
  var TRAIN_CARS = 3, TRAIN_GAP = 0.62, TRAIN_HIST = 10;

  Renderer.prototype._trains = function (s, dt) {
    var key = (s.rev | 0) + '|r';
    if (key !== this._railKey) {                 // the network, on plan change
      this._railKey = key;
      var g = s.grid, net = [], i;
      for (i = 0; i < g.length; i++) if (g[i] === T.RAIL) net.push(i);
      this._railNet = net;
      this._trn = [];
    }
    var net2 = this._railNet;
    if (!net2 || net2.length < 4) { this._trn = []; return; }

    var trn = this._trn || (this._trn = []);
    var want = Math.min(4, Math.max(1, (net2.length / 18) | 0));
    if (!MM.visuals || !MM.visuals.profile.detail) want = Math.min(want, 1);
    while (trn.length > want) trn.pop();
    var guard = 0;
    while (trn.length < want && guard++ < 8) {
      // deterministic seat on the network, so a reload puts them back
      var seed = net2[((trn.length * 2654435761) >>> 0) % net2.length];
      var t = { x: seed % G, y: (seed / G) | 0, dx: 1, dy: 0, t: 0,
        hist: new Int16Array(TRAIN_HIST * 2), hn: 0,
        jit: 0.85 + (trn.length % 3) * 0.12 };
      t.d = this._railDir(s, t, -1);
      if (t.d < 0) break;
      t.dx = DIRS[t.d][0]; t.dy = DIRS[t.d][1];
      trn.push(t);
    }

    var spd = 0.00085;
    for (var k = 0; k < trn.length; k++) {
      var v = trn[k];
      v.t += spd * dt * v.jit;
      var g2 = 0;
      while (v.t >= 1 && g2++ < 4) {
        v.t -= 1;
        var nx = v.x + v.dx, ny = v.y + v.dy;
        if (!inB(nx, ny) || (s.grid[ny * G + nx] !== T.RAIL && s.grid[ny * G + nx] !== T.STATION)) {
          v.d ^= 1;                              // buffer stop: run back down
          v.dx = DIRS[v.d][0]; v.dy = DIRS[v.d][1]; v.t = 0;
          break;
        }
        // remember where it has been, newest first, before it leaves
        for (var h = TRAIN_HIST - 1; h > 0; h--) {
          v.hist[h * 2] = v.hist[h * 2 - 2]; v.hist[h * 2 + 1] = v.hist[h * 2 - 1];
        }
        v.hist[0] = v.x; v.hist[1] = v.y;
        if (v.hn < TRAIN_HIST) v.hn++;
        v.x = nx; v.y = ny;
        var nd = this._railDir(s, v, v.d ^ 1);   // never double back at a junction
        if (nd >= 0) { v.d = nd; v.dx = DIRS[nd][0]; v.dy = DIRS[nd][1]; }
      }
    }
  };

  /* A direction out of this tile along track, avoiding `banned` unless it is
     the only way out - which is what makes a dead-end terminus work. */
  Renderer.prototype._railDir = function (s, v, banned) {
    var g = s.grid, opts = RAILSCRATCH, n = 0, k, nx, ny, t;
    for (k = 0; k < 4; k++) {
      if (k === banned) continue;
      nx = v.x + DIRS[k][0]; ny = v.y + DIRS[k][1];
      if (!inB(nx, ny)) continue;
      t = g[ny * G + nx];
      if (t === T.RAIL || t === T.STATION) opts[n++] = k;
    }
    if (!n) return banned >= 0 ? banned : -1;
    if (n === 1) return opts[0];
    // keep going straight where it can; a train that dithers at every
    // junction reads as a shuttle rather than as a service
    for (k = 0; k < n; k++) if (opts[k] === v.d) return v.d;
    return opts[(hash3(v.x, v.y, 17) * n) | 0];
  };

  /* Where the consist is `back` tiles behind its leader, walked along the
     route in the history buffer rather than straight back along the heading. */
  var _tbx = 0, _tby = 0, _tdx = 1, _tdy = 0;
  function trainPos (v, back) {
    var px = v.x + v.dx * v.t, py = v.y + v.dy * v.t;
    var d = back;
    if (d <= v.t) {                              // still inside the current tile
      _tbx = v.x + v.dx * (v.t - d); _tby = v.y + v.dy * (v.t - d);
      _tdx = v.dx; _tdy = v.dy; return;
    }
    d -= v.t;
    var ax = v.x, ay = v.y, h = 0;
    while (h < v.hn) {
      var bx = v.hist[h * 2], by = v.hist[h * 2 + 1];
      if (d <= 1) {
        _tbx = ax + (bx - ax) * d; _tby = ay + (by - ay) * d;
        _tdx = ax - bx; _tdy = ay - by; return;
      }
      d -= 1; ax = bx; ay = by; h++;
    }
    _tbx = ax; _tby = ay; _tdx = v.dx; _tdy = v.dy;
    if (px === ax && py === ay) { _tdx = v.dx; _tdy = v.dy; }
  }

  Renderer.prototype._drawTrainDiag = function (d) {
    if (this._skipVeh) return;
    var trn = this._trn;
    if (!trn || !trn.length) return;
    var ctx = this.ctx, sc = this.scale, Gg = MM.gfx;
    if (!Gg || !Gg.car || !this._vehF || sc < 0.30) return;
    var fx = HW * sc, fy = HH * sc, ox = this.ox, oy = this.oy, k, c;
    var F = this._vehF[2], Gl = this._vehG[2];
    for (k = 0; k < trn.length; k++) {
      var v = trn[k];
      var lx = v.x + v.dx * v.t, ly = v.y + v.dy * v.t;
      if (((lx + ly) | 0) !== d) continue;       // one consist, one diagonal
      for (c = 0; c < TRAIN_CARS; c++) {
        trainPos(v, c * TRAIN_GAP);
        var cx = (_tbx - _tby) * fx + ox, cy = (_tbx + _tby) * fy + oy;
        if (cx < -40 || cx > this.w + 40 || cy < -40 || cy > this.h + 50) continue;
        if (this._hiddenAt(cx, cy - 3 * sc)) continue;
        // A car straddling a bend has a heading on both axes, and gfx.car is
        // built for the four cardinals - so snap to the dominant one. A car
        // with no history yet has no heading at all: take the leader's.
        var hx = _tdx, hy = _tdy;
        if (!hx && !hy) { hx = v.dx; hy = v.dy; }
        if (hx) { hx = hx > 0 ? 1 : -1; hy = 0; } else { hy = hy > 0 ? 1 : -1; }
        Gg.car(ctx, cx, cy, fx, fy, hx, hy, Gg.VEH.train, F, Gl, this._C.tire, sc);
      }
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
      if (this._hiddenAt(cx, cy - 2 * sc)) { k = this._vnext[k]; continue; }
      /* Picking reads what was drawn, not what was simulated. Recording the
         screen point here means anything behind a tower or off the edge never
         got a position this frame and so cannot be hovered - the cursor and
         the eye agree by construction, with no second projection to keep in
         step with this one. */
      if (v.kind === 2) {
        if (cx > -20 && cx < this.w + 20 && cy > -20 && cy < this.h + 30) {
          v.sx = cx; v.sy = cy - 3 * sc;
          this._person(cx, cy, v, sc, night);
        }
        k = this._vnext[k];
        continue;
      }
      if (cx > -30 && cx < this.w + 30 && cy > -30 && cy < this.h + 40) {
        v.sx = cx; v.sy = cy - (v.kind ? 4 : 3) * sc;
        var dx = v.dx, dy = v.dy, px = -dy, py = dx;
        var bh = (v.kind ? 6.4 : 4.2) * sc;
        var Gg = MM.gfx;
        // nose and tail, where the lamps go
        var nl = v.kind ? 0.28 : 0.18;
        var axx = (dx - dy) * fx * nl, axy = (dx + dy) * fy * nl;

        if (Gg && Gg.car && this._vehF && sc > 0.5) {
          // Close in, a real model: chassis, cabin, glass. The livery comes
          // from gfx so a moving taxi and a parked one are the same yellow.
          var P = Gg.carPaint(), li = v.tone % P.paint.length;
          var fleet = v.kind ? 1 : ((v.tone & 3) === 0 ? 0 : -1);   // bus, cab, or private
          var F = fleet < 0 ? P.paint[li] : this._vehF[fleet];
          var Gl = fleet < 0 ? P.glass[li] : this._vehG[fleet];
          Gg.car(ctx, cx, cy, fx, fy, dx, dy,
            Gg.VEH[v.kind ? 'bus' : ((v.tone & 7) === 1 ? 'van' : 'sedan')],
            F, Gl, C.tire, sc);
        } else {
          // Zoomed out a car is six pixels; three stacked quads is all of it
          // that survives, and it is a third of the fills.
          var hl = (v.kind ? 0.26 : 0.17), hw = v.kind ? 0.095 : 0.08;
          var sxx = (dx - dy) * fx * hl, sxy = (dx + dy) * fy * hl;
          var bxx = (px - py) * fx * hw, bxy = (px + py) * fy * hw;
          ctx.fillStyle = C.tire;
          ctx.beginPath();
          ctx.moveTo(cx + sxx + bxx, cy + sxy + bxy);
          ctx.lineTo(cx + sxx - bxx, cy + sxy - bxy);
          ctx.lineTo(cx - sxx - bxx, cy - sxy - bxy);
          ctx.lineTo(cx - sxx + bxx, cy - sxy + bxy);
          ctx.fill();

          ctx.fillStyle = v.kind ? C.bus : C.cab;
          ctx.beginPath();
          ctx.moveTo(cx + sxx + bxx, cy + sxy + bxy - bh * 0.55);
          ctx.lineTo(cx + sxx - bxx, cy + sxy - bxy - bh * 0.55);
          ctx.lineTo(cx - sxx - bxx, cy - sxy - bxy - bh * 0.55);
          ctx.lineTo(cx - sxx + bxx, cy - sxy + bxy - bh * 0.55);
          ctx.fill();

          ctx.fillStyle = v.kind ? C.busTop : C.cabTop;
          ctx.beginPath();
          ctx.moveTo(cx + sxx * 0.72 + bxx * 0.8, cy + sxy * 0.72 + bxy * 0.8 - bh);
          ctx.lineTo(cx + sxx * 0.72 - bxx * 0.8, cy + sxy * 0.72 - bxy * 0.8 - bh);
          ctx.lineTo(cx - sxx * 0.72 - bxx * 0.8, cy - sxy * 0.72 - bxy * 0.8 - bh);
          ctx.lineTo(cx - sxx * 0.72 + bxx * 0.8, cy - sxy * 0.72 + bxy * 0.8 - bh);
          ctx.fill();
        }

        if (night > 0.25 && sc > 0.5) {
          ctx.fillStyle = 'rgba(' + HOT.head + ',' + (0.55 * night).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(cx + axx, cy + axy - bh * 0.5, Math.max(1, 1.5 * sc), 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(' + HOT.tail + ',' + (0.5 * night).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(cx - axx, cy - axy - bh * 0.5, Math.max(1, 1.2 * sc), 0, TAU);
          ctx.fill();
        }
      }
      k = this._vnext[k];
    }
  };

  // Ground traffic is behind any elevated solid at the same screen point.
  // This quarter-resolution mask is read once per scenery bake, then queried
  // with a single typed-array lookup per vehicle, including during a zoom.
  Renderer.prototype._hiddenAt = function (x, y) {
    if (!this._coverageData) return false;
    var k = this.scale / this._cacheScale;
    var px = Math.floor(((x - this.ox) / k + this._cacheOx + this._cacheMx) * this._coverageScale);
    var py = Math.floor(((y - this.oy) / k + this._cacheOy + this._cacheMy) * this._coverageScale);
    if (px < 0 || py < 0 || px >= this._coverage.width || py >= this._coverage.height) return false;
    return this._coverageData[(py * this._coverage.width + px) * 4 + 3] > 127;
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
        this._drawVehDiag(vd); this._drawTrainDiag(vd); vd++;
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
      this._drawVehDiag(vd); this._drawTrainDiag(vd); vd++;
    }
  };

  /* ---------- hover / selection -------------------------------------- */

  Renderer.prototype._hoverPass = function (s) {
    if (!this.buildMode) return;
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
    var keep = [];
    for (k = 0; k < n; k++) {
      var lot = L[k], sh = LT.shape(s, lot.x1, lot.y1);
      if (!sh || sh.top < 18) continue;      // parks and yards have no windows
      // A landmark is a lattice, not a building: landmarks.js lights its own
      // beacon, and a window grid across its lot painted a bright column of
      // glazing straight through the open steelwork.
      if (MM.landmarks && MM.landmarks.ARCH[sh.arch]) continue;
      keep.push([lot.x1 + lot.y1, lot.x1, lot.y1, lot.w, lot.h, sh.top]);
    }
    // Back to front, in the same x+y order the city itself is painted in. The
    // light layer carries no walls of its own, so the only thing that can stop
    // a lit window showing through the block in front of it is draw order.
    keep.sort(function (p, q) { return p[0] - q[0]; });
    var a = this._lit, w = 0;
    for (k = 0; k < keep.length; k++) {
      var e = keep[k];
      a[w] = e[1]; a[w + 1] = e[2]; a[w + 2] = e[3]; a[w + 3] = e[4]; a[w + 4] = e[5];
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
    var ox = this.ox, oy = this.oy, a = this._lit;
    var CR = this._clipR;
    var X0 = CR ? CR.x0 : 0, Y0 = CR ? CR.y0 : 0;
    var W = CR ? CR.x1 : this.w, H = CR ? CR.y1 : this.h;
    var Gg = MM.gfx, k, c, r;
    var warm = 'rgb(' + HOT.winWarm + ')';
    ctx.save();
    ctx.fillStyle = warm;
    for (k = 0; k < this._litN; k += 5) {
      var x = a[k], y = a[k + 1], lw = a[k + 2], lh = a[k + 3], top = a[k + 4] * sc;
      var cx = (x - y) * fx + ox, cy = (x + y) * fy + oy;
      // a lot is at most three tiles deep, so this box comfortably contains it
      if (cx < X0 - 4 * fx - lw * fx || cx > W + 4 * fx + lh * fx) continue;
      // Cull on the whole prism, base to roof. Testing the roof line alone
      // dropped exactly the supertalls whose tops leave the view - and a lot
      // culled here is a lot that never punches, which is the artifact back.
      if (cy + fy < Y0 - 4 * fy || cy - top > H + 4 * fy) continue;
      var u0 = -2 * (lw - 1) - 1, v0 = -2 * (lh - 1) - 1;

      // Everything already in the layer sits behind this lot, so clear its
      // massing before lighting it. Windows are painted on the bounding
      // prism's two near faces, so punching that same prism is precisely the
      // occlusion the city has - no more, no less.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      Gg.moveTo(ctx, cx, cy, fx, fy, u0, v0, top);
      Gg.lineTo(ctx, cx, cy, fx, fy, 1, v0, top);
      Gg.lineTo(ctx, cx, cy, fx, fy, 1, v0, 0);
      Gg.lineTo(ctx, cx, cy, fx, fy, 1, 1, 0);
      Gg.lineTo(ctx, cx, cy, fx, fy, u0, 1, 0);
      Gg.lineTo(ctx, cx, cy, fx, fy, u0, 1, top);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
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
      ctx.fill();
    }
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

    // Three concentric additive fills over every lamp on screen cost 3.0ms a
    // frame - one pass per ring, each one a fresh path of arcs. The rings
    // never change shape, only their size with the zoom, so bake the three of
    // them into one small sprite and stamp it. Same image, one draw per lamp
    // of a 2*rmax-square instead of three full passes of arcs.
    var head = 13 * sc;
    var spr = this._lampS(head);
    var r0 = spr.r;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = glow;
    for (k = 0; k < nl; k += 2) ctx.drawImage(spr.c, lit[k] - r0, lit[k + 1] - head - r0, r0 * 2, r0 * 2);
    ctx.restore();
  };

  /* The lamp halo as a sprite: the same three rings, drawn once. Rebuilt only
     when the zoom changes it, and rounded so a slow zoom does not thrash. */
  Renderer.prototype._lampS = function (head) {
    var r = Math.max(2, Math.ceil(head * RING_R[0]));
    var key = r + '|' + HOT.lamp;
    if (key === this._lampKey && this._lampSprite) return this._lampSprite;
    var c = document.createElement('canvas');
    var n = Math.min(256, r * 2);            // the halo is soft; 256px is plenty
    c.width = n; c.height = n;
    var g = c.getContext('2d');
    var k = n / (r * 2);
    g.setTransform(k, 0, 0, k, 0, 0);
    // the rings stacked additively on the live canvas, so they have to stack
    // additively in here too or the sprite is not the same image
    g.globalCompositeOperation = 'lighter';
    for (var q = 0; q < 3; q++) {
      g.fillStyle = 'rgba(' + HOT.lamp + ',' + RING_A[q].toFixed(3) + ')';
      g.beginPath();
      g.arc(r, r, head * RING_R[q], 0, TAU);
      g.fill();
    }
    this._lampKey = key;
    this._lampSprite = { c: c, r: r };
    return this._lampSprite;
  };

  /* ---------- what changed --------------------------------------------
     A cache rebuild is most of a second on a built city, and the cache is
     invalidated by every player edit AND by every block that levels up on its
     own (sim.js bumps s.rev for both). Rebuilding the world because one lot
     grew a storey is what made building feel like wading.

     So: work out exactly which tiles look different, and repaint only those.
     A per-tile signature covers everything the static pass draws there - the
     tile, its level, the four neighbours a road links itself to, and the
     identity of the lot covering it, because a block is drawn as a lot rather
     than a tile and a single edit can regroup its neighbours. Diffing two
     signatures gives the exact set, with no reasoning about how far a change
     might have reached.                                                     */

  function hashStr (str) {
    var h = 2166136261, i;
    if (!str) return h >>> 0;
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  Renderer.prototype._sig = function (s) {
    var N = G * G, look = this._look;
    if (!look || look.length !== N) look = this._look = new Uint32Array(N);
    // How tall the thing on each tile is drawn, in px at scale 1. Used to
    // work out which tiles can reach into a repainted rect: without it every
    // patch has to assume the tallest tower in the game stands on every tile,
    // and a five-tile edit collects four hundred of them.
    var top = this._top;
    if (!top || top.length !== N) top = this._top = new Float32Array(N);
    var g = s.grid, lv = s.level, i, x, y;
    for (y = 0; y < G; y++) {
      for (x = 0; x < G; x++) {
        i = y * G + x;
        var sh = SHAPE[g[i]] || SHAPE_DEF;
        top[i] = (sh[0] + sh[1] * (lv[i] || 0)) * UNIT;
        var v = (g[i] & 31) | (((lv[i] || 0) & 7) << 5);
        if (x > 0)     v |= (g[i - 1] & 31) << 8;
        if (x < G - 1) v |= (g[i + 1] & 31) << 13;
        if (y > 0)     v |= (g[i - G] & 31) << 18;
        if (y < G - 1) v |= (g[i + G] & 31) << 23;
        look[i] = v;
      }
    }
    var LT = MM.lots;
    if (LT && LT.plan) {
      try { LT.plan(s); } catch (e) { return look; }
      var L = LT.lots || [], k, o, h;
      for (k = 0; k < L.length; k++) {
        o = L[k];
        h = Math.imul(o.x0 + 1, 374761393) ^ Math.imul(o.y0 + 1, 668265263) ^
            Math.imul(o.w * 8 + o.h, 2246822519) ^ Math.imul((o.kind | 0) + 1, 3266489917) ^
            Math.imul((o.lv | 0) + 1, 40503) ^ hashStr(o.arch) ^
            // dt is normalised against the densest lot in the city, so ANY
            // level-up nudges it everywhere. Bucket it coarsely or one block
            // growing a storey dirties every lot on the map and the patch
            // turns back into a full rebuild.
            Math.imul(((o.dt || 0) * 12) | 0, 6151) ^ Math.imul((o.road | 0) + 1, 2654435761);
        var lotTop = 0;
        if (LT.shape) {
          try { var sp = LT.shape(s, o.x1, o.y1); if (sp && sp.top) lotTop = sp.top; } catch (e) {}
        }
        for (y = o.y0; y <= o.y1; y++)
          for (x = o.x0; x <= o.x1; x++) {
            look[y * G + x] ^= h;
            if (lotTop > top[y * G + x]) top[y * G + x] = lotTop;
          }
      }
    }
    return look;
  };

  /* The tile bounding box of everything whose picture changed since the bake.
     null = nothing changed at all, which is the common case for a rev bump
     that only moved a number the cache never drew. */
  Renderer.prototype._dirty = function (s) {
    var N = G * G, look = this._sig(s), prev = this._lookPrev;
    if (!prev || prev.length !== N) return { all: true };
    var x0 = G, y0 = G, x1 = -1, y1 = -1, n = 0, i, x, y;
    for (i = 0; i < N; i++) {
      if (look[i] === prev[i]) continue;
      n++;
      x = i % G; y = (i / G) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!n) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1, n: n };
  };

  Renderer.prototype._commitSig = function (s) {
    var look = this._sig(s), N = look.length;
    if (!this._lookPrev || this._lookPrev.length !== N) this._lookPrev = new Uint32Array(N);
    this._lookPrev.set(look);
  };

  /* Repaint just the dirty tiles' corner of the cache. Returns false if the
     region is big enough that a straight rebuild is the cheaper answer. */
  Renderer.prototype._patchStatic = function (s, d) {
    if (!this._cctx || !this._cacheW) return false;
    var sc = this.scale, fx = HW * sc, fy = HH * sc;
    var ox = this._cacheOx + this._cacheMx, oy = this._cacheOy + this._cacheMy;
    // one tile of slack, then the diamond corners of the dirty tile box
    var a0 = d.x0 - 1, a1 = d.x1 + 1, b0 = d.y0 - 1, b1 = d.y1 + 1;
    if (a0 < 0) a0 = 0;
    if (b0 < 0) b0 = 0;
    if (a1 > G - 1) a1 = G - 1;
    if (b1 > G - 1) b1 = G - 1;
    // The rect has to contain every pixel these tiles paint, which means the
    // height of what stands on them - their own height, not the tallest tower
    // in the game. A low-rise block changing needs a tenth of the headroom a
    // supertall does, and the rect is what sets how much gets repainted.
    var hMax = 0, top = this._top, ty, tx;
    if (top) {
      for (ty = b0; ty <= b1; ty++)
        for (tx = a0; tx <= a1; tx++) { var tv = top[ty * G + tx]; if (tv > hMax) hMax = tv; }
    } else hMax = 220;
    hMax *= sc;
    var R = {
      x0: (a0 - b1) * fx + ox - fx,
      x1: (a1 - b0) * fx + ox + fx + hMax * CAST.len * CAST.x,
      y0: (a0 + b0) * fy + oy - fy - hMax,
      y1: (a1 + b1) * fy + oy + fy + hMax * CAST.len * CAST.y
    };
    if (R.x0 < 0) R.x0 = 0;
    if (R.y0 < 0) R.y0 = 0;
    if (R.x1 > this._cacheW) R.x1 = this._cacheW;
    if (R.y1 > this._cacheH) R.y1 = this._cacheH;
    if (R.x1 <= R.x0 || R.y1 <= R.y0) return true;      // off-cache: nothing to do
    // Only hand back to a full rebuild when the patch has grown to most of
    // the cache anyway. A whole-city rebuild is three quarters of a second,
    // so the clip is worth keeping well past the point where it looks marginal.
    if ((R.x1 - R.x0) * (R.y1 - R.y0) > this._cacheW * this._cacheH * 0.62) return false;
    this._paintCity(s, R);
    return true;
  };

  /* ---------- how much city to cache ------------------------------------
     The static cache used to be the viewport plus a fixed 192px margin, and
     a pan that walked past that margin rebuilt the whole thing. On a built-up
     city a rebuild is 340-750ms of vector drawing - so dragging the map threw
     a third of a second of freeze every 184 pixels, which is exactly what
     "it takes forever to move across the city" feels like.

     The fix is to stop treating the cache as a window onto an unbounded
     world. The grid is 48x48 and nothing else exists: at ordinary zooms the
     whole city is only about 3000x1800 css px, so cache all of it and a pan
     costs one blit and no rebuild, ever. Zoomed right in that would be a
     quarter of a gigabyte of canvas, so the margin is grown only as far as a
     device-pixel budget allows and falls back to something near the old
     behaviour at the far end of the zoom - where far fewer tiles are on
     screen and a rebuild is correspondingly cheaper anyway.

     Returns the rect to cache in screen coordinates relative to the current
     camera; `mx`/`my` are how far it reaches left of and above the viewport. */

  /* The city's own screen extent, in camera-independent units (screen minus
     camera origin). Tile (x,y) sits at ((x-y)fx, (x+y)fy), so x-y spans
     +/-(G-1) and x+y spans 0..2G-2; the margins are for the tallest tower
     standing up out of its tile and for the shadows running off the last row. */
  Renderer.prototype._cityBox = function () {
    var sc = this.scale, fx = HW * sc, fy = HH * sc;
    return {
      l: -(G - 1) * fx - fx, r: (G - 1) * fx + fx,
      // headroom for the tallest tower standing out of its tile, and for the
      // shadows the last row throws past the edge of the grid
      t: -fy - 260 * sc, b: (2 * G - 2) * fy + fy + 150 * sc
    };
  };

  Renderer.prototype._cacheRect = function () {
    var pixelBudget = MM.visuals ? MM.visuals.profile.pixels : CACHE_PX;
    var box = this._cityBox(), w = this.w, h = this.h;
    var ox = this.ox, oy = this.oy;
    var dpr = Math.min(this.dpr || 1, 2);

    // screen-space city bounds for the camera we are about to bake at
    var cl = box.l + ox, cr = box.r + ox, ct = box.t + oy, cb = box.b + oy;

    function span (lo, hi, a, b) {          // [a,b] clipped into [lo,hi]
      var x0 = a > lo ? a : lo, x1 = b < hi ? b : hi;
      return x1 > x0 ? { a: x0, b: x1 } : { a: x0, b: x0 };
    }
    function rectFor (m) {
      var X = span(-m, w + m, cl, cr), Y = span(-m, h + m, ct, cb);
      return { L: X.a, R: X.b, T: Y.a, B: Y.b };
    }
    function area (r) { return (r.R - r.L) * (r.B - r.T); }

    // Two outcomes only, and the middle ground is deliberately not one of
    // them. Either the whole city fits - in which case a pan never rebuilds
    // anything, which is the whole prize - or it does not, and then the
    // margin stays small. Spending a big budget on a margin that merely
    // delays the next rebuild is the worst of both: the rebuild still comes,
    // and it is far more expensive because the cache is huge.
    var huge = 2 * (w + h) + 4 * Math.max(box.r - box.l, box.b - box.t);
    var r = rectFor(huge), a = area(r), cd = dpr;

    if (a * dpr * dpr > pixelBudget) {
      // Nearly affordable? Buy the whole city by softening the cache instead.
      var soft = Math.sqrt(pixelBudget / Math.max(1, a));
      if (soft >= CACHE_DPR_MIN) {
        cd = Math.min(dpr, soft);
      } else {
        // Zoomed in past the point where the city fits. Keep every device
        // pixel and buy the largest margin the budget allows: a rebuild is
        // fill-bound and so costs about the same whatever is in it, which
        // makes the number of rebuilds the only thing worth optimising, and
        // the margin is what a zoom-out burst eats through before the cache
        // stops covering the screen. Area grows monotonically with the margin
        // and saturates once the city is inside, so bisect for it.
        var lo = CACHE_M, hi = huge;
        for (var i = 0; i < 26; i++) {
          var mid = (lo + hi) * 0.5;
          if (area(rectFor(mid)) * dpr * dpr > pixelBudget) hi = mid; else lo = mid;
        }
        r = rectFor(lo);
      }
    }

    // Where the city stops there is nothing to draw and the sky underneath is
    // the right answer, so that edge is left exactly where it falls.
    if (r.R - r.L < 1 || r.B - r.T < 1) return { mx: 0, my: 0, W: 1, H: 1, dpr: cd, empty: true };
    // A large viewport alone can exceed the budget, even with no margin.
    // Soften that cache as a last resort instead of allocating past the cap.
    cd = Math.min(cd, Math.sqrt(pixelBudget / Math.max(1, (r.R - r.L) * (r.B - r.T))));
    return { mx: -r.L, my: -r.T, W: r.R - r.L, H: r.B - r.T, dpr: cd, empty: false };
  };

  /* Does the cache still hold everything the current camera needs to show?
     Compared in camera-independent units, so a pan inside a whole-city cache
     is always valid however far it goes. */
  Renderer.prototype._cacheCovers = function () {
    var box = this._cityBox(), ox = this.ox, oy = this.oy;
    // what the viewport needs, intersected with what actually exists
    var nl = Math.max(box.l, -ox), nr = Math.min(box.r, this.w - ox);
    var nt = Math.max(box.t, -oy), nb = Math.min(box.b, this.h - oy);
    if (nr <= nl || nb <= nt) return true;              // nothing on screen
    // What was recorded is in screen units at the scale it was baked at, and
    // those units stretch with the zoom. Without this the coverage test is
    // comparing two different rulers and says "no" at every zoom step, which
    // put a 700ms rebuild in every frame of a wheel spin.
    var k = this._cacheScale > 0 ? this.scale / this._cacheScale : 1;
    var e = 0.5;
    return nl >= this._covL * k - e && nr <= this._covR * k + e &&
           nt >= this._covT * k - e && nb <= this._covB * k + e;
  };

  /* ---------- atmosphere: four gradients, baked --------------------------
     The four washes that cover the whole viewport - the sky, the sun's haze,
     the directional glow and the vignette - were the most expensive thing in
     a frame by a distance. Measured on this renderer at 1426x754: a linear
     gradient fill costs 2.0ms and a radial one 3.6ms, against 1.2ms to blit
     the same pixels out of an offscreen. Skia evaluates a gradient per pixel
     and blits a scanline at a time, so the gap does not close.

     None of them reads the grid or the camera. They are a pure function of
     the light and the window, which is exactly the shape of thing that wants
     baking: paint each into an offscreen once per light bucket, then blit.
     Baked at half resolution and blown back up, because a gradient has no
     detail to lose and it makes the bake itself four times cheaper.

     Three layers, because they need three composite operations:
       _bgL   opaque       sky gradient + sun or moon disc   (under the city)
       _addL  'lighter'    the sun's directional wash        (over the city)
       _ovL   source-over  aerial haze + vignette            (over everything) */

  var ATMO_K = 0.5;                        // bake resolution, linear

  /* An offscreen `name` sized to the viewport times k, cleared, with the
     transform set so callers can keep drawing in plain viewport coordinates. */
  Renderer.prototype._layer = function (name, k) {
    var c = this[name];
    if (!c) c = this[name] = document.createElement('canvas');
    var w = Math.max(1, Math.round(this.w * k)), h = Math.max(1, Math.round(this.h * k));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this[name + 'x'] = null; }
    var g = this[name + 'x'];
    if (!g) g = this[name + 'x'] = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    return g;
  };

  Renderer.prototype._bakeAtmo = function () {
    var LG = MM.light;
    // light.js owns the key: it quantises the sun's position and the light,
    // so a wash that moved three pixels is not a reason to repaint a million.
    var key = (LG && LG.key ? LG.key(this) : (this.w + 'x' + this.h)) +
      '|' + this.L.toFixed(2) + '|' + this.golden.toFixed(2) + '|' + this.N.toFixed(2);
    if (key === this._atmoKey) return;
    this._atmoKey = key;

    var K = ATMO_K, g, grad;

    // 1. background - the sky, then the disc the whole scene points at
    g = this._layer('_bgL', K);
    grad = g.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, rgbs(lerp3([18, 27, 52], [96, 164, 228], this.L)));
    var bot = lerp3([34, 40, 62], [198, 226, 244], this.L);
    bot = lerp3(bot, [236, 158, 92], this.golden * 0.7);
    grad.addColorStop(1, rgbs(bot));
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    if (LG && LG.sky) LG.sky(g, this);

    // 2. additive - through the middle of the night there is nothing in it,
    //    and an empty layer is a blit worth skipping entirely
    this._addOn = !!(LG && LG.glow) && (!LG.glowAlpha || LG.glowAlpha() >= 0.015);
    if (this._addOn) { g = this._layer('_addL', K); LG.glow(g, this); }

    // 3. over - aerial perspective, then the vignette on top of it
    g = this._layer('_ovL', K);
    if (LG && LG.haze) LG.haze(g, this);
    g.save();
    g.globalAlpha = 0.55 + 0.35 * this.N;
    g.fillStyle = this._buildVignette(g);
    g.fillRect(0, 0, this.w, this.h);
    g.restore();
  };

  /* ---------- frame --------------------------------------------------- */

  /* Draw the unchanging city into the offscreen cache. Everything that moves -
     traffic, steam, the hover cursor - is drawn live on top of the blit. */
  Renderer.prototype._renderStatic = function (s) {
    var rect = this._cacheRect();
    var dpr = rect.dpr;
    var mx = rect.mx, my = rect.my, W = rect.W, H = rect.H;
    var cc = this._cc;
    var cw = Math.max(1, Math.floor(W * dpr)), ch = Math.max(1, Math.floor(H * dpr));
    if (cc.width !== cw || cc.height !== ch) { cc.width = cw; cc.height = ch; this._cctx = null; }
    if (!this._cctx) this._cctx = cc.getContext('2d');
    var lc = this._lc;
    var lw = Math.max(1, Math.round(cw * LIGHT_RES)), lh = Math.max(1, Math.round(ch * LIGHT_RES));
    if (lc.width !== lw || lc.height !== lh) { lc.width = lw; lc.height = lh; this._lctx = null; }
    if (!this._lctx) this._lctx = lc.getContext('2d');

    this._cacheOx = this.ox; this._cacheOy = this.oy;
    this._cacheW = W; this._cacheH = H;
    this._cacheMx = mx; this._cacheMy = my;
    this._cacheScale = this.scale; this._cacheDpr = dpr;
    // what we now hold, in camera-independent units, for _cacheCovers
    this._covL = -mx - this.ox; this._covR = W - mx - this.ox;
    this._covT = -my - this.oy; this._covB = H - my - this.oy;

    this._paintCity(s, null);
  };

  /* Paint the city into the cache. With no rect it is the whole cache, cleared
     first; with one it is that rect only - clipped and cleared - which is how
     a build or a level-up repaints a street corner instead of a city. */
  Renderer.prototype._paintCity = function (s, R) {
    var dpr = this._cacheDpr, W = this._cacheW, H = this._cacheH;
    var live = this.ctx, ox0 = this.ox, oy0 = this.oy, w0 = this.w, h0 = this.h;
    this.ctx = this._cctx;
    // the camera the cache was baked at, not wherever the live one has got to
    this.ox = this._cacheOx + this._cacheMx; this.oy = this._cacheOy + this._cacheMy;
    this.w = W; this.h = H;

    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._clipR = R;                      // the layer passes cull against this
    if (R) {
      ctx.save();
      ctx.beginPath(); ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); ctx.clip();
      ctx.clearRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
    } else {
      ctx.clearRect(0, 0, W, H);          // transparent: the sky is drawn live
    }
    this._skipVeh = true;

    var n0 = this.N;
    this.N = 0;                           // the cached city is always at noon
    if (MM.gfx) MM.gfx.setLight(this._rm, this._gm, this._bm, 0);

    this._collect(s, R);
    this._ground(s);
    this._roadPass(s);
    this._railPass(s);
    this._overlayPass(s);
    this._dapple(s);
    this._shadows(s);

    var dim = this.overlay && this.overlay !== 'none';
    if (dim) ctx.globalAlpha = 0.55;
    var mask = this._coverage;
    if (!mask) mask = this._coverage = document.createElement('canvas');
    var res = Math.min(.25, dpr * .25), mw = Math.max(1, Math.ceil(W * res)), mh = Math.max(1, Math.ceil(H * res));
    if (mask.width !== mw || mask.height !== mh) { mask.width = mw; mask.height = mh; }
    var mg = mask.getContext('2d', { willReadFrequently: true });
    mg.setTransform(res, 0, 0, res, 0, 0); mg.fillStyle = '#000';
    mg.save();
    if (R) { mg.beginPath(); mg.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); mg.clip(); mg.clearRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); }
    else mg.clearRect(0, 0, W, H);
    if (MM.gfx) MM.gfx.setCoverage(mg);
    try { this._structures(s); } finally { if (MM.gfx) MM.gfx.setCoverage(null); mg.restore(); }
    this._coverageScale = res;
    try { this._coverageData = mg.getImageData(0, 0, mw, mh).data; }
    catch (e) { this._coverageData = null; } // privacy settings may deny readback
    if (dim) ctx.globalAlpha = 1;
    if (R) ctx.restore();

    // the window-light layer, same camera, painted at full brightness but at
    // its own (lower) resolution - _blitCache reads the ratio off the canvas
    this.ctx = this._lctx;
    ctx = this.ctx;
    var ld = dpr * LIGHT_RES;
    ctx.setTransform(ld, 0, 0, ld, 0, 0);
    if (R) {
      ctx.save();
      ctx.beginPath(); ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); ctx.clip();
      ctx.clearRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
    if (this.scale >= 0.42) this._paintWindows(s);
    if (R) ctx.restore();

    this._skipVeh = false;
    this._clipR = null;
    this.N = n0;
    this.ctx = live;
    this.ox = ox0; this.oy = oy0; this.w = w0; this.h = h0;
  };

  /* Where the cache lands on screen right now. Everything is derived rather
     than remembered, so this is also correct when the camera has zoomed since
     the bake: the cached image is simply the same picture at another scale,
     and blitting it scaled is what lets a wheel spin stay smooth while the
     rebuild waits for the camera to settle. */
  /* Blit the part of the cache that is actually on screen, and no more.
     The cache is now most of a city - 9 megapixels of it - and handing all of
     that to drawImage to be scaled and then clipped costs real time even
     though nearly none of it lands. Source-rect form clips first. */
  Renderer.prototype._blitCache = function (ctx, img, b) {
    if (!img || !img.width || !this._cacheW) return;
    var cd = img.width / this._cacheW;               // device px per cache css px
    var k = b.k;
    var sx0 = clamp((0 - b.x) / k, 0, this._cacheW);
    var sx1 = clamp((this.w - b.x) / k, 0, this._cacheW);
    var sy0 = clamp((0 - b.y) / k, 0, this._cacheH);
    var sy1 = clamp((this.h - b.y) / k, 0, this._cacheH);
    if (sx1 - sx0 < 0.5 || sy1 - sy0 < 0.5) return;
    ctx.drawImage(img,
      sx0 * cd, sy0 * cd, (sx1 - sx0) * cd, (sy1 - sy0) * cd,
      b.x + sx0 * k, b.y + sy0 * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
  };

  Renderer.prototype._blitAt = function () {
    var k = this._cacheScale > 0 ? this.scale / this._cacheScale : 1;
    return {
      k: k,
      x: (-this._cacheMx - this._cacheOx) * k + this.ox,
      y: (-this._cacheMy - this._cacheOy) * k + this.oy,
      w: this._cacheW * k, h: this._cacheH * k
    };
  };

  Renderer.prototype.draw = function (s, dtMs) {
    /* The title screen rides over a city of its own - see src/shell.js. This
       renderer only ever READS a state, never writes one, so swapping which
       one it reads is the whole of what that takes: MM.state goes on being
       the player's own city, and the save, the autosave and the cloud push
       never see the showcase at all. */
    if (this.showing) s = this.showing;
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
    var quality = MM.visuals ? MM.visuals.quality : 'high';
    if (this._quality !== quality) { this._quality = quality; this.resize(); this._cacheKey = ''; }
    if (this._cursorBuild !== this.buildMode) { this._cursorBuild = this.buildMode; this.canvas.classList.toggle('building', this.buildMode); }

    this._camera(dt);          // held keys and momentum, before anything reads ox/oy

    this._daynight(s, dt);
    this._palette();

    if (this.clock - this._netT > 400) { this._netT = this.clock; this._rebuildNet(s); }
    this._traffic(s, dt);
    this._trains(s, dt);

    var ctx = this.ctx;

    // Sky and sun. Viewport-relative, so the city cache cannot carry them -
    // but they only move with the light, so they are baked (see _bakeAtmo)
    // and this is one opaque blit instead of a linear and a radial gradient.
    this._bakeAtmo();
    ctx.drawImage(this._bgL, 0, 0, this.w, this.h);

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
    //
    // The zoom is deliberately NOT in the key either. A zoom does not make the
    // cached image wrong, only the size it is drawn at, and _blitAt puts it up
    // at the new scale for nothing. The rebuild that sharpens it can wait.
    // s.rev is deliberately NOT in the key either. It is bumped by every edit
    // and by every block that levels up on its own, and rebuilding the world
    // for one new storey is what made building feel like wading. It is handled
    // below instead, by repainting the tiles that actually look different.
    var key = this.w + 'x' + this.h + '|' + ov +
      // no light term: the cached city does not change with the clock
      // the heatmaps are recomputed daily, so they alone track the calendar
      (ov === 'none' ? '' : '|' + (s.day | 0));

    // A rebuild costs a third of a second on a built-up city, so it waits for
    // the camera to stop. Through a drag or a wheel spin the existing cache is
    // blitted where it now belongs instead, which is what turns a burst of
    // freezes into a pan that keeps up with the mouse.
    var moved = this.ox !== this._lastOx || this.oy !== this._lastOy ||
      this.scale !== this._lastScale;
    this._lastOx = this.ox; this._lastOy = this.oy; this._lastScale = this.scale;
    this._still = moved ? 0 : this._still + 1;
    this._settleMs = moved ? 0 : this._settleMs + dt;

    var b = this._blitAt();
    // Two things it cannot ride out: a cache that no longer covers what is on
    // screen (that would be a hole), and one stretched far enough to look
    // soft. A hole forces the rebuild whatever the camera is doing. Softness
    // does not have to: while `cinematic` is set and the camera has not
    // stopped, the wider RIDE_* window applies and the sharpening is left to
    // the settle branch below, which is the same trade a wheel burst makes.
    var lo = BLIT_MIN, hi = BLIT_MAX;
    if (this.cinematic && this._settleMs < SETTLE_MS) { lo = RIDE_MIN; hi = RIDE_MAX; }
    var must = key !== this._cacheKey || !this._cacheW || !this._cacheCovers() ||
      b.k < lo || b.k > hi;
    var rev = s.rev | 0;
    if (must || (this._cacheScale !== this.scale && this._settleMs >= SETTLE_MS)) {
      this._renderStatic(s);
      this._commitSig(s);
      this._cacheKey = key; this._cacheRev = rev;
      b = this._blitAt();
    } else if (rev !== this._cacheRev) {
      // The city changed under us. Repaint only what looks different - and
      // often that is nothing at all, because plenty of rev bumps move a
      // number the static pass never draws.
      var d = this._dirty(s);
      if (d && d.all) { this._renderStatic(s); b = this._blitAt(); this._commitSig(s); }
      else if (d) { if (!this._patchStatic(s, d)) this._renderStatic(s); this._commitSig(s); }
      this._cacheRev = rev;
    }
    this._blitCache(ctx, this._cc, b);

    // The water surface is live, over the blit and under the traffic.
    if (MM.light && quality !== 'eco') MM.light.shimmer(ctx, this, s);

    for (var d = 0; d < 2 * G; d++) { this._drawVehDiag(d); this._drawTrainDiag(d); }

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

    // Everything additive, in one pass each: the sun's wash (baked), the lit
    // windows (baked with the city) and the street lamps. Additive composites
    // commute, so their order among themselves does not matter.
    if (this._addOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this._addL, 0, 0, this.w, this.h);
      ctx.restore();
    }
    if (this.N > 0.10 && this.scale >= 0.42) {   // lit windows, one blit
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, 0.72 * this.N);
      this._blitCache(ctx, this._lc, b);
      ctx.restore();
    }
    this._lampGlow();

    // aerial perspective and the vignette, baked together into one blit
    ctx.drawImage(this._ovL, 0, 0, this.w, this.h);

    // Hover sits over the vignette now rather than under it, which costs
    // nothing and keeps the cursor readable in the darkened corners.
    this._hoverPass(s);
    this._pickPass(s);
  };

  /* The inspector's selection, drawn as the lot's footprint rather than as a
     single tile: what you picked was a building, so what lights up is the
     whole parcel it stands on. this.pick is set by src/inspect.js and is null
     the rest of the time, which is what keeps this free when nobody is
     looking at anything. */
  Renderer.prototype._pickPass = function (s) {
    var p = this.pick;
    if (!p) return;
    var ctx = this.ctx, sc = this.scale, fx = HW * sc, fy = HH * sc;

    if (p.agent) {
      var v = p.agent;
      if (v.sx < -1000) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,214,102,0.95)';
      ctx.lineWidth = Math.max(1.2, 1.6 * sc);
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, Math.max(7, 9 * sc), 0, TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (!p.lot) return;
    var L = p.lot;
    // Footprint outline: the four outer corners of the lot's tile rectangle,
    // in the same projection the ground pads were drawn with.
    var pts = [[L.x0 - 0.5, L.y0 - 0.5], [L.x1 + 0.5, L.y0 - 0.5],
      [L.x1 + 0.5, L.y1 + 0.5], [L.x0 - 0.5, L.y1 + 0.5]];
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var wx = pts[i][0], wy = pts[i][1];
      var cx = (wx - wy) * fx + this.ox, cy = (wx + wy) * fy + this.oy;
      if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,214,102,0.13)';
    ctx.fill();
    var pulse = 0.70 + 0.30 * Math.sin(this.clock * 0.005);
    ctx.strokeStyle = 'rgba(255,214,102,' + pulse.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.4, 2 * sc);
    ctx.stroke();
    ctx.restore();
  };

  function lerp3 (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgbs (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  MM.Renderer = Renderer;
})(window.MM);

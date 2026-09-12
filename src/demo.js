/* src/demo.js - the showcase city.

   `npm start` boots this hand-planned metropolis instead of your save, so the
   renderer can be judged on a finished city rather than on a starter block:
   an airport, a downtown of towers, a stadium, a funfair, a container port,
   a power station, a marina, hospitals, depots and forty blocks of housing.

   Three modes, because the city has two jobs now:

     'showcase' (default)  the planned city is where you START, and then the
                           real economy runs on it. Your save is read and
                           written normally; the plan is only used when there
                           is nothing to load.
     'diorama'             the old behaviour - economy held still, save never
                           touched, clock crawling so the sky still turns.
                           This is the mode to shoot renderer stills in.
     false                 no showcase at all; open on the starter block.

   Set MM.DEMO before this file loads, or put ?diorama / ?play in the URL.

   'showcase' is the default because a frozen city cannot be played and cannot
   be priced: sim.daily() is what fills s.pow, and s.pow is what every district
   is worth. A diorama's land value is zero everywhere.

   The plan is laid out on the 5-tile road grid: roads on every fifth row and
   column, four-tile blocks between them. Landmarks reserve whole blocks so
   they always keep a road frontage on all four sides.                      */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var q = (typeof location !== 'undefined' && location.search) || '';
  var MODE = /[?&]diorama(?:[=&]|$)/.test(q) ? 'diorama'
    : /[?&]play(?:[=&]|$)/.test(q) ? false
    : MM.DEMO === undefined ? 'showcase' : MM.DEMO;
  var ON = MODE !== false;

  var G = MM.GRID, T = MM.TILE, idx = MM.idx;
  var hash = (MM.gfx && MM.gfx.hash) || function (x, y, k) {
    var n = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
    return n - Math.floor(n);
  };

  var PITCH = 5;                       // road every fifth row and column

  /* ---- landmark plots -------------------------------------------------
     x0, y0, w, h, archetype, the tile kind the plot is zoned as.
     Every one of these is block-aligned, so the road grid frames it.     */
  var PLOTS = [
    [ 1,  1, 9, 9, 'airport',  T.PARK],
    [26,  1, 4, 4, 'wind',     T.PARK],
    [36,  6, 4, 4, 'marina',   T.PARK],
    [ 1, 26, 4, 4, 'stadium',  T.PARK],
    [ 6, 26, 4, 4, 'hospital', T.CLINIC],
    [ 1, 31, 4, 4, 'funfair',  T.PARK],
    [ 6, 31, 2, 2, 'fire',     T.PARK],
    [ 6, 33, 2, 2, 'police',   T.PARK],
    [11, 31, 4, 4, 'depot',    T.PARK],
    [30, 37, 4, 4, 'port',     T.IND],
    [21, 41, 4, 4, 'power',    T.IND],
    [16, 41, 4, 4, 'solar',    T.IND],
    [21, 21, 3, 3, 'hero',     T.PARK],  // the one thing allowed to break the height rules
    /* the wonders, one to a district so none of them shares a skyline */
    [31, 11, 4, 4, 'pyramid',  T.PARK],
    [16, 16, 3, 3, 'arcde',    T.PARK],
    [11, 16, 3, 3, 'clock',    T.PARK],
    [26, 26, 4, 4, 'pagoda',   T.PARK],
    [16, 26, 4, 4, 'arena',    T.PARK]
  ];

  /* whole blocks kept green, so downtown has somewhere to have lunch */
  var GREENS = [
    [21, 16, 24, 19], [ 6, 11,  9, 14], [26, 31, 29, 34],
    [16,  6, 19,  9], [11, 41, 14, 44], [26, 21, 29, 24],
    [11, 26, 14, 29]                                  // hospital's neighbour
  ];

  /* one-tile civic services, dropped on top of whatever zone they land in */
  var CIVICS = [
    [T.SCHOOL, 12, 17], [T.SCHOOL,  7, 37], [T.SCHOOL, 22,  7],
    [T.CLINIC, 13, 22], [T.CLINIC,  3, 17], [T.CLINIC, 27, 12],
    [T.GROCERY, 8, 22], [T.GROCERY, 18, 33], [T.GROCERY, 12, 38],
    [T.CHILDCARE, 12, 12], [T.CHILDCARE, 7, 42], [T.CHILDCARE, 23, 27],
    [T.TOWER, 2, 12], [T.TOWER, 3, 12], [T.TOWER, 2, 13], [T.TOWER, 3, 13],
    [T.TOWER, 2, 37], [T.TOWER, 3, 37], [T.TOWER, 2, 38], [T.TOWER, 3, 38],
    [T.BUS, 14, 16], [T.BUS, 6, 21], [T.BUS, 21, 26], [T.BUS, 16, 11],
    [T.BUS, 26, 36], [T.BUS, 11, 6], [T.BUS, 31, 26], [T.BUS, 9, 43]
  ];

  var resv = new Uint8Array(G * G);

  function inside (x, y, r) { return x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]; }

  /* the district map: what a plain tile becomes if nothing else claimed it */
  function zoneAt (x, y) {
    var r = hash(x, y, 11);
    if (y >= 36) {                                   // south: works and wharves
      if (x >= 16) return [T.IND, r < 0.42 ? 2 : 3];
      return [T.RES, r < 0.45 ? 1 : 2];
    }
    if (x >= 31) return [T.RES, r < 0.3 ? 3 : 4];    // riverside towers
    if (x >= 16 && y >= 11 && y <= 29) return [T.COM, 4];          // downtown
    if (x >= 11 && y >= 11 && y <= 34) return [T.COM, r < 0.4 ? 3 : 4]; // midtown
    if (y >= 30) return [T.RES, r < 0.5 ? 2 : 3];    // south-side neighbourhoods
    if (y <= 5) return [T.RES, 2];                   // low-rise by the airport
    if (x >= 16) return [T.COM, r < 0.5 ? 2 : 3];    // uptown high street
    return [T.RES, r < 0.25 ? 2 : (r < 0.75 ? 3 : 4)];
  }

  function build () {
    var s = MM.createState();
    var n = G * G, i, x, y, k;

    for (i = 0; i < n; i++) {
      if (s.grid[i] !== T.WATER) { s.grid[i] = T.EMPTY; s.level[i] = 0; }
      resv[i] = 0;
    }

    /* 1. landmark plots first: they own their block outright */
    for (k = 0; k < PLOTS.length; k++) {
      var p = PLOTS[k];
      for (y = p[1]; y < p[1] + p[3]; y++) {
        for (x = p[0]; x < p[0] + p[2]; x++) {
          if (x >= G || y >= G) continue;
          i = idx(x, y);
          resv[i] = 1; s.grid[i] = p[5]; s.level[i] = p[5] === T.IND ? 3 : 0;
        }
      }
    }

    /* 2. the road grid, plus two crossings of the East River */
    for (y = 0; y < G; y++) {
      for (x = 0; x < G; x++) {
        i = idx(x, y);
        if (resv[i] || s.grid[i] === T.WATER) continue;
        if (x % PITCH === 0 || y % PITCH === 0) s.grid[i] = T.ROAD;
      }
    }
    for (k = 0; k < 2; k++) {
      y = k ? 30 : 15;
      for (x = 25; x < G; x++) { i = idx(x, y); if (!resv[i]) s.grid[i] = T.ROAD; }
    }

    /* 3. zone everything the roads left over */
    for (y = 0; y < G; y++) {
      for (x = 0; x < G; x++) {
        i = idx(x, y);
        if (resv[i] || s.grid[i] !== T.EMPTY) continue;
        var z = zoneAt(x, y);
        s.grid[i] = z[0]; s.level[i] = z[1];
      }
    }

    /* 4. parks */
    for (k = 0; k < GREENS.length; k++) {
      var gr = GREENS[k];
      for (y = gr[1]; y <= gr[3]; y++) {
        for (x = gr[0]; x <= gr[2]; x++) {
          i = idx(x, y);
          if (resv[i] || s.grid[i] === T.WATER || s.grid[i] === T.ROAD) continue;
          s.grid[i] = T.PARK; s.level[i] = 0;
        }
      }
    }
    /* pocket parks, one per handful of blocks, so no district is all brick */
    for (y = 1; y < G; y++) {
      for (x = 1; x < G; x++) {
        i = idx(x, y);
        if (resv[i] || s.grid[i] === T.WATER || s.grid[i] === T.ROAD) continue;
        if (hash(x - x % PITCH, y - y % PITCH, 12) < 0.10) { s.grid[i] = T.PARK; s.level[i] = 0; }
      }
    }

    /* 5. civic services */
    for (k = 0; k < CIVICS.length; k++) {
      var c = CIVICS[k];
      i = idx(c[1], c[2]);
      if (resv[i] || s.grid[i] === T.WATER || s.grid[i] === T.ROAD) continue;
      s.grid[i] = c[0]; s.level[i] = 0;
    }

    /* 6. tell lots.js which block each landmark belongs on */
    if (MM.lots && MM.lots.pin) {
      MM.lots.clearPins();
      for (k = 0; k < PLOTS.length; k++) {
        var q = PLOTS[k];
        MM.lots.pin(q[0], q[1], q[4], q[2], q[3]);
      }
    }

    stats(s);
    s.rev = 1;
    return s;
  }

  /* Plausible headline numbers. The showcase does not run the economy, so
     these are computed once from what is actually on the ground. */
  function stats (s) {
    var pop = 0, jobs = 0, i, t, lv;
    for (i = 0; i < s.grid.length; i++) {
      t = s.grid[i]; lv = s.level[i] || 0;
      if (t === T.RES) pop += 14 + lv * 26;
      else if (t === T.TOWER) pop += 220;
      else if (t === T.COM) jobs += 10 + lv * 22;
      else if (t === T.IND) jobs += 16 + lv * 20;
    }
    s.pop = pop; s.jobs = jobs; s.employed = Math.min(pop * 0.62, jobs * 0.94) | 0;
    s.treasury = 4200000;
    s.approval = 79; s.happiness = 76; s.rent = 114;
    s.traffic = 44; s.pollution = 33;
    s.ridership = (pop * 0.31) | 0;
    s.dailyIncome = 41200; s.dailyCost = 27800;
    s.taxRate = { res: 9, com: 11, ind: 12 };
    s.policies = { freeBus: true, rentFreeze: true, childcare: true };
    s.tick = 10; s.day = 612; s.speed = 1;
    s.log = [{ day: s.day, text: 'Showcase city loaded - every district built out.', kind: 'good' }];
    MM.log(s, 'Airport, port, stadium, marina and power station online.', 'info');
  }

  MM.buildDemoCity = build;

  /* Start a different city without reloading the page.
   *
   * This has to mutate the state object rather than replace it, and that is
   * not a style choice. game.js holds `const state` in a closure: the frame
   * loop, every input handler and the UI all reference that one object.
   * Assigning MM.state a fresh object would leave the game simulating the old
   * city forever while the shell showed the new one. game.js is the lead's
   * file and the contract forbids editing it, so in place is the only door -
   * and it is the right one anyway, because every cache downstream is keyed
   * to s.rev, which makes one bump the whole invalidation.
   *
   *   kind 'fresh'     the starter block - a road, a few lots, $60k
   *        'showcase'  the built-out city, inherited mid-term
   */
  function newGame (kind) {
    var s = MM.state;
    if (!s) return null;
    var src = kind === 'fresh' ? MM.createState() : build();

    /* Typed arrays by .set(), never by assignment. render.js diffs a per-tile
       signature against these exact buffers to find its dirty rect, and
       lots.js caches a plan over them; handing either a different object is
       how you get a city that renders the one before it. */
    s.grid.set(src.grid);
    s.level.set(src.level);
    s.pow.set(src.pow);
    for (var k in src) {
      if (k === 'grid' || k === 'level' || k === 'pow') continue;
      s[k] = src[k];
    }
    s.rev = (s.rev || 0) + 1;      // the renderer's static cache is now wrong
    s.pending = null;
    s.gameOver = null;
    MM.saveState(s);
    return s;
  }

  MM.newGame = newGame;

  if (ON) {
    MM.demo = { loadState: MM.loadState, saveState: MM.saveState, sim: MM.sim, mode: MODE };

    if (MODE === 'diorama') {
      MM.loadState = function () { return build(); };
      MM.saveState = function () { return true; };    // never touch the real save

      /* A diorama, not a save file: hold the economy still so the city stays
         exactly as planned, and advance the clock slowly so the sky still runs
         through dawn, noon, dusk and night. */
      var sub = 0;
      MM.sim = {
        step: function (s) {
          if (++sub < 6) return;                       // ~60s per game day
          sub = 0;
          s.tick = (s.tick | 0) + 1;
          if (s.tick >= MM.TICKS_PER_DAY) { s.tick = 0; s.day = (s.day | 0) + 1; }
        },
        K: MM.demo.sim ? MM.demo.sim.K : undefined
      };
    } else {
      /* The plan is a starting position, not a cage. Load a real save if there
         is one; otherwise open on the built-out city and let the economy run.
         sim and saveState are left exactly as they were. */
      MM.loadState = function () {
        var saved = null;
        try { saved = MM.demo.loadState(); } catch (e) { saved = null; }
        return saved || build();
      };
    }
  }
})(window.MM);

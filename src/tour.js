/* MAYOR - the guided tour behind "Start demo".
 *
 * Five minutes is the whole brief, so this file is a SCHEDULE and nothing
 * else. It adds no game logic: every beat reaches for a system that already
 * exists - the shell's camera, the simulation's own event roll, the
 * inspector, the chain layer - and lets that system produce the result. If a
 * beat could not be done by a player with a mouse, it does not belong here.
 *
 * Two things make it trustworthy rather than a video.
 *
 * The clock is injectable. Beats are scheduled against `now()`, which defaults
 * to performance.now but is handed in by tools/tour-check.js so the whole
 * five minutes can be rehearsed headlessly in milliseconds. A timing claim
 * nobody can test is a timing claim nobody should believe.
 *
 * And every beat is skippable. Any key, any click on the caption's own button,
 * and the tour stops where it is and hands over a city that is fully playable
 * from exactly that state. It never traps anyone and it never rewinds.
 */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  function el (tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function chain () { return window.MM_CHAIN || null; }
  function haveWallet () { var c = chain(); return !!(c && c.currentUser && c.currentUser()); }
  function haveGraph () { var c = chain(); return !!(c && c.graph && c.graph.isConfigured()); }

  /* ------------------------------------------------------------------ *
   * the beat sheet
   *
   * `at` is seconds from the start. `needs` names a capability; when it is
   * missing the beat runs `alt` instead of `run`, which is how a demo on a
   * laptop with no wallet still shows the chain rather than an error. A stage
   * demo must never depend on somebody's inbox.
   * ------------------------------------------------------------------ */
  var RIDE_FROM = 25, RIDE_TO = 100;          // the eight stops, seconds

  var BEATS = [
    { at: 0, id: 'title', say: '',
      run: function (t) { if (MM.shell && !MM.shell.open) MM.shell.show('title'); } },

    { at: RIDE_FROM, id: 'ride', say: 'Eight stops. Every one is somewhere you can build.',
      run: function () { /* the ride is driven continuously in _frame */ } },

    { at: 100, id: 'enter', say: 'The camera never cut. That was the city the whole time.',
      run: function () { if (MM.shell && MM.shell.open) MM.shell.play(); } },

    { at: 112, id: 'speed', say: 'Four years, and it runs whether you are watching or not.',
      run: function () { var s = MM.state; if (s) s.speed = 2; } },

    { at: 118, id: 'event', say: 'The city asks for things. You answer with money you do not have.',
      run: function () {
        var s = MM.state;
        /* The real roll, not a scripted card: whatever the simulation would
           have offered today is what appears. If the roll comes up empty the
           beat simply passes - a forced event would be the one fake thing in
           the whole tour. */
        if (s && !s.pending && MM.maybeFireEvent) {
          try { s.pending = MM.maybeFireEvent(s) || null; } catch (e) { /* content is not load-bearing */ }
        }
      } },

    { at: 130, id: 'inspect', say: 'Every parcel has a name, and the name is ENS.',
      run: function () {
        var r = MM.renderer, s = MM.state;
        if (!MM.inspect || !r || !s) return;
        /* Point at the middle of the built-up city and open whatever is
           actually there, rather than a parcel chosen in advance. */
        var p = tileToScreen(r, 22, 22);
        if (p) MM.inspect.open(p.x, p.y);
      } },

    { at: 160, id: 'push', say: 'The city publishes itself. Only the name-holder may.',
      needs: 'wallet',
      run: function () { var c = chain(); if (c && c.pushNow) c.pushNow(true); },
      alt: function () { if (MM.inspect) MM.inspect.close(); } },

    { at: 200, id: 'graph', say: 'Ninety days of nine districts, indexed. One request.',
      needs: 'graph',
      run: function () { var c = chain(); if (c && c.history) c.history(); },
      alt: function () { if (MM.inspect) MM.inspect.close(); } },

    { at: 240, id: 'vault', say: 'Somebody can take a position on how well you govern.',
      needs: 'wallet',
      run: function () { /* the market panel is already showing it */ },
      alt: function () { /* nothing to substitute; the panel speaks for itself */ } },

    { at: 265, id: 'back', say: 'Your turn.',
      run: function (t) { t.stop('done'); } }
  ];

  var TOTAL = 270;                             // seconds, and the claim

  /* Screen position of a tile centre, without reaching into the renderer's
     internals beyond the three public fields it already exposes. */
  function tileToScreen (r, tx, ty) {
    if (typeof r.ox !== 'number' || typeof r.scale !== 'number') return null;
    if (r.tileToScreen) return r.tileToScreen(tx, ty);
    return { x: (window.innerWidth || 1280) / 2, y: (window.innerHeight || 800) / 2 };
  }

  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---- the tour -----------------------------------------------------------

  function Tour (opts) {
    opts = opts || {};
    this.now = opts.now || function () { return performance.now(); };
    this.beats = opts.beats || BEATS;
    this.running = false;
    this.fired = [];
    this._headless = !!opts.headless;
  }

  Tour.prototype.start = function () {
    if (this.running) return this;
    this.running = true;
    this.t0 = this.now();
    this.i = 0;
    this.fired = [];
    if (!this._headless) this._mount();
    this._tick();
    if (!this._headless) this._loop();
    return this;
  };

  /* Advance to wherever the clock says we are. Separated from the rAF loop so
     the rehearsal can drive it with a clock of its own. */
  Tour.prototype._tick = function () {
    if (!this.running) return;
    var t = (this.now() - this.t0) / 1000;

    /* The ride is continuous, not a beat: scrolling the shell between stops is
       what moves the camera, so it is interpolated every frame between
       RIDE_FROM and RIDE_TO rather than jumped eight times.

       This runs BEFORE the beats, and the order is load-bearing. The 'enter'
       beat lands on exactly RIDE_TO and calls play(), which closes the shell -
       so with the beats first, the guard below is already false on the tick
       that should have delivered the final stop. The camera would hand off
       from wherever the previous frame happened to leave it and never reach
       the last stop at all. Arrive, then depart. */
    if (MM.shell && MM.shell.open && t >= RIDE_FROM && t <= RIDE_TO) {
      var k = clamp((t - RIDE_FROM) / (RIDE_TO - RIDE_FROM), 0, 1);
      /* rideTo, not apply: the copy column is real scrolled content, and
         apply() alone flies the camera while the words stay on scene one. */
      if (MM.shell.rideTo) MM.shell.rideTo(k); else MM.shell.apply(k);
    }

    while (this.i < this.beats.length && t >= this.beats[this.i].at) {
      var b = this.beats[this.i++];
      this.fired.push(b.id);
      this._say(b.say);
      try {
        var ok = !b.needs || (b.needs === 'wallet' ? haveWallet() : haveGraph());
        if (ok) { if (b.run) b.run(this); }
        else if (b.alt) b.alt(this);
      } catch (e) {
        /* One broken beat must not end the tour. The next one is seconds away
           and the city underneath is still playable. */
        if (window.console) console.warn('[tour] beat ' + b.id + ' failed:', e);
      }
    }

    if (t > TOTAL + 5) this.stop('overrun');
  };

  Tour.prototype._loop = function () {
    var self = this;
    function frame () {
      if (!self.running) return;
      self._tick();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  Tour.prototype.stop = function (why) {
    if (!this.running) return;
    this.running = false;
    this.why = why || 'skipped';
    if (this._el) { this._el.remove(); this._el = null; }
    if (this._off) { this._off(); this._off = null; }
    /* Hand over exactly where we are. No rewind, no reset, no "the demo is
       over" screen - the city on the glass is the one they now own. */
    var s = MM.state;
    if (s && s.speed === 0) s.speed = 1;
    if (MM.shell && MM.shell.open && why === 'done') MM.shell.show('title');
  };

  // ---- the caption strip --------------------------------------------------

  Tour.prototype._mount = function () {
    var self = this;
    var box = el('div', 'mm-tour', document.body);
    this._el = box;
    this._line = el('div', 'tr-say', box, '');
    var skip = el('button', 'tr-skip', box, 'Take it from here');
    skip.addEventListener('click', function () { self.stop('skipped'); });

    /* Any key is a skip. Capture, so it beats both the game's bare-key
       handlers and the shell's - whoever is on top, the intent is the same. */
    function onKey () { self.stop('skipped'); }
    window.addEventListener('keydown', onKey, true);
    this._off = function () { window.removeEventListener('keydown', onKey, true); };
  };

  Tour.prototype._say = function (text) {
    if (!this._line) return;
    if (!text) { this._el.classList.remove('on'); return; }
    this._line.textContent = text;
    this._el.classList.add('on');
  };

  MM.Tour = Tour;
  MM.tour = { BEATS: BEATS, TOTAL: TOTAL, RIDE_FROM: RIDE_FROM, RIDE_TO: RIDE_TO,
    start: function (opts) { MM.tour.current = new Tour(opts).start(); return MM.tour.current; } };
})(window.MM);

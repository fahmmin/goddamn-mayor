/* OBSICITY - the shell: a train window onto the city, then the menu.
 *
 * The conceit, ported from the Lumora design: you are sitting inside a
 * carriage. The window frame never moves. What moves is the city outside it,
 * and it moves because you scroll - wide skyline, then the airfield, downtown,
 * the marina, the high street, the stadium, the waterfront, the blocks people
 * actually live in. Eight stops on one line.
 *
 * The important difference from the original: the view through the window is
 * not video. It is the live renderer, with the simulation paused and the
 * camera flown between real coordinates in the real city - the airport plot at
 * (1,1), the hero tower at (21,21), the port at (30,37). Nothing here is
 * footage of a city. It is the city, and every stop is somewhere you can
 * actually go and build.
 *
 * Dependencies: Lenis is vendored at vendor/lenis.min.js and loaded as a
 * classic script, so there is no CDN, no npm runtime dependency and no CSP
 * exemption. If it is missing, native scroll drives the same code path and
 * the only thing lost is the easing.
 *
 * game.js is untouched, as the contract requires. This owns an overlay: it
 * pauses with state.speed = 0, hides the HUD with a class, borrows the camera
 * and gives it back exactly as it found it.
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
  function on (node, fn) {
    node.addEventListener('click', function (e) {
      if (e.detail > 0 && node.blur) node.blur();   // as ui.js: Space must not re-trigger
      fn(e);
    });
    return node;
  }
  function lerp (a, b, t) { return a + (b - a) * t; }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  /* Ease the hop between stops, not the scroll itself - Lenis already owns
     the scroll. This is what stops the camera snapping at a scene boundary. */
  function ease (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* Every stop is a real plot in demo.js's PLOTS table or a real district
     region from districts.js, so the camera is always pointed at something
     that exists. tx/ty are tile coords, z is renderer.scale, hour sets the
     light. See src/demo.js:49-62. */
  var STOPS = [
    { key: 'city', title: 'Obsicity', kicker: 'AN ISOMETRIC CITY THAT ANSWERS TO ITS MARKET',
      body: 'You are the Mayor. Four years, a treasury, and a city that will tell you loudly when you get it wrong.',
      tx: 24, ty: 24, z: 0.40, hour: 17, hero: true },

    { key: 'airfield', title: 'The airfield', kicker: 'AIRPORT LOW-RISE',
      body: 'Nine blocks of runway on the northern edge, and the low-rise that grew up around it. Every district is a name: airfield.cityhall.eth.',
      tx: 5.5, ty: 5.5, z: 0.95, hour: 6 },

    { key: 'downtown', title: 'Downtown', kicker: 'THE TOWERS',
      body: 'The height rules bend once, in the middle, for the one building allowed to break them. Land value is highest here, so this is where a district is worth the most.',
      tx: 22.5, ty: 22.5, z: 1.45, hour: 12 },

    { key: 'marina', title: 'The marina', kicker: 'RIVERSIDE TOWERS',
      body: 'Water on the east edge, and the most expensive addresses in the city looking at it.',
      tx: 37.5, ty: 8, z: 1.25, hour: 9 },

    { key: 'shops', title: 'The high street', kicker: 'UPTOWN',
      body: 'Groceries, clinics, childcare. Services are what keep approval up - and approval is what keeps your name from expiring early.',
      tx: 24, ty: 8.5, z: 1.55, hour: 15 },

    { key: 'stadium', title: 'The stadium', kicker: 'THE WEST SIDE',
      body: 'And the funfair below it. Parks and spectacle cost money every single day and return it in land value.',
      tx: 3, ty: 28, z: 1.25, hour: 19 },

    { key: 'port', title: 'The waterfront', kicker: 'WORKS & WHARVES',
      body: 'The container port and the power station. Somebody has to pay for the towers, and it is usually down here.',
      tx: 32, ty: 39, z: 1.15, hour: 21 },

    { key: 'people', title: 'The blocks', kicker: 'RED HOOK',
      body: 'Where the residents actually live. Twenty-five thousand of them, each one a number in the rent index you are about to be judged on.',
      tx: 8, ty: 41, z: 1.6, hour: 18, last: true }
  ];

  var STATS = [
    'Nine districts, live on Sepolia',
    'Every office an ENS name',
    'Deterministic simulation',
    'No wallet required to start'
  ];

  function Shell () {
    this.mode = 'title';
    this.open = false;
    this.p = 0;
    this._panel = null;
    this._cam = null;
    this._build();
  }

  // ---- construction -------------------------------------------------------

  Shell.prototype._build = function () {
    var self = this;
    var root = el('div', 'obs-shell', document.body);
    this.root = root;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Obsicity');

    /* The carriage: the original overlay from the design, self-hosted. Its
       three windows are genuine alpha-0 holes - verified on the pixels, not
       assumed - so the live canvas underneath shows straight through them
       while the seats, sill and frame stay opaque and mask the rest.
       That is the whole trick, and it is why there is no second render, no
       compositing and no video anywhere in this screen. */
    var car = el('img', 'obs-car', root);
    this._car = car;
    car.src = 'src/img/carriage.png';
    car.alt = '';
    car.decoding = 'async';
    car.setAttribute('aria-hidden', 'true');
    el('div', 'obs-vignette', root);

    // ---- fixed nav ----
    var nav = el('header', 'obs-nav', root);
    var mark = on(el('a', 'obs-mark', nav), function () { self.scrollTo(0); });
    mark.href = 'javascript:void 0';
    el('span', 'obs-mark-o', mark, 'Obsi');
    el('em', 'obs-mark-c', mark, 'city');

    var links = el('nav', 'obs-links liquid-glass', nav);
    [['How to play', 'how'], ['The chain', 'chain'], ['Settings', 'settings'], ['Credits', 'credits']]
      .forEach(function (l) {
        on(el('button', 'obs-link', links, l[0]), function () { self.showPanel(l[1]); });
      });
    this._navEnter = on(el('button', 'obs-link obs-enter', links, 'Enter'), function () { self.play(); });

    // ---- the scroller ----
    var scroll = el('div', 'obs-scroll', root);
    this._scroll = scroll;
    var content = el('div', 'obs-scroll-inner', scroll);
    this._content = content;

    this._scenes = STOPS.map(function (s, i) {
      var sec = el('section', 'obs-scene', content);
      var box = el('div', 'obs-copy', sec);
      el('div', 'obs-kicker', box, s.kicker);
      if (s.hero) {
        var h1 = el('h1', 'obs-title', box);
        el('span', null, h1, 'Obsi');
        el('em', null, h1, 'city');
      } else {
        el('h2', 'obs-stop', box, s.title);
      }
      el('p', 'obs-body', box, s.body);

      if (s.hero) {
        var cta = el('div', 'obs-cta', box);
        self._primary = on(el('button', 'obs-btn primary', cta, 'Enter the city'), function () { self.play(); });
        self._secondary = on(el('button', 'obs-btn', cta, 'New city'), function () { self.newCity(); });
        self._resumeNote = el('div', 'obs-note', box, '');
        el('div', 'obs-hint', box, 'scroll to ride the line');
      }
      if (s.last) {
        var cta2 = el('div', 'obs-cta', box);
        on(el('button', 'obs-btn primary', cta2, 'Take the office'), function () { self.play(); });
      }
      return { sec: sec, stop: s, box: box };
    });

    // ---- stop rail ----
    var rail = el('div', 'obs-rail', root);
    this._dots = STOPS.map(function (s, i) {
      var d = on(el('button', 'obs-dot', rail), function () { self.scrollTo(i); });
      d.setAttribute('aria-label', s.title);
      el('span', 'obs-dot-label', d, s.title);
      return d;
    });

    // ---- footer stats ----
    var foot = el('footer', 'obs-foot', root);
    var stats = el('div', 'obs-stats', foot);
    STATS.forEach(function (s) { el('span', 'obs-stat', stats, s); });

    // ---- panels ----
    this._panelHost = el('div', 'obs-panel-host', root);
    this._panelHost.hidden = true;

    /* The game binds bare keys on window. While the shell is up they must not
       reach it - except Escape, which is how you leave. */
    window.addEventListener('keydown', function (e) {
      if (!self.open) {
        if (e.key === 'Escape' && !self._gameBusy()) { self.pause(); e.preventDefault(); }
        return;
      }
      if (e.key === 'Escape') {
        if (self._panel) self.showPanel(null);
        else if (self.mode === 'pause') self.play();
        e.preventDefault();
        return;
      }
      e.stopPropagation();
    }, true);

    this._initScroll();
    this.apply(0);
  };

  // ---- scrolling ----------------------------------------------------------

  Shell.prototype._initScroll = function () {
    var self = this;

    /* Lenis drives a custom wrapper rather than the page, because html/body
       are overflow:hidden and the whole app is position:fixed. Absent, the
       native scroll event runs exactly the same handler. */
    if (typeof window.Lenis === 'function') {
      try {
        this.lenis = new window.Lenis({
          wrapper: this._scroll,
          content: this._content,
          duration: 1.15,
          easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
          smoothWheel: true,
          syncTouch: false
        });
        var raf = function (time) {
          if (!self.lenis) return;
          self.lenis.raf(time);
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
        this.lenis.on('scroll', function (e) { self._onScroll(e.animatedScroll); });
      } catch (err) {
        this.lenis = null;
      }
    }
    if (!this.lenis) {
      this._scroll.addEventListener('scroll', function () { self._onScroll(self._scroll.scrollTop); }, { passive: true });
    }

    /* Any real scroll intent releases toTop()'s hold immediately, so the
       reset can never fight someone who is already riding the line. */
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) {
      self._scroll.addEventListener(ev, function () { self._touched = true; }, { passive: true });
    });
  };

  Shell.prototype._onScroll = function (top) {
    var max = this._scroll.scrollHeight - this._scroll.clientHeight;
    this.apply(max > 0 ? clamp(top / max, 0, 1) : 0);
  };

  Shell.prototype.scrollTo = function (i) {
    var y = i * this._scroll.clientHeight;
    if (this.lenis) this.lenis.scrollTo(y);
    else this._scroll.scrollTo({ top: y, behavior: 'smooth' });
  };

  /* p is 0..1 across the whole ride. Everything visual hangs off this one
     number, so the camera, the copy and the rail can never disagree. */
  Shell.prototype.apply = function (p) {
    this.p = p;
    var n = STOPS.length - 1;
    var seg = clamp(p, 0, 1) * n;
    var i = Math.min(Math.floor(seg), n - 1);
    var t = ease(clamp(seg - i, 0, 1));
    var a = STOPS[i], b = STOPS[i + 1] || a;

    var r = MM.renderer, s = MM.state;
    if (r) {
      r.scale = lerp(a.z, b.z, t);
      r.centerOn(lerp(a.tx, b.tx, t), lerp(a.ty, b.ty, t));
      if (r.clampCamera) r.clampCamera();
    }
    /* Time of day is a sim field, so the light changes as you ride. The game
       clock is paused, which is the only reason writing it here is safe. */
    if (s) s.tick = Math.round(lerp(a.hour, b.hour, t)) % 24;

    var near = Math.round(seg);
    for (var k = 0; k < this._dots.length; k++) {
      this._dots[k].classList.toggle('on', k === near);
    }
    /* Copy fades with distance from its own stop, so only one block of text
       is ever legible and the rest are out of the way of the view. */
    for (var j = 0; j < this._scenes.length; j++) {
      var d = Math.abs(seg - j);
      var o = clamp(1 - d * 1.6, 0, 1);
      var box = this._scenes[j].box;
      box.style.opacity = String(o);
      box.style.transform = 'translateY(' + ((seg - j) * 26).toFixed(1) + 'px)';
      box.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    }
  };

  // ---- open / close -------------------------------------------------------

  Shell.prototype._gameBusy = function () {
    var s = MM.state;
    return !!(s && (s.pending || s.gameOver));
  };

  Shell.prototype.show = function (mode) {
    var s = MM.state, r = MM.renderer;
    this.mode = mode || 'title';
    this.open = true;
    if (s) { this._speed = s.speed || 1; s.speed = 0; this._hour = s.tick; }
    /* Borrow the camera, remember exactly where it was. Resuming a paused
       game must not teleport the player to wherever the ride ended. */
    if (r) this._cam = { ox: r.ox, oy: r.oy, scale: r.scale };
    document.body.classList.add('obs-open');
    this.root.hidden = false;
    this.showPanel(null);
    this._sync();

    if (this.lenis) this.lenis.resize();
    this.toTop();
  };

  /* Always open at the first stop.
   *
   * Chrome restores the scroll offset of a scrollable div across a reload,
   * and it does it AFTER this runs - so a single reset at boot is silently
   * undone and the shell opens halfway down the line, title clipped, camera
   * stranded between two stops. Reset now, again on the next frame, and once
   * more at window load, which is the last moment restoration can fire. */
  Shell.prototype.toTop = function () {
    var self = this;
    var until = Date.now() + 900;
    this._touched = false;

    function zero () {
      if (self._touched || !self.open) return;      // the moment they scroll, it is theirs
      if (self._scroll.scrollTop !== 0) {
        self._scroll.scrollTop = 0;
        if (self.lenis) self.lenis.scrollTo(0, { immediate: true });
        self.apply(0);
      }
      if (Date.now() < until) requestAnimationFrame(zero);
    }

    /* Hold it there for ~900ms rather than resetting once. Restoration does
       not happen at a single predictable moment: it can land after boot,
       after load, or after Lenis first measures, and readyState is often
       already "complete" by the time the shell exists, so a load listener
       never fires at all. Re-asserting until the reader actually touches the
       page is the only version of this that is reliable. */
    if (window.history && 'scrollRestoration' in window.history) {
      try { window.history.scrollRestoration = 'manual'; } catch (e) { /* not fatal */ }
    }
    self._scroll.scrollTop = 0;
    if (self.lenis) self.lenis.scrollTo(0, { immediate: true });
    self.apply(0);
    requestAnimationFrame(zero);
  };

  Shell.prototype.play = function () {
    var s = MM.state, r = MM.renderer;
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('obs-open');
    if (s) { s.speed = this._speed || 1; if (this._hour != null) s.tick = this._hour; }
    if (r && this._cam) { r.ox = this._cam.ox; r.oy = this._cam.oy; r.scale = this._cam.scale; }
    if (MM.audio) { MM.audio.play('ui'); if (MM.audio.ambient) MM.audio.ambient(true); }
  };

  Shell.prototype.pause = function () { this.show('pause'); };

  Shell.prototype.newCity = function () {
    if (this._confirmNew) { if (MM.clearSave) MM.clearSave(); location.reload(); return; }
    this._confirmNew = true;
    this._secondary.textContent = 'Erase this city?';
    this._secondary.classList.add('armed');
    var self = this;
    setTimeout(function () {
      self._confirmNew = false;
      if (self._secondary) { self._secondary.textContent = 'New city'; self._secondary.classList.remove('armed'); }
    }, 3200);
  };

  Shell.prototype._sync = function () {
    var s = MM.state;
    var started = !!(s && (s.day || 0) > 1);
    this._primary.textContent = this.mode === 'pause' ? 'Resume' : (started ? 'Continue' : 'Enter the city');
    this._secondary.hidden = !started;
    this._navEnter.textContent = this.mode === 'pause' ? 'Resume' : 'Enter';
    this._resumeNote.textContent = (s && started)
      ? 'Day ' + (s.day | 0) + '  ·  ' + (s.pop | 0).toLocaleString() + ' residents  ·  ' +
        Math.round(s.approval || 0) + '% approval'
      : '';
  };

  // ---- panels -------------------------------------------------------------

  var PANELS = {
    how: function (box) {
      el('h2', null, box, 'How to play');
      el('p', 'lede', box, 'The one rule that matters: nothing grows without a road. Zone next to roads, or you are paying upkeep on empty lots.');
      var g = el('div', 'obs-grid', box);
      [['Rent', 'The heart of the game. Let it run and approval bleeds and people leave.'],
        ['Unemployment', 'You zoned homes without jobs.'],
        ['Traffic', 'You built roads where you needed buses.'],
        ['Approval', 'Stay under water for too long and the recall comes for your name.']]
        .forEach(function (r) {
          var c = el('div', 'obs-card', g);
          el('h3', null, c, r[0]); el('p', null, c, r[1]);
        });
      el('h3', 'sub', box, 'Controls');
      var t = el('dl', 'obs-keys', box);
      [['1-9, s, t, 0', 'pick a build tool'], ['Left-drag', 'explore, or build with a tool selected'],
        ['Right-drag', 'pan the city - flick to throw it'], ['Wheel', 'zoom'],
        ['Space', 'pause / resume'], ['+ / -', 'game speed'], ['M', 'mute'], ['Esc', 'this menu']]
        .forEach(function (k) { el('dt', null, t, k[0]); el('dd', null, t, k[1]); });
    },

    chain: function (box) {
      el('h2', null, box, 'The chain');
      el('p', 'lede', box, 'Obsicity is a city you can underwrite. Nine districts each issue shares, and share value tracks the land value the simulation already computes every game-day.');
      var g = el('div', 'obs-grid', box);
      [['Every office is a name', 'mayor.cityhall.eth is held, not owned. It expires with the term and cannot be sold, because an office cannot be sold.'],
        ['No name, no write', 'The only way city data reaches the chain asks ENS a live question first. When the term ends, the city stops reporting on its own.'],
        ['Nine districts, nine vaults', 'Each district runs its own ENSv2 registry and a standard ERC-4626 vault on Sepolia.'],
        ['No wallet to start', 'Play the whole game without one. A wallet is only needed to take a position.']]
        .forEach(function (r) {
          var c = el('div', 'obs-card', g);
          el('h3', null, c, r[0]); el('p', null, c, r[1]);
        });
      el('p', 'fine', box, 'Sepolia testnet. The simulation never touches the network - pull the chain layer out and this is exactly the game it was before.');
    },

    settings: function (box) {
      el('h2', null, box, 'Settings');
      el('p', 'lede', box, 'Find the right balance for your device. Saved on this device.');

      el('h3', 'sub', box, 'Graphics');
      var modes = [['eco', 'Eco', 'Lower resolution, fewer moving details'],
        ['balanced', 'Balanced', 'Rich scenery, lighter on your browser'],
        ['high', 'High', 'Sharper on high-resolution displays']];
      var row = el('div', 'obs-choices', box);
      var btns = [];
      modes.forEach(function (m) {
        var b = on(el('button', 'obs-choice', row), function () {
          if (MM.visuals) MM.visuals.setQuality(m[0]);
          sync();
        });
        el('strong', null, b, m[1]); el('span', null, b, m[2]);
        btns.push({ b: b, mode: m[0] });
      });

      el('h3', 'sub', box, 'Motion');
      var mrow = el('div', 'obs-choices', box);
      var motion = on(el('button', 'obs-choice wide', mrow), function () {
        document.body.classList.toggle('obs-still');
        sync();
      });
      var motionLabel = el('strong', null, motion, '');
      el('span', null, motion, 'The carriage sway on the title screen. Off is also the default if your system asks for reduced motion.');

      el('h3', 'sub', box, 'Sound');
      var sound = el('div', 'obs-choices', box);
      var mute = on(el('button', 'obs-choice wide', sound), function () {
        if (MM.audio) { MM.audio.setMuted(!MM.audio.muted); if (MM.ui && MM.ui.setMuted) MM.ui.setMuted(MM.audio.muted); }
        sync();
      });
      var muteLabel = el('strong', null, mute, '');
      el('span', null, mute, 'Everything is synthesized - the game ships no audio files.');

      function sync () {
        for (var i = 0; i < btns.length; i++) {
          var active = MM.visuals ? MM.visuals.quality === btns[i].mode : btns[i].mode === 'balanced';
          btns[i].b.classList.toggle('on', active);
          btns[i].b.setAttribute('aria-pressed', String(active));
        }
        var still = document.body.classList.contains('obs-still');
        motionLabel.textContent = still ? 'Sway off' : 'Sway on';
        motion.classList.toggle('on', !still);
        var muted = MM.audio && MM.audio.muted;
        muteLabel.textContent = muted ? 'Sound off' : 'Sound on';
        mute.classList.toggle('on', !muted);
      }
      sync();
    },

    credits: function (box) {
      el('h2', null, box, 'Credits');
      el('p', 'lede', box, 'An isometric city-builder that runs in a browser, or in a window next to your IDE. Built to be played in the gaps.');
      var g = el('div', 'obs-grid', box);
      [['Rendering', 'Plain canvas 2D. No engine, no framework, no runtime dependencies. The view through the window on the title screen is the live renderer, not footage.'],
        ['Simulation', 'Deterministic: land value, growth, rent, traffic, budget and approval, recomputed every game-day.'],
        ['Audio', 'Synthesized at runtime. There are no sound files in this repository.'],
        ['Smooth scroll', 'Lenis, MIT licensed, vendored locally rather than loaded from a CDN.']]
        .forEach(function (r) {
          var c = el('div', 'obs-card', g);
          el('h3', null, c, r[0]); el('p', null, c, r[1]);
        });
      el('p', 'fine', box, 'Typeface: Instrument Serif, self-hosted. Built for ETHOnline 2026.');
    }
  };

  Shell.prototype.showPanel = function (name) {
    var host = this._panelHost;
    host.textContent = '';
    this._panel = name || null;
    if (this.lenis) { if (name) this.lenis.stop(); else this.lenis.start(); }
    if (!name || !PANELS[name]) { host.hidden = true; return; }

    host.hidden = false;
    var box = el('div', 'obs-panel', host);
    var self = this;
    on(el('button', 'obs-close', box, '×'), function () { self.showPanel(null); })
      .setAttribute('aria-label', 'Close');
    PANELS[name](box);
    host.scrollTop = 0;
  };

  // ---- boot ---------------------------------------------------------------

  var tries = 0;
  function boot () {
    if (MM.shell) return;
    if (!MM.state || !document.body) {
      /* Bounded, and the bound is load-bearing. An open-ended retry keeps a
         pending timer alive forever, and under Node that alone stops the
         process exiting - smoke.js evaluates this file without game.js, so
         MM.state never arrives and `npm run smoke` would hang, not fail. */
      if (++tries > 100) return;
      setTimeout(boot, 60);
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.body.classList.add('obs-still');
    }
    MM.shell = new Shell();
    MM.shell.show('title');
  }

  MM.Shell = Shell;
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window.MM);

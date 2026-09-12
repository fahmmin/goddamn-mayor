/* OBSICITY - the game shell: title screen, menu, panels, pause.
 *
 * The page used to boot straight into the city, which made a finished game
 * feel like a tech demo someone had left running. This is the front of the
 * product: a title, a way in, a way back out, and somewhere to put the
 * things a player needs before they need the HUD.
 *
 * The backdrop is deliberately NOT a video. It is the live renderer, already
 * drawing, with the simulation paused - so the first thing anyone sees is the
 * actual city rather than stock footage of one. Costs no assets, no network
 * and no CSP exemption, which the module contract would not have allowed
 * anyway.
 *
 * game.js is not edited and cannot be. The shell owns nothing but an overlay:
 * it pauses by setting state.speed = 0, hides the HUD with a class on the
 * root, and puts everything back on the way out.
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
      if (e.detail > 0 && node.blur) node.blur();   // same reason as ui.js: Space must not re-trigger
      fn(e);
    });
    return node;
  }

  /* Lumora's four-video switcher, ported to the only footage this project
   * has: the city itself. Each vantage moves the camera and sets the hour,
   * so the backdrop actually changes rather than crossfading a stock clip. */
  var VANTAGES = [
    { label: 'Golden Hour', hour: 17, x: 0.34, y: 0.44 },
    { label: 'First Light', hour: 6,  x: 0.62, y: 0.30 },
    { label: 'Midday',      hour: 12, x: 0.28, y: 0.62 },
    { label: 'After Dark',  hour: 22, x: 0.50, y: 0.50 }
  ];

  var STATS = [
    'Nine districts, live on Sepolia',
    'Every office an ENS name',
    'Deterministic simulation',
    'No wallet required to start'
  ];

  function Shell () {
    this.mode = 'title';          // 'title' | 'pause'
    this.open = false;
    this.vantage = 0;
    this._panel = null;
    this._build();
  }

  Shell.prototype._build = function () {
    var self = this;
    var root = el('div', 'obs-shell', document.body);
    this.root = root;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Obsicity main menu');

    el('div', 'obs-scrim', root);

    // ---- top bar ----
    var nav = el('header', 'obs-nav', root);
    var mark = el('div', 'obs-mark', nav);
    el('span', 'obs-mark-o', mark, 'OBSI');
    el('span', 'obs-mark-c', mark, 'CITY');

    var links = el('nav', 'obs-links', nav);
    [['How to play', 'how'], ['The chain', 'chain'], ['Settings', 'settings'], ['Credits', 'credits']]
      .forEach(function (l) {
        on(el('button', 'obs-link', links, l[0]), function () { self.showPanel(l[1]); });
      });

    // ---- hero ----
    var hero = el('main', 'obs-hero', root);
    el('div', 'obs-kicker', hero, 'AN ISOMETRIC CITY THAT ANSWERS TO ITS MARKET');
    var h1 = el('h1', 'obs-title', hero);
    el('span', null, h1, 'Obsi');
    el('em', null, h1, 'city');
    el('p', 'obs-tag', hero,
      'You are the Mayor. Four years, a treasury, and a city that will tell you loudly when you get it wrong.');

    var cta = el('div', 'obs-cta', hero);
    this._primary = on(el('button', 'obs-btn primary', cta, 'Enter the city'), function () { self.play(); });
    this._secondary = on(el('button', 'obs-btn', cta, 'New city'), function () { self.newCity(); });
    this._resumeNote = el('div', 'obs-note', hero, '');

    // ---- footer ----
    var foot = el('footer', 'obs-foot', root);
    var van = el('div', 'obs-vantage', foot);
    this._vanBtns = VANTAGES.map(function (v, i) {
      return on(el('button', 'obs-chip', van, v.label), function () { self.setVantage(i); });
    });
    var stats = el('div', 'obs-stats', foot);
    STATS.forEach(function (s) { el('span', 'obs-stat', stats, s); });

    // ---- panel host ----
    this._panelHost = el('div', 'obs-panel-host', root);
    this._panelHost.hidden = true;

    /* The game binds bare keys on window (Space pauses, digits pick tools).
     * While the shell is up those must not reach it, so swallow them in the
     * capture phase - except Escape, which is how you leave. */
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

    this.setVantage(0);
  };

  /* Never steal Escape from a modal the game is already showing. */
  Shell.prototype._gameBusy = function () {
    var s = MM.state;
    return !!(s && (s.pending || s.gameOver));
  };

  Shell.prototype.setVantage = function (i) {
    this.vantage = i;
    var v = VANTAGES[i];
    for (var k = 0; k < this._vanBtns.length; k++) {
      this._vanBtns[k].classList.toggle('on', k === i);
      this._vanBtns[k].setAttribute('aria-pressed', String(k === i));
    }
    var s = MM.state, r = MM.renderer;
    if (s) s.tick = v.hour;
    if (r && MM.GRID) { r.stopPan && r.stopPan(); r.centerOn(MM.GRID * v.x, MM.GRID * v.y); }
  };

  // ---- open / close -------------------------------------------------------

  Shell.prototype.show = function (mode) {
    var s = MM.state;
    this.mode = mode || 'title';
    this.open = true;
    if (s) { this._speed = s.speed || 1; s.speed = 0; }
    document.body.classList.add('obs-open');
    this.root.hidden = false;
    this.showPanel(null);
    this._sync();
  };

  Shell.prototype.play = function () {
    var s = MM.state;
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('obs-open');
    if (s) s.speed = this._speed || 1;
    if (MM.audio) { MM.audio.play('ui'); MM.audio.ambient && MM.audio.ambient(true); }
  };

  Shell.prototype.pause = function () { this.show('pause'); };

  Shell.prototype.newCity = function () {
    if (this._confirmNew) {
      MM.clearSave && MM.clearSave();
      location.reload();
      return;
    }
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
    if (s && started) {
      this._resumeNote.textContent = 'Day ' + (s.day | 0) + '  ·  ' +
        (s.pop | 0).toLocaleString() + ' residents  ·  ' + Math.round(s.approval || 0) + '% approval';
    } else {
      this._resumeNote.textContent = '';
    }
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

      el('h3', 'sub', box, 'Sound');
      var sound = el('div', 'obs-choices', box);
      var mute = on(el('button', 'obs-choice wide', sound), function () {
        if (MM.audio) { MM.audio.setMuted(!MM.audio.muted); MM.ui && MM.ui.setMuted && MM.ui.setMuted(MM.audio.muted); }
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
        var muted = MM.audio && MM.audio.muted;
        muteLabel.textContent = muted ? 'Sound off' : 'Sound on';
        mute.classList.toggle('on', !muted);
      }
      sync();
    },

    credits: function (box) {
      el('h2', null, box, 'Credits');
      el('p', 'lede', box, 'An isometric city-builder that runs in a window next to your IDE. Built to be played in the gaps - while a build runs, while a test suite churns.');
      var g = el('div', 'obs-grid', box);
      [['Rendering', 'Plain canvas 2D. No engine, no framework, no runtime dependencies. Surface textures and window light are baked once into a static cache.'],
        ['Simulation', 'Deterministic: land value, growth, rent, traffic, budget and approval, recomputed every game-day.'],
        ['Audio', 'Synthesized at runtime. There are no sound files in this repository.'],
        ['The chain layer', 'ENSv2, ERC-4626 and Privy on Sepolia, bundled separately so the game never gains a dependency.']]
        .forEach(function (r) {
          var c = el('div', 'obs-card', g);
          el('h3', null, c, r[0]); el('p', null, c, r[1]);
        });
      el('p', 'fine', box, 'Built for ETHOnline 2026.');
    }
  };

  Shell.prototype.showPanel = function (name) {
    var host = this._panelHost;
    host.textContent = '';
    this._panel = name || null;
    if (!name || !PANELS[name]) { host.hidden = true; this.root.classList.remove('paneled'); return; }

    host.hidden = false;
    this.root.classList.add('paneled');
    var box = el('div', 'obs-panel', host);
    var self = this;
    on(el('button', 'obs-close', box, '×'), function () { self.showPanel(null); })
      .setAttribute('aria-label', 'Close');
    PANELS[name](box);
    host.scrollTop = 0;
  };

  // ---- boot ---------------------------------------------------------------

  /* game.js creates MM.state during its own boot and this file loads after
   * it, but never assume: smoke.js evaluates modules without game.js at all,
   * and must not throw. */
  var tries = 0;
  function boot () {
    if (MM.shell) return;
    if (!MM.state || !document.body) {
      /* Bounded, and that bound is load-bearing. An open-ended retry keeps a
       * pending timer alive forever, and under Node that alone is enough to
       * stop the process exiting - smoke.js evaluates this file without
       * game.js, so MM.state never arrives and `npm run smoke` would simply
       * hang rather than fail. Roughly six seconds, then give up quietly:
       * no game means no shell, which is the correct outcome there. */
      if (++tries > 100) return;
      setTimeout(boot, 60);
      return;
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

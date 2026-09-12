/* MAYOR - the shell: a train window onto the city, then the menu.
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
  /* Each stop carries its own argument, not a feature. `lede` is the line that
     has to land; `body` is the two sentences that earn it. `name` is the short
     form the ledger in the bottom-right stands up - deliberately separate from
     `title`, because a heading and a list entry want different lengths. */
  var STOPS = [
    { key: 'city', name: '', title: "I'm the Goddamn Mayor",
      kicker: 'ONE TERM · YOUR NAME ON IT',
      body: 'You have watched a city get it wrong. The bus line went the wrong way. The money landed in the wrong district.',
      quote: 'He should have done this instead of that. Put the money here, not there.',
      punch: 'Had that moment? Good. Take the office.',
      tx: 24, ty: 24, z: 0.40, hour: 17, hero: true },

    { key: 'airfield', name: 'AIRFIELD', title: 'The airfield', kicker: 'AIRPORT LOW-RISE',
      lede: 'You do not get advice. You get consequences.',
      body: 'Nine blocks of runway on the northern edge. Everything you build has an address and a bill, and both arrive whether you were paying attention or not.',
      tx: 5.5, ty: 5.5, z: 0.95, hour: 6 },

    { key: 'downtown', name: 'DOWNTOWN', title: 'Downtown', kicker: 'THE TOWERS',
      lede: 'The height rules bend once, for you.',
      body: 'Land value is highest here, which is exactly why the wrong call costs the most here. One building in this city is allowed to break the rules. You pick it.',
      tx: 22.5, ty: 22.5, z: 1.45, hour: 12 },

    { key: 'marina', name: 'MARINA', title: 'The marina', kicker: 'RIVERSIDE TOWERS',
      lede: 'Somebody is going to get rich off this water.',
      body: 'The most expensive addresses in the city are looking at it. You set what they pay.',
      tx: 37.5, ty: 8, z: 1.25, hour: 9 },

    { key: 'shops', name: 'HIGH STREET', title: 'The high street', kicker: 'UPTOWN',
      lede: 'Approval is not a score. It is your term.',
      body: 'Groceries, clinics, childcare. Let them slip and your name expires early - onchain, publicly, with your address on it.',
      tx: 24, ty: 8.5, z: 1.55, hour: 15 },

    { key: 'stadium', name: 'STADIUM', title: 'The stadium', kicker: 'THE WEST SIDE',
      lede: 'Spend money on joy. Watch it come back.',
      body: 'Parks and spectacle cost you every single day and return it in land value. Nobody believes that until they run it.',
      tx: 3, ty: 28, z: 1.25, hour: 19 },

    { key: 'port', name: 'WATERFRONT', title: 'The waterfront', kicker: 'WORKS & WHARVES',
      lede: 'The towers do not pay for themselves.',
      body: 'The container port and the power station. Every skyline is subsidised by somewhere nobody photographs.',
      tx: 32, ty: 39, z: 1.15, hour: 21 },

    { key: 'people', name: 'THE BLOCKS', title: 'The blocks', kicker: 'RED HOOK',
      lede: 'Twenty-five thousand people. Each one a number you own.',
      body: 'This is where the residents live. The rent index you are judged on is made of them.',
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
    root.setAttribute('aria-label', "I'm the Goddamn Mayor");

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
    el('span', 'obs-mark-o', mark, 'GODDAMN ');
    el('em', 'obs-mark-c', mark, 'MAYOR');

    var links = el('nav', 'obs-links liquid-glass', nav);
    [['How to play', 'how'], ['Settings', 'settings'], ['Credits', 'credits']]
      .forEach(function (l) {
        on(el('button', 'obs-link', links, l[0]), function () { self.showPanel(l[1]); });
      });
    /* inside.html says what the chain panel used to say, with diagrams and
       real addresses instead of four paragraphs. A plain link, because it is
       a document and a new tab is what people expect of one. */
    var inside = el('a', 'obs-link', links, "What's inside");
    inside.href = 'inside.html';
    inside.target = '_blank';
    inside.rel = 'noopener';
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
        /* Three explicit lines rather than one wrapping string. At this size a
           wrap is a layout decision, not a typesetting accident, and letting
           the viewport pick where GODDAMN breaks would be the latter. */
        var h1 = el('h1', 'obs-title', box);
        el('span', 'l', h1, 'IM THE');
        el('span', 'l', h1, 'GODDAMN');
        el('em', 'l', h1, 'MAYOR');
      } else {
        el('h2', 'obs-stop', box, s.title);
      }
      if (s.lede) el('p', 'obs-lede', box, s.lede);
      el('p', 'obs-body', box, s.body);
      if (s.quote) el('blockquote', 'obs-quote', box, '“' + s.quote + '”');
      if (s.punch) el('p', 'obs-punch', box, s.punch);

      if (s.hero) {
        /* Two doors, always. One of them costs an email and gives you a city
           with your name on it; the other costs nothing and shows you the
           city running. Continue appears beside them only once there is
           something to continue. */
        var cta = el('div', 'obs-cta', box);
        self._primary = on(el('button', 'obs-btn primary', cta, 'Be the Mayor'), function () { self.beTheMayor(); });
        self._secondary = on(el('button', 'obs-btn', cta, 'Start demo'), function () { self.startDemo(); });
        self._resumeBtn = on(el('button', 'obs-btn ghost', cta, 'Continue'), function () { self.play(); });
        self._resumeNote = el('div', 'obs-note', box, '');
        el('div', 'obs-hint', box, 'scroll to ride the line');
      }
      if (s.last) {
        var cta2 = el('div', 'obs-cta', box);
        on(el('button', 'obs-btn primary', cta2, 'Take the office'), function () { self.beTheMayor(); });
      }
      return { sec: sec, stop: s, box: box };
    });

    /* ---- the district ledger, bottom-right ----
       Was a column of dots with hover-only labels, which meant the city's
       districts were invisible unless you already knew to look for them.
       Every name now stands up at once: the one you are looking at is lit,
       the ones behind you stay legible, the ones ahead sit back. By the last
       stop the whole list is lit, which is the point - each line is somewhere
       you can actually go and build. */
    var rail = el('div', 'obs-ledger', root);
    this._dots = STOPS.map(function (s, i) {
      var d = on(el('button', 'obs-led', rail), function () { self.scrollTo(i); });
      d.setAttribute('aria-label', s.name || s.title);
      /* Stop 0 is the title screen and names no district, so it keeps a slot
         in the rail for scrubbing but shows nothing. */
      if (!s.name) d.classList.add('blank');
      el('span', 'obs-led-rule', d);
      el('span', 'obs-led-name', d, s.name || '');
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
        /* Escape opens the menu during play - but not out from under a wallet
           dialog. The deposit and login modals are drawn by the chain layer
           while the shell is closed, and without this the menu would open
           behind one and leave it orphaned over a running game. */
        if (e.key === 'Escape' && !self._flying && !self._gameBusy() && !self._passThrough(e.target)) {
          self.pause(); e.preventDefault();
        }
        return;
      }
      /* A dialog drawn on top of the shell owns its own keys.
         This listener is on window in the CAPTURE phase, so it sees every key
         before the dialog does. Typing survives without this - stopPropagation
         does not cancel a default action, so characters still reach a focused
         input - but Escape does not: the branch below calls preventDefault and
         acts on it, which would close a shell panel or resume the game out
         from under an open login. We are only here to keep BARE keys away from
         the game; anything inside a dialog is that dialog's business. */
      if (self._passThrough(e.target)) return;

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

  /* Does this key belong to something drawn on top of the shell?
     Named, and on the prototype, so the regression is testable without a
     browser: what it guards is Escape closing the menu out from under a
     wallet dialog, which is a two-window-deep state no screenshot catches. */
  Shell.prototype._passThrough = function (target) {
    return !!(target && target.closest && target.closest('.w-modal, .obs-panel'));
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

  /* Ride to a normalised point on the line, 0..1.
     Sets the scroll position rather than calling apply() directly, and that is
     the whole point of it: apply() moves the camera and the ledger, but the
     copy column is real scrolled content, so driving apply() alone flies the
     camera to the marina while the words stay parked on scene one - fading to
     nothing, because apply() dims every scene by its distance from the
     current one. Move the scroll and apply() follows for free. */
  Shell.prototype.rideTo = function (p) {
    var max = this._scroll.scrollHeight - this._scroll.clientHeight;
    if (max <= 0) { this.apply(0); return; }
    this._touched = true;                  // this IS the reader scrolling
    var y = clamp(p, 0, 1) * max;
    if (this.lenis) this.lenis.scrollTo(y, { immediate: true });
    else this._scroll.scrollTop = y;
    this.apply(clamp(p, 0, 1));
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

    /* Three states, not two. "passed" is what makes the ledger accumulate as
       you ride instead of flicking a single highlight down a list. */
    var near = Math.round(seg);
    for (var k = 0; k < this._dots.length; k++) {
      var dot = this._dots[k];
      dot.classList.toggle('on', k === near);
      dot.classList.toggle('past', k < near);
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
    this._flying = false;               // cancels a flight still in the air
    this.root.classList.remove('leaving');
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

  // ---- the doors ----------------------------------------------------------

  Shell.prototype._hasSave = function () {
    var s = MM.state;
    return !!(s && (s.day || 0) > 1);
  };

  /* Door one: sign in, then choose a city.
     The primary button doubles as Resume when the shell was opened over a
     game in progress, so the mode check lives here rather than in a second
     click handler that would have to be swapped in and out. */
  Shell.prototype.beTheMayor = function () {
    if (this.mode === 'pause') { this.play(); return; }
    var self = this;
    this._withChain(function (chain) {
      /* No chain layer is a normal outcome, not an error: the game is
         playable without one and the fork is the same screen either way.
         A cancelled login lands here too. */
      if (!chain || !chain.login) { self.showPanel('fork'); return; }
      chain.login().then(function () { self.showPanel('fork'); },
        function () { self.showPanel('fork'); });
    });
  };

  /* web3/bundle.js is deferred and 660KB, so this button can be clicked
     before the chain layer exists at all. Wait a beat for it, say so on the
     button while waiting, and give up rather than hang - the same shape as
     the poll index.js already uses to find MM.state. */
  var CHAIN_WAIT_MS = 4000;

  Shell.prototype._withChain = function (cb) {
    var self = this, btn = this._primary, label = btn && btn.textContent;
    if (window.MM_CHAIN) { cb(window.MM_CHAIN); return; }

    var until = Date.now() + CHAIN_WAIT_MS;
    if (btn) { btn.disabled = true; btn.textContent = 'Waking the chain…'; }
    (function poll () {
      if (window.MM_CHAIN || Date.now() > until) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        cb(window.MM_CHAIN || null);
        return;
      }
      setTimeout(poll, 120);
    })();
  };

  /* Door two. No wallet, no email, no choice to make.
     The tour drives the ride itself from here, so this does NOT call play() -
     the 'enter' beat does, a minute and a half in, after the camera has been
     down the line. Without a tour module it degrades to what it was: the
     loaded city, entered. */
  Shell.prototype.startDemo = function () {
    if (MM.tour && MM.tour.start) { MM.tour.start(); return; }
    this.play();
  };

  /* Chosen from the fork. newGame mutates the live state in place, because
     game.js closes over it - see src/demo.js. */
  Shell.prototype._begin = function (kind) {
    if (MM.newGame) MM.newGame(kind);
    this.showPanel(null);
    this.play();
  };

  // ---- leaving: the flight ------------------------------------------------

  var FLY_MS = 950;

  /* The handoff, and the reason the landing page had to live in this document.
     The renderer has been drawing the city the whole time the shell was up, so
     "open the app" is not a navigation - it is the same camera continuing to
     move. Carriage and copy fade, the camera flies from wherever the ride
     ended to wherever play resumes, and the light travels with it so the hour
     does not cut. There is no page load and no cache rebuild to hide. */
  Shell.prototype.play = function () {
    var self = this, s = MM.state, r = MM.renderer;
    if (this._flying) return;

    /* Input goes back immediately: this is a camera move, not a modal, and
       nobody should have to wait out an animation to start playing. */
    this.open = false;
    if (this.lenis) this.lenis.stop();
    this.root.classList.add('leaving');
    if (MM.audio) { MM.audio.play('ui'); if (MM.audio.ambient) MM.audio.ambient(true); }

    var to = this._cam;
    if (!r || !to) { this._land(); return; }

    var from = { ox: r.ox, oy: r.oy, scale: r.scale };
    var hourFrom = s ? (s.tick | 0) : 0;
    var hourTo = this._hour == null ? hourFrom : this._hour;
    var t0 = performance.now();
    this._flying = true;

    function step (now) {
      if (!self._flying) return;                 // show() cancelled us
      var k = ease(clamp((now - t0) / FLY_MS, 0, 1));
      r.ox = lerp(from.ox, to.ox, k);
      r.oy = lerp(from.oy, to.oy, k);
      r.scale = lerp(from.scale, to.scale, k);
      if (r.clampCamera) r.clampCamera();
      if (s) s.tick = Math.round(lerp(hourFrom, hourTo, k)) % 24;
      if (k < 1) requestAnimationFrame(step);
      else { self._flying = false; self._land(); }
    }
    requestAnimationFrame(step);
  };

  /* Touch down. The HUD's fade is keyed to body.obs-open, so dropping the
     class here rather than at take-off is what makes it arrive as the camera
     settles instead of over the top of the flight. */
  Shell.prototype._land = function () {
    var s = MM.state, r = MM.renderer;
    this._flying = false;
    this.root.hidden = true;
    this.root.classList.remove('leaving');
    document.body.classList.remove('obs-open');
    if (s) { s.speed = this._speed || 1; if (this._hour != null) s.tick = this._hour; }
    if (r && this._cam) { r.ox = this._cam.ox; r.oy = this._cam.oy; r.scale = this._cam.scale; }
  };

  Shell.prototype.pause = function () { this.show('pause'); };

  Shell.prototype._sync = function () {
    var s = MM.state;
    var started = this._hasSave();
    var paused = this.mode === 'pause';
    this._primary.textContent = paused ? 'Resume' : 'Be the Mayor';
    this._secondary.hidden = paused;
    this._resumeBtn.hidden = paused || !started;
    this._navEnter.textContent = paused ? 'Resume' : 'Enter';
    this._resumeNote.textContent = (s && started && !paused)
      ? 'Day ' + (s.day | 0) + '  ·  ' + (s.pop | 0).toLocaleString() + ' residents  ·  ' +
        Math.round(s.approval || 0) + '% approval'
      : '';
  };

  // ---- panels -------------------------------------------------------------

  var PANELS = {
    /* The fork. Two ways to hold the office, and they are genuinely different
       games: one is an empty block, the other is a built-out city you did not
       build and now answer for. Both already existed as flags in demo.js -
       this is a surface over them, not new game logic. */
    fork: function (box) {
      var self = this;
      el('h2', null, box, 'Take the office');
      el('p', 'lede', box, 'Two ways in. Both of them end up with your name on the city.');

      var ch = el('div', 'obs-choices', box);

      var a = on(el('button', 'obs-choice wide', ch), function () { self._begin('fresh'); });
      el('strong', null, a, 'Break ground');
      el('span', null, a, 'One road, a few lots and sixty thousand dollars. Nothing here is anyone else’s fault.');

      var b = on(el('button', 'obs-choice wide', ch), function () { self._begin('showcase'); });
      el('strong', null, b, 'Take over City Hall');
      el('span', null, b, 'Inherit the built-out city mid-term - nine districts, an airport, a port, and every decision somebody else already made.');

      if (this._hasSave()) {
        var s = MM.state;
        el('p', 'fine', box, 'Either one replaces the city you have now - day ' + (s.day | 0) +
          ', ' + (s.pop | 0).toLocaleString() + ' residents.');
        var c = el('div', 'obs-choices', box);
        var k = on(el('button', 'obs-choice wide', c), function () { self.showPanel(null); self.play(); });
        el('strong', null, k, 'Keep playing the one I have');
        el('span', null, k, 'Back to the city already in progress.');
      }
    },

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
      el('p', 'lede', box, 'This is a city you can underwrite. Nine districts each issue shares, and share value tracks the land value the simulation already computes every game-day.');
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
    PANELS[name].call(this, box);
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

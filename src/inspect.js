/* OBSICITY - the inspector.
 *
 * Hover anything and it tells you its name. Click it and it opens its record.
 *
 * The point this makes is the one the whole chain layer exists to make: the
 * city is not a picture of a city, it is a registry with a picture on top.
 * Every walker on the street, every cab, every block has a name that resolves,
 * and the names nest the way the ownership does. You find that out by moving
 * the mouse, not by reading a writeup.
 *
 * Self-contained on purpose. It listens on the canvas, it draws into #hud, it
 * sets renderer.pick, and it touches nothing else - no edits to game.js, no
 * new coupling in ui.js. Delete the script tag and the game is the game.
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
  var NF = new Intl.NumberFormat('en-US');
  function n (v) { return NF.format(Math.round(v || 0)); }
  function shortAddr (a) {
    return a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  }
  function title (str) {
    return String(str || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  var LEVELS = ['vacant', 'built', 'established', 'dense', 'premier'];

  function Inspect (canvas, hud, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.sel = null;                 // the clicked entity, or null
    this._hoverKey = '';
    this._build(hud);
    this._bind();
  }

  Inspect.prototype._build = function (hud) {
    this.tip = el('div', 'ens-tip', hud);
    this.tipName = el('div', 'ens-tip-name', this.tip);
    this.tipSub = el('div', 'ens-tip-sub', this.tip);

    this.panel = el('aside', 'ens-panel', hud);
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Registry record');
    var self = this;
    var head = el('div', 'ens-head', this.panel);
    this.pKicker = el('div', 'ens-kicker', head);
    this.pTitle = el('h2', 'ens-title', head);
    this.pAddr = el('div', 'ens-addr', head);
    el('button', 'ens-close', head, '×').addEventListener('click', function () { self.close(); });
    this.pBody = el('div', 'ens-body', this.panel);
  };

  Inspect.prototype._bind = function () {
    var self = this, c = this.canvas;
    /* Where the press landed, so a click that ended a map drag does not also
       open a record.
       On WINDOW, in capture: the renderer owns left-drag in explore mode and
       takes mousedown at capture on the canvas with stopImmediatePropagation,
       which kills every later canvas listener - including one registered here
       in either phase. Capture descends window -> canvas, so this runs first
       and is the only placement that survives. The click event itself is a
       separate dispatch the renderer does not touch, and arrives normally. */
    var downX = 0, downY = 0;
    window.addEventListener('mousedown', function (e) {
      downX = e.clientX; downY = e.clientY;
    }, true);
    c.addEventListener('click', function (e) {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) return;
      if (self._busy()) return;
      self.open(e.clientX, e.clientY);
    });
    c.addEventListener('mousemove', function (e) {
      if (self._busy()) { self._hide(); return; }
      self._move(e.clientX, e.clientY);
    });
    c.addEventListener('mouseleave', function () { self._hide(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.sel) { e.stopPropagation(); self.close(); }
    }, true);
  };

  /* When the pointer is doing something else. With a build tool in hand a
     click spends money and must not also open a record; behind the title
     screen or a modal event the canvas is not what the player is looking at. */
  Inspect.prototype._busy = function () {
    if (this.renderer.buildMode) return true;
    if (MM.shell && MM.shell.open) return true;
    return !!(MM.state && (MM.state.pending || MM.state.gameOver));
  };

  /* ---------- resolving a pick into a named entity -------------------- */

  Inspect.prototype._resolve = function (px, py) {
    var s = MM.state, R = this.renderer;
    if (!s || !MM.ens || !R.pickAt) return null;
    var hit = R.pickAt(s, px, py);
    if (!hit) return null;
    if (hit.kind === 'agent') {
      var a = MM.ens.agent(s, hit.agent);
      if (a) { a.hit = hit; return a; }
      return null;
    }
    if (hit.kind === 'parcel') {
      var p = MM.ens.parcel(s, hit.x, hit.y);
      if (p) { p.hit = hit; return p; }
    }
    return null;
  };

  /* ---------- hover --------------------------------------------------- */

  Inspect.prototype._move = function (px, py) {
    var e = this._resolve(px, py);
    if (!e) { this._hide(); return; }

    // Diff on the name, not on the object: _resolve builds a fresh record
    // every mousemove and rewriting the DOM at pointer rate for a tooltip
    // that has not changed is the one thing this must not do.
    if (e.name !== this._hoverKey) {
      this._hoverKey = e.name;
      this.tipName.textContent = e.name;
      this.tipSub.textContent = e.type === 'parcel'
        ? e.use + ' · ' + e.address
        : (e.headline || '') + (e.trade ? ' · ' + e.trade : '');
      this.tip.setAttribute('data-kind', e.type);
    }
    this.tip.classList.add('on');

    /* Clamp inside the viewport so a name at the right-hand edge does not
       hang off it. Measured after the text is set, or the first frame of a
       long name is placed on the previous name's width. */
    var w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    var x = Math.min(px + 16, window.innerWidth - w - 10);
    var y = py - h - 14;
    if (y < 8) y = py + 22;
    this.tip.style.transform = 'translate(' + Math.max(8, x) + 'px,' + y + 'px)';

    // Highlight only what is NOT already pinned open, so the selection ring
    // stays put while you look around.
    if (!this.sel) this.renderer.pick = e.hit;
  };

  Inspect.prototype._hide = function () {
    this.tip.classList.remove('on');
    this._hoverKey = '';
    if (!this.sel) this.renderer.pick = null;
  };

  /* ---------- the record ---------------------------------------------- */

  Inspect.prototype.open = function (px, py) {
    var e = this._resolve(px, py);
    if (!e) { this.close(); return; }
    this.sel = e;
    this.renderer.pick = e.hit;
    this.panel.classList.add('on');
    this._render(e);
  };

  Inspect.prototype.close = function () {
    this.sel = null;
    this.renderer.pick = null;
    this.panel.classList.remove('on');
  };

  /* Rebuilt wholesale on open. This is the one place in the HUD where that is
     right: it is not on the frame path, it runs once per click, and the shape
     of the record genuinely differs between a tower and a taxi. */
  Inspect.prototype._render = function (e) {
    var body = this.pBody;
    body.textContent = '';
    this.pKicker.textContent = e.type === 'parcel' ? 'PARCEL' :
      (e.type === 'cab' ? 'LICENCE' : (e.type === 'bus' ? 'ROUTE' : 'CITIZEN'));
    this.pTitle.textContent = e.type === 'parcel' ? e.address : (e.headline || title(e.first));
    this.pAddr.textContent = e.name;

    this._lineage(body, e);
    if (e.type === 'parcel') this._parcel(body, e);
    else this._agent(body, e);
  };

  /* The breadcrumb IS the argument. Four rows, each one a real label owned by
     the row above it, is a clearer statement of the scheme than any paragraph
     about it - and it is the same tree the district registries already
     enforce onchain two levels up. */
  Inspect.prototype._lineage = function (body, e) {
    var sec = el('section', 'ens-sec', body);
    el('h3', null, sec, 'Namespace');
    var tree = el('ol', 'ens-tree', sec);
    var chain = MM.ens.lineage(e.name);
    for (var i = 0; i < chain.length; i++) {
      var row = el('li', null, tree);
      el('span', 'ens-depth', row, i === chain.length - 1 ? '●' : '└');
      el('span', 'ens-label', row, chain[i]);
      // Only the top two levels are minted today; the rest are derived and
      // mintable. Saying which is which is the difference between a demo and
      // a claim.
      el('span', 'ens-badge' + (i < 2 ? ' live' : ''), row, i < 2 ? 'onchain' : 'derived');
    }
    if (chain.length) tree.lastChild.classList.add('self');
  };

  Inspect.prototype._parcel = function (body, p) {
    var sec = el('section', 'ens-sec', body);
    el('h3', null, sec, 'Record');
    var dl = el('dl', 'ens-facts', sec);
    function fact (k, v) { el('dt', null, dl, k); el('dd', null, dl, v); }
    fact('Use', p.use);
    // A landmark stands on land zoned for something else, and saying both is
    // the difference between a record and a label.
    if (p.landmark) fact('Zoned', p.zoning);
    fact('District', p.district ? p.district.name : '—');
    fact('Footprint', p.w + '×' + p.h + ' tiles');
    fact('Development', LEVELS[Math.min(4, p.level)] + ' (L' + p.level + ')');
    // The sim floors land value at K.BASE on every tile, so a flat zero means
    // it has not run yet (the frozen diorama) rather than worthless land.
    // Printing "0 / 255" there reads as a bug in the panel, so say nothing.
    if (p.land > 0) fact('Land value', n(p.land) + ' / 255');
    if (p.homes) fact('Homes', n(p.homes));
    if (p.jobs) fact('Jobs', n(p.jobs));

    var oc = MM.ens.onchain(p);
    var csec = el('section', 'ens-sec', body);
    el('h3', null, csec, 'Issuance');
    var cdl = el('dl', 'ens-facts', csec);
    function cf (k, v, cls) { el('dt', null, cdl, k); el('dd', cls || null, cdl, v); }
    if (oc.registry) {
      cf('Parent registry', shortAddr(oc.registry), 'mono');
      cf('Issues under', oc.parent, 'mono');
      cf('Chain', oc.chainId === 11155111 ? 'Sepolia' : ('chain ' + oc.chainId));
    } else {
      cf('Parent registry', 'chain layer not loaded');
      cf('Issues under', oc.parent, 'mono');
    }
    cf('Status', 'derived — mintable under the district registry');

    var roll = MM.ens.residents(MM.state, p);
    if (roll.list && roll.list.length) {
      var rsec = el('section', 'ens-sec', body);
      el('h3', null, rsec,
        (p.homes ? 'Residents' : 'Workers') + ' · ' + n(roll.total));
      var ul = el('ul', 'ens-roll', rsec);
      for (var i = 0; i < roll.list.length; i++) {
        var r = roll.list[i], li = el('li', null, ul);
        el('span', 'ens-who', li, title(r.first));
        el('span', 'ens-trade', li, r.trade);
        // The full name, not a relative one: that this resolves all the way
        // up to the city root is the entire claim being made here.
        el('span', 'ens-sub', li, r.name);
      }
      if (roll.total > roll.shown) {
        el('p', 'ens-more', rsec,
          '+' + n(roll.total - roll.shown) + ' more, each with a name under this parcel.');
      }
    }
  };

  Inspect.prototype._agent = function (body, a) {
    var sec = el('section', 'ens-sec', body);
    el('h3', null, sec, 'Record');
    var dl = el('dl', 'ens-facts', sec);
    function fact (k, v, cls) { el('dt', null, dl, k); el('dd', cls || null, dl, v); }
    if (a.type === 'person') {
      fact('Trade', a.trade);
      fact('Standing', a.tenure);
      if (a.parcel) {
        fact('Lives at', a.parcel.address);
        fact('Issued by', a.parcel.name, 'mono');
      } else {
        fact('Registered to', a.district ? a.district.name : 'the city');
      }
    } else {
      fact('Class', a.type === 'cab' ? 'Licensed taxi' : 'Bus');
      fact('Licence', a.licence);
      fact('Issued by', a.type === 'cab' ? MM.ens.fleetRoot() : MM.ens.transitRoot(), 'mono');
    }
    var t = a.agent;
    if (t) fact('Position', 'tile ' + (t.x | 0) + ', ' + (t.y | 0));

    /* A street agent is alive for as long as it is on screen and then it is
       gone. Saying so is more honest than implying every walker is a durable
       onchain identity - the NAME is durable, the walk is not. */
    el('p', 'ens-note', body,
      'Derived from this entity’s id, so the name is stable for as long as ' +
      'it is in the city. Names are minted on demand, not ahead of time.');
  };

  /* ---------- boot ----------------------------------------------------- */

  /* This file is loaded AFTER game.js, so MM.renderer already exists by the
     time boot runs - the same arrangement shell.js uses, and the reason there
     is no polling here. Headless (smoke.js) there is no renderer and boot is
     a no-op, which is what keeps the harness able to eval this file. */
  function boot () {
    var canvas = document.getElementById('city');
    var hud = document.getElementById('hud');
    if (!canvas || !hud || !MM.renderer) return;
    MM.inspect = new Inspect(canvas, hud, MM.renderer);
  }

  MM.Inspect = Inspect;
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window.MM);

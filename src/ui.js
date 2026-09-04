/* MAYOR MAMDANI - HUD. Owned by the ui agent. Pairs with src/style.css. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const NF = new Intl.NumberFormat('en-US');
  const HIST = 7;                     // sparkline window, in game days
  const TUT_KEY = 'mamdani.tut.v1';
  const OVERLAYS = ['none', 'value', 'traffic', 'pollution'];
  const SPEEDS = [
    { n: 0, label: '❚❚', tip: 'Pause  [Space]' },
    { n: 1, label: '1x', tip: 'Normal  [-/+]' },
    { n: 2, label: '3x', tip: 'Fast  [-/+]' },
    { n: 3, label: '8x', tip: 'Turbo  [-/+]' }
  ];
  const FACES = [[70, '😄'], [55, '🙂'], [40, '😐'], [25, '😟'], [-1, '😡']];

  // ---- dom helpers ------------------------------------------------------
  function el (tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgEl (tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  // Every write below is diffed against the last written value: update() runs
  // at 60fps and must not touch the DOM unless something actually moved.
  function setText (n, v) { if (n.__t !== v) { n.__t = v; n.textContent = v; } }
  function setCls (n, c, on) { const k = '__c' + c; on = !!on; if (n[k] !== on) { n[k] = on; n.classList.toggle(c, on); } }
  function setAttr (n, a, v) { const k = '__a' + a; if (n[k] !== v) { n[k] = v; n.setAttribute(a, v); } }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num (v, f) { return (typeof v === 'number' && isFinite(v)) ? v : f; }

  function money (n) {
    const v = Math.round(n || 0);
    const s = v < 0 ? '-$' : '$';
    const a = Math.abs(v);
    return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : s + NF.format(a);
  }
  function signed (n) {
    const v = Math.round(n || 0);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + NF.format(Math.abs(v));
  }
  function face (v) { for (let i = 0; i < FACES.length; i++) if (v >= FACES[i][0]) return i; return FACES.length - 1; }

  // sim.js is another engineer's file and may be missing or load late.
  function derived (s) {
    let d = {};
    try { if (MM.sim && typeof MM.sim.derive === 'function') d = MM.sim.derive(s) || {}; } catch (e) { d = {}; }
    const net = num(d.net, num(d.netDaily, (s.dailyIncome || 0) - (s.dailyCost || 0)));
    // ponytail: workforce fallback is a flat 55% of pop; sim.derive wins whenever it reports one.
    const wf = Math.max(1, (s.pop || 0) * 0.55);
    let unemp = num(d.unemployment, num(d.unemp, clamp((wf - (s.employed || 0)) / wf, 0, 1) * 100));
    if (unemp > 0 && unemp <= 1) unemp *= 100;   // derive may report a 0..1 fraction
    return { net: net, unemp: unemp };
  }

  function policyCost (s) {
    try { if (typeof MM.policyDailyCost === 'function') return MM.policyDailyCost(s) || 0; } catch (e) { /* fall through */ }
    let c = 0;
    const list = MM.POLICIES || [];
    for (let i = 0; i < list.length; i++) if (s.policies && s.policies[list[i].id]) c += list[i].dailyCost || 0;
    return c;
  }

  const STATS = [
    { key: 'cash', label: 'TREASURY', c: 'amber', wide: true, get: function (s) { return s.treasury || 0; }, fmt: money },
    { key: 'pop', label: 'POPULATION', c: 'cyan', get: function (s) { return s.pop || 0; }, fmt: function (v) { return NF.format(Math.round(v)); } },
    { key: 'app', label: 'APPROVAL', c: 'green', get: function (s) { return s.approval || 0; }, fmt: function (v) { return Math.round(v) + '%'; } },
    { key: 'rent', label: 'RENT INDEX', c: 'rose', get: function (s) { return s.rent || 0; }, fmt: function (v) { return String(Math.round(v)); } },
    { key: 'traf', label: 'TRAFFIC', c: 'violet', get: function (s) { return s.traffic || 0; }, fmt: function (v) { return Math.round(v) + '%'; } },
    { key: 'unemp', label: 'UNEMPLOYED', c: 'rose', get: function (s, d) { return d.unemp; }, fmt: function (v) { return (Math.round(v * 10) / 10) + '%'; } }
  ];

  function sparkPoints (arr) {
    const n = arr.length;
    if (n < 2) return '';
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { if (arr[i] < min) min = arr[i]; if (arr[i] > max) max = arr[i]; }
    const span = max - min;
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = i * (60 / (n - 1));
      const y = span === 0 ? 9 : 16 - ((arr[i] - min) / span) * 14;
      out += (i ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return out;
  }

  // ---- UI ---------------------------------------------------------------
  function UI (root, state, handlers) {
    this.h = handlers || {};
    this.eventOpen = false;
    this.root = root;

    this._day = -1;
    this._logTop = undefined;
    this._appBucket = -1;
    this._overShown = false;
    this._deriveAt = -1e9;
    this._d = { net: 0, unemp: 0 };
    this._hist = {};
    this._tiles = {};
    this._tools = [];
    this._speeds = [];
    this._overlays = [];
    this._cards = [];
    this._polBuilt = false;
    this._overlay = 'none';
    this._resetArmed = 0;
    this._evtCb = null;

    root.textContent = '';
    root.classList.add('mm-root');

    this._buildTop(root);
    this._buildTools(root);
    this._buildRail(root, state);
    this._buildDock(root);
    this._buildToasts(root);
    this._buildModal(root);
    this._buildOver(root);
    this._buildTutorial(root);

    this.update(state);
  }

  UI.prototype._call = function (name, a, b) {
    const f = this.h[name];
    if (typeof f === 'function') f(a, b);
  };

  // clicking a HUD button must not leave it focused, or the global Space /
  // hotkey handler in game.js would re-trigger it. Keyboard focus is kept.
  function unfocus (e) { if (e.detail > 0 && e.currentTarget.blur) e.currentTarget.blur(); }
  function on (node, fn) {
    node.addEventListener('click', function (e) { unfocus(e); fn(e); });
    return node;
  }

  // ---- top bar ----------------------------------------------------------
  UI.prototype._buildTop = function (root) {
    const bar = el('div', 'mm-bar', root);

    const brand = el('div', 'brand', bar);
    const mark = el('div', 'mark', brand);
    el('span', 'm1', mark, 'MAYOR');
    el('span', 'm2', mark, 'MAMDANI');
    const clock = el('div', 'clock', brand);
    this._dayEl = el('div', 'day', clock, 'Day 1');
    this._yearEl = el('div', 'year', clock, 'Year 1 of 4');

    const stats = el('div', 'stats', bar);
    for (let i = 0; i < STATS.length; i++) {
      const st = STATS[i];
      const t = el('div', 'tile k-' + st.key + ' c-' + st.c + (st.wide ? ' wide' : ''), stats);
      el('div', 'tl', t, st.label);
      const row = el('div', 'tv', t);
      const rec = { root: t, val: el('span', 'num', row), sub: el('span', 'sub', row) };
      const sv = svgEl('svg', { class: 'spark', viewBox: '0 0 60 18', preserveAspectRatio: 'none' }, t);
      rec.line = svgEl('polyline', { fill: 'none', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', points: '' }, sv);
      rec.dot = svgEl('circle', { r: '1.8', cx: '-9', cy: '-9' }, sv);
      this._tiles[st.key] = rec;
      this._hist[st.key] = [];
    }

    const sp = el('div', 'speed', bar);
    el('div', 'sl', sp, 'SPEED');
    const seg = el('div', 'seg', sp);
    for (let i = 0; i < SPEEDS.length; i++) {
      const s = SPEEDS[i];
      const b = el('button', 'sb', seg, s.label);
      b.title = s.tip;
      const n = s.n;
      const self = this;
      on(b, function () { self._call('onSpeed', n); });
      this._speeds.push(b);
    }
  };

  // ---- left toolbar -----------------------------------------------------
  UI.prototype._buildTools = function (root) {
    const box = el('div', 'mm-tools', root);
    el('div', 'head', box, 'BUILD');
    const list = MM.BUILDABLE || [];
    const info = MM.TILE_INFO || {};
    const doze = MM.TILE ? MM.TILE.BULLDOZE : 99;
    const self = this;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const inf = info[t] || { name: 'Tile ' + t, cost: 0, key: '' };
      if (t === doze) el('div', 'sep', box);
      const b = el('button', 'tool' + (t === doze ? ' doze' : ''), box);
      el('span', 'k', b, String(inf.key || '').toUpperCase());
      el('span', 'tn', b, inf.name);
      el('span', 'tc', b, '$' + NF.format(inf.cost || 0));
      b.title = inf.name + ' - $' + (inf.cost || 0) + (inf.upkeep ? ', $' + inf.upkeep + '/day upkeep' : '') + '  [' + inf.key + ']';
      on(b, function () { self._call('onSelect', t); });
      this._tools.push({ b: b, tile: t, cost: inf.cost || 0 });
    }
  };

  // ---- right rail -------------------------------------------------------
  UI.prototype._buildRail = function (root, state) {
    const self = this;
    const rail = el('div', 'mm-rail', root);
    this._rail = rail;

    const tabs = el('div', 'tabs', rail);
    const collapse = this._collapseBtn = el('button', 'collapse', tabs, '›');
    collapse.title = 'Collapse panel';
    on(collapse, function () {
      const c = !rail.classList.contains('collapsed');
      rail.classList.toggle('collapsed', c);
      collapse.textContent = c ? '‹' : '›';
    });
    const names = ['Policies', 'Feed', 'Budget'];
    this._tabs = [];
    this._panes = [];
    for (let i = 0; i < names.length; i++) {
      const b = el('button', 'tab', tabs, names[i]);
      const n = i;
      on(b, function () { self._tab(n); });
      this._tabs.push(b);
    }

    const body = el('div', 'panes', rail);
    for (let i = 0; i < 3; i++) this._panes.push(el('div', 'pane', body));

    // Policies
    const p0 = this._panes[0];
    const head = el('div', 'polhead', p0);
    el('span', 'lbl', head, 'POLICY SPEND');
    this._polCost = el('span', 'v', head, '$0/day');
    this._cardBox = el('div', 'cards', p0);
    this._buildPolicies();

    // Feed
    this._logBox = el('div', 'loglist', this._panes[1]);

    // Budget
    const p2 = this._panes[2];
    el('div', 'sub', p2, 'DAILY LEDGER');
    const led = el('div', 'ledger', p2);
    this._bud = {
      income: this._budRow(led, 'Taxes collected', 'good'),
      upkeep: this._budRow(led, 'Services & upkeep', 'bad'),
      policy: this._budRow(led, 'Policy programs', 'pol'),
      net: this._budRow(led, 'Net per day', 'net')
    };
    this._bud.net.row.classList.add('total');
    el('div', 'sub', p2, 'TAX RATES');
    const kinds = [['res', 'Residential'], ['com', 'Commercial'], ['ind', 'Industrial']];
    this._tax = {};
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i][0];
      const row = el('div', 'srow', p2);
      const lab = el('label', 'sl', row);
      el('span', null, lab, kinds[i][1]);
      const v = el('b', 'sv', lab, '0%');
      const inp = el('input', 'slider', row);
      inp.type = 'range'; inp.min = '0'; inp.max = '25'; inp.step = '1';
      inp.value = String((state.taxRate && state.taxRate[kind]) || 0);
      lab.setAttribute('for', (inp.id = 'tax-' + kind));
      const warn = el('div', 'warn', row, 'Above 14% they start packing up.');
      inp.addEventListener('input', function () {
        const val = +inp.value;
        setText(v, val + '%');
        setCls(warn, 'show', val > 14);
        setCls(inp, 'hot', val > 14);
        self._call('onTax', kind, val);
      });
      this._tax[kind] = { inp: inp, v: v, warn: warn };
      setText(v, inp.value + '%');
      setCls(warn, 'show', +inp.value > 14);
      setCls(inp, 'hot', +inp.value > 14);
    }
    this._tab(0);
  };

  UI.prototype._budRow = function (parent, label, kind) {
    const row = el('div', 'brow ' + kind, parent);
    el('span', 'bl', row, label);
    return { row: row, v: el('span', 'bv', row, '$0') };
  };

  UI.prototype._tab = function (n) {
    for (let i = 0; i < this._tabs.length; i++) {
      setCls(this._tabs[i], 'on', i === n);
      setCls(this._panes[i], 'on', i === n);
    }
    this._rail.classList.remove('collapsed');
    this._collapseBtn.textContent = '›';
  };

  UI.prototype._buildPolicies = function () {
    const list = MM.POLICIES;
    if (!list || !list.length) {
      if (!this._polNote) this._polNote = el('div', 'empty', this._cardBox, 'No policy platform loaded yet.');
      return;
    }
    if (this._polNote) { this._cardBox.removeChild(this._polNote); this._polNote = null; }
    const self = this;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const card = el('button', 'pcard', this._cardBox);
      el('span', 'picon', card, p.icon || '⚖️');
      const body = el('span', 'pbody', card);
      const top = el('span', 'pname', body);
      el('span', 'n', top, p.name || p.id);
      el('span', 'pcost', top, '$' + NF.format(p.dailyCost || 0) + '/d');
      el('span', 'pblurb', body, p.blurb || '');
      const lock = el('span', 'plock', body, 'Unlocks at ' + NF.format(p.unlockPop || 0) + ' residents');
      const sw = el('span', 'psw', card);
      el('span', 'knob', sw);
      const id = p.id;
      on(card, function () {
        if (card.classList.contains('locked')) { self.toast('Locked until ' + NF.format(p.unlockPop || 0) + ' residents.', 'bad'); return; }
        self._call('onPolicy', id);
      });
      this._cards.push({ card: card, lock: lock, id: id, unlock: p.unlockPop || 0 });
    }
    this._polBuilt = true;
  };

  // ---- bottom-left dock -------------------------------------------------
  UI.prototype._buildDock = function (root) {
    const self = this;
    const dock = el('div', 'mm-dock', root);

    const ov = el('div', 'seg ov', dock);
    el('span', 'cap', ov, 'MAP');
    for (let i = 0; i < OVERLAYS.length; i++) {
      const name = OVERLAYS[i];
      const b = el('button', 'ob', ov, name);
      on(b, function () { self._overlay = name; self._syncOverlay(); self._call('onOverlay', name); });
      this._overlays.push({ b: b, name: name });
    }
    this._syncOverlay();

    const sys = el('div', 'seg sys', dock);
    this._muteBtn = on(el('button', 'ob', sys, '🔊 Sound'), function () { self._call('onMute'); });
    this._muteBtn.title = 'Mute / unmute  [M]';
    on(el('button', 'ob', sys, 'Save'), function () { self._call('onSave'); });
    this._resetBtn = on(el('button', 'ob danger', sys, 'Reset'), function () {
      if (Date.now() < self._resetArmed) { self._resetArmed = 0; self._call('onReset'); return; }
      self._resetArmed = Date.now() + 4000;
      setText(self._resetBtn, 'Erase save?');
      setCls(self._resetBtn, 'armed', true);
      setTimeout(function () {
        if (Date.now() >= self._resetArmed) { setText(self._resetBtn, 'Reset'); setCls(self._resetBtn, 'armed', false); }
      }, 4100);
    });
  };

  UI.prototype._syncOverlay = function () {
    for (let i = 0; i < this._overlays.length; i++) setCls(this._overlays[i].b, 'on', this._overlays[i].name === this._overlay);
  };

  // ---- toasts -----------------------------------------------------------
  UI.prototype._buildToasts = function (root) { this._toastBox = el('div', 'mm-toasts', root); };

  UI.prototype.toast = function (text, kind) {
    const box = this._toastBox;
    while (box.childNodes.length > 3) box.removeChild(box.firstChild);
    const n = el('div', 'toast k-' + (kind || 'info'), box, String(text));
    requestAnimationFrame(function () { n.classList.add('in'); });
    setTimeout(function () {
      n.classList.remove('in');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 280);
    }, 3500);
  };

  // ---- event modal ------------------------------------------------------
  UI.prototype._buildModal = function (root) {
    const self = this;
    const scrim = el('div', 'mm-scrim', root);
    const card = el('div', 'mm-modal', scrim);
    this._m = {
      scrim: scrim,
      icon: el('div', 'micon', card),
      title: el('div', 'mtitle', card),
      text: el('div', 'mtext', card),
      choices: el('div', 'mchoices', card),
      btns: []
    };
    el('div', 'mhint', card, 'Press 1 / 2 / 3 to decide - Enter takes the highlighted one');

    // capture phase so this always beats the global hotkeys in game.js
    window.addEventListener('keydown', function (e) {
      if (!self.eventOpen) return;
      if (e.key === 'Tab') return;
      const btns = self._m.btns;
      const k = e.key;
      if (k >= '1' && k <= '9' && btns[+k - 1]) { btns[+k - 1].click(); }
      else if (k === 'Enter' || k === ' ') {
        const a = document.activeElement;
        const b = (a && a.classList && a.classList.contains('choice')) ? a : btns[0];
        if (b) b.click();
      } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        let i = btns.indexOf(document.activeElement);
        i = (i < 0 ? 0 : i + (k === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length;
        if (btns[i]) btns[i].focus();
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  };

  UI.prototype.showEvent = function (evt, cb) {
    const self = this;
    evt = evt || {};
    this.eventOpen = true;
    this._evtCb = cb;
    const m = this._m;
    setText(m.icon, evt.icon || '📰');
    setText(m.title, evt.title || 'City Hall');
    setText(m.text, evt.text || '');
    m.choices.textContent = '';
    m.btns = [];
    const list = (evt.choices && evt.choices.length) ? evt.choices : [{ label: 'Continue' }];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const b = el('button', 'choice', m.choices);
      el('span', 'ck', b, String(i + 1));
      const t = el('span', 'ct', b);
      el('span', 'cl', t, c.label || 'OK');
      if (c.hint) el('span', 'ch', t, c.hint);
      b.addEventListener('click', function () { self._pick(c); });
      m.btns.push(b);
    }
    m.scrim.classList.add('show');
    if (m.btns[0]) m.btns[0].focus();
  };

  UI.prototype._pick = function (choice) {
    if (!this.eventOpen) return;
    this.eventOpen = false;
    this._m.scrim.classList.remove('show');
    const cb = this._evtCb;
    this._evtCb = null;
    if (cb) cb(choice || null);
  };

  // ---- game over --------------------------------------------------------
  UI.prototype._buildOver = function (root) {
    const self = this;
    const scrim = el('div', 'mm-scrim over', root);
    const card = el('div', 'mm-modal', scrim);
    el('div', 'micon', card, '🏛️');
    this._over = {
      scrim: scrim,
      title: el('div', 'mtitle', card, 'Term over'),
      text: el('div', 'mtext', card),
      stats: el('div', 'ostats', card)
    };
    on(el('button', 'choice big', card), function () { self._call('onReset'); }).appendChild(
      el('span', 'ct', null, 'Run again'));
  };

  UI.prototype._showOver = function (s) {
    const g = s.gameOver;
    const reason = typeof g === 'string' ? g : (g.reason || g.text || g.title || 'Your term has ended.');
    setText(this._over.text, reason);
    const box = this._over.stats;
    box.textContent = '';
    const rows = [
      ['Days served', NF.format(s.day || 0)],
      ['Population', NF.format(Math.round(s.pop || 0))],
      ['Approval', Math.round(s.approval || 0) + '%'],
      ['Treasury', money(s.treasury)],
      ['Rent index', String(Math.round(s.rent || 0))]
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = el('div', 'orow', box);
      el('span', null, r, rows[i][0]);
      el('b', null, r, rows[i][1]);
    }
    this._over.scrim.classList.add('show');
  };

  // ---- tutorial ---------------------------------------------------------
  UI.prototype._buildTutorial = function (root) {
    let seen = false;
    try { seen = localStorage.getItem(TUT_KEY) === '1'; } catch (e) { /* private mode */ }
    if (seen) return;
    const card = el('div', 'mm-tut', root);
    el('div', 'th', card, 'FOUR THINGS, MR. MAYOR');
    const ol = el('ol', null, card);
    const lines = [
      'Lay roads first - nothing grows off the grid.',
      'Zone residential and commercial right next to a road.',
      'Approval is your job. Parks, clinics and buses buy it.',
      'Watch the rent index. High rent empties the city.'
    ];
    for (let i = 0; i < lines.length; i++) el('li', null, ol, lines[i]);
    on(el('button', 'ok', card, 'Got it'), function () {
      card.parentNode.removeChild(card);
      try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { /* ignore */ }
    });
  };

  // ---- muting -----------------------------------------------------------
  UI.prototype.setMuted = function (muted) {
    setText(this._muteBtn, muted ? '🔇 Muted' : '🔊 Sound');
    setCls(this._muteBtn, 'off', !!muted);
  };

  // ---- per-day sampling -------------------------------------------------
  UI.prototype._sample = function (s, d, seed) {
    for (let i = 0; i < STATS.length; i++) {
      const st = STATS[i];
      const h = this._hist[st.key];
      const v = st.get(s, d) || 0;
      h.push(v);
      if (seed) h.push(v);            // two points so day 1 already draws a line
      while (h.length > HIST) h.shift();
      const rec = this._tiles[st.key];
      const pts = sparkPoints(h);
      setAttr(rec.line, 'points', pts);
      if (pts) {
        const last = pts.slice(pts.lastIndexOf(' ') + 1).split(',');
        setAttr(rec.dot, 'cx', last[0]);
        setAttr(rec.dot, 'cy', last[1]);
      }
    }
  };

  // ---- feed -------------------------------------------------------------
  UI.prototype._syncLog = function (s) {
    const log = s.log || [];
    if (log[0] === this._logTop) return;
    let n = this._logTop ? log.indexOf(this._logTop) : -1;
    if (n < 0) n = log.length;                 // first fill, or scrolled past the cap
    const box = this._logBox;
    for (let i = Math.min(n, 60) - 1; i >= 0; i--) {
      const e = log[i];
      const row = el('div', 'li k-' + (e.kind || 'info'));
      el('span', 'd', row, 'Day ' + e.day);
      el('span', 't', row, e.text);
      box.insertBefore(row, box.firstChild);
    }
    while (box.childNodes.length > 60) box.removeChild(box.lastChild);
    this._logTop = log[0];
  };

  // ---- the hot path -----------------------------------------------------
  UI.prototype.update = function (s) {
    if (!s) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._deriveAt > 200) { this._deriveAt = now; this._d = derived(s); }  // derive() may walk the grid; 5Hz is plenty
    const d = this._d;

    if (!this._polBuilt && MM.POLICIES && MM.POLICIES.length) this._buildPolicies();

    if (s.day !== this._day) {
      const first = this._day < 0;
      this._day = s.day;
      this._sample(s, d, first);
      setText(this._dayEl, 'Day ' + NF.format(s.day));
      setText(this._yearEl, 'Year ' + clamp(Math.floor((s.day - 1) / ((s.termDay || 1461) / 4)) + 1, 1, 4) + ' of 4');
    }

    // stat tiles
    for (let i = 0; i < STATS.length; i++) {
      const st = STATS[i];
      setText(this._tiles[st.key].val, st.fmt(st.get(s, d)));
    }
    const cash = this._tiles.cash;
    setText(cash.sub, signed(d.net) + '/d');
    setCls(cash.sub, 'up', d.net >= 0);
    setCls(cash.sub, 'down', d.net < 0);
    setCls(cash.root, 'alarm', (s.treasury || 0) < 500);

    const app = this._tiles.app;
    const bucket = face(s.approval || 0);
    setText(app.sub, FACES[bucket][1]);
    setCls(app.root, 'warn', bucket >= 2);
    setCls(app.root, 'alarm', bucket >= 3);
    if (bucket !== this._appBucket) {
      if (this._appBucket >= 0) {
        const root = app.root;
        root.classList.remove('pulse');
        void root.offsetWidth;
        root.classList.add('pulse');
        setTimeout(function () { root.classList.remove('pulse'); }, 1500);
      }
      this._appBucket = bucket;
    }
    setCls(this._tiles.rent.root, 'alarm', (s.rent || 0) > 125);
    setCls(this._tiles.traf.root, 'alarm', (s.traffic || 0) > 70);

    // speed + tools
    for (let i = 0; i < this._speeds.length; i++) setCls(this._speeds[i], 'on', s.speed === i);
    for (let i = 0; i < this._tools.length; i++) {
      const t = this._tools[i];
      setCls(t.b, 'on', s.selected === t.tile);
      setCls(t.b, 'poor', (s.treasury || 0) < t.cost);
    }

    // policies
    const pc = policyCost(s);
    const income = s.dailyIncome || 0;
    setText(this._polCost, '$' + NF.format(Math.round(pc)) + '/day');
    setCls(this._polCost, 'over', pc > income);
    for (let i = 0; i < this._cards.length; i++) {
      const c = this._cards[i];
      const locked = (s.pop || 0) < c.unlock;
      const active = !!(s.policies && s.policies[c.id]);
      setCls(c.card, 'locked', locked);
      setCls(c.card, 'on', active);
      setAttr(c.card, 'aria-pressed', active ? 'true' : 'false');
      setCls(c.lock, 'show', locked);
    }

    // budget
    setText(this._bud.income.v, money(income));
    setText(this._bud.upkeep.v, money(Math.max(0, (s.dailyCost || 0) - pc)));
    setText(this._bud.policy.v, money(pc));
    setText(this._bud.net.v, signed(d.net));
    setCls(this._bud.net.row, 'bad', d.net < 0);

    this._syncLog(s);

    if (s.gameOver && !this._overShown) { this._overShown = true; this._showOver(s); }
  };

  MM.UI = UI;
})(window.MM);

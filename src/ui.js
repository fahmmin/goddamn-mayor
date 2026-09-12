/* MAYOR MAMDANI - HUD. Owned by the ui agent. Pairs with src/style.css. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const NF = new Intl.NumberFormat('en-US');
  const HIST = 7;                     // sparkline window, in game days
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
  function icon (parent, name) {
    const paths = {
      city: 'M3 21h18M5 21V10h5v11M10 21V3h8v18M7 13h1m-1 3h1m5-10h2m-2 4h2m-2 4h2',
      hall: 'M2 9l10-6 10 6H2m2 12h16M6 11v7m6-7v7m6-7v7',
      build: 'M14 4l6 6M3 21l4-1L20 7l-3-3L4 17l-1 4',
      home: 'M3 11l9-8 9 8M6 9v12h12V9m-8 12v-7h4v7',
      gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
      close: 'M6 6l12 12M18 6L6 18',
      people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 21v-3a6 6 0 0 1 12 0v3m2-14a3 3 0 0 1 0 6m1 3c3 0 3 3 3 5',
      coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m3 5h-5a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12',
      happy: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 9h.01M16 9h.01M8 14q4 5 8 0',
      road: 'M7 3L3 21M17 3l4 18M12 3v3m0 3v3m0 3v3m0 3v1',
      park: 'M12 2l-7 9h4l-6 7h18l-6-7h4l-7-9m0 16v4',
      plus: 'M12 5v14M5 12h14', minus: 'M5 12h14'
    };
    const svg = svgEl('svg', { class: 'ui-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, parent);
    svgEl('path', { d: paths[name] || paths.city }, svg); return svg;
  }
  function buildIcon (parent, tile) {
    const T = MM.TILE;
    const svg = svgEl('svg', { class: 'build-icon', viewBox: '0 0 72 64', 'aria-hidden': 'true' }, parent);
    const colors = {};
    colors[T.RES] = ['#f3dfb6', '#b38b60', '#e16f51']; colors[T.COM] = ['#a6d2df', '#457d98', '#e5f4f3'];
    colors[T.IND] = ['#dbc6ae', '#9e8870', '#deaa51']; colors[T.SCHOOL] = ['#f4d7a2', '#bd8850', '#e69d42'];
    colors[T.CLINIC] = ['#edf1e6', '#96b5b3', '#40a5b4']; colors[T.GROCERY] = ['#f3e4cb', '#b6a48b', '#e26555'];
    colors[T.CHILDCARE] = ['#e5daed', '#ab8dc0', '#9574b7']; colors[T.TOWER] = ['#e9efdf', '#91aa82', '#66aa73'];
    const c = colors[tile] || ['#d9e2cf', '#6e9b69', '#7bb378'];
    function path (d, fill) { svgEl('path', { d: d, fill: fill }, svg); }
    path('M6 48L35 33 67 48 37 63Z', '#d8e7ce');
    path('M6 48L37 61 67 47 67 51 37 64 6 51Z', '#94b08a');
    if (tile === T.PARK) {
      path('M30 49L43 42 49 46 35 55Z', '#eee4c5');
      [[21,35,12],[44,24,15],[52,44,9]].forEach(function (p) {
        svgEl('path', { d: 'M' + p[0] + ' ' + p[1] + 'v14', stroke: '#826945', 'stroke-width': 3 }, svg);
        svgEl('circle', { cx: p[0], cy: p[1], r: p[2], fill: '#3e8c63' }, svg);
        svgEl('circle', { cx: p[0] - 3, cy: p[1] - 3, r: p[2] * .7, fill: '#79b66a' }, svg);
      }); return;
    }
    if (tile === T.ROAD || tile === T.BUS || tile === T.BULLDOZE) {
      path('M8 44L40 27 65 41 34 59Z', '#667577'); path('M20 44l7-4 3 2-7 4m13-7 7-4 3 2-7 4', '#f2e4b1');
      if (tile === T.ROAD) return;
      path('M18 30L41 19 55 26 32 38Z', tile === T.BUS ? '#7bc6dd' : '#efb64a');
      path('M18 30v13l14 7V38Z', tile === T.BUS ? '#3896b6' : '#d49227'); path('M32 38L55 26v13L32 50Z', tile === T.BUS ? '#246b8b' : '#a57936');
      path('M35 39l17-9v6l-17 9Z', '#cce3df'); return;
    }
    path('M16 22L37 11 58 21 37 33Z', c[2]); path('M16 22v26l21 11V33Z', c[0]); path('M37 33l21-12v25L37 59Z', c[1]);
    path('M14 22L37 9 61 21 58 24 37 14 17 25Z', c[2]);
    path('M21 30l4 2v6l-4-2m7-2 4 2v6l-4-2m-7 0 4 2v6l-4-2m7-2 4 2v6l-4-2M42 35l4-2v6l-4 2m7-10 4-2v6l-4 2m-7 6 4-2v6l-4 2m7-10 4-2v6l-4 2', '#608b98');
    if (tile === T.CLINIC) path('M28 24v5l-5-2v5l5 2v5l5 2v-5l5 2v-5l-5-2v-5Z', '#e16d5f');
    if (tile === T.GROCERY) path('M14 35l23 11v6L14 41Z', '#d96552');
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
    this._touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    root.textContent = '';
    root.classList.add('mm-root');

    this._buildTop(root);
    this._buildTools(root);
    this._buildRail(root, state);
    this._buildMarket(root);
    this._buildDock(root);
    this._buildToasts(root);
    this._buildModal(root);
    this._buildOver(root);
    this._buildTutorial(root);
    this._buildControls(root);

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
    icon(el('div', 'city-seal', brand), 'city');
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
      icon(el('span', 'stat-icon', t), { cash: 'coin', pop: 'people', app: 'happy', rent: 'home', traf: 'road', unemp: 'city' }[st.key]);
      el('div', 'tl', t, { cash: 'City funds', pop: 'Residents', app: 'Approval', rent: 'Rent index', traf: 'Traffic', unemp: 'Unemployed' }[st.key]);
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
      b.setAttribute('aria-label', s.tip);
      const n = s.n;
      const self = this;
      on(b, function () { self._call('onSpeed', n); });
      this._speeds.push(b);
    }
  };

  // ---- left toolbar -----------------------------------------------------
  UI.prototype._buildTools = function (root) {
    const box = this._catalog = el('div', 'mm-tools', root);
    box.id = 'build-catalog'; box.setAttribute('aria-label', 'Build catalog');
    this._catalogOpen = window.innerWidth >= 700;
    box.hidden = !this._catalogOpen;
    const head = el('div', 'catalog-head', box);
    const title = el('div', null, head);
    el('div', 'catalog-kicker', title, 'A city for everyone');
    el('h2', null, title, 'Build your city');
    const self = this;
    const close = on(el('button', 'icon-btn', head), function () { self._setCatalog(false); });
    close.setAttribute('aria-label', 'Close build catalog'); icon(close, 'close');
    const tabs = el('div', 'catalog-tabs', box);
    tabs.setAttribute('aria-label', 'Building categories');
    const T = MM.TILE;
    const groups = [
      { name: 'Zones', icon: 'city', tiles: [T.RES, T.COM, T.IND] },
      { name: 'Services', icon: 'hall', tiles: [T.SCHOOL, T.CLINIC, T.GROCERY, T.CHILDCARE, T.TOWER] },
      { name: 'Transport', icon: 'road', tiles: [T.ROAD, T.BUS] },
      { name: 'Parks', icon: 'park', tiles: [T.PARK] }
    ];
    this._groups = groups;
    groups.forEach(function (g, i) {
      g.button = on(el('button', 'category', tabs), function () { self._category(i); });
      icon(g.button, g.icon); el('span', null, g.button, g.name);
      g.button.setAttribute('aria-pressed', 'false');
    });
    this._categoryTitle = el('div', 'category-title', box);
    const grid = el('div', 'tool-grid', box);
    const list = MM.BUILDABLE || [];
    const info = MM.TILE_INFO || {};
    const doze = MM.TILE ? MM.TILE.BULLDOZE : 99;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const inf = info[t] || { name: 'Tile ' + t, cost: 0, key: '' };
      const b = el('button', 'tool' + (t === doze ? ' doze' : ''), t === doze ? box : grid);
      buildIcon(b, t);
      el('span', 'k', b, String(inf.key || '').toUpperCase());
      const names = {}; names[T.GROCERY] = 'City grocery'; names[T.CLINIC] = 'Health clinic'; names[T.SCHOOL] = 'Public school'; names[T.TOWER] = 'Social housing'; names[T.BUS] = 'Bus stop';
      el('span', 'tn', b, names[t] || inf.name);
      el('span', 'tc', b, '$' + NF.format(inf.cost || 0));
      b.title = inf.name + ' - $' + (inf.cost || 0) + (inf.upkeep ? ', $' + inf.upkeep + '/day upkeep' : '') + '  [' + inf.key + ']';
      b.setAttribute('aria-label', inf.name + ', $' + (inf.cost || 0));
      on(b, function () {
        if (b.getAttribute('aria-disabled') === 'true') { self.toast('Not enough city funds for ' + inf.name + '.', 'bad'); return; }
        self._call('onSelect', t);
        if (MM.renderer) MM.renderer.buildMode = true;
        if (window.innerWidth < 700) self._setCatalog(false);
      });
      this._tools.push({ b: b, tile: t, cost: inf.cost || 0 });
    }
    const note = el('div', 'catalog-note', box);
    icon(note, 'road'); el('span', null, note, 'Connect buildings to a road to help them grow.');
    this._category(1);
  };

  UI.prototype._category = function (n) {
    const g = this._groups[n]; this._categoryIndex = n;
    this._groups.forEach(function (group, i) {
      setCls(group.button, 'on', n === i); setAttr(group.button, 'aria-pressed', n === i ? 'true' : 'false');
    });
    this._tools.forEach(function (t) { t.b.hidden = t.tile !== MM.TILE.BULLDOZE && g.tiles.indexOf(t.tile) < 0; });
    setText(this._categoryTitle, g.name + '  /  ' + g.tiles.length + ' available');
  };
  UI.prototype._setCatalog = function (open) {
    this._catalogOpen = open; this._catalog.hidden = !open;
    if (this._buildBtn) setAttr(this._buildBtn, 'aria-expanded', String(open));
    if (open && this._rail) this._closeRail();
  };
  UI.prototype._closeRail = function () {
    this._rail.classList.add('collapsed');
    if (this._hallBtn) setAttr(this._hallBtn, 'aria-expanded', 'false');
  };

  // ---- right rail -------------------------------------------------------
  UI.prototype._buildRail = function (root, state) {
    const self = this;
    const rail = el('div', 'mm-rail', root);
    this._rail = rail;

    const tabs = el('div', 'tabs', rail);
    const collapse = this._collapseBtn = el('button', 'collapse', tabs, '×');
    collapse.title = 'Close City Hall'; collapse.setAttribute('aria-label', 'Close City Hall');
    on(collapse, function () {
      self._closeRail();
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
    el('div', 'sub', p2, 'CITY INDICATORS');
    const metrics = el('div', 'ledger', p2);
    this._cityMetrics = {};
    for (let i = 3; i < STATS.length; i++) {
      const st = STATS[i];
      this._cityMetrics[st.key] = this._budRow(metrics, { rent: 'Rent index', traf: 'Traffic', unemp: 'Unemployment' }[st.key], 'metric').v;
    }
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
    this._closeRail();
    this._catalog.hidden = window.innerWidth < 700; this._catalogOpen = !this._catalog.hidden;
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
    this._collapseBtn.textContent = '×';
    this._setCatalog(false);
    if (this._hallBtn) setAttr(this._hallBtn, 'aria-expanded', 'true');
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
      const b = el('button', 'ob', ov, name === 'none' ? 'City' : name);
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
    for (let i = 0; i < this._overlays.length; i++) {
      const o = this._overlays[i], active = o.name === this._overlay;
      setCls(o.b, 'on', active); setAttr(o.b, 'aria-pressed', String(active));
    }
  };

  UI.prototype._buildControls = function (root) {
    const self = this;
    const actions = el('div', 'city-actions', root);
    const hall = this._hallBtn = on(el('button', 'hall-btn', actions), function () {
      if (self._rail.classList.contains('collapsed')) self._tab(0); else self._closeRail();
    });
    icon(hall, 'hall'); el('span', null, hall, 'City Hall'); hall.setAttribute('aria-expanded', 'false');
    const settings = on(el('button', 'icon-btn settings-btn', actions), function () {
      panel.hidden = !panel.hidden; setAttr(settings, 'aria-expanded', String(!panel.hidden));
    });
    icon(settings, 'gear'); settings.setAttribute('aria-label', 'Graphics settings'); settings.setAttribute('aria-expanded', 'false');
    const panel = el('div', 'graphics-panel', root); panel.hidden = true;
    el('h3', null, panel, 'Graphics');
    el('p', null, panel, 'Find the right balance for your device.');
    const modes = [['eco', 'Eco', 'Lower resolution, fewer moving details'], ['balanced', 'Balanced', 'Rich scenery, lighter on your browser'], ['high', 'High', 'Sharper on high-resolution displays']];
    const qualityButtons = [];
    modes.forEach(function (mode) {
      const b = on(el('button', 'quality-choice', panel), function () {
        if (MM.visuals) MM.visuals.setQuality(mode[0]);
        syncQuality();
      });
      el('strong', null, b, mode[1]); el('span', null, b, mode[2]); qualityButtons.push({ b: b, mode: mode[0] });
    });
    function syncQuality () {
      qualityButtons.forEach(function (q) {
        const active = MM.visuals ? MM.visuals.quality === q.mode : q.mode === 'balanced';
        setCls(q.b, 'on', active); setAttr(q.b, 'aria-pressed', String(active));
      });
    }
    syncQuality();
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth < 700 && lastWidth >= 700) { self._setCatalog(false); self._closeRail(); }
      lastWidth = window.innerWidth;
    });
    const camera = el('div', 'camera-controls', root);
    [['plus', 'Zoom in', 1], ['minus', 'Zoom out', -1], ['home', 'Center city', 0]].forEach(function (c) {
      const b = on(el('button', 'icon-btn', camera), function () {
        const r = MM.renderer; if (!r) return;
        if (c[2]) r.zoomAt(r.w * .5, r.h * .48, c[2]); else { r.stopPan(); r.centerOn(MM.GRID * .28, MM.GRID * .46); }
      });
      icon(b, c[0]); b.title = c[1]; b.setAttribute('aria-label', c[1]);
    });
    const build = this._buildBtn = on(el('button', 'build-toggle', root), function () { self._setCatalog(!self._catalogOpen); });
    icon(build, 'build'); el('span', null, build, 'Build city');
    build.setAttribute('aria-expanded', String(this._catalogOpen)); build.setAttribute('aria-controls', 'build-catalog');
    const hint = el('div', 'placement-hint', root);
    this._placementTitle = el('strong', null, hint, 'Explore your city');
    this._placementText = el('span', null, hint, 'Drag to explore · Scroll to zoom');
    const cancel = this._cancelBuild = on(el('button', 'cancel-build', hint, 'Done'), function () {
      if (MM.renderer) MM.renderer.buildMode = false;
    }); cancel.hidden = true;
    const help = on(el('button', 'help-btn', root, '?'), function () { if (self._tutorial) self._tutorial.hidden = !self._tutorial.hidden; });
    help.title = 'How to play'; help.setAttribute('aria-label', 'How to play');
    const map = on(el('button', 'mobile-map', root, 'Map layers'), function () {
      const open = !root.classList.contains('map-open'); setCls(root, 'map-open', open); setAttr(map, 'aria-expanded', String(open));
    }); map.setAttribute('aria-expanded', 'false');
    window.addEventListener('keydown', function (e) {
      if (!self.eventOpen && !(e.target && /input|textarea|select/i.test(e.target.tagName))) {
        for (let i = 0; i < self._tools.length; i++) {
          const inf = MM.TILE_INFO[self._tools[i].tile];
          if (inf && String(inf.key).toLowerCase() === e.key.toLowerCase() && MM.renderer) MM.renderer.buildMode = true;
        }
      }
      if (e.key !== 'Escape' || self.eventOpen) return;
      panel.hidden = true; setAttr(settings, 'aria-expanded', 'false');
      setCls(root, 'map-open', false); setAttr(map, 'aria-expanded', 'false');
      self._setCatalog(false); self._closeRail();
      if (self._tutorial) self._tutorial.hidden = true;
      if (MM.renderer) MM.renderer.buildMode = false;
    });
    // A focused button owns Space/Enter; do not also pause the simulation or
    // zoom it through the window-level game shortcuts.
    root.addEventListener('keydown', function (e) {
      if (!self.eventOpen && e.target && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) e.stopPropagation();
    });
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
    const card = el('div', 'mm-tut', root);
    card.hidden = true; this._tutorial = card;
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
      card.hidden = true;
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
  // ---- the market panel -------------------------------------------------
  /* Nine districts, priced. The panel reads state.chain and nothing else -
   * web3/bundle.js writes that object and stops, so the game never learns the
   * network exists and smoke.js never has to load a bundle.
   *
   * Three data states, and the badge always says which one you are looking at:
   *   live    a snapshot arrived from the chain inside CHAIN_STALE_MS
   *   stale   the chain answered once and has gone quiet - last-known values
   *   local   no snapshot ever arrived, so these are this browser's own sim
   *
   * "local" is labelled rather than hidden on purpose. An unlabelled number
   * that looks onchain but is not would be the single worst thing this panel
   * could do to the submission.
   */
  const CHAIN_STALE_MS = 30000;

  UI.prototype._buildMarket = function (root) {
    const panel = el('div', 'mm-market', root);
    this._market = panel;
    panel.setAttribute('aria-label', 'District market');

    const head = el('div', 'mkt-head', panel);
    const title = el('div', 'mkt-title', head);
    el('span', 'mkt-t1', title, 'DISTRICT MARKET');
    this._mktRoot = el('span', 'mkt-t2', title, MM.districts ? MM.districts.ROOT : '');
    this._mktBadge = el('span', 'mkt-badge', head, 'local');

    const term = el('div', 'mkt-term', panel);
    this._mktOffice = el('span', 'mkt-office', term, '—');
    this._mktRating = el('span', 'mkt-rating', term, '—');

    const list = el('div', 'mkt-list', panel);
    this._mktRows = [];
    const dl = (MM.districts && MM.districts.LIST) || [];
    for (let i = 0; i < dl.length; i++) {
      const r = el('div', 'mrow', list);
      const arrow = el('span', 'ma', r, '·');
      const nm = el('span', 'mn', r, dl[i].ens || dl[i].key);
      const nav = el('span', 'mv', r, '$0');
      const chg = el('span', 'mc', r, '—');
      const sv = svgEl('svg', { class: 'mspark', viewBox: '0 0 60 18', preserveAspectRatio: 'none' }, r);
      const line = svgEl('polyline', { fill: 'none', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', points: '' }, sv);
      nm.title = dl[i].name;
      this._mktRows.push({ root: r, arrow: arrow, name: nm, nav: nav, chg: chg, line: line,
        hist: [], shown: 0, target: 0, prev: 0 });
    }

    this._mktFoot = el('div', 'mkt-foot', panel, 'connect a wallet to underwrite a district');
  };

  /* Credit rating from the two things a lender would actually look at: how
   * popular the administration is, and whether the city runs a surplus. Same
   * inputs the sim already has, so it agrees with the HUD by construction. */
  const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'D'];
  function ratingOf (s, d) {
    const appr = num(s.approval, 50);
    const net = num(d.net, 0);
    const income = Math.max(1, num(s.dailyIncome, 1));
    let score = appr / 100 * 6 + clamp(net / income, -1, 1) * 2;     // 0..8-ish
    if ((s.treasury || 0) < 0) score -= 2;
    return RATINGS[clamp(Math.round(8 - score), 0, 8)];
  }

  UI.prototype._updateMarket = function (s, d, now) {
    if (!this._market) return;
    const rows = this._mktRows;
    if (!rows.length) return;

    const ch = s.chain;
    const fresh = !!(ch && ch.districts && ch.districts.length === rows.length);
    const age = ch && ch.at ? now - ch.at : Infinity;
    const mode = !ch || !ch.everLive ? 'local' : (age > CHAIN_STALE_MS ? 'stale' : 'live');

    setText(this._mktBadge, mode);
    setCls(this._mktBadge, 'live', mode === 'live');
    setCls(this._mktBadge, 'stale', mode === 'stale');
    if (MM.districts) setText(this._mktRoot, MM.districts.ROOT);

    // office + rating: the chain's answer when there is one, the sim's otherwise
    const rating = (ch && ch.rating) || ratingOf(s, d);
    setText(this._mktRating, rating);
    setCls(this._mktRating, 'bad', RATINGS.indexOf(rating) >= 4);

    if (ch && ch.office && ch.office.expiry) {
      const left = Math.max(0, Math.round((ch.office.expiry * 1000 - Date.now()) / 86400000));
      setText(this._mktOffice, ch.office.label + '.' + (MM.districts ? MM.districts.ROOT : '') +
        (ch.office.holder ? '  ·  ' + left + 'd left' : '  ·  vacant'));
      setCls(this._mktOffice, 'bad', !ch.office.canPush);
    } else {
      const term = num(s.termDay, 1461);
      setText(this._mktOffice, 'term day ' + NF.format(s.day || 0) + ' / ' + NF.format(term));
      setCls(this._mktOffice, 'bad', false);
    }

    // targets: chain snapshot if we have one, this browser's sim if we do not.
    // stats() walks all 2304 tiles, so it is sampled once per game-day in
    // _sampleMarket and cached here - update() runs at 60fps and must not.
    const local = fresh ? null : this._mktLocal;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const t = fresh ? num(ch.districts[i].nav, 0) : (local ? num(local[i].nav, 0) : 0);
      if (t !== r.target) { r.prev = r.target; r.target = t; }
      // ease toward the target so the numbers move rather than jump on arrival
      r.shown += (r.target - r.shown) * 0.08;
      if (Math.abs(r.target - r.shown) < 1) r.shown = r.target;

      setText(r.nav, money(r.shown));
      const pct = r.prev > 0 ? ((r.target - r.prev) / r.prev) * 100 : 0;
      setText(r.chg, (pct === 0 ? '—' : (pct > 0 ? '+' : '') + pct.toFixed(1) + '%'));
      setCls(r.chg, 'up', pct > 0.05);
      setCls(r.chg, 'down', pct < -0.05);
      setText(r.arrow, pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : '·');
      setCls(r.arrow, 'up', pct > 0.05);
      setCls(r.arrow, 'down', pct < -0.05);
    }
  };

  /* Sampled once per game-day alongside the stat tiles, not per frame. */
  UI.prototype._sampleMarket = function (s) {
    if (!this._mktRows || !this._mktRows.length) return;
    const ch = s.chain;
    const fresh = !!(ch && ch.districts && ch.districts.length === this._mktRows.length);
    const local = (!fresh && MM.districts) ? MM.districts.stats(s) : null;
    this._mktLocal = local;                     // cached for update(); see _updateMarket
    for (let i = 0; i < this._mktRows.length; i++) {
      const r = this._mktRows[i];
      r.hist.push(fresh ? num(ch.districts[i].nav, 0) : (local ? num(local[i].nav, 0) : 0));
      if (r.hist.length > HIST) r.hist.shift();
      setAttr(r.line, 'points', sparkPoints(r.hist));
    }
  };

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
      this._sampleMarket(s);
      setText(this._dayEl, 'Day ' + NF.format(s.day));
      setText(this._yearEl, 'Year ' + clamp(Math.floor((s.day - 1) / ((s.termDay || 1461) / 4)) + 1, 1, 4) + ' of 4');
    }

    // stat tiles
    for (let i = 0; i < STATS.length; i++) {
      const st = STATS[i];
      setText(this._tiles[st.key].val, st.fmt(st.get(s, d)));
      if (this._cityMetrics[st.key]) setText(this._cityMetrics[st.key], st.fmt(st.get(s, d)));
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
    for (let i = 0; i < this._speeds.length; i++) {
      setCls(this._speeds[i], 'on', s.speed === i); setAttr(this._speeds[i], 'aria-pressed', String(s.speed === i));
    }
    if (this._selected !== s.selected) {
      if (this._selected !== undefined) {
        if (MM.renderer) MM.renderer.buildMode = true;
        for (let i = 0; i < this._groups.length; i++) if (this._groups[i].tiles.indexOf(s.selected) >= 0) this._category(i);
      }
      this._selected = s.selected;
    }
    const building = !!(MM.renderer && MM.renderer.buildMode);
    if (this._placementTitle) {
      const inf = (MM.TILE_INFO || {})[s.selected] || {};
      setText(this._placementTitle, building ? inf.name + ' · $' + (inf.cost || 0) : 'Explore your city');
      setText(this._placementText, building ? (this._touch ? 'Tap to place · Drag to move' : 'Click to place · Right-drag to move')
        : (this._touch ? 'Drag to explore · Pinch to zoom' : 'Drag to explore · Scroll to zoom'));
      if (this._cancelBuild.hidden === building) this._cancelBuild.hidden = !building;
    }
    for (let i = 0; i < this._tools.length; i++) {
      const t = this._tools[i];
      setCls(t.b, 'on', building && s.selected === t.tile);
      setAttr(t.b, 'aria-pressed', String(building && s.selected === t.tile));
      setCls(t.b, 'poor', (s.treasury || 0) < t.cost);
      setAttr(t.b, 'aria-disabled', String((s.treasury || 0) < t.cost));
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

    this._updateMarket(s, d, now);

    this._syncLog(s);

    if (s.gameOver && !this._overShown) { this._overShown = true; this._showOver(s); }
  };

  MM.UI = UI;
})(window.MM);

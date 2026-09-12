/* Headless integration smoke test.
   Evals every module in load order against a minimal fake DOM, then runs the
   simulation hard. Catches cross-module breakage without opening a browser.
   Run: node smoke.js                                                        */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, 'src');
const store = {};

// --- minimal fake DOM ------------------------------------------------------
function el (tag) {
  const e = {
    tagName: (tag || 'div').toUpperCase(), style: {}, dataset: {}, children: [], classList: {
      _s: new Set(), add () { [].forEach.call(arguments, a => this._s.add(a)); },
      remove () { [].forEach.call(arguments, a => this._s.delete(a)); },
      toggle (a, f) { f === undefined ? (this._s.has(a) ? this._s.delete(a) : this._s.add(a)) : (f ? this._s.add(a) : this._s.delete(a)); },
      contains (a) { return this._s.has(a); }
    },
    textContent: '', innerHTML: '', value: '', checked: false, width: 1280, height: 800,
    appendChild (c) { this.children.push(c); return c; },
    append () { [].forEach.call(arguments, c => this.children.push(c)); },
    removeChild (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove () {},
    setAttribute (k, v) { this[k] = v; }, getAttribute (k) { return this[k]; }, removeAttribute () {},
    addEventListener () {}, removeEventListener () {}, focus () {}, blur () {}, click () {},
    querySelector () { return el('div'); }, querySelectorAll () { return []; },
    getBoundingClientRect () { return { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 }; },
    getContext () { return ctx2d(); },
    insertBefore (c) { this.children.unshift(c); return c; },
    scrollTo () {}, closest () { return null; }
  };
  Object.defineProperty(e, 'childNodes', { get () { return this.children; } });
  Object.defineProperty(e, 'childElementCount', { get () { return this.children.length; } });
  Object.defineProperty(e, 'firstChild', { get () { return this.children[0] || null; } });
  Object.defineProperty(e, 'lastChild', { get () { return this.children[this.children.length - 1] || null; } });
  Object.defineProperty(e, 'firstElementChild', { get () { return this.children[0] || null; } });
  Object.defineProperty(e, 'lastElementChild', { get () { return this.children[this.children.length - 1] || null; } });
  return e;
}
function ctx2d () {
  const noop = () => {};
  const c = {
    canvas: { width: 1280, height: 800 },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: 'left', textBaseline: 'top', lineJoin: 'miter', lineCap: 'butt',
    shadowBlur: 0, shadowColor: '', globalCompositeOperation: 'source-over',
    filter: 'none', imageSmoothingEnabled: true
  };
  ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'fill', 'stroke', 'rect',
    'fillRect', 'strokeRect', 'clearRect', 'arc', 'arcTo', 'ellipse', 'translate', 'scale',
    'rotate', 'setTransform', 'resetTransform', 'transform', 'clip', 'quadraticCurveTo',
    'bezierCurveTo', 'fillText', 'strokeText', 'setLineDash', 'drawImage', 'putImageData'
  ].forEach(k => { c[k] = noop; });
  c.measureText = t => ({ width: String(t).length * 6 });
  c.createLinearGradient = c.createRadialGradient = () => ({ addColorStop: noop });
  c.createPattern = () => null;
  c.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  return c;
}

global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener () {}, removeEventListener () {},
  requestAnimationFrame () { return 0; }, cancelAnimationFrame () {},
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id),
  setInterval: () => 0, clearInterval: () => {},
  matchMedia: () => ({ matches: false, addEventListener () {}, addListener () {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  location: { reload () {} }
};
global.document = {
  body: el('body'), documentElement: el('html'), head: el('head'),
  createElement: el, createElementNS: (ns, tag) => el(tag),
  createTextNode: t => ({ textContent: t, nodeType: 3 }),
  createDocumentFragment: () => el('fragment'),
  getElementById: id => (id === 'city' ? el('canvas') : el('div')),
  querySelector: () => el('div'), querySelectorAll: () => [],
  addEventListener () {}, removeEventListener () {}, activeElement: null
};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.performance = { now: () => Date.now() };
// node 24 defines `navigator` as a getter-only global — plain assignment throws
Object.defineProperty(global, 'navigator', {
  value: { userAgent: 'node', language: 'en-US' }, configurable: true, writable: true
});
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.AudioContext = undefined;   // audio must degrade to silence

// --- load modules in index.html order --------------------------------------
const ORDER = ['state.js', 'districts.js', 'gfx.js', 'materials.js', 'audio.js', 'policies.js', 'events.js', 'sim.js',
  'ground.js', 'roofs.js', 'props.js', 'lots.js', 'ens.js', 'quests.js', 'light.js', 'bridges.js', 'landmarks.js', 'sky.js', 'render.js', 'ui.js', 'demo.js', 'inspect.js', 'shell.js'];
// demo.js shadows loadState/saveState/sim.step when showcase mode is on. The
// harness wants the real ones, so opt out before it loads and test its plan
// through MM.buildDemoCity instead.
global.window.MM = { DEMO: false };
const missing = [];
for (const f of ORDER) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { missing.push(f); continue; }
  const code = fs.readFileSync(p, 'utf8');
  try {
    (0, eval)(code);
  } catch (e) {
    console.error('\n  FAIL  ' + f + ' threw while loading:\n        ' + e.message + '\n');
    process.exit(1);
  }
}
if (missing.length) { console.error('  FAIL  missing files: ' + missing.join(', ')); process.exit(1); }

const MM = global.window.MM;
const ok = [];
const warn = [];
function need (cond, label) { cond ? ok.push(label) : (console.error('  FAIL  ' + label), process.exitCode = 1); }
function soft (cond, label) { cond ? ok.push(label) : warn.push(label); }

// --- API surface -----------------------------------------------------------
need(typeof MM.createState === 'function', 'MM.createState');
need(typeof MM.Renderer === 'function', 'MM.Renderer');
need(typeof MM.UI === 'function', 'MM.UI');
need(MM.sim && typeof MM.sim.step === 'function', 'MM.sim.step');
need(Array.isArray(MM.POLICIES), 'MM.POLICIES');
need(Array.isArray(MM.EVENTS), 'MM.EVENTS');
need(typeof MM.maybeFireEvent === 'function', 'MM.maybeFireEvent');
need(typeof MM.togglePolicy === 'function', 'MM.togglePolicy');
need(typeof MM.policyDailyCost === 'function', 'MM.policyDailyCost');
need(typeof MM.hasPolicy === 'function', 'MM.hasPolicy');
need(MM.audio && typeof MM.audio.play === 'function', 'MM.audio.play');
soft(typeof MM.sim.derive === 'function', 'MM.sim.derive');
if (process.exitCode) { console.error('\n  API surface incomplete — stopping.\n'); process.exit(1); }

// --- content sanity --------------------------------------------------------
const REQUIRED_POLICIES = ['freeBuses', 'rentFreeze', 'cityGrocery', 'universalChildcare',
  'taxTheRich', 'communitySafety', 'minimumWage30', 'freeSchoolMeals'];
const ids = MM.POLICIES.map(p => p.id);
REQUIRED_POLICIES.forEach(id => need(ids.indexOf(id) >= 0, 'policy "' + id + '" exists'));
need(MM.EVENTS.length >= 20, 'at least 20 events (got ' + MM.EVENTS.length + ')');
MM.EVENTS.forEach(e => {
  need(!!e.id && !!e.title && !!e.text, 'event ' + e.id + ' has id/title/text');
  need(Array.isArray(e.choices) && e.choices.length >= 2, 'event ' + e.id + ' has >=2 choices');
  e.choices.forEach(c => need(typeof c.apply === 'function', 'event ' + e.id + ' choice apply()'));
});

// --- renderer + ui construct and run ---------------------------------------
const canvas = el('canvas');
const r = new MM.Renderer(canvas);
r.resize();
r.centerOn(12, 12);
const s = MM.createState();
const ui = new MM.UI(el('div'), s, {
  onSelect () {}, onPolicy () {}, onSpeed () {}, onOverlay () {},
  onTax () {}, onSave () {}, onReset () {}, onMute () {}
});

// lots.js owns every zoned and civic block; check its contract and that its
// plan actually consolidates tiles rather than handing back one lot per tile.
need(MM.lots && typeof MM.lots.plan === 'function', 'MM.lots.plan');
need(MM.lots && typeof MM.lots.role === 'function', 'MM.lots.role');
need(MM.lots && typeof MM.lots.draw === 'function', 'MM.lots.draw');

// screenToTile must round-trip through the projection
let roundTripOk = true;
for (const [tx, ty] of [[0, 0], [5, 9], [23, 23], [47, 47], [30, 4]]) {
  r.centerOn(tx, ty);
  const hit = r.screenToTile(640, 400);
  if (!hit || Math.abs(hit.x - tx) > 1 || Math.abs(hit.y - ty) > 1) { roundTripOk = false; break; }
}
soft(roundTripOk, 'screenToTile round-trips through centerOn');

// --- long simulation run ---------------------------------------------------
const T = MM.TILE;
function paint (tile, x0, y0, w, h) {
  for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
    if (MM.inBounds(x, y) && s.grid[MM.idx(x, y)] !== T.WATER) {
      s.grid[MM.idx(x, y)] = tile;
      s.level[MM.idx(x, y)] = MM.ZONES.indexOf(tile) >= 0 ? 1 : 0;
    }
  }
}
for (let y = 4; y < 40; y += 4) paint(T.ROAD, 3, y, 26, 1);
for (let x = 3; x < 30; x += 5) paint(T.ROAD, x, 4, 1, 36);
paint(T.RES, 4, 5, 4, 3); paint(T.RES, 9, 5, 4, 3); paint(T.RES, 14, 9, 4, 3);
paint(T.COM, 4, 9, 4, 3); paint(T.COM, 9, 13, 4, 3);
paint(T.IND, 19, 21, 4, 3);
paint(T.PARK, 14, 5, 2, 2); s.grid[MM.idx(9, 9)] = T.BUS; s.grid[MM.idx(19, 9)] = T.CLINIC;
s.treasury = 40000;

// every planned lot must have exactly one anchor tile, and every tile it
// covers must point back at it - otherwise a block is drawn twice or not at all
s.rev = (s.rev | 0) + 1;
MM.lots.plan(s);
let anchors = 0, merged = 0, roleOk = true;
for (const L of MM.lots.lots) {
  if (L.w > 1 || L.h > 1) merged++;
  for (let y = L.y0; y <= L.y1; y++) {
    for (let x = L.x0; x <= L.x1; x++) {
      const want = (x === L.x1 && y === L.y1) ? 1 : -1;
      if (MM.lots.role(s, x, y) !== want) roleOk = false;
    }
  }
  anchors++;
}
need(anchors > 0, 'lots.plan produced lots (' + anchors + ')');
need(roleOk, 'every lot tile resolves to one anchor');
soft(merged > 0, 'some lots span more than one tile (' + merged + ')');
need(MM.lots.role(s, 3, 4) === 0, 'road tiles are not claimed by a lot');

// --- the showcase city -----------------------------------------------------
// demo.js is what `npm start` boots. It has to plan cleanly: no landmark in
// the river, every pinned plot actually becoming one lot of the right shape.
need(typeof MM.buildDemoCity === 'function', 'MM.buildDemoCity');
need(typeof MM.lots.pin === 'function', 'MM.lots.pin');
need(typeof MM.lots.shape === 'function', 'MM.lots.shape');
need(MM.sky && typeof MM.sky.draw === 'function', 'MM.sky.draw');
{
  const d = MM.buildDemoCity();
  need(d && d.grid.length === MM.GRID * MM.GRID, 'demo city is a full grid');
  const tally = {};
  for (let i = 0; i < d.grid.length; i++) tally[d.grid[i]] = (tally[d.grid[i]] || 0) + 1;
  need((tally[T.ROAD] || 0) > 300, 'demo city has a road network (' + (tally[T.ROAD] || 0) + ' tiles)');
  need((tally[T.RES] || 0) > 200 && (tally[T.COM] || 0) > 150 && (tally[T.IND] || 0) > 80,
    'demo city zones all three kinds');
  need(d.pop > 20000, 'demo city has a real population (' + d.pop + ')');

  MM.lots.plan(d);
  const byAnchor = new Map();
  for (const L of MM.lots.lots) byAnchor.set(L.x0 + ',' + L.y0, L);
  let pinned = 0, badWater = 0;
  for (const L of MM.lots.lots) if (L.pinned) pinned++;
  /* Every entry of demo.js's PLOTS table, and the count below asserts it is
     every one - so a landmark added to the city without being added here is a
     failure, not a silent pass. */
  const WANT = [['airport', 1, 1], ['wind', 26, 1], ['marina', 36, 6], ['stadium', 1, 26],
    ['hospital', 6, 26], ['funfair', 1, 31], ['fire', 6, 31], ['police', 6, 33],
    ['depot', 11, 31], ['port', 30, 37], ['power', 21, 41], ['solar', 16, 41],
    ['hero', 21, 21],
    // the wonders, one to a district
    ['pyramid', 31, 11], ['arcde', 16, 16], ['clock', 11, 16], ['pagoda', 26, 26],
    ['arena', 16, 26]];
  for (const [arch, x, y] of WANT) {
    const L = byAnchor.get(x + ',' + y);
    need(!!L && L.arch === arch && L.pinned,
      'landmark "' + arch + '" planned at ' + x + ',' + y + (L ? ' (got ' + L.arch + ')' : ' (no lot)'));
    if (L) for (let yy = L.y0; yy <= L.y1; yy++) for (let xx = L.x0; xx <= L.x1; xx++) {
      if (d.grid[MM.idx(xx, yy)] === T.WATER) badWater++;
    }
  }
  need(pinned === WANT.length, 'every landmark pinned exactly once (' + pinned + ')');
  need(badWater === 0, 'no landmark plot sits in the river');

  /* MM.newGame swaps cities without a reload, and it MUST do it in place.
     game.js holds `const state` in a closure - the frame loop, every input
     handler and the UI all point at that one object - so a newGame that
     assigned a fresh object would leave the game simulating the old city
     while the screen showed the new one. render.js and lots.js key their
     caches to the typed-array buffers and to s.rev, so those have to survive
     too. Identity is the whole contract here, which is what this asserts. */
  {
    const live = MM.createState();
    MM.state = live;
    const grid0 = live.grid, level0 = live.level, pow0 = live.pow;
    const rev0 = live.rev || 0;
    const townsBefore = MM.count(live, T.COM);

    const back = MM.newGame('showcase');
    need(back === live, 'newGame returns the same state object it was given');
    need(MM.state === live, 'newGame mutates in place - game.js closes over this object');
    need(live.grid === grid0 && live.level === level0 && live.pow === pow0,
      'newGame keeps the typed-array buffers render.js and lots.js cache against');
    need(live.day === 612, 'newGame("showcase") loads the built-out city (day ' + live.day + ')');
    need(MM.count(live, T.COM) > townsBefore, 'newGame("showcase") actually rewrote the grid');
    need((live.rev || 0) > rev0, 'newGame bumps s.rev so the static cache rebuilds');
    need(live.pending === null && live.gameOver === null, 'newGame clears pending and gameOver');

    MM.newGame('fresh');
    need(live.day === 1 && live.treasury === 60000,
      'newGame("fresh") returns to the starter block (day ' + live.day + ')');
    need(live.grid === grid0, 'newGame("fresh") keeps the buffers too');
    MM.state = null;
  }

  /* The shell binds keydown on window in the CAPTURE phase, and for Escape it
     calls preventDefault and acts. The chain layer draws its login and deposit
     dialogs on top, so without this guard Escape closes the menu - or resumes
     the game - out from under an open wallet dialog, leaving it orphaned.
     (Plain typing was never at risk: stopPropagation does not cancel a default
     action, so characters reach a focused input either way.) */
  {
    const pass = MM.Shell.prototype._passThrough;
    const fake = sel => ({ closest: q => (q.split(',').some(p => p.trim() === sel) ? {} : null) });
    need(pass.call(null, fake('.w-modal')) === true, 'Escape inside a wallet dialog is left to the dialog');
    need(pass.call(null, fake('.obs-panel')) === true, 'Escape inside a shell panel is left to the panel');
    need(pass.call(null, { closest: () => null }) === false, 'bare keys are still kept from the game');
    need(pass.call(null, null) === false, 'a keydown with no target does not throw');
  }

  need(Object.keys(MM.lots.ARCH).length >= 30, 'lots.js exposes the full archetype set (' +
    Object.keys(MM.lots.ARCH).length + ')');
  const used = new Set(MM.lots.lots.map(L => L.arch));
  need(used.size >= 20, 'the showcase city uses most of the archetypes (' + used.size + ')');
  const unused = Object.keys(MM.lots.ARCH).filter(a => !used.has(a));
  soft(unused.length === 0, 'every archetype appears somewhere (missing: ' + unused.join(', ') + ')');

  // The whole city has to render at several zooms without a single archetype
  // throwing. lots.draw swallows exceptions so one bad block cannot kill the
  // frame - so watch console.error instead, or a broken landmark goes unseen.
  const realErr = console.error;
  let drawErrs = [];
  console.error = (...a) => drawErrs.push(String(a[0]));
  const probe = new MM.Renderer(el('canvas'));
  probe.resize();
  for (const [zx, zy, zs] of [[10, 6, 1], [24, 24, 0.6], [30, 40, 1.4], [24, 24, 0.35]]) {
    probe.scale = zs; probe.centerOn(zx, zy); probe.draw(d, 16);
  }
  console.error = realErr;
  need(drawErrs.length === 0, 'showcase city renders clean at four zooms (' +
    drawErrs.slice(0, 2).join(' | ') + ')');
  let shaped = 0;
  for (const L of MM.lots.lots) if (MM.lots.shape(d, L.x1, L.y1)) shaped++;
  need(shaped === MM.lots.lots.length, 'lots.shape answers for every anchor');
  MM.lots.clearPins();
}

const seen = { events: 0, choicesApplied: 0 };
const trail = [];
for (let i = 0; i < MM.TICKS_PER_DAY * 500; i++) {
  MM.sim.step(s);
  if (s.pending) {
    seen.events++;
    const c = s.pending.choices[seen.events % s.pending.choices.length];
    c.apply(s); seen.choicesApplied++;
    s.pending = null;
  }
  for (const k of ['pop', 'treasury', 'approval', 'rent', 'traffic', 'happiness', 'pollution']) {
    if (!Number.isFinite(s[k])) { console.error('  FAIL  ' + k + ' became ' + s[k] + ' on day ' + s.day); process.exit(1); }
  }
  if (s.approval < -0.01 || s.approval > 100.01) { console.error('  FAIL  approval out of range: ' + s.approval); process.exit(1); }
  if (s.tick % (MM.TICKS_PER_DAY * 50) === 0) {
    trail.push('  day ' + String(s.day).padStart(4) +
      '  pop ' + String(Math.round(s.pop)).padStart(7) +
      '  $' + String(Math.round(s.treasury)).padStart(9) +
      '  appr ' + String(s.approval.toFixed(1)).padStart(5) +
      '  rent ' + String(Math.round(s.rent)).padStart(4) +
      '  traf ' + String(Math.round(s.traffic)).padStart(3));
  }
  // exercise the render + ui paths on the same states the player would see
  if (i % 97 === 0) { r.draw(s, 16); ui.update(s); }
}

// --- policy toggling doesn't explode ---------------------------------------
s.pop = 20000; s.treasury = 500000;
MM.POLICIES.forEach(p => MM.togglePolicy(s, p.id));
need(Number.isFinite(MM.policyDailyCost(s)), 'policyDailyCost finite with all policies on');
for (let i = 0; i < MM.TICKS_PER_DAY * 120; i++) MM.sim.step(s);
need(Number.isFinite(s.treasury) && Number.isFinite(s.pop), 'state finite after all-policies run');
MM.POLICIES.forEach(p => MM.togglePolicy(s, p.id));
for (let i = 0; i < MM.TICKS_PER_DAY * 60; i++) MM.sim.step(s);
need(Number.isFinite(s.approval), 'state finite after toggling every policy off');

// --- save / load round trip ------------------------------------------------
need(MM.saveState(s) === true, 'saveState');
const back = MM.loadState();
need(back && back.day === s.day && back.grid.length === s.grid.length, 'loadState round-trip');

// --- report ----------------------------------------------------------------
console.log('\n  500-day trajectory');
trail.forEach(l => console.log(l));
console.log('\n  events fired: ' + seen.events + '   policies: ' + MM.POLICIES.length + '   event types: ' + MM.EVENTS.length);
if (warn.length) console.log('\n  warnings:\n' + warn.map(w => '    ~ ' + w).join('\n'));
console.log('\n  ' + ok.length + ' checks passed' + (process.exitCode ? '' : '  —  INTEGRATION OK') + '\n');

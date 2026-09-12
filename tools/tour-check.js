/* node tools/tour-check.js
 *
 * Rehearses the guided tour headlessly, on a fake clock, in milliseconds.
 *
 * The tour makes a promise - under five minutes, every beat, hands over a
 * playable city - and a promise nobody can check is a promise nobody should
 * believe. Watching it once in a browser proves it worked once on one machine
 * with one wallet configured. This proves the schedule itself: that the beats
 * are ordered, that none of them overrun the budget, that a missing wallet or
 * a missing subgraph substitutes rather than throws, and that a skip at any
 * second leaves the game running.
 *
 * It drives MM.Tour through its injected clock, which is the whole reason the
 * clock is injectable.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// --- the smallest DOM the tour touches -------------------------------------
function el (tag) {
  const n = {
    tagName: (tag || 'div').toUpperCase(), style: {}, children: [], textContent: '',
    className: '', href: '', target: '', rel: '',
    classList: {
      _s: new Set(),
      add () { [].forEach.call(arguments, a => this._s.add(a)); },
      remove () { [].forEach.call(arguments, a => this._s.delete(a)); },
      toggle (a, f) { f ? this._s.add(a) : this._s.delete(a); },
      contains (a) { return this._s.has(a); }
    },
    appendChild (c) { this.children.push(c); return c; },
    remove () {}, setAttribute () {}, getAttribute () { return null; },
    addEventListener () {}, removeEventListener () {}, focus () {}, blur () {},
    querySelector () { return null; }, closest () { return null; }
  };
  return n;
}

const listeners = {};
global.window = {
  innerWidth: 1440, innerHeight: 900,
  addEventListener (k, f) { (listeners[k] || (listeners[k] = [])).push(f); },
  removeEventListener () {},
  requestAnimationFrame () { return 0; },
  matchMedia: () => ({ matches: false, addEventListener () {} }),
  console: console
};
global.document = {
  body: el('body'), createElement: el,
  getElementById: () => el('div'), querySelector: () => null,
  addEventListener () {}, readyState: 'complete'
};
global.requestAnimationFrame = () => 0;
global.performance = { now: () => Date.now() };

// --- load just the tour ------------------------------------------------------
global.window.MM = {};
(0, eval)(fs.readFileSync(path.join(SRC, 'tour.js'), 'utf8'));
const MM = global.window.MM;

let pass = 0;
const fails = [];
function ok (cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label); }
}

console.log('\nMAYOR - tour rehearsal\n');

/* A fake clock, and a fake shell and city for the beats to reach for. Nothing
 * here pretends to BE the game - it records what the tour asked the game to
 * do, which is the only thing this file is testing. */
function rig (opts) {
  opts = opts || {};
  const log = [];
  let clock = 0;

  MM.state = { speed: 0, pending: null, day: 12 };
  MM.renderer = { ox: 0, oy: 0, scale: 1, tileToScreen: () => ({ x: 700, y: 440 }) };
  MM.shell = {
    open: true,
    show (m) { this.open = true; log.push('shell.show:' + m); },
    play () { this.open = false; log.push('shell.play'); },
    rideTo (p) { log.push('ride'); this.p = p; },
    apply (p) { this.p = p; }
  };
  MM.inspect = { open: () => log.push('inspect.open'), close: () => log.push('inspect.close') };
  MM.maybeFireEvent = () => ({ id: 'fake', title: 'A thing happened' });

  global.window.MM_CHAIN = opts.chain === undefined ? null : opts.chain;

  const tour = new MM.Tour({ headless: true, now: () => clock });
  tour.start();
  return {
    log, tour,
    to (sec) { clock = sec * 1000; tour._tick(); return this; }
  };
}

const FULL_CHAIN = {
  currentUser: () => ({ address: '0xabc' }),
  graph: { isConfigured: () => true },
  pushNow: () => {},
  history: () => {}
};

// ---------------------------------------------------------------- the budget
{
  const ids = MM.tour.BEATS.map(b => b.id);
  const ats = MM.tour.BEATS.map(b => b.at);
  ok(new Set(ids).size === ids.length, 'every beat has a distinct id');
  ok(ats.every((v, i) => i === 0 || v >= ats[i - 1]), 'the beat sheet is in time order');
  ok(ats[0] === 0, 'the tour starts at zero');
  ok(Math.max(...ats) <= 300, 'the last beat lands inside five minutes (' + Math.max(...ats) + 's)');
  ok(MM.tour.TOTAL <= 300, 'the advertised total is inside five minutes (' + MM.tour.TOTAL + 's)');
  ok(MM.tour.RIDE_TO > MM.tour.RIDE_FROM, 'the ride has a positive duration');
}

// ------------------------------------------------------- every beat fires, in order
{
  const r = rig({ chain: FULL_CHAIN });
  for (let s = 0; s <= MM.tour.TOTAL + 6; s += 1) r.to(s);
  const want = MM.tour.BEATS.map(b => b.id);
  ok(JSON.stringify(r.tour.fired) === JSON.stringify(want),
    'all ' + want.length + ' beats fired in order (' + r.tour.fired.join(' ') + ')');
  ok(r.log.indexOf('shell.play') >= 0, 'the tour actually enters the city');
  ok(r.log.indexOf('inspect.open') >= 0, 'and opens a parcel by its name');
  ok(!r.tour.running, 'and stops itself at the end');
  ok(r.tour.why === 'done', 'reporting that it finished rather than overran');
}

/* The failure this is really here for. A stage laptop with no wallet and no
   deployed subgraph must still play the whole tour - substituting, never
   erroring - because the demo cannot depend on somebody's inbox. */
{
  const r = rig({ chain: null });
  for (let s = 0; s <= MM.tour.TOTAL + 6; s += 1) r.to(s);
  ok(r.tour.fired.length === MM.tour.BEATS.length, 'with no chain layer at all, every beat still fires');
  ok(r.log.indexOf('shell.play') >= 0, 'and it still enters the city');
  ok(!r.tour.running, 'and still finishes');
}
{
  const r = rig({ chain: { currentUser: () => null, graph: { isConfigured: () => false } } });
  for (let s = 0; s <= MM.tour.TOTAL + 6; s += 1) r.to(s);
  ok(r.tour.fired.length === MM.tour.BEATS.length, 'with a wallet-less chain layer, every beat still fires');
}

// --------------------------------------------------------------- the ride moves
{
  const r = rig({ chain: FULL_CHAIN });
  r.to(MM.tour.RIDE_FROM); const a = MM.shell.p;
  r.to((MM.tour.RIDE_FROM + MM.tour.RIDE_TO) / 2); const b = MM.shell.p;
  r.to(MM.tour.RIDE_TO); const c = MM.shell.p;
  ok(a === 0, 'the ride starts at the first stop');
  ok(b > a && c > b, 'and moves the camera continuously, not in jumps (' +
    [a, b, c].map(x => x.toFixed(2)).join(' -> ') + ')');
  ok(Math.abs(c - 1) < 1e-9, 'and arrives exactly at the last stop');
}

// ------------------------------------------------ a skip at any second is clean
{
  let clean = true, worst = null;
  for (let at = 0; at <= MM.tour.TOTAL; at += 5) {
    const r = rig({ chain: FULL_CHAIN });
    for (let s = 0; s <= at; s += 1) r.to(s);
    r.tour.stop('skipped');
    const s = MM.state;
    if (r.tour.running || s.speed === 0) { clean = false; worst = at; break; }
    r.to(at + 30);                                  // the clock keeps running
    if (r.tour.fired.length && r.tour.running) { clean = false; worst = at; break; }
  }
  ok(clean, 'skipping at any second leaves a running game (' +
    (worst === null ? 'checked every 5s' : 'broke at ' + worst + 's') + ')');
}

// ------------------------------------------------- one broken beat is survivable
{
  const boom = MM.tour.BEATS.map(b => (b.id === 'inspect'
    ? Object.assign({}, b, { run: () => { throw new Error('deliberate'); } }) : b));
  const log = [];
  let clock = 0;
  MM.state = { speed: 0 }; MM.renderer = { ox: 0, oy: 0, scale: 1 };
  MM.shell = { open: true, show () {}, play () { log.push('play'); }, apply () {} };
  MM.inspect = { open () {}, close () {} };
  global.window.MM_CHAIN = FULL_CHAIN;
  const warn = console.warn; console.warn = () => {};
  const t = new MM.Tour({ headless: true, now: () => clock, beats: boom }).start();
  for (let s = 0; s <= MM.tour.TOTAL + 6; s += 1) { clock = s * 1000; t._tick(); }
  console.warn = warn;
  ok(t.fired.length === boom.length, 'a beat that throws does not end the tour');
}

console.log('\n' + pass + ' passing' + (fails.length ? ', ' + fails.length + ' FAILING' : '') + '\n');
if (fails.length) process.exit(1);

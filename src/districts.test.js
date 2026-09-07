/* node src/districts.test.js - no framework, no deps. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window = { MM: {} };

const load = f => (0, eval)(fs.readFileSync(path.join(__dirname, f), 'utf8'));
load('state.js');
load('districts.js');
const MM = global.window.MM;
const D = MM.districts, T = MM.TILE, G = MM.GRID;

let passed = 0;
function test (name, fn) { fn(); passed++; console.log('  ok  ' + name); }

/* The branches exactly as demo.js:73-85 has them, minus the level roll. If
 * districts.js ever drifts from the map the city is actually generated on,
 * this is what catches it - the regions overlap on purpose, so the ORDER of
 * these tests is the whole definition. */
function zoneAtOriginal (x, y) {
  if (y >= 36) { if (x >= 16) return 'wharves'; return 'redhook'; }
  if (x >= 31) return 'riverside';
  if (x >= 16 && y >= 11 && y <= 29) return 'downtown';
  if (x >= 11 && y >= 11 && y <= 34) return 'midtown';
  if (y >= 30) return 'southside';
  if (y <= 5) return 'airfield';
  if (x >= 16) return 'uptown';
  return 'westside';
}

test('at() reproduces demo.js zoneAt geometry on all 2304 tiles', () => {
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const got = D.LIST[D.at(x, y)].key;
      const want = zoneAtOriginal(x, y);
      assert.strictEqual(got, want, `(${x},${y}): got ${got}, want ${want}`);
    }
  }
});

test('the partition is total - every tile lands in exactly one district', () => {
  const seen = new Array(D.LIST.length).fill(0);
  for (let i = 0; i < G * G; i++) {
    const d = D.map[i];
    assert.ok(d >= 0 && d < D.LIST.length, 'tile ' + i + ' -> bad district ' + d);
    seen[d]++;
  }
  assert.strictEqual(seen.reduce((a, b) => a + b, 0), G * G);
  seen.forEach((n, i) => assert.ok(n > 0, D.LIST[i].key + ' claims no tiles'));
});

test('every district has a distinct key, id and ENS name under one root', () => {
  const keys = new Set(), ids = new Set(), ens = new Set();
  D.LIST.forEach((d, i) => {
    assert.strictEqual(d.id, i, d.key + ' id does not match its index');
    assert.strictEqual(d.ens, d.key + '.' + D.ROOT);
    keys.add(d.key); ids.add(d.id); ens.add(d.ens);
  });
  assert.strictEqual(keys.size, D.LIST.length);
  assert.strictEqual(ids.size, D.LIST.length);
  assert.strictEqual(ens.size, D.LIST.length);
});

test('stats() survives a missing or empty state - it runs before the sim does', () => {
  [undefined, null, {}, { grid: null }].forEach(s => {
    const r = D.stats(s);
    assert.strictEqual(r.length, D.LIST.length);
    r.forEach(d => { assert.strictEqual(d.nav, 0); assert.strictEqual(d.built, 0); });
  });
});

test('the opening city already has value, and it straddles three districts', () => {
  // seedTerrain (state.js:76) lays a starter block at x=10..19, y=20..24, which
  // crosses midtown, downtown and the westside edge. The city is never blank.
  const by = {};
  D.stats(MM.createState()).forEach(d => { by[d.key] = d; });
  assert.ok(by.downtown.built > 0, 'starter block should reach downtown');
  assert.ok(by.midtown.built > 0, 'starter block should reach midtown');
  assert.ok(by.airfield.built === 0, 'nothing is built by the airport on day 1');
});

test('stats() prices a built city: NAV tracks land value and density', () => {
  const s = MM.createState();
  s.grid.fill(0); s.level.fill(0); s.pow.fill(0);   // testing the arithmetic, not the seed
  // one dense, valuable block downtown; one thin, cheap one out by the airport
  const rich = [], poor = [];
  for (let y = 14; y < 20; y++) for (let x = 20; x < 26; x++) rich.push(MM.idx(x, y));
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) poor.push(MM.idx(x, y));
  rich.forEach(i => { s.grid[i] = T.COM; s.level[i] = 4; s.pow[i] = 200; });
  poor.forEach(i => { s.grid[i] = T.RES; s.level[i] = 1; s.pow[i] = 40; });

  const by = {};
  D.stats(s).forEach(d => { by[d.key] = d; });

  assert.strictEqual(by.downtown.built, rich.length, 'downtown tile count');
  assert.strictEqual(by.airfield.built, poor.length, 'airfield tile count');
  assert.ok(by.downtown.nav > by.airfield.nav * 10, 'dense valuable block should dwarf the thin one');
  assert.strictEqual(by.downtown.land, 200, 'mean land value');
  assert.strictEqual(by.downtown.level, 4, 'mean level');

  // 36 tiles * 200 value * (1 + level 4) * 0.25
  assert.strictEqual(by.downtown.nav, Math.round(36 * 200 * 5 * D.NAV_SCALE));

  D.stats(s).forEach(d => {
    assert.ok(Number.isFinite(d.nav) && d.nav >= 0, d.key + ' NAV not a sane number: ' + d.nav);
  });
});

test('NAV moves when the city does - the number the sidebar watches', () => {
  const s = MM.createState();
  s.grid.fill(0); s.level.fill(0); s.pow.fill(0);
  for (let y = 14; y < 20; y++) for (let x = 20; x < 26; x++) {
    const i = MM.idx(x, y); s.grid[i] = T.COM; s.level[i] = 2; s.pow[i] = 90;
  }
  const before = D.stats(s)[0].nav;
  for (let y = 14; y < 20; y++) for (let x = 20; x < 26; x++) s.pow[MM.idx(x, y)] = 140;
  const after = D.stats(s)[0].nav;
  assert.ok(after > before, 'land value rose but NAV did not: ' + before + ' -> ' + after);
});

test('setRoot() renames every district - testnet name now, real one later', () => {
  const original = D.ROOT;
  try {
    D.setRoot('mm-7f3a1c.eth');
    assert.strictEqual(D.ROOT, 'mm-7f3a1c.eth');
    D.LIST.forEach(d => assert.strictEqual(d.ens, d.key + '.mm-7f3a1c.eth'));
    assert.strictEqual(D.stats(MM.createState())[0].ens, 'downtown.mm-7f3a1c.eth');

    D.setRoot('  .trimmed.eth. ');   // stray dots and space are the caller's problem, not ours
    assert.strictEqual(D.ROOT, 'trimmed.eth');

    D.setRoot('');                   // empty must never wipe the root
    assert.strictEqual(D.ROOT, 'trimmed.eth');
    D.setRoot(null);
    assert.strictEqual(D.ROOT, 'trimmed.eth');
  } finally {
    D.setRoot(original);
  }
  assert.strictEqual(D.ROOT, original);
  D.LIST.forEach(d => assert.strictEqual(d.ens, d.key + '.' + original));
});

console.log('\n' + passed + ' passing\n');

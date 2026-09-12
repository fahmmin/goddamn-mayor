/* node src/ens.test.js - no framework, no deps.
 *
 * The namespace has exactly two properties worth defending, and both are the
 * kind that pass by eye and fail in production:
 *
 *   UNIQUE  - two parcels must never derive the same label. A registry where
 *             two things answer to one name is not a registry.
 *   STABLE  - the same world must derive the same names every time, on every
 *             machine, forever. Nothing is stored, so derivation IS the
 *             storage; the moment it drifts, every name in the city changes.
 *
 * The address scheme claims uniqueness by construction (hundred-block from the
 * row, doubled column within it). This checks the construction rather than
 * trusting the argument, across all 2304 origins.
 */
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
['state.js', 'districts.js', 'gfx.js', 'materials.js', 'audio.js', 'policies.js',
  'events.js', 'sim.js', 'ground.js', 'roofs.js', 'props.js', 'lots.js', 'ens.js'].forEach(load);

const MM = global.window.MM;
const E = MM.ens, T = MM.TILE, G = MM.GRID;

let passed = 0;
function test (name, fn) { fn(); passed++; console.log('  ok  ' + name); }

/* A city with something in it: the seeded starter block, grown. */
function city () {
  const s = MM.createState();
  for (let y = 8; y < 30; y++) {
    for (let x = 6; x < 26; x++) {
      const i = y * G + x;
      if (s.grid[i] === T.WATER) continue;
      if (y % 5 === 0 || x % 6 === 0) { s.grid[i] = T.ROAD; continue; }
      s.grid[i] = (x % 3 === 0) ? T.COM : (x % 7 === 0 ? T.IND : T.RES);
      s.level[i] = 1 + ((x + y) % 4);
      s.pow[i] = 60 + ((x * 7 + y * 13) % 160);
    }
  }
  s.rev = (s.rev | 0) + 1;
  return s;
}

/* lots.plan() caches on s.rev, so a fixture that wants a FRESH plan has to
   say so - otherwise the second city silently reuses the first city's lots
   and the stability test proves nothing. */
let rev = 100;
function freshCity () { const s = city(); s.rev = ++rev; return s; }

/* The first tile that is actually part of a lot. Hardcoding a coordinate is
   how this file broke the first time: the fixture's road grid moves whenever
   the fixture does. */
function anyParcel (s, min) {
  for (let y = 8; y < 30; y++) {
    for (let x = 6; x < 26; x++) {
      const q = E.parcel(s, x, y);
      if (q && (!min || q.homes >= min)) return q;
    }
  }
  return null;
}

test('every parcel label on a street is unique across the whole grid', () => {
  const seen = new Map();
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const label = E.parcelLabel(x, y);
      assert.ok(!seen.has(label),
        'collision: ' + label + ' claimed by ' + JSON.stringify(seen.get(label)) +
        ' and by ' + JSON.stringify([x, y]));
      seen.set(label, [x, y]);
    }
  }
  assert.strictEqual(seen.size, G * G);
});

test('a label is a legal ENS label - lowercase, no dots, no leading hyphen', () => {
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const l = E.parcelLabel(x, y);
      assert.ok(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(l), 'illegal label: ' + l);
    }
  }
});

test('house numbers count up through the blocks, like real addressing', () => {
  // same street-row, further east = higher number; one row north = next hundred
  const a = parseInt(E.parcelLabel(4, 10), 10);
  const b = parseInt(E.parcelLabel(9, 10), 10);
  const c = parseInt(E.parcelLabel(4, 11), 10);
  assert.ok(b > a, 'east should count up');
  assert.ok(Math.floor(c / 100) === Math.floor(a / 100) + 1, 'north is the next hundred block');
});

test('derivation is stable: the same parcel names the same thing twice', () => {
  const s = freshCity();
  const p1 = anyParcel(s);
  const s2 = freshCity();
  const p2 = E.parcel(s2, p1.x0, p1.y0);
  assert.ok(p1 && p2, 'the fixture grew no lots');
  assert.strictEqual(p1.name, p2.name);
  assert.strictEqual(p1.address, p2.address);
});

test('a parcel name nests under its district, which nests under the root', () => {
  const s = freshCity();
  const p = anyParcel(s);
  assert.ok(p, 'the fixture grew no lots');
  assert.ok(p.district, 'expected a district');
  assert.strictEqual(p.name, p.label + '.' + p.district.ens);
  assert.ok(p.district.ens.endsWith('.' + MM.districts.ROOT.split('.').slice(-2).join('.')) ||
    p.district.ens.endsWith(MM.districts.ROOT));
  // cityhall.eth -> downtown.cityhall.eth -> the parcel. The bare TLD is
  // not a name this city owns, and lineage() is right to leave it out.
  assert.deepStrictEqual(E.lineage(p.name),
    [MM.districts.ROOT, p.district.ens, p.name]);
});

test('every tile of a multi-tile lot resolves to ONE parcel name', () => {
  const s = freshCity();
  let checked = 0;
  for (let y = 8; y < 30; y++) {
    for (let x = 6; x < 26; x++) {
      const L = MM.lots.lotOf(s, x, y);
      if (!L || L.w * L.h < 2) continue;
      const a = E.parcel(s, L.x0, L.y0), b = E.parcel(s, L.x1, L.y1);
      assert.strictEqual(a.name, b.name, 'lot at ' + L.x0 + ',' + L.y0 + ' named twice');
      checked++;
    }
  }
  assert.ok(checked > 0, 'the fixture grew no multi-tile lots to check');
});

test('no two residents of one building share a name', () => {
  const s = freshCity();
  // a building big enough to exercise the permutation walk
  const p = anyParcel(s, E.MAX_ROLL);
  assert.ok(p, 'the fixture grew no building big enough to roll a full roster');
  const roll = E.residents(s, p);
  const names = new Set(roll.list.map(r => r.name));
  assert.strictEqual(names.size, roll.list.length, 'duplicate resident names in ' + p.name);
  roll.list.forEach(r => assert.ok(r.name.endsWith('.' + p.name), 'resident not under its parcel'));
  assert.deepStrictEqual(E.lineage(roll.list[0].name),
    [MM.districts.ROOT, p.district.ens, p.name, roll.list[0].name]);
});

test('a resident roll is stable under its cap - raising it renames nobody', () => {
  const s = freshCity();
  const p = anyParcel(s, 8);
  assert.ok(p, 'the fixture grew no building with eight homes');
  const few = E.residents(s, p, 3).list;
  const many = E.residents(s, p, 8).list;
  few.forEach((r, i) => assert.strictEqual(r.name, many[i].name,
    'resident ' + i + ' was renamed by widening the roll'));
});

test('capacity is read from the simulation, not from a copy of it', () => {
  const s = freshCity();
  // one plain RES tile, alone, at a known level
  for (let i = 0; i < s.grid.length; i++) { s.grid[i] = T.EMPTY; s.level[i] = 0; }
  s.grid[20 * G + 20] = T.RES; s.level[20 * G + 20] = 3;
  s.rev = ++rev;
  const p = E.parcel(s, 20, 20);
  assert.strictEqual(p.homes, MM.sim.K.RES_CAP[3],
    'homes must come from MM.sim.K.RES_CAP, so tuning the sim moves the panel');
});

test('street agents are named by id, so a walk never renames anybody', () => {
  const s = freshCity();
  const home = anyParcel(s, 1);
  assert.ok(home, 'the fixture grew nowhere to live');
  const walker = { id: 41, kind: 2, x: home.x0, y: home.y0, home: { x: home.x0, y: home.y0 } };
  const a = E.agent(s, walker);
  walker.x = 19; walker.y = 22;                  // they walked
  assert.strictEqual(E.agent(s, walker).name, a.name);
  assert.ok(a.name.endsWith('.' + home.name), 'walker should hang off their building: ' + a.name);
});

test('a walker with no building still gets a name, one level up', () => {
  const s = freshCity();
  const stray = { id: 7, kind: 2, x: 44, y: 3, home: { x: -1, y: -1 } };
  const a = E.agent(s, stray);
  assert.strictEqual(a.tenure, 'citizen');
  assert.strictEqual(E.lineage(a.name).length, 3);   // root, district, the citizen
});

test('cabs and buses are licensed by the city, not by a district', () => {
  const s = freshCity();
  const cab = E.agent(s, { id: 3, kind: 0, x: 12, y: 12 });
  const bus = E.agent(s, { id: 4, kind: 1, x: 12, y: 12 });
  assert.ok(cab.name.endsWith('.' + E.fleetRoot()), cab.name);
  assert.ok(bus.name.endsWith('.' + E.transitRoot()), bus.name);
  assert.ok(/^[a-z]+[0-9]+$/.test(bus.label), 'route should read like a route: ' + bus.label);
  assert.notStrictEqual(cab.name, E.agent(s, { id: 4, kind: 0, x: 12, y: 12 }).name);
});

test('onchain() names the district registry when the chain layer is loaded', () => {
  const s = freshCity();
  const p = anyParcel(s);
  assert.strictEqual(E.onchain(p).registry, null, 'no chain config: no invented address');

  MM.chainCfg = {
    chainId: 11155111, root: 'cityhall.eth',
    districts: MM.districts.LIST.map(d => ({ key: d.key, ens: d.ens, registry: '0xreg' + d.id }))
  };
  const oc = E.onchain(p);
  assert.strictEqual(oc.registry, '0xreg' + p.district.id);
  assert.strictEqual(oc.parent, p.district.ens);
  assert.ok(oc.live);
  delete MM.chainCfg;
});

test('setRoot() renames the whole namespace, parcels and people included', () => {
  const s = freshCity();
  const before = anyParcel(s);
  MM.districts.setRoot('testcity.eth');
  const after = E.parcel(s, before.x0, before.y0);
  assert.strictEqual(after.label, before.label, 'the parcel itself did not move');
  assert.ok(after.name.endsWith('.testcity.eth'), after.name);
  assert.ok(E.residents(s, after).list.every(r => r.name.endsWith('.testcity.eth')));
  MM.districts.setRoot('cityhall.eth');
});

console.log('\n' + passed + ' passing\n');

/* node src/sim.test.js - no framework, no deps. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- host stubs (classic scripts expect a browser) --------------------------
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window = { MM: {} };

const load = f => (0, eval)(fs.readFileSync(path.join(__dirname, f), 'utf8'));
load('state.js');
load('sim.js');
const MM = global.window.MM;

// --- stubs for files this agent does not own --------------------------------
MM.POLICIES = [];
MM.hasPolicy = (s, id) => !!(s && s.policies && s.policies[id]);
MM.policyDailyCost = () => 0;
MM.maybeFireEvent = () => null;

const T = MM.TILE, G = MM.GRID;
const put = (s, x, y, t, lvl) => {
  const i = MM.idx(x, y);
  s.grid[i] = t;
  s.level[i] = lvl === undefined ? (MM.ZONES.indexOf(t) >= 0 ? 1 : 0) : lvl;
  s.treasury -= MM.TILE_INFO[t] ? MM.TILE_INFO[t].cost : 0;
};
const blank = () => {
  const s = MM.createState();
  s.grid.fill(0); s.level.fill(0);          // wipe river + starter block
  return s;
};
const days = (s, n) => { for (let d = 0; d < n * MM.TICKS_PER_DAY; d++) MM.sim.step(s); };

let passed = 0;
function test (name, fn) { fn(); passed++; console.log('  ok  ' + name); }

console.log('\nMAYOR MAMDANI - sim tests\n');

// ---------------------------------------------------------------------------
test('no road access = no growth, ever', () => {
  const s = blank();
  for (let x = 4; x < 10; x++) for (let y = 4; y < 10; y++) put(s, x, y, T.RES);
  for (let x = 4; x < 10; x++) for (let y = 12; y < 16; y++) put(s, x, y, T.COM);
  put(s, 20, 20, T.PARK); put(s, 21, 20, T.PARK); put(s, 20, 21, T.PARK);
  s.treasury = 1e6;
  days(s, 120);
  for (let x = 4; x < 10; x++) for (let y = 4; y < 10; y++) {
    assert.strictEqual(s.level[MM.idx(x, y)], 1, 'roadless RES leveled up at ' + x + ',' + y);
  }
});

test('road-adjacent tiles DO grow (control for the test above)', () => {
  const s = blank();
  for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) {
    put(s, x, y, (x % 4 === 0) ? T.ROAD : (x % 4 === 1 || x % 4 === 2) ? T.RES : T.COM);
  }
  s.treasury = 1e6;
  days(s, 60);
  let grew = 0;
  for (let i = 0; i < s.level.length; i++) if (s.level[i] > 1) grew++;
  assert.ok(grew > 20, 'expected roaded zones to level up, got ' + grew);
});

test('res + com + roads grows population over 100 days', () => {
  const s = blank();
  // 16x16 district, road every 4th column, two parts housing to one part shops
  for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) {
    put(s, x, y, (x % 4 === 2) ? T.ROAD : (x % 4 === 3 ? T.COM : T.RES));
  }
  s.treasury = 1e6;
  const p0 = s.pop;
  days(s, 100);
  assert.ok(s.pop > p0 + 400, 'population did not grow: ' + p0 + ' -> ' + s.pop);
  assert.ok(s.jobs > 0, 'no jobs');
});

test('over-zoned residential with no commercial stalls', () => {
  const a = blank(), b = blank();
  for (const s of [a, b]) {
    for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) put(s, x, y, (x % 4 === 2) ? T.ROAD : T.RES);
    s.treasury = 1e6;
  }
  // b swaps every third strip for commercial
  for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) if (x % 4 === 3) put(b, x, y, T.COM);
  days(a, 80); days(b, 80);
  const above1 = s => { let n = 0; for (let i = 0; i < s.level.length; i++) if (s.grid[i] === T.RES && s.level[i] > 1) n++; return n; };
  assert.ok(above1(a) < above1(b) * 0.2, 'all-res should stall: ' + above1(a) + ' vs mixed ' + above1(b));
  assert.ok(b.pop > a.pop * 1.4, 'jobs should unlock housing demand: allRes=' + a.pop + ' mixed=' + b.pop);
  console.log('      all-res pop=' + a.pop + ' (lv2+ ' + above1(a) + ')   mixed pop=' + b.pop + ' (lv2+ ' + above1(b) + ')');
});

test('zero income + standing upkeep drains the treasury', () => {
  const s = blank();
  for (let x = 2; x < 30; x++) put(s, x, 10, T.ROAD);
  for (let x = 2; x < 12; x++) put(s, x, 12, T.PARK);
  s.treasury = 5000;
  const t0 = s.treasury;
  days(s, 50);
  assert.strictEqual(s.dailyIncome, 0, 'no zones should mean no tax');
  assert.ok(s.dailyCost > 0, 'upkeep should be positive');
  assert.ok(s.treasury < t0 - 500, 'treasury did not drain: ' + t0 + ' -> ' + s.treasury);
});

test('rent rises when housing is scarce; rentFreeze holds it flat', () => {
  const mk = () => {
    const s = blank();
    // lots of jobs, almost no housing
    for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) {
      put(s, x, y, (x % 4 === 2) ? T.ROAD : T.COM, 3);
    }
    put(s, 7, 24, T.RES); put(s, 8, 24, T.RES);
    s.treasury = 1e6;
    return s;
  };
  const free = mk(), frozen = mk();
  frozen.policies.rentFreeze = true;
  const r0 = free.rent;
  days(free, 40); days(frozen, 40);
  assert.ok(free.rent > r0 + 8, 'rent should climb under scarcity: ' + r0 + ' -> ' + free.rent);
  assert.ok(frozen.rent < r0 + 2, 'rentFreeze should pin rent: ' + r0 + ' -> ' + frozen.rent);
  console.log('      rent free=' + free.rent.toFixed(1) + '  frozen=' + frozen.rent.toFixed(1));
});

test('social housing pushes rent down', () => {
  const mk = tower => {
    const s = blank();
    for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) {
      put(s, x, y, (x % 4 === 2) ? T.ROAD : T.COM, 3);
    }
    for (let x = 6; x < 22; x++) if (x % 4 !== 2) put(s, x, 24, tower ? T.TOWER : T.RES, tower ? 0 : 1);
    s.treasury = 1e6;
    return s;
  };
  const plain = mk(false), social = mk(true);
  days(plain, 40); days(social, 40);
  assert.ok(social.rent < plain.rent, 'towers should undercut rent: ' + social.rent.toFixed(1) + ' vs ' + plain.rent.toFixed(1));
});

test('high taxes choke business growth', () => {
  const mk = rate => {
    const s = blank();
    for (let y = 6; y < 22; y++) for (let x = 6; x < 22; x++) {
      put(s, x, y, (x % 4 === 2) ? T.ROAD : (x % 4 === 3 ? T.COM : T.RES));
    }
    s.taxRate.com = rate;
    s.treasury = 1e6;
    return s;
  };
  const sane = mk(11), gouging = mk(20);
  days(sane, 60); days(gouging, 60);
  assert.ok(sane.jobs > gouging.jobs * 1.5, 'a 20% rate should stall commerce: ' + sane.jobs + ' vs ' + gouging.jobs);
});

test('400 days: nothing goes NaN, approval stays in 0..100', () => {
  const s = MM.createState();               // keep river + starter block
  for (let y = 18; y < 30; y++) for (let x = 6; x < 26; x++) {
    if (s.grid[MM.idx(x, y)] === T.WATER) continue;
    put(s, x, y, (y % 4 === 2) ? T.ROAD : (x < 16 ? T.RES : T.COM));
  }
  put(s, 8, 30, T.IND); put(s, 9, 30, T.IND); put(s, 10, 30, T.PARK);
  s.taxRate.res = 18; s.taxRate.com = 22;   // abusive, on purpose
  for (let d = 0; d < 400 * MM.TICKS_PER_DAY; d++) {
    MM.sim.step(s);
    if (d % 240 === 0) {
      for (const k of ['pop', 'jobs', 'employed', 'treasury', 'approval', 'rent', 'traffic', 'happiness', 'pollution', 'ridership', 'dailyIncome', 'dailyCost']) {
        assert.ok(Number.isFinite(s[k]), k + ' is not finite: ' + s[k]);
      }
      assert.ok(s.approval >= 0 && s.approval <= 100, 'approval out of range: ' + s.approval);
      assert.ok(s.traffic >= 0 && s.traffic <= 100, 'traffic out of range: ' + s.traffic);
      assert.ok(s.pop >= 0, 'negative pop');
      const d2 = MM.sim.derive(s);
      assert.ok(Number.isFinite(d2.unemployment) && Number.isFinite(d2.netDaily), 'derive returned NaN');
      assert.ok(typeof d2.rentLabel === 'string' && typeof d2.approvalLabel === 'string');
    }
  }
  for (let i = 0; i < s.pow.length; i++) assert.ok(s.pow[i] >= 0 && s.pow[i] <= 255);
});

test('step never throws on a garbage-ish state', () => {
  const s = MM.createState();
  s.taxRate = { res: NaN, com: undefined, ind: 999 };
  s.rent = NaN; s.treasury = NaN; s.approval = NaN; s.pop = NaN;
  days(s, 5);
  assert.ok(Number.isFinite(s.approval) && Number.isFinite(s.rent), 'sim did not recover from NaN input');
});

test('game over fires: bankrupt city gets a control board', () => {
  const s = blank();
  for (let x = 2; x < 40; x++) for (let y = 2; y < 12; y++) put(s, x, y, T.CLINIC);
  s.treasury = 0;
  days(s, 60);
  assert.ok(s.gameOver && s.gameOver.reason === 'bankrupt', 'expected bankruptcy, got ' + JSON.stringify(s.gameOver));
});

// ---------------------------------------------------------------------------
test('BALANCE: a sensible starter city at day 40', () => {
  const s = MM.createState();               // river + starter block intact
  // grid of roads over a 26x22 area
  for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++) {
    if (s.grid[MM.idx(x, y)] === T.WATER) continue;
    if (y % 5 === 4 || x % 5 === 1) put(s, x, y, T.ROAD);
  }
  // zone the blocks: res west, com middle, ind south-east pocket
  for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++) {
    const i = MM.idx(x, y);
    if (s.grid[i] !== T.EMPTY) continue;
    if (y >= 32 && x >= 24) put(s, x, y, T.IND);
    else if (x >= 20) put(s, x, y, T.COM);
    else put(s, x, y, T.RES);
  }
  // amenities
  [[9, 17], [16, 22], [24, 18], [12, 29], [22, 31], [28, 24]].forEach(p => put(s, p[0], p[1], T.PARK));
  [[13, 16], [18, 27], [26, 21]].forEach(p => put(s, p[0], p[1], T.BUS));
  put(s, 11, 22, T.GROCERY); put(s, 21, 28, T.GROCERY);
  put(s, 14, 33, T.SCHOOL); put(s, 23, 16, T.SCHOOL);
  put(s, 17, 19, T.CLINIC);
  put(s, 9, 26, T.CHILDCARE);

  console.log('      built city, treasury after construction: $' + Math.round(s.treasury));
  console.log('      day   pop   treasury  approval  rent  traffic  jobs');
  const row = () => console.log('      ' + String(s.day).padStart(3) + String(s.pop).padStart(7) +
    String(Math.round(s.treasury)).padStart(11) + String(Math.round(s.approval)).padStart(9) +
    String(Math.round(s.rent)).padStart(7) + String(Math.round(s.traffic)).padStart(8) +
    String(s.jobs).padStart(7));
  row();
  for (let d = 0; d < 40; d++) { days(s, 1); if (s.day % 10 === 1) row(); }
  row();

  assert.ok(s.pop >= 3000 && s.pop <= 9000, 'day-40 population out of band: ' + s.pop);
  assert.ok(s.treasury >= 0, 'sensible city went broke: ' + Math.round(s.treasury));
  assert.ok(!s.gameOver, 'sensible city ended early: ' + JSON.stringify(s.gameOver));
  assert.ok(s.approval > 35, 'approval collapsed: ' + s.approval.toFixed(1));

  // and it should not run away to infinity either
  days(s, 160);
  console.log('      day 200:  pop=' + s.pop + '  treasury=$' + Math.round(s.treasury) +
    '  approval=' + Math.round(s.approval) + '  rent=' + Math.round(s.rent));
  assert.ok(s.treasury < 5e6, 'treasury ran away: ' + s.treasury);
  assert.ok(Number.isFinite(s.pop));
});

console.log('\n' + passed + ' passing\n');

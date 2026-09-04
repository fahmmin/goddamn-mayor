/* Growth diagnostic: builds the smoke layout, runs N days, and prints WHY
   tiles are or aren't levelling — land value vs NEED, demand vs DEM.
   Run: node tools/diag.js [days]                                            */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, configurable: true });
for (const f of ['state.js', 'policies.js', 'events.js', 'sim.js']) {
  (0, eval)(fs.readFileSync(path.join(SRC, f), 'utf8'));
}
const MM = global.window.MM;
const T = MM.TILE, G = MM.GRID;

const s = MM.createState();
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

const DAYS = parseInt(process.argv[2] || '120', 10);
function snapshot (label) {
  const lv = { RES: [0, 0, 0, 0, 0], COM: [0, 0, 0, 0, 0], IND: [0, 0, 0, 0, 0] };
  let pvSum = 0, pvN = 0, pvMax = 0;
  for (let i = 0; i < s.grid.length; i++) {
    const t = s.grid[i], L = s.level[i];
    const k = t === T.RES ? 'RES' : t === T.COM ? 'COM' : t === T.IND ? 'IND' : null;
    if (!k) continue;
    lv[k][L]++;
    pvSum += s.pow[i]; pvN++; pvMax = Math.max(pvMax, s.pow[i]);
  }
  const d = typeof MM.sim.derive === 'function' ? MM.sim.derive(s) : {};
  console.log(
    label.padEnd(9) +
    ' pop ' + String(Math.round(s.pop)).padStart(6) +
    ' jobs ' + String(s.jobs).padStart(5) +
    ' $' + String(Math.round(s.treasury)).padStart(8) +
    ' | landvalue avg ' + String(Math.round(pvSum / Math.max(1, pvN))).padStart(3) +
    ' max ' + String(pvMax).padStart(3) +
    ' | R ' + lv.RES.join('/') + '  C ' + lv.COM.join('/') + '  I ' + lv.IND.join('/') +
    (d.demand ? ' | dem r' + d.demand.r.toFixed(2) + ' c' + d.demand.c.toFixed(2) + ' i' + d.demand.i.toFixed(2) : '')
  );
}

console.log('\nNEED (land value to reach level): ' + JSON.stringify([0, 0, 44, 88, 136]));
console.log('level histogram is count at level 0/1/2/3/4\n');
snapshot('day 1');
for (let d = 0; d < DAYS; d++) {
  for (let t = 0; t < MM.TICKS_PER_DAY; t++) MM.sim.step(s);
  if (s.pending) { s.pending = null; }        // ignore events, we want pure growth
  if ((d + 1) % 15 === 0) snapshot('day ' + (d + 1));

  // Halfway through, play the game: the mayor answers the plateau with
  // services and more housing. Growth MUST resume, or the core loop is broken.
  if (d === Math.floor(DAYS / 2)) {
    console.log('  -- mayor intervenes: parks, school, clinics, grocery, more zoning --');
    s.grid[MM.idx(6, 13)] = T.PARK;   s.grid[MM.idx(11, 9)] = T.PARK;
    s.grid[MM.idx(16, 13)] = T.PARK;  s.grid[MM.idx(6, 17)] = T.SCHOOL;
    s.grid[MM.idx(11, 17)] = T.CLINIC; s.grid[MM.idx(16, 17)] = T.GROCERY;
    s.grid[MM.idx(21, 13)] = T.CHILDCARE; s.grid[MM.idx(14, 21)] = T.BUS;
    paint(T.RES, 4, 13, 2, 3); paint(T.RES, 19, 5, 4, 3); paint(T.RES, 24, 9, 4, 3);
    paint(T.COM, 24, 21, 4, 3);
    s.treasury += 8000;
  }
}
console.log('');

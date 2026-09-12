/* SHARED CONTRACT - single source of truth. Owned by lead. Module agents must NOT edit this file. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const GRID = 48;                 // 48x48 tiles
  const TICKS_PER_DAY = 24;        // 1 tick = 1 game hour

  const TILE = {
    EMPTY: 0, WATER: 1, ROAD: 2, RES: 3, COM: 4, IND: 5, PARK: 6,
    BUS: 7, GROCERY: 8, CHILDCARE: 9, CLINIC: 10, SCHOOL: 11, TOWER: 12,
    // Appended, never renumbered: a saved grid is raw tile ids, so the only
    // safe way to add a tile is on the end. Old saves simply contain none.
    RAIL: 13, STATION: 14,
    BULLDOZE: 99
  };

  // cost = one-off build cost. upkeep = $/day.
  const TILE_INFO = {
    [TILE.ROAD]:      { name: 'Road',           cost: 10,  upkeep: 0.22, key: '1', hue: 0,   glyph: '=' },
    [TILE.RES]:       { name: 'Residential',    cost: 90,  upkeep: 1.0,  key: '2', hue: 145, glyph: 'R' },
    [TILE.COM]:       { name: 'Commercial',     cost: 130, upkeep: 1.6,  key: '3', hue: 205, glyph: 'C' },
    [TILE.IND]:       { name: 'Industrial',     cost: 170, upkeep: 2.2,  key: '4', hue: 40,  glyph: 'I' },
    [TILE.PARK]:      { name: 'Park',           cost: 60,  upkeep: 1.8,  key: '5', hue: 110, glyph: 'P' },
    [TILE.BUS]:       { name: 'Bus Stop',       cost: 240, upkeep: 5.0,  key: '6', hue: 20,  glyph: 'B' },
    [TILE.GROCERY]:   { name: 'City Grocery',   cost: 420, upkeep: 9.0,  key: '7', hue: 330, glyph: 'G' },
    [TILE.CHILDCARE]: { name: 'Childcare',      cost: 520, upkeep: 11.0, key: '8', hue: 280, glyph: 'K' },
    [TILE.CLINIC]:    { name: 'Public Clinic',  cost: 680, upkeep: 14.0, key: '9', hue: 0,   glyph: 'H' },
    [TILE.SCHOOL]:    { name: 'Public School',  cost: 600, upkeep: 12.0, key: 's', hue: 50,  glyph: 'S' },
    [TILE.TOWER]:     { name: 'Social Housing', cost: 900, upkeep: 16.0, key: 't', hue: 175, glyph: 'M' },
    [TILE.RAIL]:      { name: 'Rail Track',      cost: 45,  upkeep: 0.9,  key: 'r', hue: 265, glyph: '#' },
    [TILE.STATION]:   { name: 'Rail Station',    cost: 1100, upkeep: 20.0, key: 'e', hue: 265, glyph: 'E' },
    [TILE.BULLDOZE]:  { name: 'Bulldoze',       cost: 4,   upkeep: 0,    key: '0', hue: 0,   glyph: 'X' }
  };

  const BUILDABLE = [TILE.ROAD, TILE.RAIL, TILE.STATION, TILE.RES, TILE.COM, TILE.IND,
    TILE.PARK, TILE.BUS, TILE.GROCERY, TILE.CHILDCARE, TILE.CLINIC, TILE.SCHOOL,
    TILE.TOWER, TILE.BULLDOZE];

  const ZONES = [TILE.RES, TILE.COM, TILE.IND];
  const SERVICES = [TILE.BUS, TILE.STATION, TILE.GROCERY, TILE.CHILDCARE, TILE.CLINIC, TILE.SCHOOL, TILE.PARK];

  const idx = (x, y) => y * GRID + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

  function createState () {
    const n = GRID * GRID;
    const s = {
      version: 1,
      tick: 9, day: 1,          // open mid-morning, not at midnight
      speed: 1,                 // 0 paused, 1 normal, 2 fast, 3 turbo
      grid: new Uint8Array(n),  // TILE.*
      level: new Uint8Array(n), // 0..4 growth level of a zoned tile
      pow: new Uint8Array(n),   // 0..255 land value / desirability heatmap (sim writes, render reads)

      pop: 0, jobs: 0, employed: 0,
      // Enough to actually lay a first district (~350 tiles). At 12k the mayor
      // was underwater before day 1, which trips the broke-city growth penalty
      // and quietly strangles the opening.
      treasury: 60000,
      approval: 62,             // %
      rent: 100,                // rent index, 100 = baseline
      traffic: 0,               // 0..100
      happiness: 60,            // 0..100
      pollution: 0,             // 0..100
      ridership: 0,             // daily bus riders
      dailyIncome: 0, dailyCost: 0,
      taxRate: { res: 9, com: 11, ind: 12 },  // percent

      policies: {},             // id -> true
      log: [],                  // {day, text, kind}
      pending: null,            // active modal event
      selected: TILE.ROAD,
      streak: 0,
      termDay: 1461,            // 4 year term
      gameOver: null,
      cooldowns: {}             // eventId -> day it may fire again
    };
    seedTerrain(s);
    return s;
  }

  // A river plus one starter block, so the city never opens on a blank void.
  function seedTerrain (s) {
    for (let y = 0; y < GRID; y++) {
      const cx = Math.round(GRID * 0.74 + Math.sin(y * 0.28) * 3.2 + Math.sin(y * 0.07) * 4);
      for (let x = cx; x < Math.min(GRID, cx + 4); x++) s.grid[idx(x, y)] = TILE.WATER;
    }
    const bx = 10, by = 20;
    for (let x = bx; x < bx + 10; x++) { s.grid[idx(x, by)] = TILE.ROAD; s.grid[idx(x, by + 4)] = TILE.ROAD; }
    for (let y = by; y <= by + 4; y++) { s.grid[idx(bx, y)] = TILE.ROAD; s.grid[idx(bx + 9, y)] = TILE.ROAD; }
    for (let x = bx + 1; x < bx + 5; x++) for (let y = by + 1; y < by + 4; y++) { s.grid[idx(x, y)] = TILE.RES; s.level[idx(x, y)] = 1; }
    for (let x = bx + 5; x < bx + 9; x++) for (let y = by + 1; y < by + 4; y++) { s.grid[idx(x, y)] = TILE.COM; s.level[idx(x, y)] = 1; }
  }

  function count (s, tile) { let c = 0; for (let i = 0; i < s.grid.length; i++) if (s.grid[i] === tile) c++; return c; }

  function log (s, text, kind) {
    s.log.unshift({ day: s.day, text: text, kind: kind || 'info' });
    if (s.log.length > 120) s.log.length = 120;
  }

  const SAVE_KEY = 'mamdani.save.v1';
  function saveState (s) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, s, {
        grid: Array.from(s.grid), level: Array.from(s.level), pow: Array.from(s.pow), pending: null
      })));
      return true;
    } catch (e) { return false; }
  }
  function loadState () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o.version !== 1) return null;
      o.grid = Uint8Array.from(o.grid);
      o.level = Uint8Array.from(o.level);
      o.pow = Uint8Array.from(o.pow || []);
      if (o.pow.length !== GRID * GRID) o.pow = new Uint8Array(GRID * GRID);
      o.pending = null;
      o.cooldowns = o.cooldowns || {};
      return o;
    } catch (e) { return null; }
  }
  function clearSave () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  Object.assign(MM, {
    GRID, TICKS_PER_DAY, TILE, TILE_INFO, BUILDABLE, ZONES, SERVICES,
    idx, inBounds, createState, count, log, saveState, loadState, clearSave
  });
})(window.MM);

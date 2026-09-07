/* The city's nine districts, and what each one is worth.
 *
 * The map already knew its own neighbourhoods: demo.js's zoneAt() is a pure
 * geometric partition of the grid, used until now only to decide what the
 * showcase city should grow where. The branches are lifted here verbatim,
 * minus the hash() roll that picked a level - that part was generation, this
 * part is geography, and geography does not move.
 *
 * A district is the unit the chain trades in. sim.js already computes the only
 * price signal that matters, s.pow, once per game day; stats() aggregates it.
 */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.GRID, T = MM.TILE, N = G * G;

  /* The parent name. Every district is a subname of it, every parcel a subname
   * of the district.
   *
   * Deliberately not a constant. Testnet work runs against whatever throwaway
   * name is free, and the city moves to its real name on the final deploy - so
   * nothing downstream may hardcode this. Set MM.CITY_ROOT before this file
   * loads, or call MM.districts.setRoot() after, and every district's ENS name
   * follows. Same idiom as MM.DEMO in demo.js. */
  var ROOT = 'cityhall.eth';

  /* Order is the district id, and the id is what the chain stores. Never
   * reorder this list - renumbering it renames every parcel onchain. */
  var LIST = [
    { id: 0, key: 'downtown',  name: 'Downtown' },
    { id: 1, key: 'midtown',   name: 'Midtown' },
    { id: 2, key: 'riverside', name: 'Riverside Towers' },
    { id: 3, key: 'uptown',    name: 'Uptown High Street' },
    { id: 4, key: 'westside',  name: 'The West Side' },
    { id: 5, key: 'southside', name: 'South Side' },
    { id: 6, key: 'wharves',   name: 'Works & Wharves' },
    { id: 7, key: 'redhook',   name: 'Red Hook' },
    { id: 8, key: 'airfield',  name: 'Airport Low-Rise' }
  ];

  function setRoot (name) {
    name = String(name == null ? '' : name).trim().replace(/^\.+|\.+$/g, '');
    if (name) ROOT = name;
    for (var i = 0; i < LIST.length; i++) LIST[i].ens = LIST[i].key + '.' + ROOT;
    if (MM.districts) MM.districts.ROOT = ROOT;
    return ROOT;
  }

  setRoot(MM.CITY_ROOT);

  /* Lifted from demo.js:73-85. Same branches, same order - the order is the
   * whole definition, since the regions deliberately overlap and the first
   * match wins. */
  function at (x, y) {
    if (y >= 36) return x >= 16 ? 6 : 7;                     // wharves | red hook
    if (x >= 31) return 2;                                   // riverside towers
    if (x >= 16 && y >= 11 && y <= 29) return 0;             // downtown
    if (x >= 11 && y >= 11 && y <= 34) return 1;             // midtown
    if (y >= 30) return 5;                                   // south-side
    if (y <= 5) return 8;                                    // by the airport
    if (x >= 16) return 3;                                   // uptown high street
    return 4;                                                // the west side
  }

  /* at() is a pure function of the tile, so resolve all 2304 of them once. */
  var MAP = new Uint8Array(N);
  (function () {
    for (var y = 0; y < G; y++) for (var x = 0; x < G; x++) MAP[y * G + x] = at(x, y);
  })();

  /* Land value runs 0..255 and level 0..4, so a tile contributes at most 1275
   * to the index. This turns that index into something denominated in dollars;
   * it is a capitalisation rate and nothing deeper. */
  var NAV_SCALE = 0.25;

  function stats (s) {
    var out = [], i;
    for (i = 0; i < LIST.length; i++) {
      out.push({ id: LIST[i].id, key: LIST[i].key, name: LIST[i].name, ens: LIST[i].ens,
        tiles: 0, built: 0, landSum: 0, land: 0, levelSum: 0, level: 0, nav: 0 });
    }
    if (!s || !s.grid || !s.pow) return out;

    var grid = s.grid, pow = s.pow, lvl = s.level;
    for (i = 0; i < N; i++) {
      var d = out[MAP[i]];
      d.tiles++;
      var t = grid[i];
      if (t === T.EMPTY || t === T.WATER) continue;
      var L = lvl ? (lvl[i] | 0) : 0, v = pow[i] | 0;
      d.built++;
      d.landSum += v;
      d.levelSum += L;
      d.nav += v * (1 + L);
    }
    for (i = 0; i < out.length; i++) {
      var o = out[i];
      o.land = o.built ? o.landSum / o.built : 0;
      o.level = o.built ? o.levelSum / o.built : 0;
      o.nav = Math.round(o.nav * NAV_SCALE);
    }
    return out;
  }

  MM.districts = { LIST: LIST, ROOT: ROOT, setRoot: setRoot, at: at, map: MAP, stats: stats, NAV_SCALE: NAV_SCALE };
})(window.MM);

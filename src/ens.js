/* OBSICITY - the city's namespace.
 *
 * Every thing in the city has a name, and the name is ENS.
 *
 *   cityhall.eth                                  the city          (deployed)
 *   downtown.cityhall.eth                         a district        (deployed, own registry)
 *   1422-canal.downtown.cityhall.eth              a parcel          (derived here)
 *   ada.1422-canal.downtown.cityhall.eth          a resident        (derived here)
 *   4f2a1c.fleet.cityhall.eth                     a licensed cab    (derived here)
 *   m14.transit.cityhall.eth                      a bus route       (derived here)
 *
 * Nothing below is stored and nothing below is random. Every name is a pure
 * function of a fact the world already holds - a parcel's origin tile, an
 * agent's spawn id - so the same city names the same things on every machine,
 * across a reload, and in a replay, with no registry to keep in sync and no
 * bytes on disk. Registration is the separate, optional act: a name exists as
 * soon as its parcel does, and goes onchain only when someone pays for it.
 *
 * This file is pure derivation. No DOM, no canvas, no network - src/ never
 * reaches the network and this is no exception. src/inspect.js draws it.
 */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var G = MM.GRID || 48, T = MM.TILE || {};

  /* ------------------------------------------------------------------ *
   * deterministic hash
   *
   * The same mixer sim.js uses for its per-tile noise. Any hash would do;
   * using this one means a name and the land value under it are shuffled
   * by identical arithmetic, so nothing can drift between them later.
   * ------------------------------------------------------------------ */
  function h32 (a, b, c) {
    var h = ((a | 0) * 374761393 + (b | 0) * 668265263 + ((c | 0) + 1) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function pick (list, h) { return list[h % list.length]; }

  /* A permutation walk, not repeated sampling: stepping by a stride coprime
     with the list length visits every entry once before it revisits any. That
     is what stops one building housing three people called Ada. */
  function walk (list, h, i, stride) {
    return list[(h + i * (stride || 37)) % list.length];
  }

  /* ------------------------------------------------------------------ *
   * word lists
   * ------------------------------------------------------------------ */

  // 64 streets. Length is deliberately a power of two so the stride walks
  // above stay permutations.
  var STREETS = [
    'canal', 'bowery', 'ludlow', 'delancey', 'orchard', 'mott', 'pell', 'bayard',
    'grand', 'spring', 'prince', 'houston', 'bleecker', 'jane', 'perry', 'gansevoort',
    'wythe', 'bedford', 'berry', 'kent', 'meserole', 'nassau', 'driggs', 'lorimer',
    'flatbush', 'atlantic', 'dekalb', 'myrtle', 'greene', 'vanderbilt', 'clinton', 'court',
    'ditmars', 'steinway', 'roosevelt', 'northern', 'skillman', 'jackson', 'astoria', 'broadway',
    'tremont', 'fordham', 'grand-concourse', 'jerome', 'webster', 'southern', 'longwood', 'hunts-point',
    'richmond', 'bay', 'victory', 'forest', 'hylan', 'amboy', 'clove', 'castleton',
    'lexington', 'madison', 'amsterdam', 'columbus', 'riverside', 'convent', 'edgecombe', 'malcolm-x'
  ];

  // 64 given names, so a tower can seat sixty-four neighbours without a clash.
  var FIRST = [
    'ada', 'noor', 'luis', 'wei', 'imani', 'tomas', 'sade', 'oleg',
    'mina', 'kwame', 'rosa', 'yusuf', 'ines', 'dmitri', 'aisha', 'pablo',
    'leila', 'jonas', 'nadia', 'hugo', 'fatou', 'seb', 'priya', 'marek',
    'zara', 'ravi', 'clara', 'tariq', 'suki', 'ivan', 'amara', 'bo',
    'elif', 'diego', 'hana', 'omar', 'greta', 'kofi', 'lena', 'sanjay',
    'maya', 'nico', 'thandi', 'emil', 'rania', 'jiro', 'carmen', 'viktor',
    'asha', 'pedro', 'yuki', 'samir', 'brigid', 'ade', 'nina', 'harun',
    'talia', 'matteo', 'zeynep', 'caleb', 'lucia', 'anwar', 'freya', 'kenji'
  ];

  // What a person does, by what they live above or work in. Flavour, but
  // flavour that is consistent: the same id always draws the same trade.
  var TRADES = {
    res: ['nurse', 'bus driver', 'teacher', 'line cook', 'super', 'nanny',
      'paralegal', 'welder', 'barista', 'night porter', 'sound engineer', 'courier',
      'pharmacist', 'social worker', 'plumber', 'librarian'],
    com: ['floor manager', 'buyer', 'barback', 'stylist', 'sales lead', 'chef de partie',
      'front of house', 'accounts clerk', 'locksmith', 'tailor', 'roaster', 'bookseller',
      'optician', 'framer', 'butcher', 'florist'],
    ind: ['fitter', 'crane operator', 'QA inspector', 'forklift driver', 'machinist', 'shift lead',
      'electrician', 'yard hand', 'dispatcher', 'millwright', 'lab tech', 'rigger',
      'toolmaker', 'stevedore', 'boilermaker', 'fabricator'],
    civ: ['registrar', 'duty officer', 'caseworker', 'caretaker', 'ward sister', 'head of year',
      'dinner lady', 'porter', 'receptionist', 'site manager', 'counsellor', 'technician',
      'archivist', 'coordinator', 'safeguarding lead', 'key worker']
  };

  // Route letters are the borough prefixes, so a route reads like a route.
  var ROUTE_PREFIX = ['m', 'b', 'q', 'bx', 's', 'm', 'b', 'q'];

  /* ------------------------------------------------------------------ *
   * the namespace roots
   * ------------------------------------------------------------------ */

  function root () {
    return (MM.districts && MM.districts.ROOT) || 'cityhall.eth';
  }
  // Two city-level names that are not districts: the things that move.
  function fleetRoot ()   { return 'fleet.' + root(); }
  function transitRoot () { return 'transit.' + root(); }

  function districtOf (x, y) {
    var d = MM.districts;
    if (!d) return null;
    return d.LIST[d.at(x, y)] || null;
  }

  /* ------------------------------------------------------------------ *
   * parcels
   *
   * A parcel is the LAND, not the building. Bulldoze a block and rebuild it
   * and the name does not change - which is exactly how a land registry
   * behaves, and the reason the seed is the lot's origin tile rather than
   * anything about the structure standing on it.
   *
   * The address is real addressing, not a hash dressed up as one: the
   * hundred-block is the row and the number within it is the column, doubled
   * so one side of the street is even. That makes it unique across the whole
   * grid by construction - x0*2 maxes out at 94, below the 100 the row
   * carries - so no two parcels can ever claim the same label on the same
   * street, and walking north genuinely counts you up through the blocks.
   * ------------------------------------------------------------------ */

  function houseNumber (x0, y0) { return (y0 + 1) * 100 + x0 * 2; }

  function parcelLabel (x0, y0) {
    return houseNumber(x0, y0) + '-' + pick(STREETS, h32(x0, y0, 11));
  }

  // Human-facing street address: "1422 Canal St".
  function streetAddress (x0, y0) {
    var st = pick(STREETS, h32(x0, y0, 11)).replace(/-/g, ' ');
    return houseNumber(x0, y0) + ' ' + st.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) +
      (/\b(broadway|concourse|riverside|northern|southern|victory|malcolm x)\b/.test(st) ? '' : ' St');
  }

  /* Landmarks are pinned onto whatever land they stand on - the signature
     tower and the stadium both sit on PARK tiles - so the zoning under them
     is the wrong answer to "what is this". lots.js already records the only
     signal that matters, L.pinned, and the archetype says which one it is. */
  var LANDMARK = {
    airport: 'Airport', stadium: 'Stadium', marina: 'Marina', port: 'Container Port',
    power: 'Power Station', solar: 'Solar Field', wind: 'Wind Farm', depot: 'Bus Depot',
    funfair: 'Funfair', fire: 'Fire Station', police: 'Police Station',
    hospital: 'Hospital', hero: 'Signature Tower'
  };

  /* What a lot is FOR, collapsed to the four things a name cares about. */
  var SECTOR = {};
  SECTOR[T.RES] = 'res'; SECTOR[T.TOWER] = 'res';
  SECTOR[T.COM] = 'com'; SECTOR[T.GROCERY] = 'com';
  SECTOR[T.IND] = 'ind';
  SECTOR[T.SCHOOL] = 'civ'; SECTOR[T.CLINIC] = 'civ'; SECTOR[T.CHILDCARE] = 'civ';
  SECTOR[T.PARK] = 'civ'; SECTOR[T.BUS] = 'civ';

  /* Capacity comes from sim.js's own tables via MM.sim.K, never from a copy.
     A building that says it houses 55 people says so because that is the
     number the simulation is using for that tile this tick. */
  function caps (s, L) {
    var K = (MM.sim && MM.sim.K) || null;
    var homes = 0, jobs = 0, x, y, i, lv;
    for (y = L.y0; y <= L.y1; y++) {
      for (x = L.x0; x <= L.x1; x++) {
        i = y * G + x;
        lv = s.level ? (s.level[i] | 0) : 0;
        switch (s.grid[i]) {
          case T.TOWER: homes += K ? K.TOWER_CAP : 140; break;
          case T.RES:   homes += K ? K.RES_CAP[lv] : 0; break;
          case T.COM:   jobs  += K ? K.COM_JOB[lv] : 0; break;
          case T.IND:   jobs  += K ? K.IND_JOB[lv] : 0; break;
          // Civic blocks are not in the sim's capacity tables - they are
          // service radii, not zoned capacity - so staff is the footprint.
          case T.SCHOOL: jobs += 14; break;
          case T.CLINIC: jobs += 11; break;
          case T.CHILDCARE: jobs += 8; break;
          case T.GROCERY: jobs += 9; break;
          default: break;
        }
      }
    }
    return { homes: homes, jobs: jobs };
  }

  /* The whole record for the parcel under a tile, or null if that tile is not
     part of one. Everything downstream - tooltip, panel, onchain payload -
     reads this one shape. */
  function parcel (s, x, y) {
    if (!s || !MM.lots || !MM.inBounds || !MM.inBounds(x, y)) return null;
    var L = MM.lots.lotOf(s, x, y);
    if (!L) return null;
    var d = districtOf(L.x0, L.y0);
    var label = parcelLabel(L.x0, L.y0);
    var c = caps(s, L);
    var i = L.y0 * G + L.x0;
    var info = MM.TILE_INFO ? MM.TILE_INFO[L.kind] : null;
    var mark = L.pinned ? LANDMARK[L.arch] : null;
    return {
      type: 'parcel',
      lot: L,
      x0: L.x0, y0: L.y0, w: L.w, h: L.h,
      seed: h32(L.x0, L.y0, 3),
      label: label,
      name: label + '.' + (d ? d.ens : root()),
      address: streetAddress(L.x0, L.y0),
      district: d,
      kind: L.kind,
      use: mark || (info ? info.name : 'Parcel'),
      landmark: !!mark,
      zoning: info ? info.name : 'Unzoned',
      sector: mark ? 'civ' : (SECTOR[L.kind] || 'civ'),
      arch: L.arch,
      level: L.lv | 0,
      land: s.pow ? (s.pow[i] | 0) : 0,
      homes: c.homes,
      jobs: c.jobs,
      // A parcel with neither homes nor jobs still has a name; it is just
      // land. Parks and empty lots land here.
      tiles: L.w * L.h
    };
  }

  /* ------------------------------------------------------------------ *
   * residents
   *
   * One subname per person, issued under the parcel. The roll is capped
   * because a 140-home tower does not need 140 rows in a panel to make the
   * point - but the nth resident's name is still a pure function of n, so
   * raising the cap never renames anybody who was already listed.
   * ------------------------------------------------------------------ */

  var MAX_ROLL = 12;

  function residents (s, p, limit) {
    if (!p) return [];
    var n = p.homes > 0 ? p.homes : p.jobs;
    if (n <= 0) return [];
    var shown = Math.min(n, limit || MAX_ROLL);
    var trades = TRADES[p.sector] || TRADES.res;
    var resident = p.homes > 0;
    var out = [];
    for (var i = 0; i < shown; i++) {
      var first = walk(FIRST, p.seed, i, 37);
      out.push({
        type: 'person',
        first: first,
        label: first,
        name: first + '.' + p.name,
        trade: walk(trades, p.seed + i * 7, i, 5),
        // Whether they live here or work here changes what the name MEANS,
        // and the panel says which.
        tenure: resident ? 'resident' : 'worker',
        parcel: p
      });
    }
    return { list: out, total: n, shown: shown };
  }

  /* One specific resident by index - what a street agent resolves to. */
  function residentAt (s, p, n) {
    var r = residents(s, p, Math.max(1, (n % MAX_ROLL) + 1));
    return r.list ? r.list[n % r.list.length] : null;
  }

  /* ------------------------------------------------------------------ *
   * the things that move
   *
   * A street agent is identified by v.id, which render.js assigns once when
   * the agent is created and never reassigns - including across the respawn
   * that happens when it walks off the end of a road. So a person keeps their
   * name for as long as they are in the city, which is the only property a
   * name has to have.
   * ------------------------------------------------------------------ */

  function person (s, v) {
    var home = v.home && v.home.x >= 0 ? parcel(s, v.home.x, v.home.y) : null;
    var h = h32(v.id, 0, 5);
    if (home) {
      var r = residentAt(s, home, h % Math.max(1, home.homes || home.jobs || 1));
      if (r) {
        r = Object.assign({}, r);
        r.agent = v;
        r.headline = r.first.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        return r;
      }
    }
    /* No parcel to belong to - they spawned on a road out past the last
       block. They are still a citizen, so they still have a name; it just
       hangs off the district rather than off a building. */
    var d = districtOf(v.x | 0, v.y | 0);
    var first = pick(FIRST, h);
    var label = first + '-' + (h % 4096).toString(16);
    return {
      type: 'person', first: first, label: label,
      name: label + '.' + (d ? d.ens : root()),
      headline: first.replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
      trade: pick(TRADES.res, h >>> 5),
      tenure: 'citizen', parcel: null, district: d, agent: v
    };
  }

  /* A cab is licensed by the city, not by a district: the medallion is the
     name, and it hangs off fleet.cityhall.eth. Same shape as a real TLC
     medallion - the licence IS the asset. */
  function cab (s, v) {
    var h = h32(v.id, 7, 9);
    var label = (h % 0xffffff).toString(16).padStart(6, '0');
    return {
      type: 'cab', label: label, name: label + '.' + fleetRoot(),
      headline: 'Medallion ' + label.toUpperCase(),
      licence: 'TLC medallion', agent: v
    };
  }

  function bus (s, v) {
    var h = h32(v.id, 13, 17);
    var label = pick(ROUTE_PREFIX, h) + (1 + (h >>> 4) % 99);
    return {
      type: 'bus', label: label, name: label + '.' + transitRoot(),
      headline: 'Route ' + label.toUpperCase(),
      licence: 'city transit', agent: v
    };
  }

  /* kind is render.js's: 0 cab, 1 bus, 2 pedestrian. */
  function agent (s, v) {
    if (!v) return null;
    return v.kind === 2 ? person(s, v) : (v.kind === 1 ? bus(s, v) : cab(s, v));
  }

  /* ------------------------------------------------------------------ *
   * onchain status
   *
   * What is actually deployed, versus what is merely derivable. The honest
   * answer for a parcel today is "derivable, not registered": the district
   * registry that would own it exists onchain and is named here, and the
   * parcel gets minted under it the moment someone pays the gas.
   *
   * chain config reaches us through MM.chainCfg, which web3/bundle.js sets.
   * Absent that - no chain layer, or offline - this reports a local name and
   * the panel says so rather than inventing an address.
   * ------------------------------------------------------------------ */
  function onchain (p) {
    var cfg = MM.chainCfg;
    var d = p && p.district;
    if (!cfg || !d) return { live: false, registry: null, parent: d ? d.ens : root() };
    var rec = null;
    for (var i = 0; i < (cfg.districts || []).length; i++) {
      if (cfg.districts[i].key === d.key) { rec = cfg.districts[i]; break; }
    }
    return {
      live: !!rec,
      // The contract that issues this name's label. For a parcel that is the
      // district registry; for a resident it is whatever the parcel gets.
      registry: rec ? rec.registry : null,
      parent: rec ? rec.ens : d.ens,
      chainId: cfg.chainId || null,
      root: cfg.root || root()
    };
  }

  /* The chain of names above a given one, outermost first. What the panel
     draws as a breadcrumb, and the clearest single statement of the whole
     scheme: every row is a real label owned by the row above it. */
  function lineage (name) {
    var parts = String(name || '').split('.');
    var out = [];
    for (var i = 0; i < parts.length - 1; i++) out.unshift(parts.slice(i).join('.'));
    return out;
  }

  MM.ens = {
    root: root, fleetRoot: fleetRoot, transitRoot: transitRoot,
    parcel: parcel, residents: residents, residentAt: residentAt,
    agent: agent, person: person, cab: cab, bus: bus,
    onchain: onchain, lineage: lineage,
    parcelLabel: parcelLabel, streetAddress: streetAddress,
    hash: h32, STREETS: STREETS, FIRST: FIRST, MAX_ROLL: MAX_ROLL
  };
})(window.MM);

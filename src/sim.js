/* OBSICITY - simulation. Owned by the sim agent. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const G = MM.GRID, N = G * G, T = MM.TILE, TPD = MM.TICKS_PER_DAY;

  // ---------------------------------------------------------------- tunables
  const K = {
    BASE: 36,          // land value floor on any tile
    // AMEN/BAD multiply a SPREAD_GAIN-normalised field, so the per-tile amenity
    // numbers below (park 30, clinic 34...) really are land-value points at the
    // source, falling off with distance. Keep these near 1.
    AMEN: 1.0,         // amenity field -> land value gain
    BAD: 0.9,          // industry field -> land value penalty
    CONG: 13,          // local congestion -> land value penalty
    ROADV: 6,          // being near a road is worth this
    BLUR: 2,           // box blur radius, applied twice (~9x9 pyramid)

    RES_CAP: [0, 10, 26, 55, 100],
    COM_JOB: [0, 4, 11, 23, 42],
    IND_JOB: [0, 6, 15, 31, 54],
    TOWER_CAP: 140,
    WORKFORCE: 0.52,

    // Land value needed to reach level i. Level 2 sits just under "roaded, and
    // nothing else" (BASE 36 + ROADV 6) so any serviced block develops; 3 and 4
    // require real investment in amenities.
    NEED: [0, 0, 40, 86, 124],
    // ...scaled per sector. Factories develop on cheap land and always did;
    // holding them to the residential threshold froze industry at level 1.
    NEED_MUL: { res: 1.0, com: 0.92, ind: 0.55 },
    // Demand needed to reach level i. RCI is a negative-feedback loop that
    // settles near zero, so thresholds above it are never sustained and the top
    // levels become unreachable. These sit at/below equilibrium: a sector only
    // has to be not-oversupplied to keep building.
    DEM: [0, 0, -0.15, -0.05, 0.02],
    GROW_P: 0.20,                     // base chance/day a qualifying tile levels

    // $/day per resident (RES) or per job (COM/IND) at tax rate 10
    TAX_RES: 0.16, TAX_COM: 0.42, TAX_IND: 0.38,
    ROAD_CAP: 34,    // car trips a road tile absorbs per day
    BUS_CAP: 320,    // riders a bus stop absorbs per day
    RAIL_CAP: 1450,  // ...and a rail station, if it is on the network
    COM_SHARE: 0.38, IND_SHARE: 0.26,            // jobs each sector owes per resident

    SERVE: { clinic: 1800, school: 1500, childcare: 1200, grocery: 1000 }
  };

  // -------------------------------------------------------------- scratch
  const fA = new Float32Array(N);   // amenity
  const fB = new Float32Array(N);   // industry / nuisance
  const fR = new Float32Array(N);   // road density
  const fT = new Float32Array(N);   // trip generation
  const fN = new Float32Array(N);   // road-within-2 mask
  const tmp = new Float32Array(N);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // deterministic per-tile-per-day noise, so runs replay identically
  function rnd (i, d) {
    let h = (i * 374761393 + d * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function blur (buf, r) {
    for (let y = 0; y < G; y++) {
      const o = y * G;
      for (let x = 0; x < G; x++) {
        const a = x - r < 0 ? 0 : x - r, b = x + r > G - 1 ? G - 1 : x + r;
        let s = 0;
        for (let k = a; k <= b; k++) s += buf[o + k];
        tmp[o + x] = s / (b - a + 1);
      }
    }
    for (let x = 0; x < G; x++) {
      for (let y = 0; y < G; y++) {
        const a = y - r < 0 ? 0 : y - r, b = y + r > G - 1 ? G - 1 : y + r;
        let s = 0;
        for (let k = a; k <= b; k++) s += tmp[k * G + x];
        buf[y * G + x] = s / (b - a + 1);
      }
    }
  }

  function dilate (buf, r) {
    for (let y = 0; y < G; y++) {
      const o = y * G;
      for (let x = 0; x < G; x++) {
        const a = x - r < 0 ? 0 : x - r, b = x + r > G - 1 ? G - 1 : x + r;
        let m = 0;
        for (let k = a; k <= b; k++) if (buf[o + k] > m) m = buf[o + k];
        tmp[o + x] = m;
      }
    }
    for (let x = 0; x < G; x++) {
      for (let y = 0; y < G; y++) {
        const a = y - r < 0 ? 0 : y - r, b = y + r > G - 1 ? G - 1 : y + r;
        let m = 0;
        for (let k = a; k <= b; k++) { const v = tmp[k * G + x]; if (v > m) m = v; }
        buf[y * G + x] = m;
      }
    }
  }

  // ------------------------------------------------------------- policies
  // A box blur preserves the MEAN, so it craters a point source's peak: two
  // passes at radius 2 leave ~4% of it. Measure that attenuation once and scale
  // it back out, so the amenity constants mean what they look like they mean.
  // Measured rather than hardcoded, so changing K.BLUR stays safe.
  const SPREAD_GAIN = (function () {
    const probe = new Float32Array(N);
    const mid = (G >> 1) * G + (G >> 1);
    probe[mid] = 1000;
    blur(probe, K.BLUR); blur(probe, K.BLUR);
    return probe[mid] > 0 ? 1000 / probe[mid] : 1;
  })();

  /* How many stations actually sit on the rail network - a station needs a
     track tile orthogonally adjacent to it to be worth any seats at all. */
  function connectedStations (s) {
    const G = MM.GRID, g = s.grid, T = MM.TILE;
    let n = 0;
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        if (g[y * G + x] !== T.STATION) continue;
        if ((x > 0 && g[y * G + x - 1] === T.RAIL) ||
            (x < G - 1 && g[y * G + x + 1] === T.RAIL) ||
            (y > 0 && g[(y - 1) * G + x] === T.RAIL) ||
            (y < G - 1 && g[(y + 1) * G + x] === T.RAIL)) n++;
      }
    }
    return n;
  }

  function has (s, id) {
    try { return typeof MM.hasPolicy === 'function' && !!MM.hasPolicy(s, id); } catch (e) { return false; }
  }
  // Aggregate every active policy's effects generically.
  function effects (s) {
    const o = { approval: 0, rentMul: 1, trafficMul: 1, costMul: 1, growthMul: 1, popMul: 1 };
    const list = Array.isArray(MM.POLICIES) ? MM.POLICIES : [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || !p.id || !has(s, p.id)) continue;
      const e = p.effects || {};
      o.approval += num(e.approval, 0);
      o.rentMul *= num(e.rentMul, 1);
      o.trafficMul *= num(e.trafficMul, 1);
      o.costMul *= num(e.costMul, 1);
      o.growthMul *= num(e.growthMul, 1);
      o.popMul *= num(e.popMul, 1);
    }
    o.approval = clamp(o.approval, -40, 40);
    o.rentMul = clamp(o.rentMul, 0.4, 2);
    o.trafficMul = clamp(o.trafficMul, 0.2, 2);
    o.costMul = clamp(o.costMul, 0.4, 3);
    o.growthMul = clamp(o.growthMul, 0.2, 2.5);
    o.popMul = clamp(o.popMul, 0.5, 2);
    return o;
  }

  function ensure (s) {
    if (!s.tgt) s.tgt = { pop: num(s.pop, 0), traffic: num(s.traffic, 0), happiness: num(s.happiness, 60), ridership: 0 };
    if (!s.d) s.d = {};
    if (!s.marks) s.marks = {};
    s.debtDays = num(s.debtDays, 0);
    s.lowDays = num(s.lowDays, 0);
  }

  function say (s, text, kind) { try { if (typeof MM.log === 'function') MM.log(s, text, kind); } catch (e) {} }

  // Laffer-ish: past 14% you collect less than the sticker rate says.
  const effRate = r => (r <= 14 ? r : 14 + (r - 14) * 0.55);
  // Past ~12-14% businesses stop expanding, past 16% they start closing.
  const taxGrow = r => clamp(1 - Math.max(0, r - 12) * 0.18, 0, 1);

  // ------------------------------------------------------------ daily pass
  function daily (s) {
    ensure(s);
    const grid = s.grid, lvl = s.level, pow = s.pow, day = s.day | 0;
    const ef = effects(s);

    fA.fill(0); fB.fill(0); fR.fill(0); fT.fill(0); fN.fill(0);
    const cnt = new Array(16).fill(0);      // one slot per placeable tile id

    let housingCap = 0, towerCap = 0, comJobs = 0, indJobs = 0;

    for (let i = 0; i < N; i++) {
      const t = grid[i];
      if (t < 16) cnt[t]++;
      const L = clamp(lvl[i] | 0, 0, 4);
      switch (t) {
        case T.WATER: fA[i] += 3; break;
        case T.ROAD: fR[i] = 1; fN[i] = 1; break;
        case T.PARK: fA[i] += 30; break;
        case T.BUS: fA[i] += 20; break;
        case T.STATION: fA[i] += 32; break;    // a station lifts a neighbourhood
        case T.RAIL: fB[i] += 4; break;        // and the track itself is a nuisance
        case T.GROCERY: fA[i] += 26; break;
        case T.CHILDCARE: fA[i] += 24; break;
        case T.CLINIC: fA[i] += 34; break;
        case T.SCHOOL: fA[i] += 30; break;
        case T.TOWER:
          fA[i] += 6; housingCap += K.TOWER_CAP; towerCap += K.TOWER_CAP;
          fT[i] += K.TOWER_CAP * 0.5; break;
        case T.RES: {
          const c = K.RES_CAP[L]; housingCap += c;
          fA[i] += 0.6 + L * 0.6; fT[i] += c * 0.5; break;
        }
        case T.COM: {
          const j = K.COM_JOB[L]; comJobs += j;
          fA[i] += 1.8 + L * 1.4; fT[i] += j * 0.6; break;
        }
        case T.IND: {
          const j = K.IND_JOB[L]; indJobs += j;
          fB[i] += 22 + L * 4; fT[i] += j * 0.6; break;
        }
      }
    }

    const jobsOld = comJobs + indJobs;
    const popNow = clamp(num(s.pop, 0), 0, 1e7);

    blur(fA, K.BLUR); blur(fA, K.BLUR);
    blur(fB, K.BLUR); blur(fB, K.BLUR);
    // restore point-source magnitude lost to the blur (see SPREAD_GAIN)
    for (let i = 0; i < N; i++) { fA[i] *= SPREAD_GAIN; fB[i] *= SPREAD_GAIN; }
    blur(fR, K.BLUR); blur(fR, K.BLUR);
    blur(fT, K.BLUR); blur(fT, K.BLUR);
    dilate(fN, 2);

    // ---- 5. transit + traffic (uses yesterday's population; one day of lag)
    const commuters = Math.min(popNow * K.WORKFORCE, jobsOld);
    const busSeats = cnt[T.BUS] * K.BUS_CAP * (has(s, 'freeBuses') ? 1.75 : 1);
    // A station with no track is a shed. Counting only connected stations is
    // what makes laying the line matter instead of dotting stations about.
    // ponytail: adjacency, not reachability - two stations on one rail stub
    // both count. Flood-fill the network if lines ever need to be distinct.
    const railSeats = connectedStations(s) * K.RAIL_CAP *
      (has(s, 'freeBuses') ? 1.75 : 1);
    const riders = Math.min(commuters * 0.78, busSeats + railSeats);
    const carShare = commuters > 0 ? Math.max(0, commuters - riders) / commuters : 0;
    s.tgt.ridership = Math.round(riders);

    // congestion field: local trips vs local road capacity. fT becomes cong.
    let congSum = 0, congCount = 0;
    for (let i = 0; i < N; i++) {
      const t = grid[i];
      if (t === T.EMPTY || t === T.WATER) { fT[i] = 0; continue; }
      const c = clamp((fT[i] * carShare) / (fR[i] * K.ROAD_CAP + 2), 0, 2.5);
      fT[i] = c;
      if (t === T.RES || t === T.COM || t === T.IND || t === T.TOWER) { congSum += c; congCount++; }
    }
    const traffic = clamp((congCount > 0 ? congSum / congCount : 0) * 55 * ef.trafficMul, 0, 100);
    s.tgt.traffic = traffic;

    // ---- 6. pollution
    const pollution = clamp(cnt[T.IND] * 1.4 + traffic * 0.32 - cnt[T.PARK] * 0.85, 0, 100);
    s.pollution = Math.round(pollution);

    // ---- 1. land value / desirability
    let valSum = 0, valCount = 0;
    for (let i = 0; i < N; i++) {
      const t = grid[i];
      if (t === T.EMPTY || t === T.WATER) { pow[i] = 0; continue; }
      // A warehouse doesn't mind living next to a warehouse. Applying the full
      // nuisance penalty to industry itself made industrial land value sit below
      // the level-2 threshold permanently, so factories could never develop.
      const nuis = t === T.IND ? 0.15 : t === T.COM ? 0.55 : 1;
      let v = K.BASE + fA[i] * K.AMEN + fN[i] * K.ROADV
        - fB[i] * K.BAD * nuis - fT[i] * K.CONG - pollution * 0.10 * nuis;
      v = clamp(v, 0, 255);
      pow[i] = v | 0;
      valSum += v; valCount++;
    }
    const landAvg = valCount > 0 ? valSum / valCount / 255 : 0;

    // ---- 2. RCI demand, all in units of people so the three stay consistent
    const rentPen = Math.max(0, num(s.rent, 100) - 100) / 100 * 0.55;
    // nobody moves to a city with no work
    const workersNow = popNow * K.WORKFORCE;
    const jobPull = workersNow > 1 ? 0.55 + clamp(jobsOld / workersNow, 0, 1) * 0.45 : 1;
    const avgOcc = clamp(0.35 + landAvg * 0.75 - rentPen, 0.15, 1) * ef.popMul * jobPull;
    const popPotential = housingCap * avgOcc;
    const wantPop = (jobsOld / K.WORKFORCE) * 1.08 + 60;
    // Shops and factories open for the housing that EXISTS, not just the people
    // already in it. Without this, pop needs jobs and jobs need pop, and a young
    // city deadlocks forever at its starting size.
    const demandBase = Math.max(popNow, housingCap * 0.62);
    const wantCom = demandBase * K.COM_SHARE + 10;
    const wantInd = demandBase * K.IND_SHARE + 8;
    // Measured against people actually HERE, not against zoned capacity.
    // Against capacity, zoning land suppressed its own demand: a mayor who
    // drew a big district instantly drove dR to -1 and froze the whole city.
    // Jobs still gate housing — wantPop is job-derived, with only a small
    // base so a jobless city stalls at a village.
    const dR = clamp((wantPop - popNow) / Math.max(80, wantPop * 0.4), -1, 1);
    const dC = clamp((wantCom - comJobs) / Math.max(14, wantCom * 0.4), -1, 1);
    const dI = clamp((wantInd - indJobs) / Math.max(12, wantInd * 0.4), -1, 1);

    // ---- 7a. brownout: broke cities stop maintaining anything
    const broke = s.treasury < 0 ? clamp(1 + s.treasury / 12000, 0.25, 1) : 1;

    // ---- 3. growth, population, jobs and property tax, in one pass
    let popTarget = 0, income = 0, newHousing = 0, newCom = 0, newInd = 0, topLevel = 0;

    for (let i = 0; i < N; i++) {
      const t = grid[i];
      if (t !== T.RES && t !== T.COM && t !== T.IND && t !== T.TOWER) continue;
      const v = pow[i];
      const occ = clamp(0.35 + v / 255 * 0.75 - rentPen, 0.15, 1) * ef.popMul * jobPull;

      if (t === T.TOWER) {
        newHousing += K.TOWER_CAP;
        popTarget += K.TOWER_CAP * clamp(occ + 0.25, 0.3, 1);
        continue;
      }

      const road = fN[i] > 0;
      const dem = t === T.RES ? dR : t === T.COM ? dC : dI;
      const rate = num(t === T.RES ? s.taxRate.res : t === T.COM ? s.taxRate.com : s.taxRate.ind, 10);
      let L = clamp(lvl[i] | 0, 1, 4);

      // A zoned tile with no road within 2 tiles never grows. Ever.
      const nm = t === T.RES ? K.NEED_MUL.res : t === T.COM ? K.NEED_MUL.com : K.NEED_MUL.ind;
      const L0 = L;
      if (road) {
        const r = rnd(i, day);
        const up = L + 1;
        if (up <= 4 && v >= K.NEED[up] * nm && dem >= K.DEM[up]) {
          const p = K.GROW_P * (0.5 + dem * 0.5) * taxGrow(rate) * ef.growthMul * broke;
          if (r < p) { L = up; if (L > topLevel) topLevel = L; }
        } else if (L > 1 && (v < K.NEED[L] * nm * 0.62 || dem < -0.7 || rate > 16 || broke < 0.5)) {
          const p = 0.09 + Math.max(0, rate - 16) * 0.05 + (1 - broke) * 0.12;
          if (r > 1 - p) L = L - 1;
        }
        lvl[i] = L;
        // tells the renderer its cached city is stale; most days nothing moves
        if (L !== L0) s.rev = (s.rev || 0) + 1;
      } else {
        L = clamp(lvl[i] | 0, 1, 4);
      }
      if (L > topLevel) topLevel = L;

      // Tax the actual tax base — residents and jobs — not the level index.
      // Per-level rates made every level-1 tile lose money against its upkeep,
      // so a city could never climb out of its own maintenance bill.
      const yield_ = (0.7 + v / 255 * 0.8) * (effRate(rate) / 10);
      if (t === T.RES) {
        const c = K.RES_CAP[L];
        newHousing += c; popTarget += c * occ;
        income += K.TAX_RES * c * occ * yield_;
      } else if (t === T.COM) {
        const j = K.COM_JOB[L];
        newCom += j;
        income += K.TAX_COM * j * yield_;
      } else {
        const j = K.IND_JOB[L];
        newInd += j;
        income += K.TAX_IND * j * yield_;
      }
    }

    housingCap = newHousing;
    const jobs = newCom + newInd;
    s.jobs = Math.round(clamp(jobs, 0, 1e7));
    s.tgt.pop = clamp(popTarget, 0, 1e7);
    s.employed = Math.round(clamp(Math.min(popNow * K.WORKFORCE, jobs), 0, 1e7));

    // ---- 4. rent
    const socialShare = housingCap > 0 ? towerCap / housingCap : 0;
    // measured against a neutral occupancy, so rent-driven vacancy cannot spiral
    const scarcity = clamp(wantPop / Math.max(1, housingCap * 0.72), 0, 2.2);
    let rentTarget = 48 + scarcity * 38 + landAvg * 40 - socialShare * 55;
    if (has(s, 'socialHousing')) rentTarget -= 12;
    rentTarget = clamp(rentTarget * ef.rentMul, 35, 320);
    let dRent = clamp(rentTarget - num(s.rent, 100), -3, 3) * 0.45;
    if (has(s, 'rentFreeze')) dRent = Math.min(dRent, 0.03);
    const rentPrev = num(s.rent, 100);
    s.rent = clamp(rentPrev + dRent, 40, 400);

    // ---- 7. budget
    let cost = 0;
    for (let t = 0; t < 13; t++) {
      const inf = MM.TILE_INFO[t];
      if (inf && cnt[t]) cost += cnt[t] * num(inf.upkeep, 0);
    }
    let pol = 0;
    try { if (typeof MM.policyDailyCost === 'function') pol = num(MM.policyDailyCost(s), 0); } catch (e) {}
    cost = (cost + pol) * ef.costMul;
    income = clamp(income, 0, 1e7);
    cost = clamp(cost, 0, 1e7);
    s.dailyIncome = Math.round(income);
    s.dailyCost = Math.round(cost);
    s.treasury = clamp(num(s.treasury, 0) + income - cost, -1e7, 1e9);

    // ---- 8. approval
    const unemp = workersNow > 1 ? clamp(1 - s.employed / workersNow, 0, 1) : 0;
    const need = Math.max(1, popNow);
    let cov = (Math.min(1, cnt[T.CLINIC] * K.SERVE.clinic / need)
      + Math.min(1, cnt[T.SCHOOL] * K.SERVE.school / need)
      + Math.min(1, cnt[T.CHILDCARE] * K.SERVE.childcare / need)
      + Math.min(1, cnt[T.GROCERY] * K.SERVE.grocery / need)) / 4;
    if (popNow < 60) cov = Math.max(cov, 0.5);      // a village needs nothing
    cov *= broke;
    const parks = clamp(cnt[T.PARK] * 300 / need, 0, 1);

    let aT = 58;
    aT -= unemp * 55;
    aT -= Math.max(0, s.rent - 100) * 0.42;
    aT += (cov - 0.5) * 30;
    aT += (parks - 0.4) * 16;
    aT -= s.tgt.traffic * 0.16;
    aT -= pollution * 0.13;
    aT += s.treasury >= 0 ? Math.min(6, s.treasury / 4000) : Math.max(-32, s.treasury / 300);
    aT += ef.approval;
    aT = clamp(aT, 0, 100);

    const aPrev = clamp(num(s.approval, 50), 0, 100);
    s.approval = clamp(aPrev + clamp(aT - aPrev, -1.5, 1.5), 0, 100);
    s.streak = s.approval > aPrev + 0.001 ? (s.streak | 0) + 1 : 0;

    // ---- 9. happiness (softer, faster)
    s.tgt.happiness = clamp(s.approval * 0.8 + 20 - s.tgt.traffic * 0.12
      - Math.max(0, s.rent - 100) * 0.10, 0, 100);

    // ---- derived snapshot for the HUD
    s.d = {
      housing: Math.round(housingCap), tower: towerCap, jobs: s.jobs,
      cov: cov, parks: parks, unemp: unemp, land: landAvg,
      demand: { r: dR, c: dC, i: dI },
      net: Math.round(income - cost), rentTarget: Math.round(rentTarget)
    };

    // ---- 11. log the moments that matter
    const m = s.marks, P = s.tgt.pop;
    [1000, 5000, 10000, 50000].forEach(function (mark) {
      if (P >= mark && !m['p' + mark]) {
        m['p' + mark] = 1;
        say(s, mark >= 50000 ? 'Fifty thousand New Yorkers. This is a real city now.'
          : mark >= 10000 ? '10,000 residents. The subway map needs a redraw.'
            : mark >= 5000 ? '5,000 people call this city home.'
              : 'First thousand residents moved in.', 'good');
      }
    });
    if (topLevel >= 4 && !m.lv4) { m.lv4 = 1; say(s, 'A district hit tier 4. Skyline unlocked.', 'good'); }
    if (s.treasury < 0 && !m.broke) { m.broke = 1; say(s, 'Treasury in the red. Albany is not picking up.', 'bad'); }
    if (s.treasury > 500 && m.broke) m.broke = 0;
    if (s.rent > 130 && !m.rent130) { m.rent130 = 1; say(s, 'Rent index past 130. Tenants are organizing.', 'bad'); }
    if (s.rent > 170 && !m.rent170) { m.rent170 = 1; say(s, 'Rent is unlivable. People are leaving the boroughs.', 'bad'); }
    if (s.rent < 95 && m.rent130) { m.rent130 = 0; m.rent170 = 0; say(s, 'Rents came back down to earth.', 'good'); }
    if (s.approval > num(m.appRec, 0) + 4) { m.appRec = s.approval; if (s.day > 3) say(s, 'Approval at ' + Math.round(s.approval) + '%. Best yet.', 'good'); }

    // ---- game over conditions
    s.debtDays = s.treasury < -1500 ? (s.debtDays | 0) + 1 : 0;
    s.lowDays = s.approval < 20 ? (s.lowDays | 0) + 1 : 0;
    if (!s.gameOver) {
      if (s.debtDays > 20 || s.treasury < -25000) {
        s.gameOver = { reason: 'bankrupt', text: 'The city defaulted. A control board runs it now.' };
        say(s, 'City bankrupt. Term over.', 'bad');
      } else if (s.lowDays > 21) {
        s.gameOver = { reason: 'recall', text: 'Recalled at ' + Math.round(s.approval) + '% approval.' };
        say(s, 'Recall election lost.', 'bad');
      } else if (s.day > num(s.termDay, 1461)) {
        const win = s.approval >= 50;
        s.gameOver = {
          reason: win ? 'reelected' : 'defeated',
          text: win ? 'Re-elected with ' + Math.round(s.approval) + '% approval.'
            : 'Voted out at ' + Math.round(s.approval) + '% approval.'
        };
        say(s, win ? 'Four more years.' : 'Term over. The voters said no.', win ? 'good' : 'bad');
      }
    }

    // ---- 10. one event roll per day
    if (!s.pending && typeof MM.maybeFireEvent === 'function') {
      try { s.pending = MM.maybeFireEvent(s) || null; } catch (e) { s.pending = null; }
    }
  }

  // ------------------------------------------------------------------ tick
  function lerp (cur, tgt, k) { return cur + (num(tgt, cur) - cur) * k; }

  function step (s) {
    if (!s || !s.grid) return;
    ensure(s);
    s.tick = (s.tick | 0) + 1;
    if (s.tick % TPD === 0) {
      try { daily(s); } catch (e) { if (typeof console !== 'undefined') console.error('sim daily', e); }
      s.day = (s.day | 0) + 1;
    }
    const t = s.tgt;
    s.pop = Math.max(0, Math.round(lerp(num(s.pop, 0), t.pop, 0.12)));
    s.traffic = clamp(lerp(num(s.traffic, 0), t.traffic, 0.10), 0, 100);
    s.happiness = clamp(lerp(num(s.happiness, 60), t.happiness, 0.14), 0, 100);
    s.ridership = Math.max(0, Math.round(lerp(num(s.ridership, 0), t.ridership, 0.12)));
  }

  // --------------------------------------------------------------- derive
  const RENT_LABEL = [[85, 'Cheap'], [105, 'Fair'], [130, 'Steep'], [165, 'Brutal'], [1e9, 'Unlivable']];
  const APP_LABEL = [[20, 'Recall watch'], [40, 'Underwater'], [55, 'Shaky'], [70, 'Popular'], [1e9, 'Landslide']];
  function label (table, v) { for (let i = 0; i < table.length; i++) if (v < table[i][0]) return table[i][1]; return table[table.length - 1][1]; }

  function derive (s) {
    const d = (s && s.d) || {};
    const pop = num(s && s.pop, 0);
    const workers = pop * K.WORKFORCE;
    const housingCapacity = Math.max(0, num(d.housing, 0));
    return {
      unemployment: workers > 1 ? clamp(1 - num(s.employed, 0) / workers, 0, 1) : 0,
      housingCapacity: housingCapacity,
      vacancy: housingCapacity > 0 ? clamp(1 - pop / housingCapacity, 0, 1) : 0,
      serviceCoverage: clamp(num(d.cov, 0), 0, 1),
      netDaily: num(d.net, num(s && s.dailyIncome, 0) - num(s && s.dailyCost, 0)),
      rentLabel: label(RENT_LABEL, num(s && s.rent, 100)),
      approvalLabel: label(APP_LABEL, num(s && s.approval, 50)),
      demand: {
        r: clamp(num(d.demand && d.demand.r, 0), -1, 1),
        c: clamp(num(d.demand && d.demand.c, 0), -1, 1),
        i: clamp(num(d.demand && d.demand.i, 0), -1, 1)
      }
    };
  }

  /* K is exported so the parcel inspector can state a building's capacity
     using the SAME table the simulation is running on, rather than a copy
     that silently disagrees the first time one of these numbers is tuned.
     Read-only by convention: nothing outside this file writes it. */
  MM.sim = { step: step, derive: derive, K: K };
})(window.MM);

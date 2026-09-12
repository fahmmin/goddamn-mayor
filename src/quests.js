/* MAYOR - the chapters, and what it takes to finish one.
 *
 * Onboarding, and the only reason it is a module rather than a script that
 * pokes the UI: every step here is a PURE PREDICATE over the state the game
 * already keeps. Nothing is stored, nothing is written, no field is added to
 * the save.
 *
 * That is the same bet src/ens.js and src/districts.js already make, and it
 * buys the same three things. A reload cannot desynchronise progress from the
 * city, because progress is not a second copy of anything - it is a reading of
 * the first. No save migration, so an existing city gains chapters the moment
 * this file loads and an old save is never wrong. And it is testable in node
 * with no DOM, which a tutorial that lives in the UI never is.
 *
 * The cost is that a step cannot ask a question about the past: "ten days of
 * surplus in a row" is not derivable from a state that only knows today. Every
 * step below is therefore a question about NOW, and where the plan wanted a
 * streak this asks for the thing the streak was a proxy for instead.
 *
 * The chain steps read s.chain, which web3/bundle.js writes and which is
 * simply absent when the chain layer is not loaded. Absent reads as not done,
 * never as an error - the game is fully playable without a wallet and the
 * first three chapters never mention one.
 */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var T = MM.TILE || {};

  function n (v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function count (s, tile) { return MM.count ? MM.count(s, tile) : 0; }

  /* The opening position is not an achievement. createState seeds a starter
     block - 26 road tiles and 24 zoned ones - so "lay a road" has to mean more
     road than you were given, or chapter two is complete before it is read. */
  var SEED_ROAD = 26;
  var SEED_ZONED = 24;

  function zoned (s) {
    return count(s, T.RES) + count(s, T.COM) + count(s, T.IND);
  }

  function anyGrown (s) {
    var lv = s && s.level;
    if (!lv) return false;
    for (var i = 0; i < lv.length; i++) if (lv[i] >= 2) return true;
    return false;
  }

  /* The rates every city opens on. Moving any one of them is the step - the
     point is that you looked at the tax structure at all, not that you found
     a particular number. */
  var OPENING_TAX = { res: 9, com: 11, ind: 12 };

  function taxTouched (s) {
    var t = s && s.taxRate;
    if (!t) return false;
    return n(t.res) !== OPENING_TAX.res || n(t.com) !== OPENING_TAX.com || n(t.ind) !== OPENING_TAX.ind;
  }

  function chain (s) { return (s && s.chain) || null; }

  function positions (s) {
    var ch = chain(s);
    var b = ch && ch.balances;
    if (!b || !b.positions) return 0;
    var sum = 0;
    for (var i = 0; i < b.positions.length; i++) sum += n(b.positions[i]);
    return sum;
  }

  /* ------------------------------------------------------------------ *
   * the chapters
   *
   * Ordered, static, and each step is one question. The three city chapters
   * come before the three chain ones on purpose: Start demo never signs in,
   * and a list whose first item needs a wallet would sit unfinished forever
   * on the one path that has to work without one.
   *
   * `hint` is what the card shows when a step is the next thing to do. It
   * names the action, not the mechanic - a checklist that explains the
   * simulation is a manual, and nobody reads a manual.
   * ------------------------------------------------------------------ */
  var CHAPTERS = [
    {
      id: 'ground', title: 'Break ground', kicker: 'Nothing grows without a road',
      steps: [
        { id: 'road', label: 'Lay some road of your own',
          hint: 'Press 1, then drag. Every lot needs a road it can touch.',
          done: function (s) { return count(s, T.ROAD) > SEED_ROAD; } },
        { id: 'zone', label: 'Zone beside it',
          hint: 'Press 2 for housing, 3 for shops. Zone next to road or pay upkeep on nothing.',
          done: function (s) { return zoned(s) > SEED_ZONED; } },
        { id: 'grow', label: 'Watch a block level up',
          hint: 'Leave it running. A well-served block builds itself taller.',
          done: anyGrown }
      ]
    },
    {
      id: 'alive', title: 'Keep them alive', kicker: 'The bills your tenants expect',
      steps: [
        { id: 'clinic', label: 'A public clinic', hint: 'Press 9.',
          done: function (s) { return count(s, T.CLINIC) > 0; } },
        { id: 'school', label: 'A school', hint: 'Press S.',
          done: function (s) { return count(s, T.SCHOOL) > 0; } },
        { id: 'grocery', label: 'A city grocery', hint: 'Press 7.',
          done: function (s) { return count(s, T.GROCERY) > 0; } },
        { id: 'transit', label: 'A way to get to work', hint: 'A bus stop (6) or a rail station (E).',
          done: function (s) { return count(s, T.BUS) + count(s, T.STATION) > 0; } },
        { id: 'approval', label: 'Hold approval at 60%',
          hint: 'Services are what hold it up. Approval is what holds your term.',
          done: function (s) { return n(s && s.approval) >= 60; } }
      ]
    },
    {
      id: 'pay', title: 'Make it pay', kicker: 'Somebody has to fund this',
      steps: [
        { id: 'tax', label: 'Set your own tax rates',
          hint: 'The Budget tab. Three rates, three constituencies, one you.',
          done: taxTouched },
        { id: 'surplus', label: 'Run a daily surplus',
          hint: 'Income above costs. Upkeep is charged every single day.',
          done: function (s) { return n(s && s.dailyIncome) > n(s && s.dailyCost); } },
        { id: 'people', label: 'Five hundred residents',
          hint: 'They arrive when the city is worth arriving in.',
          done: function (s) { return n(s && s.pop) >= 500; } }
      ]
    },
    {
      id: 'office', title: 'Take the office', kicker: 'Your name, on chain',
      steps: [
        { id: 'wallet', label: 'Sign in and get a wallet',
          hint: 'Be the Mayor, on the title screen. An email, nothing else.',
          done: function (s) { var c = chain(s); return !!(c && c.wallet && c.wallet.address); } },
        { id: 'name', label: 'The city reports under a live name',
          hint: 'mayor.cityhall.eth is held for a term, not owned.',
          done: function (s) { var c = chain(s); return !!(c && c.office && c.office.status === 0); } }
      ]
    },
    {
      id: 'record', title: 'Go on record', kicker: 'The part that is not a game',
      steps: [
        { id: 'canpush', label: 'The office will accept your writes',
          hint: 'Only the address holding the name can report the city.',
          done: function (s) { var c = chain(s); return !!(c && c.office && c.office.canPush); } },
        { id: 'pushed', label: 'Publish the city to the oracle',
          hint: 'Approval, rating, population and nine district valuations, on Sepolia.',
          done: function (s) { var c = chain(s); return !!(c && n(c.day) > 0); } }
      ]
    },
    {
      id: 'underwrite', title: 'Underwrite a district', kicker: 'Somebody bets on your term',
      steps: [
        { id: 'cash', label: 'Draw some CITYUSD',
          hint: 'The faucet, in the district market.',
          done: function (s) { var c = chain(s); return !!(c && c.balances && n(c.balances.cash) > 0); } },
        { id: 'position', label: 'Hold a position in a district',
          hint: 'A stock ERC-4626 vault. Its share price moves when the district does.',
          done: function (s) { return positions(s) > 0.5; } }
      ]
    }
  ];

  /* Six chapters, so six levels. The title is the whole reward - there is no
     bar, no points and nothing that ticks, because the city is already a
     screen full of numbers going up and down. */
  var LEVELS = ['Candidate', 'Councillor', 'Deputy', 'Mayor', 'Boss', 'Machine'];

  /* ------------------------------------------------------------------ *
   * reading
   * ------------------------------------------------------------------ */

  function chapterDone (c, s) {
    for (var i = 0; i < c.steps.length; i++) if (!c.steps[i].done(s)) return false;
    return true;
  }

  /* The current chapter is the first unfinished one. When everything is done
     it stays on the last, marked complete, rather than disappearing - the card
     is how you know there was a list at all. */
  function check (s) {
    /* Strictly sequential: the current chapter is the first unfinished one,
       and a later chapter finished early does not count until the ones before
       it are. That is deliberate - the list is a route, and crediting a step
       you reached by accident makes the next instruction a non sequitur. */
    var i = 0, k;
    while (i < CHAPTERS.length && chapterDone(CHAPTERS[i], s)) i++;
    var doneCount = i;
    if (i >= CHAPTERS.length) i = CHAPTERS.length - 1;
    var c = CHAPTERS[i];
    var steps = [], hit = 0, next = null;
    for (k = 0; k < c.steps.length; k++) {
      var st = c.steps[k];
      var ok = !!st.done(s);
      if (ok) hit++;
      else if (!next) next = st;
      steps.push({ id: st.id, label: st.label, hint: st.hint, done: ok });
    }
    return {
      index: i,
      id: c.id,
      title: c.title,
      kicker: c.kicker,
      steps: steps,
      hint: next ? next.hint : '',
      done: hit,
      total: c.steps.length,
      chaptersDone: doneCount,
      complete: doneCount >= CHAPTERS.length
    };
  }

  function level (s) {
    var d = check(s).chaptersDone;
    var i = Math.max(0, Math.min(LEVELS.length - 1, d));
    return { n: i + 1, title: LEVELS[i], of: LEVELS.length };
  }

  MM.quests = {
    CHAPTERS: CHAPTERS,
    LEVELS: LEVELS,
    check: check,
    level: level
  };
})(window.MM);

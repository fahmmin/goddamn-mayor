/* MAYOR MAMDANI - policies. Owned by the content agent. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  // dailyCost = fixed $/day. perCapita = extra $/day per resident (citywide programs
  // get more expensive as the city grows). NEGATIVE numbers mean the policy is a
  // revenue source - that is how taxTheRich and congestionPricing pay the bills.
  //
  // effects: approval is a TARGET offset in points (sim.js adds it to the approval
  // target and eases toward it), every *Mul is a multiplier that defaults to 1.
  //   rentMul, trafficMul, costMul, growthMul, popMul, pollutionMul

  const POLICIES = [
    {
      id: 'freeBuses',
      name: 'Fare-Free Buses',
      icon: '\u{1F68C}',
      blurb: 'Buses run free and fly, but the bill grows with every new rider.',
      dailyCost: 180,
      perCapita: 0.16,
      unlockPop: 300,
      effects: { approval: 7, trafficMul: 0.74, popMul: 1.03, pollutionMul: 0.94 },
      repeal: 'The fareboxes are back on the buses. Nobody has ever cheered for a farebox.'
    },
    {
      id: 'rentFreeze',
      name: 'Rent Freeze',
      icon: '\u{1F9CA}',
      blurb: 'Stabilized rents hold flat; landlords quietly stop building anything new.',
      dailyCost: 40,
      perCapita: 0.015,
      unlockPop: 250,
      effects: { approval: 9, rentMul: 0.985, growthMul: 0.86, popMul: 1.04 },
      repeal: 'The freeze is lifted. Two million lease renewals arrive with the same envelope.'
    },
    {
      id: 'cityGrocery',
      name: 'City-Owned Groceries',
      icon: '\u{1F966}',
      blurb: 'Municipal stores undercut gouging; the city eats the margin every single day.',
      dailyCost: 120,
      perCapita: 0.07,
      unlockPop: 600,
      effects: { approval: 5, popMul: 1.05, costMul: 1.03 },
      repeal: 'The city stores go dark. Eggs find their old price within a week.'
    },
    {
      id: 'universalChildcare',
      name: 'Universal Childcare',
      icon: '\u{1F9F8}',
      blurb: 'Care for every kid under five, at roughly the cost of everything else.',
      dailyCost: 240,
      perCapita: 0.14,
      unlockPop: 1200,
      effects: { approval: 8, popMul: 1.07, growthMul: 1.04 },
      repeal: 'Eleven thousand families get a letter about their new waitlist number.'
    },
    {
      id: 'taxTheRich',
      name: 'Tax the Top Bracket',
      icon: '\u{1F4B0}',
      blurb: 'Real money from the top floor; offices grow slower and complain louder.',
      dailyCost: -160,
      perCapita: -0.22,
      unlockPop: 800,
      effects: { approval: -5, growthMul: 0.93, rentMul: 0.997 },
      repeal: 'The top bracket goes back to where it was. Somewhere, a slide deck is retired.'
    },
    {
      id: 'communitySafety',
      name: 'Dept. of Community Safety',
      icon: '\u{1F9BA}',
      blurb: 'Trained responders instead of squad cars: cheap now, trusted in a year.',
      dailyCost: 70,
      perCapita: 0.04,
      unlockPop: 700,
      effects: { approval: 4, popMul: 1.03, growthMul: 1.02 },
      repeal: 'The crisis teams stand down. The calls do not stop coming in.'
    },
    {
      id: 'minimumWage30',
      name: '$30 Minimum Wage',
      icon: '\u{1F4B5}',
      blurb: 'Thirty an hour lifts the city; every storefront payroll goes up too.',
      dailyCost: 25,
      perCapita: 0.03,
      unlockPop: 900,
      effects: { approval: 6, costMul: 1.12, popMul: 1.04, growthMul: 0.97 },
      repeal: 'Wages roll back to the old floor. The floor was never the problem, but still.'
    },
    {
      id: 'freeSchoolMeals',
      name: 'Free School Meals',
      icon: '\u{1F34E}',
      blurb: 'Hot lunch for every student: no forms, no shame, no small invoice.',
      dailyCost: 60,
      perCapita: 0.09,
      unlockPop: 400,
      effects: { approval: 5, popMul: 1.04, growthMul: 1.01 },
      repeal: 'The lunch forms come back. So, eventually, does the lunch debt.'
    },

    /* ---- four of the house's own ---------------------------------------- */

    {
      id: 'congestionPricing',
      name: 'Congestion Pricing',
      icon: '\u{1F6A6}',
      // unpopular but correct: pays for itself and clears the streets, and costs you approval for it
      blurb: 'Tolls thin the traffic and fund the buses; drivers never forgive you.',
      dailyCost: -60,
      perCapita: -0.05,
      unlockPop: 1500,
      effects: { approval: -7, trafficMul: 0.70, pollutionMul: 0.88, growthMul: 1.02 },
      repeal: 'The gantries go dark and the avenue fills back in by Thursday.'
    },
    {
      id: 'ferryEverywhere',
      name: 'Ferries to Everywhere',
      icon: '\u{1F6A2}',
      // popular but a fiscal trap: adorable, beloved, and the worst subsidy per rider in the city
      blurb: 'Beloved boats to every waterfront, at a staggering subsidy per single rider.',
      dailyCost: 90,
      perCapita: 0.30,
      unlockPop: 1000,
      effects: { approval: 9, trafficMul: 0.97, popMul: 1.02 },
      repeal: 'The boats tie up for good. This will be on the front page for four days.'
    },
    {
      id: 'trashContainerization',
      name: 'Trash Containerization',
      icon: '\u{1F69B}',
      blurb: 'Bins instead of bags starves the rats and costs you parking spots.',
      dailyCost: 55,
      perCapita: 0.045,
      unlockPop: 500,
      effects: { approval: 1, pollutionMul: 0.80, popMul: 1.02 },
      repeal: 'Back to the bag piles. The rats have already sent word to their cousins.'
    },
    {
      id: 'publicPower',
      name: 'Public Power',
      icon: '⚡',
      blurb: 'City-owned green power cuts smog and bills, after a brutal build-out.',
      dailyCost: 260,
      perCapita: 0.05,
      unlockPop: 2200,
      effects: { approval: 3, pollutionMul: 0.70, costMul: 0.92, growthMul: 1.03 },
      repeal: 'The grid goes back to the utility, along with next winter\'s rate hike.'
    }
  ];

  const BY_ID = {};
  POLICIES.forEach(function (p) { BY_ID[p.id] = p; });

  function num (v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function money (v) { return '$' + Math.round(Math.abs(v)).toLocaleString('en-US'); }

  function hasPolicy (s, id) {
    return !!(s && s.policies && s.policies[id]);
  }

  // What this one policy costs per day at the city's current size.
  function costOf (p, pop) {
    return num(p.dailyCost) + num(p.perCapita) * Math.max(0, num(pop));
  }

  // Total $/day of every active policy. Negative contributors (taxes, tolls) net out.
  function policyDailyCost (s) {
    if (!s || !s.policies) return 0;
    let total = 0;
    for (let i = 0; i < POLICIES.length; i++) {
      if (s.policies[POLICIES[i].id]) total += costOf(POLICIES[i], s.pop);
    }
    return Math.round(total);
  }

  function togglePolicy (s, id) {
    const p = BY_ID[id];
    if (!s || !p) return { ok: false, msg: 'No such policy on the desk.' };
    if (!s.policies) s.policies = {};

    // --- turning it off: always allowed, never free -----------------------
    if (s.policies[id]) {
      delete s.policies[id];
      const bite = 4 + Math.round(Math.abs(num(p.effects && p.effects.approval)) * 1.1);
      s.approval = Math.max(0, Math.min(100, num(s.approval) - bite));
      MM.log(s, 'Repealed: ' + p.name + '.', 'bad');
      return { ok: true, msg: p.repeal + ' (-' + bite + ' approval)' };
    }

    // --- turning it on ----------------------------------------------------
    if (num(s.pop) < p.unlockPop) {
      return {
        ok: false,
        msg: p.name + ' needs a city of ' + p.unlockPop.toLocaleString('en-US') +
             '. You are governing ' + Math.round(num(s.pop)).toLocaleString('en-US') + ' people and a river.'
      };
    }

    const daily = costOf(p, s.pop);
    if (daily > num(s.treasury)) {
      return {
        ok: false,
        msg: p.name + ' runs ' + money(daily) + '/day and the treasury holds ' +
             money(s.treasury) + '. That is one day of program and then no city.'
      };
    }

    s.policies[id] = true;
    MM.log(s, 'Enacted: ' + p.name + '.', 'good');
    return {
      ok: true,
      msg: p.name + ' is law. ' + (daily < 0
        ? 'Brings in ' + money(daily) + '/day.'
        : 'Costs ' + money(daily) + '/day at this population.')
    };
  }

  MM.POLICIES = POLICIES;
  MM.hasPolicy = hasPolicy;
  MM.togglePolicy = togglePolicy;
  MM.policyDailyCost = policyDailyCost;
})(window.MM);

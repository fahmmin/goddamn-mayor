/* MAYOR - city events. Owned by the content agent. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const DAILY_CHANCE = 0.15;   // ~15% per game day
  const FIRST_DAY = 5;         // nothing fires in the first week of the term

  function num (v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function clamp (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Single place where state actually gets mutated, so nothing can ever go NaN
  // or out of range. Deltas are additive; rentMul multiplies the rent index.
  function fx (s, d, msg, kind) {
    if (!s) return;
    d = d || {};
    // every field is rewritten (not just the ones in the delta) so a single event
    // scrubs any NaN that got in upstream instead of passing it along.
    s.treasury = num(s.treasury) + num(d.treasury);                                  // may go negative
    s.approval = clamp(num(s.approval) + num(d.approval), 0, 100);
    s.happiness = clamp(num(s.happiness) + num(d.happiness), 0, 100);
    s.traffic = clamp(num(s.traffic) + num(d.traffic), 0, 100);
    s.pollution = clamp(num(s.pollution) + num(d.pollution), 0, 100);
    s.rent = Math.max(20, (num(s.rent) + num(d.rent)) * (d.rentMul ? num(d.rentMul) : 1));
    if (msg) {
      if (!Array.isArray(s.log)) s.log = [];
      MM.log(s, msg, kind || 'event');
    }
  }

  function setPolicy (s, id, on) {
    if (!s) return;
    if (!s.policies) s.policies = {};
    if (on) s.policies[id] = true; else delete s.policies[id];
  }

  function has (s, id) { return !!(s && s.policies && s.policies[id]); }
  function tiles (s, t) { try { return MM.count(s, t); } catch (e) { return 0; } }
  function buses (s) { return tiles(s, MM.TILE.BUS); }

  const EVENTS = [
    /* ---- rats, trash, weather ------------------------------------------ */
    {
      id: 'ratSummit',
      title: 'Rat Summit at City Hall',
      icon: '\u{1F400}',
      text: 'Sanitation reports the rat population is, in their word, thriving. A summit convenes on the steps; three rats attend uninvited.',
      weight: 7, cooldown: 45,
      cond: function (s) { return num(s.pollution) > 45; },
      choices: [
        { label: 'Containerize the entire city', hint: '(-$3,200, -14 pollution, enables Trash Containerization)',
          apply: function (s) { fx(s, { treasury: -3200, pollution: -14, approval: 2 }, 'Bins citywide. The rats file an appeal.', 'good'); setPolicy(s, 'trashContainerization', true); } },
        { label: 'Appoint a Rat Czar', hint: '(-$900, -5 pollution, +3 approval)',
          apply: function (s) { fx(s, { treasury: -900, pollution: -5, approval: 3 }, 'The city has a Rat Czar. The rats have a nemesis.', 'good'); } },
        { label: 'Call it a media invention', hint: '(free, -6 approval, +4 pollution)',
          apply: function (s) { fx(s, { approval: -6, pollution: 4 }, 'City Hall denies the rats. The rats do not deny City Hall.', 'bad'); } }
      ]
    },
    {
      id: 'snowDay',
      title: 'Eighteen Inches Overnight',
      icon: '\u{26C4}',
      text: 'The forecast went from flurries to a foot and a half by dinnertime. Every parent in the five boroughs is refreshing the schools page.',
      weight: 6, cooldown: 60,
      choices: [
        { label: 'Close the schools', hint: '(-$1,400, +5 approval, -4 happiness)',
          apply: function (s) { fx(s, { treasury: -1400, approval: 5, happiness: -4 }, 'Snow day. Every kid is thrilled; every working parent is not.', 'info'); } },
        { label: 'Stay open, plow all night', hint: '(-$3,600, -12 traffic, +2 approval)',
          apply: function (s) { fx(s, { treasury: -3600, traffic: -12, approval: 2 }, 'Every street plowed by 6 a.m. Somebody counted.', 'good'); } },
        { label: 'Remote learning, buses stay parked', hint: '(-$600, -4 approval, -6 traffic)',
          apply: function (s) { fx(s, { treasury: -600, approval: -4, traffic: -6 }, 'Remote learning. Half the city cannot log in.', 'bad'); } }
      ]
    },
    {
      id: 'heatwave',
      title: 'Ninety-Nine and Climbing',
      icon: '\u{1F975}',
      text: 'Third straight day above ninety-five. The grid is straining, the hydrants are open, and nobody in a fifth-floor walkup has slept.',
      weight: 5, cooldown: 70,
      choices: [
        { label: 'Cooling centers in every district', hint: '(-$2,800, +8 approval, +4 happiness)',
          apply: function (s) { fx(s, { treasury: -2800, approval: 8, happiness: 4 }, 'Cooling centers open citywide, buses free to reach them.', 'good'); } },
        { label: 'Open the hydrants, hand out caps', hint: '(-$500, +4 approval, +2 happiness)',
          apply: function (s) { fx(s, { treasury: -500, approval: 4, happiness: 2 }, 'Sprinkler caps on every block. Cheap, wet, beloved.', 'good'); } },
        { label: 'Ask everyone to conserve', hint: '(free, -6 approval, -5 happiness)',
          apply: function (s) { fx(s, { approval: -6, happiness: -5 }, 'The city is asked to conserve. The city is asked a lot.', 'bad'); } }
      ]
    },
    {
      id: 'hurricane',
      title: 'Storm Surge Warning',
      icon: '\u{1F300}',
      text: 'The cone shifted west overnight and the evacuation zones are lit up. Landfall Thursday, somewhere between Sandy Hook and the Rockaways.',
      weight: 3, cooldown: 100,
      cond: function (s) { return num(s.pop) > 1000; },
      choices: [
        { label: 'Order full evacuation now', hint: '(-$5,200, +6 approval, -3 happiness)',
          apply: function (s) { fx(s, { treasury: -5200, approval: 6, happiness: -3 }, 'Zone A evacuated. Shelters open in every borough.', 'good'); } },
        { label: 'Voluntary evacuation, stage equipment', hint: '(-$2,000, -2 approval)',
          apply: function (s) { fx(s, { treasury: -2000, approval: -2 }, 'Voluntary evacuation. Pumps staged, fingers crossed.', 'info'); } },
        { label: 'Wait for a better forecast', hint: '(free, -10 approval, +8 pollution)',
          apply: function (s) { fx(s, { approval: -10, pollution: 8, happiness: -4 }, 'The storm did not wait for the better forecast.', 'bad'); } }
      ]
    },
    {
      id: 'sanitationStrike',
      title: 'The Bags Are Winning',
      icon: '\u{1F6AE}',
      text: 'A sanitation slowdown enters day four. There are streets in the Bronx where the bag piles are taller than the parking signs.',
      weight: 4, cooldown: 65,
      cond: function (s) { return num(s.pollution) > 30; },
      choices: [
        { label: 'Settle tonight, whatever it costs', hint: '(-$3,800, -10 pollution, +6 approval)',
          apply: function (s) { fx(s, { treasury: -3800, pollution: -10, approval: 6 }, 'Deal signed at 2 a.m. The trucks roll at 5.', 'good'); } },
        { label: 'Bring in emergency contractors', hint: '(-$2,400, -7 pollution, -3 approval)',
          apply: function (s) { fx(s, { treasury: -2400, pollution: -7, approval: -3 }, 'Contractors clear the piles. The union remembers.', 'info'); } },
        { label: 'Wait them out', hint: '(free, +12 pollution, -9 approval)',
          apply: function (s) { fx(s, { pollution: 12, approval: -9, happiness: -4 }, 'Day nine. The smell has reached City Hall.', 'bad'); } }
      ]
    },

    /* ---- transit -------------------------------------------------------- */
    {
      id: 'subwayFlood',
      title: 'Water in the Tunnels',
      icon: '\u{1F30A}',
      text: 'Two inches of rain in an hour and the tunnels are canals again. Riders are being told to take the bus, which is your bus.',
      weight: 6, cooldown: 50,
      cond: function (s) { return buses(s) >= 2 || has(s, 'freeBuses'); },
      choices: [
        { label: 'Emergency bus surge all week', hint: '(-$2,400, +7 approval, -8 traffic)',
          apply: function (s) { fx(s, { treasury: -2400, approval: 7, traffic: -8 }, 'Every spare bus on the street by rush hour.', 'good'); } },
        { label: 'Pumps, and seal the grates', hint: '(-$1,300, +2 approval, -5 traffic)',
          apply: function (s) { fx(s, { treasury: -1300, approval: 2, traffic: -5 }, 'Grates sealed, pumps installed. Unglamorous, correct.', 'good'); } },
        { label: 'Say it is the MTA\'s problem', hint: '(free, -7 approval, +6 traffic)',
          apply: function (s) { fx(s, { approval: -7, traffic: 6 }, 'City Hall points at Albany. Albany points back.', 'bad'); } }
      ]
    },
    {
      id: 'lTrain',
      title: 'The L Train, Again',
      icon: '\u{1F687}',
      text: 'The tunnel needs work, the timeline is fourteen months, and the word L-pocalypse is already set in 90-point type.',
      weight: 4, cooldown: 80,
      cond: function (s) { return num(s.pop) > 1400; },
      choices: [
        { label: 'Bus bridge over the Williamsburg', hint: '(-$3,400, -10 traffic, +5 approval)',
          apply: function (s) { fx(s, { treasury: -3400, traffic: -10, approval: 5 }, 'A bus every ninety seconds over the bridge. It works.', 'good'); } },
        { label: 'Nights and weekends, stretch it three years', hint: '(-$1,200, +5 traffic, -2 approval)',
          apply: function (s) { fx(s, { treasury: -1200, traffic: 5, approval: -2 }, 'Three years of weekend shuttle buses begins.', 'info'); } },
        { label: 'Full shutdown, finish in nine months', hint: '(-$800, +18 traffic, -4 approval)',
          apply: function (s) { fx(s, { treasury: -800, traffic: 18, approval: -4 }, 'Full shutdown. Nine hard months, then it is done.', 'info'); } }
      ]
    },
    {
      id: 'busContract',
      title: 'The Operators Want a Contract',
      icon: '\u{1F68C}',
      text: 'Bus operators have been working without one since spring and have circled a date on the calendar. Strike route maps are already printed.',
      weight: 5, cooldown: 60,
      cond: function (s) { return buses(s) >= 2 || has(s, 'freeBuses'); },
      choices: [
        { label: 'Settle at their number', hint: '(-$4,500, +8 approval, +3 happiness)',
          apply: function (s) { fx(s, { treasury: -4500, approval: 8, happiness: 3 }, 'Contract signed. The buses run and the drivers are paid.', 'good'); } },
        { label: 'Split the difference, phase the raises', hint: '(-$2,000, +2 approval)',
          apply: function (s) { fx(s, { treasury: -2000, approval: 2 }, 'A phased deal. Nobody is thrilled, nobody walks.', 'info'); } },
        { label: 'Hold firm and take the strike', hint: '(free, -11 approval, +20 traffic)',
          apply: function (s) { fx(s, { approval: -11, traffic: 20, happiness: -5 }, 'Day one of the strike. The avenue is a parking lot.', 'bad'); } }
      ]
    },
    {
      id: 'fareEvasion',
      title: 'The Back Door Debate',
      icon: '\u{1F3AB}',
      text: 'Enforcement says a fifth of riders board without paying. On some routes the fare collection costs more than the fares collected.',
      weight: 5, cooldown: 45,
      cond: function (s) { return !has(s, 'freeBuses') && buses(s) >= 1; },
      choices: [
        { label: 'Go fare-free on the buses', hint: '(-$1,000, +9 approval, enables Fare-Free Buses)',
          apply: function (s) { fx(s, { treasury: -1000, approval: 9, traffic: -4 }, 'Fareboxes off. Every door is now the front door.', 'good'); setPolicy(s, 'freeBuses', true); } },
        { label: 'Fare inspectors on the busiest lines', hint: '(+$2,200, -7 approval)',
          apply: function (s) { fx(s, { treasury: 2200, approval: -7, happiness: -2 }, 'Inspectors deployed. Revenue up, mood down.', 'bad'); } },
        { label: 'Change nothing, keep the boxes', hint: '(free, -2 approval)',
          apply: function (s) { fx(s, { approval: -2 }, 'The fareboxes stay. So does the argument.', 'info'); } }
      ]
    },
    {
      id: 'dollarVan',
      title: 'The Dollar Vans of Flatbush',
      icon: '\u{1F690}',
      text: 'Commuter vans have been running the routes the buses gave up: two bucks, mostly unlicensed, entirely on time.',
      weight: 3, cooldown: 60,
      choices: [
        { label: 'License them as a real feeder network', hint: '(-$1,200, -7 traffic, +5 approval)',
          apply: function (s) { fx(s, { treasury: -1200, traffic: -7, approval: 5 }, 'The vans get plates, insurance, and a place on the map.', 'good'); } },
        { label: 'Impound the unlicensed ones', hint: '(+$1,400, -8 approval, +5 traffic)',
          apply: function (s) { fx(s, { treasury: 1400, approval: -8, traffic: 5 }, 'Forty vans impounded. Forty routes go unserved.', 'bad'); } },
        { label: 'Run city buses on those routes instead', hint: '(-$3,000, -9 traffic, +3 approval)',
          apply: function (s) { fx(s, { treasury: -3000, traffic: -9, approval: 3 }, 'City buses take over the van routes. Slower, but yours.', 'info'); } }
      ]
    },
    {
      id: 'bikeLaneFight',
      title: 'Protected Lane, Unprotected Meeting',
      icon: '\u{1F6B2}',
      text: 'The community board hearing on eleven blocks of protected bike lane has run four hours and is now, as always, about parking.',
      weight: 5, cooldown: 50,
      choices: [
        { label: 'Build the lane', hint: '(-$1,400, -6 traffic, -3 pollution, -4 approval)',
          apply: function (s) { fx(s, { treasury: -1400, traffic: -6, pollution: -3, approval: -4 }, 'The lane is built. Eleven blocks, forty parking spots, one furious block association.', 'info'); } },
        { label: 'Paint a line and call it a lane', hint: '(-$300, -2 traffic, -1 approval)',
          apply: function (s) { fx(s, { treasury: -300, traffic: -2, approval: -1 }, 'A painted lane appears. A double-parked truck appears on top of it.', 'info'); } },
        { label: 'Table it another year', hint: '(free, +3 approval, +4 traffic)',
          apply: function (s) { fx(s, { approval: 3, traffic: 4 }, 'Tabled to next spring, which is where lanes go to rest.', 'bad'); } }
      ]
    },
    {
      id: 'potholes',
      title: 'Pothole Season',
      icon: '\u{1F6A7}',
      text: 'The freeze-thaw cycle has done its annual work. 311 logged eleven thousand complaints before Tuesday lunch.',
      weight: 5, cooldown: 45,
      choices: [
        { label: 'Blitz: every crew, every night, two weeks', hint: '(-$3,000, -10 traffic, +5 approval)',
          apply: function (s) { fx(s, { treasury: -3000, traffic: -10, approval: 5 }, 'Eleven thousand potholes filled in fourteen nights.', 'good'); } },
        { label: 'Fix the worst hundred, publish the map', hint: '(-$1,100, -4 traffic, +2 approval)',
          apply: function (s) { fx(s, { treasury: -1100, traffic: -4, approval: 2 }, 'The worst hundred are patched and the map goes online.', 'info'); } },
        { label: 'Wait for paving season', hint: '(free, -5 approval, +7 traffic)',
          apply: function (s) { fx(s, { approval: -5, traffic: 7 }, 'Paving season is in April. It is not April.', 'bad'); } }
      ]
    },
    {
      id: 'waterMain',
      title: 'A Main From 1897 Lets Go',
      icon: '\u{1F6B0}',
      text: 'Eight feet of water on Amsterdam and a sinkhole where the crosswalk used to be. The pipe is older than the building it flooded.',
      weight: 4, cooldown: 55,
      choices: [
        { label: 'Replace the whole run while it is open', hint: '(-$4,400, -6 traffic, +4 approval)',
          apply: function (s) { fx(s, { treasury: -4400, traffic: -6, approval: 4 }, 'Six blocks of new main. Nobody will think about it for a century.', 'good'); } },
        { label: 'Patch, repave, reopen by morning', hint: '(-$1,500, +3 traffic, +1 approval)',
          apply: function (s) { fx(s, { treasury: -1500, traffic: 3, approval: 1 }, 'Patched and open by 6 a.m. The rest of the pipe is still 1897.', 'info'); } },
        { label: 'Cones and a promise', hint: '(-$200, -6 approval, +9 traffic)',
          apply: function (s) { fx(s, { treasury: -200, approval: -6, traffic: 9 }, 'The cones have been there so long they have a nickname.', 'bad'); } }
      ]
    },

    /* ---- money and power ------------------------------------------------ */
    {
      id: 'wallStreetLobby',
      title: 'A Very Polite Delegation',
      icon: '\u{1F3E6}',
      text: 'Six people from finance would like ninety minutes of your time. They have brought a slide deck titled Competitiveness.',
      weight: 6, cooldown: 40,
      cond: function (s) { return num(s.pop) > 2000 || has(s, 'taxTheRich'); },
      choices: [
        { label: 'Accept the "partnership fund"', hint: '(+$9,000, -8 approval)',
          apply: function (s) { fx(s, { treasury: 9000, approval: -8 }, 'The partnership fund clears. So does the photograph of the handshake.', 'bad'); } },
        { label: 'Repeal the top bracket to keep the towers', hint: '(+$3,000, -10 approval, disables Tax the Top Bracket)',
          apply: function (s) { fx(s, { treasury: 3000, approval: -10 }, 'The top bracket is rolled back. The deck worked.', 'bad'); setPolicy(s, 'taxTheRich', false); } },
        { label: 'Hold the line and publish the deck', hint: '(-$1,500, +6 approval)',
          apply: function (s) { fx(s, { treasury: -1500, approval: 6 }, 'The slide deck is posted online in full. It does not read well.', 'good'); } }
      ]
    },
    {
      id: 'budgetCrisis',
      title: 'The Comptroller Is On Line One',
      icon: '\u{1F4B8}',
      text: 'Payroll clears Friday and the numbers do not. Every agency has been asked to find nine percent by Thursday.',
      weight: 9, cooldown: 35,
      cond: function (s) { return num(s.treasury) < 2500; },
      choices: [
        { label: 'Short-term bond, pay for it later', hint: '(+$8,000, -5 approval)',
          apply: function (s) { fx(s, { treasury: 8000, approval: -5 }, 'The city borrows. Later is a problem for later.', 'info'); } },
        { label: 'Across-the-board cuts', hint: '(+$3,000, -8 approval, -5 happiness)',
          apply: function (s) { fx(s, { treasury: 3000, approval: -8, happiness: -5 }, 'Nine percent out of everything, including the things that worked.', 'bad'); } },
        { label: 'Tie up the ferries', hint: '(+$1,000, -6 approval, disables Ferries to Everywhere)',
          apply: function (s) { fx(s, { treasury: 1000, approval: -6 }, 'The boats stop. It was always the subsidy per rider.', 'bad'); setPolicy(s, 'ferryEverywhere', false); } }
      ]
    },
    {
      id: 'albanyBudget',
      title: 'Albany Holds the Envelope',
      icon: '\u{1F9FE}',
      text: 'The state budget is three weeks late and the city\'s share is a bargaining chip in a fight about something else entirely.',
      weight: 5, cooldown: 55,
      cond: function (s) { return num(s.pop) > 1000; },
      choices: [
        { label: 'Ride up and negotiate all week', hint: '(+$4,000, -3 approval)',
          apply: function (s) { fx(s, { treasury: 4000, approval: -3 }, 'A week in Albany buys the money and costs the optics.', 'info'); } },
        { label: 'Public pressure campaign instead', hint: '(-$1,200, +6 approval)',
          apply: function (s) { fx(s, { treasury: -1200, approval: 6 }, 'Rallies in three boroughs. Albany does not blink, the city does not care.', 'good'); } },
        { label: 'Bridge the gap from reserves', hint: '(-$2,500, +2 happiness)',
          apply: function (s) { fx(s, { treasury: -2500, happiness: 2 }, 'Reserves cover the gap. Reserves were the plan for something else.', 'info'); } }
      ]
    },
    {
      id: 'tabloidFront',
      title: 'The Front Page Has a Nickname For You',
      icon: '\u{1F4F0}',
      text: 'Tomorrow\'s tabloid runs your program above the fold, next to a photo of an empty office and a very large question mark.',
      weight: 7, cooldown: 30,
      cond: function (s) { return !!(s.policies && Object.keys(s.policies).length > 0); },
      choices: [
        { label: 'Counter-ad with the actual numbers', hint: '(-$1,800, +5 approval)',
          apply: function (s) { fx(s, { treasury: -1800, approval: 5 }, 'A full page of receipts runs opposite the front page.', 'good'); } },
        { label: 'Ignore it and keep working', hint: '(free, -4 approval, +2 happiness)',
          apply: function (s) { fx(s, { approval: -4, happiness: 2 }, 'No comment issued. The story runs for three more days.', 'info'); } },
        { label: 'Trim the program to kill the story', hint: '(+$900, -3 approval, +2 happiness)',
          apply: function (s) { fx(s, { treasury: 900, approval: -3, happiness: 2 }, 'The program is trimmed. The story dies; so does some of the program.', 'bad'); } }
      ]
    },
    {
      id: 'blackout',
      title: 'The Lights Go Out in Four Boroughs',
      icon: '\u{1F4A1}',
      text: 'A substation fails at 8:40 p.m. Traffic signals are dark and on every big corner somebody is directing cars with a flashlight.',
      weight: 3, cooldown: 90,
      cond: function (s) { return num(s.pop) > 1500; },
      choices: [
        { label: 'Emergency crews and generators, all night', hint: '(-$5,000, +9 approval, -6 traffic)',
          apply: function (s) { fx(s, { treasury: -5000, approval: 9, traffic: -6 }, 'Power back by dawn. The flashlight guy gets a proclamation.', 'good'); } },
        { label: 'Buy the grid a public backbone', hint: '(-$7,500, +4 approval, enables Public Power)',
          apply: function (s) { fx(s, { treasury: -7500, approval: 4, pollution: -4 }, 'The city buys into the grid. The next outage is the city\'s problem now.', 'good'); setPolicy(s, 'publicPower', true); } },
        { label: 'Let the utility clean up its own mess', hint: '(free, -12 approval, +10 traffic)',
          apply: function (s) { fx(s, { approval: -12, traffic: 10, happiness: -4 }, 'The utility takes four days. Everyone remembers who did not show up.', 'bad'); } }
      ]
    },

    /* ---- housing, kids, food -------------------------------------------- */
    {
      id: 'landlordSuit',
      title: 'A Landlord Group Sues',
      icon: '\u{1F4DC}',
      text: 'A property owners association has filed in state court, arguing the freeze is a taking. The hearing is set for six weeks out.',
      weight: 6, cooldown: 50,
      cond: function (s) { return has(s, 'rentFreeze'); },
      choices: [
        { label: 'Fight it with the city\'s best lawyers', hint: '(-$3,000, +5 approval)',
          apply: function (s) { fx(s, { treasury: -3000, approval: 5 }, 'The city lawyers up. The freeze holds, for now.', 'good'); } },
        { label: 'Settle: carve out small owners', hint: '(-$1,200, +1 approval, rent +4)',
          apply: function (s) { fx(s, { treasury: -1200, approval: 1, rent: 4 }, 'Buildings under six units are carved out of the freeze.', 'info'); } },
        { label: 'Drop the freeze before the ruling', hint: '(+$1,500, -12 approval, disables Rent Freeze)',
          apply: function (s) { fx(s, { treasury: 1500, approval: -12, rent: 10 }, 'The freeze is withdrawn. Renewal letters go out the same week.', 'bad'); setPolicy(s, 'rentFreeze', false); } }
      ]
    },
    {
      id: 'childcareWaitlist',
      title: 'Eleven Thousand on the Waitlist',
      icon: '\u{1F9F8}',
      text: 'The waitlist for subsidized seats is longer than the number of seats. Two parents brought the printout to the steps of City Hall.',
      weight: 5, cooldown: 55,
      cond: function (s) { return !has(s, 'universalChildcare') && num(s.pop) > 900; },
      choices: [
        { label: 'Universal childcare, starting Monday', hint: '(-$3,500, +11 approval, enables Universal Childcare)',
          apply: function (s) { fx(s, { treasury: -3500, approval: 11, happiness: 4 }, 'Universal childcare is announced from the steps. The printout is framed.', 'good'); setPolicy(s, 'universalChildcare', true); } },
        { label: 'Expand vouchers for the lowest incomes', hint: '(-$1,600, +5 approval, +3 happiness)',
          apply: function (s) { fx(s, { treasury: -1600, approval: 5, happiness: 3 }, 'Vouchers expand. The waitlist shortens by a third.', 'good'); } },
        { label: 'Commission a year-long study', hint: '(-$200, -6 approval)',
          apply: function (s) { fx(s, { treasury: -200, approval: -6 }, 'A study is commissioned. The kids will be six by the findings.', 'bad'); } }
      ]
    },
    {
      id: 'lunchTrays',
      title: 'Lunch Debt',
      icon: '\u{1F34E}',
      text: 'A principal in Queens has been quietly paying off cafeteria balances out of her own pocket. A local reporter found the receipts.',
      weight: 5, cooldown: 50,
      cond: function (s) { return !has(s, 'freeSchoolMeals') && tiles(s, MM.TILE.SCHOOL) >= 1; },
      choices: [
        { label: 'Free meals for every student, no forms', hint: '(-$1,800, +9 approval, enables Free School Meals)',
          apply: function (s) { fx(s, { treasury: -1800, approval: 9, happiness: 3 }, 'Every tray is free. Nobody has to hand anybody a form.', 'good'); setPolicy(s, 'freeSchoolMeals', true); } },
        { label: 'Erase the debt, keep the forms', hint: '(-$700, +4 approval)',
          apply: function (s) { fx(s, { treasury: -700, approval: 4 }, 'The lunch debt is wiped. The forms go out again in September.', 'info'); } },
        { label: 'Refer families to the existing program', hint: '(free, -7 approval, -3 happiness)',
          apply: function (s) { fx(s, { approval: -7, happiness: -3 }, 'Families are referred to the program they already could not navigate.', 'bad'); } }
      ]
    },
    {
      id: 'groceryOpening',
      title: 'First City Grocery Opens',
      icon: '\u{1F966}',
      text: 'The line wraps the corner for eggs at cost. Two blocks down, a bodega owner of thirty years is doing some math.',
      weight: 4, cooldown: 70,
      cond: function (s) { return has(s, 'cityGrocery'); },
      choices: [
        { label: 'Bodega partnership at city prices', hint: '(-$2,200, +7 approval, +3 happiness)',
          apply: function (s) { fx(s, { treasury: -2200, approval: 7, happiness: 3 }, 'Corner stores join the buying co-op. The block keeps its bodega.', 'good'); } },
        { label: 'Cut the ribbon and move on', hint: '(free, +3 approval, -3 happiness)',
          apply: function (s) { fx(s, { approval: 3, happiness: -3 }, 'Ribbon cut. Two blocks down, the shelves start emptying for good.', 'info'); } },
        { label: 'Raise city prices to protect the block', hint: '(+$900, -4 approval, +2 happiness)',
          apply: function (s) { fx(s, { treasury: 900, approval: -4, happiness: 2 }, 'City prices go up to match the bodega. Nobody understands the press release.', 'info'); } }
      ]
    },
    {
      id: 'halalCart',
      title: 'The Cart Permit Cap',
      icon: '\u{1F32F}',
      text: 'A vendor on 53rd has been renting his permit from a middleman for twenty grand a year. The cap has not moved since the eighties.',
      weight: 4, cooldown: 50,
      choices: [
        { label: 'Lift the cap, issue permits directly', hint: '(-$900, +6 approval, -2 happiness)',
          apply: function (s) { fx(s, { treasury: -900, approval: 6, happiness: -2 }, 'Permits go direct to vendors. The middlemen are extremely available for comment.', 'good'); } },
        { label: 'Crack down on the resale market', hint: '(+$1,100, -3 approval)',
          apply: function (s) { fx(s, { treasury: 1100, approval: -3 }, 'Enforcement sweeps the resale market and half the carts with it.', 'bad'); } },
        { label: 'Keep the cap, add a hundred permits', hint: '(-$300, +2 approval)',
          apply: function (s) { fx(s, { treasury: -300, approval: 2 }, 'A hundred new permits. The waitlist is nine thousand.', 'info'); } }
      ]
    },
    {
      id: 'communityResponders',
      title: 'A 3 a.m. Call on Nostrand',
      icon: '\u{1F9BA}',
      text: 'A mental-health call ties up two squad cars for five hours. Everyone at the scene agrees they were the wrong people to send.',
      weight: 5, cooldown: 55,
      cond: function (s) { return !has(s, 'communitySafety') && num(s.pop) > 700; },
      choices: [
        { label: 'Stand up the Department of Community Safety', hint: '(-$2,600, +6 approval, enables Dept. of Community Safety)',
          apply: function (s) { fx(s, { treasury: -2600, approval: 6, happiness: 3 }, 'Crisis teams take the call type citywide, starting next month.', 'good'); setPolicy(s, 'communitySafety', true); } },
        { label: 'One pilot team in one precinct', hint: '(-$800, +2 approval)',
          apply: function (s) { fx(s, { treasury: -800, approval: 2 }, 'A pilot team, one precinct, eighteen months of evaluation.', 'info'); } },
        { label: 'Fund more overtime instead', hint: '(-$1,900, -2 approval, +1 happiness)',
          apply: function (s) { fx(s, { treasury: -1900, approval: -2, happiness: 1 }, 'The overtime line grows. So does the same call, every night.', 'bad'); } }
      ]
    },

    /* ---- rare and delightful ------------------------------------------- */
    {
      id: 'pizzaRat',
      title: 'Pizza Rat Returns',
      icon: '\u{1F355}',
      text: 'A rat hauling a full slice down the 14th Street stairs has forty million views by lunch. The city is charmed and faintly ashamed.',
      weight: 2, cooldown: 120,
      choices: [
        { label: 'Put him on the recycling posters', hint: '(-$400, +5 approval, +2 happiness)',
          apply: function (s) { fx(s, { treasury: -400, approval: 5, happiness: 2 }, 'Pizza Rat is now the face of the recycling campaign. Engagement is unbelievable.', 'good'); } },
        { label: 'Use the moment to launch the bin program', hint: '(-$2,000, -8 pollution, +2 approval)',
          apply: function (s) { fx(s, { treasury: -2000, pollution: -8, approval: 2 }, 'The bin program launches on the back of one viral rodent.', 'good'); } },
        { label: 'No comment', hint: '(free, -1 approval)',
          apply: function (s) { fx(s, { approval: -1 }, 'City Hall declines to comment on the rat. The rat does not.', 'info'); } }
      ]
    },
    {
      id: 'bodegaCat',
      title: 'A Cat Files for City Council',
      icon: '\u{1F408}',
      text: 'A bodega cat in Sunset Park has ninety thousand signatures, a campaign hat, and no legal standing whatsoever. The Board of Elections is not amused.',
      weight: 2, cooldown: 140,
      choices: [
        { label: 'Endorse the cat', hint: '(-$200, +7 approval, -2 happiness)',
          apply: function (s) { fx(s, { treasury: -200, approval: 7, happiness: -2 }, 'The mayor endorses a cat. Two editorial boards resign themselves to four more years.', 'good'); } },
        { label: 'Small-business grant for the bodega instead', hint: '(-$1,200, +3 approval, +3 happiness)',
          apply: function (s) { fx(s, { treasury: -1200, approval: 3, happiness: 3 }, 'The bodega gets a grant. The cat gets a bigger box by the register.', 'good'); } },
        { label: 'Politely cite the city charter', hint: '(free, -4 approval, +2 happiness)',
          apply: function (s) { fx(s, { approval: -4, happiness: 2 }, 'City Hall explains ballot eligibility rules. It is the correct and least popular answer.', 'info'); } }
      ]
    },
    {
      id: 'filmCrew',
      title: 'They Want Six Blocks for a Week',
      icon: '\u{1F3AC}',
      text: 'A streaming production will pay well to shut down six blocks of Greenpoint. Trailers, generators, and a fake rain rig running at 3 a.m.',
      weight: 3, cooldown: 55,
      choices: [
        { label: 'Take the permit money', hint: '(+$4,200, -5 approval, +9 traffic)',
          apply: function (s) { fx(s, { treasury: 4200, approval: -5, traffic: 9 }, 'Six blocks closed for a week. The fake rain runs until four.', 'info'); } },
        { label: 'Approve it if they hire and feed the block', hint: '(+$2,000, +2 approval, +6 traffic)',
          apply: function (s) { fx(s, { treasury: 2000, approval: 2, traffic: 6 }, 'Local crew, local catering, and craft services open to the block.', 'good'); } },
        { label: 'Deny the permit', hint: '(free, +3 approval, -2 happiness)',
          apply: function (s) { fx(s, { approval: 3, happiness: -2 }, 'Permit denied. The block sleeps; the crew shoots in Toronto.', 'info'); } }
      ]
    },
    {
      id: 'sliceWar',
      title: 'The Dollar Slice War',
      icon: '\u{1F4B2}',
      text: 'Two shops on the same Astoria block have gone to ninety-nine cents. A third is at seventy-five and the block is beside itself.',
      weight: 2, cooldown: 110,
      choices: [
        { label: 'Show up, buy a slice, say nothing about margins', hint: '(-$40, +4 approval)',
          apply: function (s) { fx(s, { treasury: -40, approval: 4 }, 'The mayor eats a slice on camera, correctly, folded.', 'good'); } },
        { label: 'Small-business grants so nobody undercuts to death', hint: '(-$1,600, +2 approval, +4 happiness)',
          apply: function (s) { fx(s, { treasury: -1600, approval: 2, happiness: 4 }, 'Grants end the price war. All three shops survive the winter.', 'good'); } },
        { label: 'Send in the health inspectors', hint: '(+$600, -5 approval)',
          apply: function (s) { fx(s, { treasury: 600, approval: -5 }, 'Inspectors visit all three. Two Bs and a C, and one very bad news cycle.', 'bad'); } }
      ]
    },
    {
      id: 'paradeRoute',
      title: 'Everyone Wants Fifth Avenue',
      icon: '\u{1F389}',
      text: 'Four parades have applied for the same Saturday. All four have been marching that avenue longer than you have been alive.',
      weight: 4, cooldown: 50,
      choices: [
        { label: 'Run all four, stagger them, pay the overtime', hint: '(-$2,600, +7 approval, +12 traffic)',
          apply: function (s) { fx(s, { treasury: -2600, approval: 7, traffic: 12 }, 'Four parades, one Saturday, zero incidents, enormous overtime.', 'good'); } },
        { label: 'One parade, lottery for the rest', hint: '(-$400, -3 approval, +4 traffic)',
          apply: function (s) { fx(s, { treasury: -400, approval: -3, traffic: 4 }, 'A lottery decides. Three organizing committees will never forget.', 'info'); } },
        { label: 'Move them all to the park, close no streets', hint: '(-$900, -5 approval, +5 happiness)',
          apply: function (s) { fx(s, { treasury: -900, approval: -5, happiness: 5 }, 'The parades go to the park. Traffic flows and nobody is happy about it.', 'info'); } }
      ]
    }
  ];

  // Fires at most once per game day. Never throws.
  /* Every choice's dollar figure is authored for a mid-size city (~6k people).
     Left literal, a $5,000 snow-removal bill bankrupts a town of 800 and is
     pocket change to a city of 80,000. So measure whatever the author's apply()
     did to the treasury and rescale it to the city actually being governed.
     Wrapping at hand-out time means every caller gets this for free, and the
     authored EVENTS objects are never mutated. */
  const REF_POP = 6000;
  function scaleMoney (evt) {
    const out = {};
    for (const k in evt) if (Object.prototype.hasOwnProperty.call(evt, k)) out[k] = evt[k];
    out.choices = (evt.choices || []).map(function (c) {
      const wrapped = {};
      for (const k in c) if (Object.prototype.hasOwnProperty.call(c, k)) wrapped[k] = c[k];
      wrapped.apply = function (s) {
        const before = num(s.treasury);
        c.apply(s);
        const delta = num(s.treasury) - before;
        if (!delta) return;
        let k = 0.3 + num(s.pop) / REF_POP;
        k = k < 0.3 ? 0.3 : k > 4 ? 4 : k;
        s.treasury = before + delta * k;
      };
      return wrapped;
    });
    return out;
  }

  function maybeFireEvent (s) {
    try {
      if (!s || s.pending) return null;
      const day = num(s.day);
      if (day < FIRST_DAY) return null;
      if (!s.cooldowns || typeof s.cooldowns !== 'object') s.cooldowns = {};
      if (Math.random() > DAILY_CHANCE) return null;

      const pool = [];
      let total = 0;
      for (let i = 0; i < EVENTS.length; i++) {
        const e = EVENTS[i];
        if (num(s.cooldowns[e.id]) > day) continue;
        if (e.cond) {
          let ok = false;
          try { ok = !!e.cond(s); } catch (err) { ok = false; }
          if (!ok) continue;
        }
        const w = Math.max(0, num(e.weight));
        if (w <= 0) continue;
        pool.push(e); total += w;
      }
      if (!pool.length || total <= 0) return null;

      let r = Math.random() * total;
      let pick = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        r -= Math.max(0, num(pool[i].weight));
        if (r <= 0) { pick = pool[i]; break; }
      }
      s.cooldowns[pick.id] = day + Math.max(1, num(pick.cooldown) || 30);
      return scaleMoney(pick);
    } catch (err) {
      return null;
    }
  }

  MM.EVENTS = EVENTS;
  MM.maybeFireEvent = maybeFireEvent;
})(window.MM);

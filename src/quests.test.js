/* node src/quests.test.js
 *
 * The chapters are a pure reading of game state, so they are testable the way
 * sim.js and ens.js are: build a city, ask the question, check the answer. No
 * DOM, no browser, no fixtures.
 *
 * What matters here is mostly not "does step X flip". It is that the list
 * cannot lie about a city - that the opening position scores zero, that
 * reading it twice gives the same answer, and that a missing chain layer is
 * an unfinished chapter rather than a thrown exception.
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = { MM: {} };
for (const f of ['state.js', 'districts.js', 'quests.js']) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), 'utf8'));
}
const MM = global.window.MM;
const T = MM.TILE;

let pass = 0;
const fails = [];
function ok (cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label); }
}

function fresh () { return MM.createState(); }
function put (s, x, y, tile) { s.grid[MM.idx(x, y)] = tile; }

console.log('\nMAYOR - quest tests\n');

// ---------------------------------------------------------------- purity
{
  const s = fresh();
  const before = JSON.stringify({ g: Array.from(s.grid), a: s.approval, t: s.taxRate, p: s.pop });
  const a = MM.quests.check(s);
  const b = MM.quests.check(s);
  const after = JSON.stringify({ g: Array.from(s.grid), a: s.approval, t: s.taxRate, p: s.pop });
  ok(before === after, 'check() does not touch the state it reads');
  ok(JSON.stringify(a) === JSON.stringify(b), 'check() twice on one city gives one answer');
}

// ------------------------------------------------------- the opening position
{
  const s = fresh();
  const q = MM.quests.check(s);
  ok(q.id === 'ground', 'a new city opens on chapter one');
  ok(q.done === 0, 'the starter block scores nothing - it was a gift, not a move (' + q.done + ')');
  ok(MM.quests.level(s).title === 'Candidate', 'and you start as Candidate');
  ok(!!q.hint, 'an unfinished chapter always offers the next action');
}

/* The regression that matters: createState seeds 26 roads and 24 zoned tiles.
   A naive "has a road" predicate is true before the player has done anything,
   and the whole first chapter completes itself on load. */
{
  const s = fresh();
  ok(MM.count(s, T.ROAD) > 0, 'the starter block really does ship with road');
  ok(MM.quests.check(s).steps[0].done === false, 'and shipped road does not count as laying road');

  let laid = 0;
  for (let x = 2; x < 9 && laid < 6; x++, laid++) put(s, x, 40, T.ROAD);
  ok(MM.quests.check(s).steps[0].done === true, 'road you laid yourself does count');
}

// ---------------------------------------------------------------- sequencing
{
  const s = fresh();
  // finish a LATER chapter without touching the earlier ones
  put(s, 2, 2, T.CLINIC); put(s, 3, 2, T.SCHOOL);
  put(s, 4, 2, T.GROCERY); put(s, 5, 2, T.BUS);
  s.approval = 90;
  const q = MM.quests.check(s);
  ok(q.id === 'ground', 'a chapter finished out of order does not jump the queue');
  ok(MM.quests.level(s).n === 1, 'and does not hand out a level for it');
}

// ------------------------------------------------------------ walking the list
{
  const s = fresh();
  for (let x = 2; x < 10; x++) put(s, x, 40, T.ROAD);
  for (let x = 2; x < 10; x++) put(s, x, 41, T.RES);
  s.level[MM.idx(3, 41)] = 3;
  ok(MM.quests.check(s).id === 'alive', 'finishing chapter one moves you to chapter two');
  ok(MM.quests.level(s).title === 'Councillor', 'and one chapter is one level');

  put(s, 2, 2, T.CLINIC); put(s, 3, 2, T.SCHOOL);
  put(s, 4, 2, T.GROCERY); put(s, 5, 2, T.BUS);
  s.approval = 72;
  ok(MM.quests.check(s).id === 'pay', 'the tenant utilities close chapter two');

  s.taxRate = { res: 14, com: 11, ind: 12 };
  s.dailyIncome = 900; s.dailyCost = 400; s.pop = 800;
  const q = MM.quests.check(s);
  ok(q.id === 'office', 'a city that pays for itself reaches the chain chapters');
  ok(q.done === 0, 'which it has not started, because there is no wallet');
}

// ------------------------------------------------------- taxes are a decision
{
  const s = fresh();
  ok(MM.quests.check(s).steps.every(x => x.id !== 'tax'), 'tax is not asked about in chapter one');
  const t = MM.quests.CHAPTERS.find(c => c.id === 'pay').steps.find(x => x.id === 'tax');
  ok(t.done(s) === false, 'the rates a city opens on are not a decision you made');
  s.taxRate = { res: 9, com: 11, ind: 13 };
  ok(t.done(s) === true, 'moving any one of the three is');
}

// ------------------------------------------------ no chain layer is not a crash
{
  const s = fresh();
  delete s.chain;
  let threw = null;
  try { MM.quests.check(s); MM.quests.level(s); } catch (e) { threw = e; }
  ok(!threw, 'a city with no chain layer reads cleanly (' + (threw && threw.message) + ')');

  const office = MM.quests.CHAPTERS.find(c => c.id === 'office');
  ok(office.steps.every(x => x.done(s) === false), 'and its chain steps are simply unfinished');

  s.chain = { wallet: null, office: null, balances: null };
  ok(office.steps.every(x => x.done(s) === false), 'a chain layer with nothing in it likewise');

  s.chain = { wallet: { address: '0xabc' }, office: { status: 0, canPush: true }, day: 42 };
  ok(office.steps.every(x => x.done(s) === true), 'a live office finishes the chapter');
}

// ---------------------------------------------------------------- completion
{
  const s = fresh();
  for (let x = 2; x < 12; x++) { put(s, x, 40, T.ROAD); put(s, x, 41, T.RES); }
  s.level[MM.idx(3, 41)] = 3;
  put(s, 2, 2, T.CLINIC); put(s, 3, 2, T.SCHOOL);
  put(s, 4, 2, T.GROCERY); put(s, 5, 2, T.BUS);
  s.approval = 72;
  s.taxRate = { res: 14, com: 11, ind: 12 };
  s.dailyIncome = 900; s.dailyCost = 400; s.pop = 800;
  s.chain = {
    wallet: { address: '0xabc' }, office: { status: 0, canPush: true }, day: 42,
    balances: { cash: 1000, positions: [0, 0, 250, 0, 0, 0, 0, 0, 0] }
  };
  const q = MM.quests.check(s);
  ok(q.complete === true, 'every chapter can actually be finished');
  ok(MM.quests.level(s).title === 'Machine', 'and the last level is reachable');
  ok(q.hint === '', 'a finished list stops giving instructions');
}

console.log('\n' + pass + ' passing' + (fails.length ? ', ' + fails.length + ' FAILING' : '') + '\n');
if (fails.length) process.exit(1);

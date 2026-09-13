/* node subgraph/verify-index.js [url]
 *
 * Assertions against the DEPLOYED subgraph, in the spirit of
 * chain/verify-gate.js: the gate script proves the contract enforces the
 * office, this one proves the index remembers it.
 *
 * The distinction matters because they fail differently. A subgraph that is
 * still syncing, pointed at a stale address, or deployed from a manifest whose
 * startBlock is too late all return the same thing - an empty array, with HTTP
 * 200 and no error. "No rows" is indistinguishable from "not finished" unless
 * something asks a question it knows the answer to. That is what this does.
 *
 * Reads SUBGRAPH_URL from the environment or .env, or takes it as argv[2].
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Same .env convention as web3/make-config.js: a checkout has the file, a
   build server has the variables, neither should need the other. */
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

let URL_ = process.argv[2] || process.env.SUBGRAPH_URL || '';
if (!URL_) {
  try {
    URL_ = JSON.parse(fs.readFileSync(path.join(ROOT, 'web3', 'config.json'), 'utf8')).subgraph || '';
  } catch { /* not generated yet */ }
}
if (!URL_) {
  console.error('\n  no subgraph url.\n' +
    '  pass one:  node subgraph/verify-index.js https://api.studio.thegraph.com/query/…\n' +
    '  or set SUBGRAPH_URL in .env\n');
  process.exit(1);
}

/* The role bitmap CityOracle accepts, from the deployment rather than a
   literal - the same source build-manifest.js generates the mapping from. */
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'chain', 'deployed.json'), 'utf8'));
const WRITE_ROLE = BigInt((D.offices && D.offices.mayor && D.offices.mayor.role) || '0');

let passed = 0, failed = 0;
function ok (label, cond, detail) {
  if (cond) { passed++; console.log('  ok    ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function gql (query) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  /* GraphQL answers 200 with an errors array, so a response that did not throw
     is not the same thing as one that succeeded. */
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
  return j.data;
}

async function main () {
  console.log('\n  ' + URL_ + '\n');

  const d = await gql(`{
    names(first: 25, orderBy: registeredAt) {
      label owner expiry roles canWrite active burned
      events(first: 50) { kind roleBitmap }
    }
    city(id: "0x63697479") { pushes lastDay }
    vaults(first: 9) { districtId ensName }
  }`);

  const names = d.names || [];
  ok('the registry is indexed at all', names.length > 0, names.length + ' names');

  const byLabel = {};
  for (const n of names) byLabel[n.label] = n;

  const mayor = byLabel['mayor'];
  ok('mayor.cityhall.eth is in the index', !!mayor);
  if (mayor) {
    ok('  it carries an expiry', BigInt(mayor.expiry) > 0n,
      new Date(Number(mayor.expiry) * 1000).toISOString().slice(0, 10));
    ok('  the index agrees it may write', mayor.canWrite === true,
      'roles ' + mayor.roles);
    ok('  which is the write role the oracle demands',
      (BigInt(mayor.roles) & WRITE_ROLE) === WRITE_ROLE,
      'WRITE_ROLE ' + WRITE_ROLE.toString());
  }

  /* The bonus bullet, checkable. An agent whose permissions ARE its name is
     only an interesting claim if the absence of the role is verifiable - so
     this asserts the negative, and asserts it on the whole event history
     rather than only on the current bitmap. A role granted and then revoked
     would leave canWrite false and still falsify the claim. */
  const deputy = byLabel['deputy'];
  ok('deputy.cityhall.eth is in the index', !!deputy);
  if (deputy) {
    ok('  it cannot write', deputy.canWrite === false, 'roles ' + deputy.roles);
    const everHadWrite = (deputy.events || []).some(
      ev => ev.roleBitmap && (BigInt(ev.roleBitmap) & WRITE_ROLE) === WRITE_ROLE);
    ok('  and has never once held the write role', !everHadWrite,
      (deputy.events || []).length + ' role events checked');
  }

  ok('the oracle half is indexed too', !!d.city && d.city.pushes > 0,
    d.city ? d.city.pushes + ' pushes, day ' + d.city.lastDay : 'no city row');
  ok('all nine vaults are indexed', (d.vaults || []).length === 9,
    (d.vaults || []).length + '/9');

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('\n  ' + String(e.message || e) + '\n');
  process.exit(1);
});

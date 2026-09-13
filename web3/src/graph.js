/* The subgraph client.
 *
 * Why this exists at all, stated plainly: an RPC can tell you what a district
 * is worth right now, in one eth_call. It cannot tell you what it was worth
 * over the last ninety days without ninety archive calls against a node that
 * probably does not keep the state, and it cannot list one wallet's position
 * across nine vaults in fewer than nine round trips. Both are one request
 * here. If the only thing a subgraph bought were a logo on a slide it would
 * not be worth a file.
 *
 * The sparkline in the market panel was a client-side rolling sample - real
 * numbers, but sampled in the browser and gone on reload. With this it is the
 * actual series the oracle wrote, which is the difference between a chart of
 * the game and a chart of the record.
 *
 * Failure discipline matches index.js exactly: a dead endpoint is STALENESS,
 * never a crash. Nothing here throws where the game can see it, and the panel
 * keeps its last-known numbers and falls back to the local sample.
 */

const TIMEOUT_MS = 8000;

let url = null;
let failures = 0;

export function configure (cfg) {
  url = (cfg && cfg.subgraph) || null;
  return !!url;
}

export function isConfigured () { return !!url; }

/* One fetch, one timeout, one shape of error. GraphQL answers 200 with an
 * `errors` array for a bad query, so a non-throwing response is not the same
 * thing as a successful one and both are checked. */
async function query (text, variables) {
  if (!url) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: text, variables: variables || {} }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error('subgraph HTTP ' + r.status);
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(String(j.errors[0].message).slice(0, 140));
    failures = 0;
    return j.data;
  } catch (e) {
    failures++;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function health () { return { url: url, failures: failures }; }

// ---------------------------------------------------------------- queries

const Q_DISTRICTS = `{
  vaults(first: 9, orderBy: districtId) {
    id districtId ensName totalAssets totalShares sharePrice
    depositedTotal withdrawnTotal settledTotal
  }
  city(id: "0x63697479") { lastDay lastApproval lastRating lastPop pushes wallets }
}`;

/* Nine vaults and the city header in one request, where the RPC needs ten
 * calls. `city` is keyed on the bytes of the literal string "city". */
export async function queryDistricts () {
  const d = await query(Q_DISTRICTS);
  if (!d) return null;
  return { vaults: d.vaults || [], city: d.city || null };
}

const Q_POSITIONS = `query($who: Bytes!) {
  positions(where: { account: $who, shares_gt: "0" }, first: 50) {
    shares depositedAssets withdrawnAssets updatedAt
    vault { id districtId ensName sharePrice }
  }
}`;

/* Every position a wallet holds, across every vault, in one request. */
export async function queryPositions (address) {
  if (!address) return null;
  const d = await query(Q_POSITIONS, { who: String(address).toLowerCase() });
  return d ? (d.positions || []) : null;
}

const Q_HISTORY = `query($n: Int!) {
  districtSnapshots(first: $n, orderBy: day, orderDirection: desc) {
    districtId day nav pop land level timestamp
  }
}`;

/* The series the sparkline draws.
 *
 * One request for every district rather than one per district: a push writes
 * all nine in the same transaction, so they interleave in day order and
 * splitting them into nine queries would be nine times the work for the same
 * rows. Returned oldest-first per district, because that is the direction a
 * chart is drawn in and reversing it here means no caller has to remember.
 */
export async function queryHistory (days) {
  const n = Math.max(1, Math.min(1000, (days || 90) * 9));
  const d = await query(Q_HISTORY, { n: n });
  if (!d) return null;

  const by = {};
  const rows = d.districtSnapshots || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    (by[r.districtId] || (by[r.districtId] = [])).push(Number(r.nav));
  }
  for (const k in by) by[k].reverse();       // desc from the query, asc for a chart
  return by;
}

const Q_OFFICES = `{
  names(first: 25, orderBy: registeredAt) {
    label owner expiry roles canWrite active burned registeredAt burnedAt
  }
}`;

/* The offices, as the registry recorded them rather than as they stand now.
 *
 * The market panel already knows whether the CURRENT mayor can push - index.js
 * asks the oracle's canPush() over the RPC every ten seconds, and one eth_call
 * is the right tool for a question about now. This answers the one the RPC
 * cannot: what the office looked like before it was burned. `unregister()`
 * leaves no state behind, so after the recall an RPC can only report that
 * nobody holds mayor.cityhall.eth - not who did, nor that they held the write
 * role while they signed ninety days of valuations.
 *
 * Useful without a wallet and without a signature, which is the point: a judge
 * can check that deputy.cityhall.eth has canWrite false and has never had a
 * ROLES_CHANGED event setting the write bit, without trusting the README.
 *
 * Same failure discipline as everything else here - null, never a throw.
 */
export async function queryOffices () {
  const d = await query(Q_OFFICES);
  return d ? (d.names || []) : null;
}

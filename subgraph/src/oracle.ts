/* CityOracle - the only thing that writes the city onto the chain.
 *
 * One push per term-interval carries the whole city: approval, rating,
 * population, and nine district valuations. That is nine DistrictPushed logs
 * inside one transaction, which is why event ids are keyed on log index and
 * not on the transaction hash.
 *
 * The oracle can only be written by the address holding mayor.cityhall.eth,
 * and the name expires. So CitySnapshot is a record of who said what about the
 * city and when - and it is immutable here for the same reason it is immutable
 * there: a term's record is not editable.
 */
import { Address, Bytes, BigInt } from '@graphprotocol/graph-ts';
import { CityPushed, DistrictPushed, Settled } from '../generated/CityOracle/CityOracle';
import { CitySnapshot, DistrictSnapshot, Mayor, VaultEvent } from '../generated/schema';
import { getVault, getCity, eventId, ZERO, ONE } from './shared';
import { vaultForId } from './districts';

/* A push's snapshot id is the transaction plus the day, not the log index:
 * DistrictPushed handlers need to find the CitySnapshot their push belongs to,
 * and they run after it in the same transaction. */
function citySnapshotId(tx: Bytes, day: i32): Bytes {
  return tx.concatI32(day);
}

export function handleCityPushed(e: CityPushed): void {
  let day = e.params.day.toI32();

  let snap = new CitySnapshot(citySnapshotId(e.transaction.hash, day));
  snap.day = day;
  snap.approval = e.params.approval;
  snap.rating = e.params.rating;
  snap.pop = e.params.pop.toI32();
  snap.mayor = e.params.mayor;
  snap.timestamp = e.block.timestamp;
  snap.tx = e.transaction.hash;
  snap.save();

  let m = Mayor.load(e.params.mayor);
  if (m == null) {
    m = new Mayor(e.params.mayor);
    m.pushes = 0;
    m.firstDay = day;
    m.firstSeen = e.block.timestamp;
  }
  m.pushes = m.pushes + 1;
  m.lastDay = day;
  m.lastSeen = e.block.timestamp;
  m.save();

  let c = getCity();
  c.lastDay = day;
  c.lastApproval = e.params.approval;
  c.lastRating = e.params.rating;
  c.lastPop = e.params.pop.toI32();
  c.pushes = c.pushes + 1;
  c.updatedAt = e.block.timestamp;
  c.save();
}

/* Nine of these per push. This is the series the sparkline draws, and the
 * reason the subgraph exists: the same ninety days costs ninety archive calls
 * over the RPC and one query here. */
export function handleDistrictPushed(e: DistrictPushed): void {
  let id = e.params.districtId;
  let day = e.params.day.toI32();

  let snap = new DistrictSnapshot(eventId(e));
  snap.districtId = id;
  snap.day = day;
  snap.nav = e.params.nav;
  snap.pop = e.params.pop.toI32();
  snap.land = e.params.land;
  snap.level = e.params.level;
  snap.timestamp = e.block.timestamp;

  /* Linking by address rather than by loading through the oracle: the vault
     table is generated from the same config the manifest is, so the two cannot
     disagree about which vault is district 4. */
  let addr = vaultForId(id);
  if (addr != '') {
    snap.vault = getVault(Address.fromString(addr)).id;
  }

  /* The city row for this push is in this same transaction. It may legitimately
     be missing if a district push ever lands without one, so this is a link and
     not an assumption. */
  let cityId = citySnapshotId(e.transaction.hash, day);
  if (CitySnapshot.load(cityId) != null) snap.city = cityId;

  snap.save();
}

/* Settlement: the oracle moving CityUSD in or out of a district vault because
 * the district's land value moved. A positive delta is a gain, and needs no
 * cooperation from the vault at all - the tokens simply arrive and
 * totalAssets() rises. A negative one is the remit() path, which the vault
 * also logs; both are recorded, from the two sides they are visible from. */
export function handleSettled(e: Settled): void {
  let addr = vaultForId(e.params.districtId);
  if (addr == '') return;

  let v = getVault(Address.fromString(addr));
  v.totalAssets = e.params.assetsAfter;
  v.settledTotal = v.settledTotal.plus(e.params.delta);
  if (v.totalShares.gt(ZERO)) {
    v.sharePrice = v.totalAssets.toBigDecimal().div(v.totalShares.toBigDecimal());
  }
  v.save();

  let ev = new VaultEvent(eventId(e));
  ev.vault = v.id;
  ev.kind = 'SETTLE';
  ev.account = null;
  /* Magnitude in assets, sign carried by settledTotal on the vault - assets is
     a BigInt quantity everywhere else in the schema and a negative one here
     would make every chart that sums it wrong. */
  ev.assets = e.params.delta.lt(ZERO) ? e.params.delta.neg() : e.params.delta;
  ev.shares = ZERO;
  ev.assetsAfter = e.params.assetsAfter;
  ev.block = e.block.number;
  ev.timestamp = e.block.timestamp;
  ev.tx = e.transaction.hash;
  ev.save();
}

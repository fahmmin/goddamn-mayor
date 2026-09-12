/* Entity loaders. Every handler starts by getting a row that is guaranteed to
 * exist, because a mapping that has to remember whether it is the first event
 * for an address is a mapping with a bug waiting in it. */
import { Address, BigInt, BigDecimal, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Vault, Account, Position, City } from '../generated/schema';
import { districtIdForVault, ensForId } from './districts';

export const ZERO = BigInt.fromI32(0);
export const ONE = BigInt.fromI32(1);
export const CITY_ID = Bytes.fromUTF8('city');

export function getVault(addr: Address): Vault {
  let id = addr as Bytes;
  let v = Vault.load(id);
  if (v != null) return v;

  v = new Vault(id);
  /* districtId and ensName come from the generated table rather than from an
     eth_call. They are fixed at deploy time and never change, so paying a
     contract read per new vault would buy nothing and would fail the whole
     handler if the node's archive call did. */
  let did = districtIdForVault(addr.toHexString());
  v.districtId = did;
  v.ensName = did >= 0 ? ensForId(did) : '';
  v.asset = Address.zero() as Bytes;
  v.totalAssets = ZERO;
  v.totalShares = ZERO;
  v.sharePrice = BigDecimal.fromString('1');
  v.depositedTotal = ZERO;
  v.withdrawnTotal = ZERO;
  v.settledTotal = ZERO;
  v.save();
  return v;
}

/* Share price, with the empty-vault case spelled out. A vault with no shares
 * has no price; reporting 0 would draw a chart that dives to the floor before
 * the first deposit, and dividing anyway is a trap. */
export function repriceVault(v: Vault): void {
  if (v.totalShares.equals(ZERO)) {
    v.sharePrice = BigDecimal.fromString('1');
    return;
  }
  v.sharePrice = v.totalAssets.toBigDecimal().div(v.totalShares.toBigDecimal());
}

export function getAccount(addr: Address): Account {
  let id = addr as Bytes;
  let a = Account.load(id);
  if (a != null) return a;
  a = new Account(id);
  a.save();
  return a;
}

export function getPosition(account: Address, vault: Vault, ts: BigInt): Position {
  let id = account.toHexString() + '-' + vault.id.toHexString();
  let p = Position.load(id);
  if (p != null) return p;
  p = new Position(id);
  p.account = getAccount(account).id;
  p.vault = vault.id;
  p.shares = ZERO;
  p.depositedAssets = ZERO;
  p.withdrawnAssets = ZERO;
  p.updatedAt = ts;
  return p;
}

export function getCity(): City {
  let c = City.load(CITY_ID);
  if (c != null) return c;
  c = new City(CITY_ID);
  c.lastDay = 0;
  c.lastApproval = 0;
  c.lastRating = 0;
  c.lastPop = 0;
  c.pushes = 0;
  c.wallets = 0;
  c.updatedAt = ZERO;
  c.save();
  return c;
}

/* A unique, stable id for a log. tx hash alone collides whenever one
 * transaction emits the same event twice - which push() does nine times over,
 * once per district. */
export function eventId(e: ethereum.Event): Bytes {
  return e.transaction.hash.concatI32(e.logIndex.toI32());
}

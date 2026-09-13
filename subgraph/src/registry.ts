/* The city's ENSv2 registry - where the office is a name.
 *
 * CityOracle.push() does not check an owner mapping. It asks this registry,
 * live, whether msg.sender holds the write role on mayor.cityhall.eth and
 * whether the term has expired. That check is the whole project. What it is
 * not, is answerable about the PAST: expiry, roles and ownership are contract
 * state, the public Sepolia endpoints are not archive nodes, and an
 * unregistered name leaves nothing behind to read. After the recall burns the
 * office, an RPC can only report that nobody holds it.
 *
 * So this file records the office the way oracle.ts records the valuations:
 * as an immutable trail of what was true when. "Who signed this NAV, and had
 * their term run out yet" is then one query instead of an impossible one.
 *
 * Only the CITY registry is indexed, not the nine district registries. The
 * offices live here, the recall happens here, and the district registries
 * issue parcels that nobody has minted yet - nine more data sources would
 * lengthen the sync to index nothing.
 */
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  LabelRegistered,
  LabelUnregistered,
  ExpiryUpdated,
  EACRolesChanged,
  TokenResource
} from '../generated/CityRegistry/UserRegistryImpl';
import { Name, NameEvent, ResourceLink } from '../generated/schema';
import { WRITE_ROLE_STR } from './districts';

let ZERO = BigInt.fromI32(0);

/* The one role CityOracle will accept. Generated from chain/deployed.json
   rather than written here, because a wrong constant would make canWrite a
   confident lie rather than an obvious failure. */
function writeRole(): BigInt {
  return BigInt.fromString(WRITE_ROLE_STR);
}

/* A tokenId is only unique within the registry that issued it. */
function nameId(registry: Address, tokenId: BigInt): string {
  return registry.toHexString() + '-' + tokenId.toString();
}

function resourceId(registry: Address, resource: BigInt): string {
  return registry.toHexString() + '-r-' + resource.toString();
}

function eventId(e: ethereum.Event): Bytes {
  return e.transaction.hash.concatI32(e.logIndex.toI32());
}

/* Every mutation below starts from a row that exists. A name may legitimately
   be unknown - registered before startBlock, or in a registry we do not index
   - and that is a skip, never a crash: a mapping that throws stops the whole
   subgraph at that block. */
function loadName(registry: Address, tokenId: BigInt): Name | null {
  return Name.load(nameId(registry, tokenId));
}

function record(n: Name, kind: string, e: ethereum.Event): NameEvent {
  let ev = new NameEvent(eventId(e));
  ev.name = n.id;
  ev.kind = kind;
  ev.actor = e.transaction.from;
  ev.block = e.block.number;
  ev.timestamp = e.block.timestamp;
  ev.tx = e.transaction.hash;
  return ev;
}

/* A name is minted. LabelRegistered carries the label string itself, so the
   readable name is indexed without a reverse lookup against the registry. */
export function handleLabelRegistered(e: LabelRegistered): void {
  let id = nameId(e.address, e.params.tokenId);
  let n = Name.load(id);
  if (n == null) {
    n = new Name(id);
    n.registry = e.address as Bytes;
    n.tokenId = e.params.tokenId;
    n.roles = ZERO;
    n.canWrite = false;
    n.registeredAt = e.block.timestamp;
  }
  n.label = e.params.label;
  n.owner = e.params.owner;
  n.expiry = e.params.expiry;
  n.active = true;
  /* A re-registration after a burn is a new term, not a continuation. */
  n.burned = false;
  n.burnedAt = null;
  n.updatedAt = e.block.timestamp;
  n.save();

  let ev = record(n, 'REGISTERED', e);
  ev.expiry = n.expiry;
  ev.save();
}

/* The recall. This is the event the whole ENS argument rests on: the same
   wallet keeps its key and its vault position, and simply stops being able to
   write to the city. Nothing is revoked from the person - the name is gone. */
export function handleLabelUnregistered(e: LabelUnregistered): void {
  let n = loadName(e.address, e.params.tokenId);
  if (n == null) return;

  n.active = false;
  n.burned = true;
  n.burnedAt = e.block.timestamp;
  /* Roles are not cleared to zero here on purpose. The name held the write
     role right up until it stopped existing, and flattening that would erase
     the thing the record is for. `active` and `burned` say what happened. */
  n.updatedAt = e.block.timestamp;
  n.save();

  record(n, 'BURNED', e).save();
}

/* A renewal moves the term. Nobody has to act for a term to END - that is the
   point of expiry - but extending one is a transaction, and it is logged. */
export function handleExpiryUpdated(e: ExpiryUpdated): void {
  let n = loadName(e.address, e.params.tokenId);
  if (n == null) return;

  n.expiry = e.params.newExpiry;
  n.updatedAt = e.block.timestamp;
  n.save();

  let ev = record(n, 'RENEWED', e);
  ev.expiry = n.expiry;
  ev.save();
}

/* Roles are keyed on a `resource`, and only TokenResource says which token a
   resource belongs to. It is emitted when the token is created, so it
   normally arrives before any role change - but ordering is not assumed
   anywhere below. */
export function handleTokenResource(e: TokenResource): void {
  let n = loadName(e.address, e.params.tokenId);
  if (n == null) return;

  let link = new ResourceLink(resourceId(e.address, e.params.resource));
  link.name = n.id;
  link.save();
}

/* Which roles an account holds on a name, over time.
 *
 * This is what turns "the Deputy provably cannot push" from a claim in a
 * README into a query: deputy.cityhall.eth has a roles bitmap that has never
 * had the write bit set, and every change to it is a row here.
 *
 * Only the owner's own roles are tracked on the Name. A bitmap for some other
 * account is still logged as an event, but writing it onto the name would
 * make canWrite mean "somebody, somewhere can write", which is not the
 * question CityOracle asks.
 */
export function handleEACRolesChanged(e: EACRolesChanged): void {
  let link = ResourceLink.load(resourceId(e.address, e.params.resource));
  if (link == null) return;

  let n = Name.load(link.name);
  if (n == null) return;

  let ev = record(n, 'ROLES_CHANGED', e);
  ev.roleBitmap = e.params.newRoleBitmap;
  ev.save();

  if (!e.params.account.equals(n.owner)) return;

  n.roles = e.params.newRoleBitmap;
  n.canWrite = !e.params.newRoleBitmap.bitAnd(writeRole()).equals(ZERO);
  n.updatedAt = e.block.timestamp;
  n.save();
}

/* Hand-written minimal ABIs. The compiler emits full ones into
 * chain/build/contracts.json, but the bundle only ever calls these, and
 * importing a 40KB artifact to reach nine functions is not a trade worth
 * making in a file the browser downloads. */
import { parseAbi } from 'viem';

export const ORACLE_ABI = parseAbi([
  'function city() view returns (uint32 day, uint16 approval, uint8 rating, uint32 pop, uint64 pushedAt)',
  'function allDistricts() view returns ((uint32 nav, uint32 pop, uint16 land, uint16 level)[])',
  'function officeState() view returns (uint8 status, uint64 expiry, address holder, uint256 tokenId)',
  'function canPush(address who) view returns (bool)',
  'function push(uint32 day, uint16 approval, uint8 rating, uint32 pop, uint32[] navs, uint32[] pops, uint16[] lands, uint16[] levels)',
  'function settle(int256[] deltas)',
  'function vaults(uint8) view returns (address)'
]);

export const VAULT_ABI = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function ensName() view returns (string)'
]);

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function faucet()'
]);

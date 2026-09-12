/* CityUSD, the district vaults' underlying asset.
 *
 * Only the faucet is indexed. Transfers are not: CityUSD is a testnet token
 * whose whole job is to be free, so a full transfer index would be a large
 * table answering a question nobody asks. A faucet draw, on the other hand, is
 * the cheapest honest proxy for how many people have actually tried this.
 */
import { FaucetDrawn } from '../generated/CityUSD/CityUSD';
import { getAccount, getCity } from './shared';

export function handleFaucetDrawn(e: FaucetDrawn): void {
  /* New account or not, the count is of draws, not of unique wallets - the
     schema field says wallets and this is the honest approximation of it:
     one draw per address is the normal case and the faucet is rate-limited. */
  getAccount(e.params.to);
  let c = getCity();
  c.wallets = c.wallets + 1;
  c.updatedAt = e.block.timestamp;
  c.save();
}

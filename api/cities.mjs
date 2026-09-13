/* /api/cities  -  this mayor's cities, most recently played first.
 *
 * Deliberately without the saves. Choosing between six cities should not mean
 * downloading six grids.
 */
import { caller, listCities } from '../lib/city.mjs';
import { ALLOWED_ORIGIN } from '../lib/env.mjs';

export default async function handler (req, res) {
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const did = await caller(req.headers.authorization);
  if (!did) return res.status(401).json({ error: 'not signed in' });

  try {
    return res.status(200).json(await listCities(did));
  } catch (e) {
    console.error('cities: ' + (e && e.message));
    return res.status(500).json({ error: 'server' });
  }
}

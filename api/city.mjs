/* /api/city  -  one saved city.
 *
 *   GET    ?id=   the named city, or the most recently played
 *   POST          a NEW city                     <- { save, day, name }
 *   PUT    ?id=   update that one                <- { save, day }
 *   DELETE ?id=
 *
 * Every request needs  Authorization: Bearer <privy access token>.
 * The rules live in lib/city.js, shared with the local dev server.
 */
import {
  caller, getCity, createCity, updateCity, deleteCity, readWrite, UUID
} from '../lib/city.mjs';
import { ALLOWED_ORIGIN } from '../lib/env.mjs';

export default async function handler (req, res) {
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const did = await caller(req.headers.authorization);
  if (!did) return res.status(401).json({ error: 'not signed in' });

  const id = (req.query && req.query.id) || '';
  if (id && !UUID.test(id)) return res.status(400).json({ error: 'bad id' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getCity(did, id));
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      /* Vercel parses a JSON body for us; the dev server hands over a string.
       * readWrite takes either. */
      const w = readWrite(req.body);
      if (w.error) return res.status(w.status).json({ error: w.error });

      /* POST makes a city, PUT updates the one named. Separating them is what
       * lets "break ground" leave the city you already built alone. */
      if (req.method === 'POST' || !id) {
        return res.status(200).json(await createCity(did, w.save, w.day, w.name));
      }
      const row = await updateCity(did, id, w.save, w.day, w.name);
      if (!row) return res.status(404).json({ error: 'no such city' });
      return res.status(200).json(row);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'which city?' });
      return res.status(200).json(await deleteCity(did, id));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('city ' + req.method + ': ' + (e && e.message));
    return res.status(500).json({ error: 'server' });
  }
}

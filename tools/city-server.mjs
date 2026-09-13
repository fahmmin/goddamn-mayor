/* npm run api  -  the city API on localhost, for development.
 *
 * The same handlers Vercel runs as /api/city and /api/cities, behind a plain
 * node http server so the game works at localhost:8080 without deploying
 * anything. index.html's CSP already allows http://localhost:8787.
 *
 * In production this file does nothing: Vercel serves api/city.js and
 * api/cities.js directly, and the rules they share live in lib/city.js.
 */
import http from 'node:http';
import city from '../api/city.mjs';
import cities from '../api/cities.mjs';
import { PORT, ALLOWED_ORIGIN, requireDb, PRIVY_APP_ID } from '../lib/env.mjs';

requireDb();
if (!PRIVY_APP_ID) {
  console.error('\n  PRIVY_APP_ID is not set - every request would be rejected.\n');
  process.exit(1);
}

/* Vercel hands a handler req.query and req.body, and gives res the
 * status().json() shape. Node's http gives none of that, so put it there. */
function adapt (req, res, body) {
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  req.body = body;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (k, v) => { try { setHeader(k, v); } catch (e) { /* already sent */ } return res; };
  return url;
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > 512 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  let raw = '';
  if (req.method === 'POST' || req.method === 'PUT') {
    try { raw = await readBody(req); } catch {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'save too large' }));
      return;
    }
  }
  const url = adapt(req, res, raw);
  const route = url.pathname.replace(/^\/api/, '');
  if (route === '/cities') return cities(req, res);
  if (route === '/city') return city(req, res);
  res.status(404).json({ error: 'not found' });
});

server.listen(PORT, () => {
  console.log('\n  THE SAVED CITY  ->  http://localhost:' + PORT + '/city');
  console.log('  allowing origin    ' + ALLOWED_ORIGIN + '\n');
});

/* node tools/serve.js [port] - static host for the web build. No deps.
 * The game is already a plain page; this only exists so it has an origin,
 * which is what file:// could never give it (and what every RPC needs). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* argv[2] is a port only when a human typed one. A host that fills argv with
 * its own switches would hand us Number('--inspect') = NaN, which listen()
 * treats as "any free port" - the page would then be served somewhere
 * nobody is looking. Take it only when it actually parses as a port. */
const fromArgv = Number(process.argv[2]);
const PORT = (Number.isInteger(fromArgv) && fromArgv > 0 && fromArgv < 65536)
  ? fromArgv : Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff'
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  // never serve outside the repo, whatever the request says
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log("I'M THE GODDAMN MAYOR  ->  http://localhost:" + PORT));

/* main.js requires this file to run the desktop build against a real origin
 * rather than file://, and closes the server on quit. */
module.exports = server;

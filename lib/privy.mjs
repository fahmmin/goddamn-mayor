/* Is this caller who they say they are?
 *
 * A Privy access token is an ES256 JWT. Privy publishes the matching public
 * key as a JWKS, so verifying one needs no secret and no library: WebCrypto
 * does ECDSA P-256 natively, and the raw r||s signature in a JWT is exactly
 * the format it wants.
 *
 * Everything here is a check, not a lookup. The DID the caller ends up with
 * comes out of the verified claims - never out of the request, which is the
 * whole point of doing this at all.
 */
const JWKS = id => 'https://auth.privy.io/api/v1/apps/' + id + '/jwks.json';

let cache = { at: 0, keys: null };
const TTL_MS = 10 * 60 * 1000;

async function keysFor (appId) {
  if (cache.keys && Date.now() - cache.at < TTL_MS) return cache.keys;
  const r = await fetch(JWKS(appId));
  if (!r.ok) throw new Error('jwks ' + r.status);
  const { keys } = await r.json();
  cache = { at: Date.now(), keys };
  return keys;
}

const b64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function importJwk (jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/* Resolves the DID, or null. Never throws for an ordinary bad token: an
 * expired session is a normal thing for a browser to be holding. */
export async function didFromToken (token, appId) {
  if (!token || !appId) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch { return null; }
  if (header.alg !== 'ES256') return null;

  let keys;
  try { keys = await keysFor(appId); } catch { return null; }
  const jwk = keys.find(k => !header.kid || k.kid === header.kid) || keys[0];
  if (!jwk) return null;

  const signed = Buffer.from(parts[0] + '.' + parts[1], 'ascii');
  const sig = b64url(parts[2]);
  let good = false;
  try {
    good = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, await importJwk(jwk), sig, signed);
  } catch { return null; }
  if (!good) return null;

  /* Signature checked; now the claims. A valid signature over a token meant
   * for a different app, or one that expired yesterday, is still not a login. */
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'privy.io') return null;
  if (payload.aud !== appId) return null;
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  return sub.startsWith('did:privy:') ? sub : null;
}

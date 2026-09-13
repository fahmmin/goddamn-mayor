/* Does the verifier actually verify? Sign tokens with a throwaway key, serve
 * its public half as a JWKS, and check that only the good one is accepted. */
import { didFromToken } from '../lib/privy.mjs';

const APP = 'test-app-id';
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

async function mint (claims, key) {
  const head = b64({ alg: 'ES256', typ: 'JWT', kid: 'test' });
  const body = b64(claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key || kp.privateKey,
    Buffer.from(head + '.' + body, 'ascii'));
  return head + '.' + body + '.' + Buffer.from(sig).toString('base64url');
}

const real = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('jwks.json')) {
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test' }] }), { status: 200 });
  }
  return real(url);
};

const now = Math.floor(Date.now() / 1000);
const good = { iss: 'privy.io', aud: APP, sub: 'did:privy:abc', exp: now + 600 };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok    ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

console.log('\nMAYOR - privy token verification\n');
ok(await didFromToken(await mint(good), APP) === 'did:privy:abc', 'a good token yields its DID');
ok(await didFromToken(await mint({ ...good, aud: 'someone-else' }), APP) === null, 'a token for another app is refused');
ok(await didFromToken(await mint({ ...good, iss: 'evil.io' }), APP) === null, 'a token from another issuer is refused');
ok(await didFromToken(await mint({ ...good, exp: now - 10 }), APP) === null, 'an expired token is refused');
ok(await didFromToken(await mint({ ...good, sub: 'not-a-did' }), APP) === null, 'a non-DID subject is refused');

const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
ok(await didFromToken(await mint(good, other.privateKey), APP) === null, 'a token signed by the WRONG key is refused');

const t = await mint(good);
const tampered = t.split('.'); tampered[1] = b64({ ...good, sub: 'did:privy:someone-else' });
ok(await didFromToken(tampered.join('.'), APP) === null, 'swapping the DID invalidates the signature');
ok(await didFromToken('', APP) === null, 'an empty token is refused');
ok(await didFromToken(await mint(good), '') === null, 'no app id means no trust');

console.log('\n  ' + pass + ' passing' + (fail ? ', ' + fail + ' FAILING' : '') + '\n');
process.exit(fail ? 1 : 0);

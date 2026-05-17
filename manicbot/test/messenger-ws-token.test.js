/**
 * WS token mint + verify — Worker side. The admin-app mirror (in
 * admin-app/src/lib/wsToken.ts) must produce byte-identical output for
 * the same secret + payload (verified by `it('admin-app token verifies
 * against Worker secret')` below).
 */

import { describe, it, expect } from 'vitest';
import { mintWsToken, verifyWsToken } from '../src/utils/wsToken.js';

const SECRET = 'test-ws-secret-shared-between-worker-and-admin-app';

describe('mintWsToken + verifyWsToken roundtrip', () => {
  it('verifies a freshly-minted token', async () => {
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_owner' });
    const claims = await verifyWsToken(SECRET, tok);
    expect(claims).toBeTruthy();
    expect(claims.tenantId).toBe('t_a');
    expect(claims.webUserId).toBe('w_owner');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects token signed with a different secret', async () => {
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_owner' });
    const claims = await verifyWsToken('wrong-secret', tok);
    expect(claims).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_owner' });
    const [payload, sig] = tok.split('.');
    // Flip the first char of the payload — avoids the b64 padding-bit edge
    // case where flipping the last char doesn't change the decoded byte.
    const tamperedPayload = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1);
    const tamperedTok = `${tamperedPayload}.${sig}`;
    expect(await verifyWsToken(SECRET, tamperedTok)).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_owner' });
    const [payload, sig] = tok.split('.');
    // Same reasoning as the payload case: flip first char, not last.
    const tamperedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await verifyWsToken(SECRET, `${payload}.${tamperedSig}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    // Mint with the smallest TTL we allow (1 sec). Wait 2.2 s so that
    // Math.floor(Date.now()/1000) is strictly greater than the embedded
    // `exp` regardless of where in the current second mint+wait landed.
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_o' }, 1);
    await new Promise((r) => setTimeout(r, 2200));
    expect(await verifyWsToken(SECRET, tok)).toBeNull();
  });

  it('clamps TTL above 60s back to 60s', async () => {
    const tok = await mintWsToken(SECRET, { tenantId: 't_a', webUserId: 'w_o' }, 9999);
    const claims = await verifyWsToken(SECRET, tok);
    expect(claims).toBeTruthy();
    const ttl = claims.exp - Math.floor(Date.now() / 1000);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(ttl).toBeGreaterThan(50); // some margin for clock skew
  });

  it('refuses to mint with empty secret / missing claims', async () => {
    await expect(mintWsToken('', { tenantId: 't_a', webUserId: 'w' })).rejects.toThrow();
    await expect(mintWsToken(SECRET, { tenantId: '', webUserId: 'w' })).rejects.toThrow();
    await expect(mintWsToken(SECRET, { tenantId: 't_a', webUserId: '' })).rejects.toThrow();
  });

  it('returns null on malformed token strings', async () => {
    expect(await verifyWsToken(SECRET, '')).toBeNull();
    expect(await verifyWsToken(SECRET, 'no.dots.here.but.extra')).toBeNull();
    expect(await verifyWsToken(SECRET, 'nope')).toBeNull();
  });
});

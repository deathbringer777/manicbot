/**
 * Signed click-token round-trip + integrity tests.
 *
 * The token signs the destination URL, so tampering with the payload (e.g.
 * swapping in a malicious destination) must fail verification.
 */
import { describe, it, expect } from 'vitest';
import { signClickToken, verifyClickToken } from '../src/services/marketing/clickToken.js';

const SECRET = 'click-secret-which-is-long-enough-32b';
const CLAIMS = {
  campaignId: 'cmp_1', sendId: 'snd_1', tenantId: 't_a',
  contactId: 42, url: 'https://salon.example/book?x=1',
};

describe('clickToken', () => {
  it('round-trips sign → verify', async () => {
    const tok = await signClickToken(SECRET, CLAIMS);
    const out = await verifyClickToken(SECRET, tok);
    expect(out).toMatchObject({
      campaignId: 'cmp_1', sendId: 'snd_1', tenantId: 't_a',
      contactId: 42, url: 'https://salon.example/book?x=1',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const tok = await signClickToken(SECRET, CLAIMS);
    expect(await verifyClickToken('a-different-secret-also-long-enough', tok)).toBeNull();
  });

  it('rejects a tampered payload (forged destination)', async () => {
    const tok = await signClickToken(SECRET, CLAIMS);
    const [p, s] = tok.split('.');
    const flipped = p.slice(0, -1) + (p.slice(-1) === 'A' ? 'B' : 'A');
    expect(await verifyClickToken(SECRET, `${flipped}.${s}`)).toBeNull();
  });

  it('rejects an expired token but accepts a fresh one', async () => {
    // ttl is clamped to a 60s floor, so use a window comfortably past it.
    const now = 1_700_000_000;
    const tok = await signClickToken(SECRET, CLAIMS, 100, now);
    expect(await verifyClickToken(SECRET, tok, now + 200)).toBeNull();
    expect(await verifyClickToken(SECRET, tok, now + 50)).not.toBeNull();
  });

  it('rejects malformed / empty tokens', async () => {
    expect(await verifyClickToken(SECRET, 'garbage')).toBeNull();
    expect(await verifyClickToken(SECRET, '')).toBeNull();
    expect(await verifyClickToken('', 'x.y')).toBeNull();
  });

  it('carries a null sendId / contactId cleanly', async () => {
    const tok = await signClickToken(SECRET, {
      campaignId: 'cmp_2', tenantId: 't_b', url: 'https://x.example/y',
    });
    const out = await verifyClickToken(SECRET, tok);
    expect(out.sendId).toBeNull();
    expect(out.contactId).toBeNull();
    expect(out.url).toBe('https://x.example/y');
  });
});

/**
 * #LPH-01 — the landing reverse-proxy must NOT forward credential headers.
 *
 * `tryLanding` proxied the homepage/assets to the (separately-deployed) landing
 * origin with `headers: request.headers` — forwarding the visitor's entire
 * inbound header set. Because the landing lives on the apex domain where the
 * admin-app session cookie is set, this leaked `Cookie` / `Authorization` across
 * a trust boundary to a different deployment. The static landing only needs
 * content-negotiation + caching headers, which are preserved.
 */
import { describe, it, expect } from 'vitest';
import { landingForwardHeaders } from '../src/http/landingHttp.js';

describe('#LPH-01 — landingForwardHeaders strips credentials', () => {
  it('removes Cookie / Authorization / proxy-auth but keeps benign headers', () => {
    const inp = new Headers({
      cookie: 'next-auth.session-token=secret',
      authorization: 'Bearer leaked',
      'proxy-authorization': 'Basic xxx',
      accept: 'text/html',
      'accept-language': 'pl',
      'user-agent': 'Googlebot/2.1',
      'if-none-match': '"etag123"',
    });
    const out = landingForwardHeaders(inp);
    expect(out.get('cookie')).toBeNull();
    expect(out.get('authorization')).toBeNull();
    expect(out.get('proxy-authorization')).toBeNull();
    // content-negotiation + caching preserved (no behaviour change for the landing)
    expect(out.get('accept')).toBe('text/html');
    expect(out.get('accept-language')).toBe('pl');
    expect(out.get('user-agent')).toBe('Googlebot/2.1');
    expect(out.get('if-none-match')).toBe('"etag123"');
  });

  it('is case-insensitive about the stripped header names', () => {
    const out = landingForwardHeaders(new Headers({ Cookie: 'a=b', Authorization: 'Bearer y' }));
    expect(out.get('cookie')).toBeNull();
    expect(out.get('authorization')).toBeNull();
  });
});

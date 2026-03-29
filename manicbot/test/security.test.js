import { describe, it, expect } from 'vitest';
import { checkAdmin } from '../src/utils/security.js';

// timingSafeEqual is a sync UTF-8 byte compare in utils/security.js (see test/telegram-webhook-http.test.js).

describe('checkAdmin', () => {
  function makeRequest(authHeader) {
    return {
      headers: { get: (name) => name === 'Authorization' ? authHeader : null },
    };
  }

  it('returns false for missing auth header', () => {
    expect(checkAdmin(makeRequest(null), 'key')).toBe(false);
  });

  it('returns false for non-Basic auth', () => {
    expect(checkAdmin(makeRequest('Bearer token'), 'key')).toBe(false);
  });

  it('returns false for invalid base64', () => {
    expect(checkAdmin(makeRequest('Basic !!!invalid!!!'), 'key')).toBe(false);
  });

  it('returns true for correct Basic credentials', () => {
    // Base64 of "user:correctkey"
    const b64 = btoa('user:correctkey');
    expect(checkAdmin(makeRequest(`Basic ${b64}`), 'correctkey')).toBe(true);
  });

  it('returns false for wrong password', () => {
    const b64 = btoa('user:wrongkey');
    expect(checkAdmin(makeRequest(`Basic ${b64}`), 'correctkey')).toBe(false);
  });

  it('returns false when no colon separator in decoded string', () => {
    const b64 = btoa('nocolon');
    expect(checkAdmin(makeRequest(`Basic ${b64}`), 'nocolon')).toBe(false);
  });
});

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
});

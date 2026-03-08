import { describe, it, expect } from 'vitest';
import { checkAdmin } from '../src/utils/security.js';

// timingSafeEqual uses crypto.subtle.timingSafeEqual (Workers-only API)
// Tests for it must run in Workers runtime, skipped in Node.js

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

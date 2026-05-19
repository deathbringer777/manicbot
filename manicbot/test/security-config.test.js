/**
 * Tests for validateSecurityConfig() in src/worker.js
 *
 * H-A — BOT_ENCRYPTION_KEY must fail-close, not warn-only. The previous
 * implementation only threw when the key was set-but-short; an entirely
 * missing key logged a warning and continued serving traffic. That
 * regression-allowed half-functional deploys: calendar links broke
 * silently, channel tokens decrypted to null, the master-password vault
 * panicked at consume-time. The fix mirrors META_APP_SECRET semantics —
 * required-or-throw, with an explicit ALLOW_PLAINTEXT_TOKENS=1 dev escape
 * hatch.
 *
 * L-A — also pins that the now-misleading "stored in plaintext" warning
 * is gone (the warning text contradicted tenant/storage.js:149 which
 * refuses plaintext storage outright).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { validateSecurityConfig, __resetSecurityValidationForTests } from '../src/worker.js';

const MIN_KEY = 'a'.repeat(32);

function baseEnv() {
  return {
    ADMIN_KEY: MIN_KEY,
    NOTIFY_TOKEN: MIN_KEY,
    BOT_ENCRYPTION_KEY: MIN_KEY,
  };
}

describe('Security Configuration Validation (H-A + L-A)', () => {
  beforeEach(() => {
    __resetSecurityValidationForTests();
  });

  it('throws when BOT_ENCRYPTION_KEY is entirely missing (H-A: fail-close)', () => {
    const env = baseEnv();
    delete env.BOT_ENCRYPTION_KEY;
    expect(() => validateSecurityConfig(env)).toThrow(/BOT_ENCRYPTION_KEY is required/);
  });

  it('throws when BOT_ENCRYPTION_KEY is empty string (H-A)', () => {
    const env = { ...baseEnv(), BOT_ENCRYPTION_KEY: '' };
    expect(() => validateSecurityConfig(env)).toThrow(/BOT_ENCRYPTION_KEY is required/);
  });

  it('throws when BOT_ENCRYPTION_KEY is shorter than 32 chars (existing rule preserved)', () => {
    const env = { ...baseEnv(), BOT_ENCRYPTION_KEY: 'too-short' };
    expect(() => validateSecurityConfig(env)).toThrow(/at least 32 characters/);
  });

  it('ALLOWS missing BOT_ENCRYPTION_KEY when ALLOW_PLAINTEXT_TOKENS=1 (dev escape hatch)', () => {
    const env = baseEnv();
    delete env.BOT_ENCRYPTION_KEY;
    env.ALLOW_PLAINTEXT_TOKENS = '1';
    expect(() => validateSecurityConfig(env)).not.toThrow();
  });

  it('ALLOW_PLAINTEXT_TOKENS=anything-else does NOT bypass (strict "1")', () => {
    const env = baseEnv();
    delete env.BOT_ENCRYPTION_KEY;
    env.ALLOW_PLAINTEXT_TOKENS = 'true';
    expect(() => validateSecurityConfig(env)).toThrow(/BOT_ENCRYPTION_KEY is required/);
  });

  it('throws when ADMIN_KEY is set but shorter than 32 chars', () => {
    const env = { ...baseEnv(), ADMIN_KEY: 'short' };
    expect(() => validateSecurityConfig(env)).toThrow(/ADMIN_KEY/);
  });

  it('throws when NOTIFY_TOKEN is set but shorter than 32 chars', () => {
    const env = { ...baseEnv(), NOTIFY_TOKEN: 'short' };
    expect(() => validateSecurityConfig(env)).toThrow(/NOTIFY_TOKEN/);
  });

  it('throws when META_VERIFY_TOKEN_WA is set but META_APP_SECRET missing', () => {
    const env = { ...baseEnv(), META_VERIFY_TOKEN_WA: 'verify-token' };
    delete env.META_APP_SECRET;
    expect(() => validateSecurityConfig(env)).toThrow(/META_APP_SECRET/);
  });

  it('throws when META_APP_SECRET is set but shorter than 32 chars (with verify token)', () => {
    const env = { ...baseEnv(), META_VERIFY_TOKEN_IG: 'verify-token', META_APP_SECRET: 'short' };
    expect(() => validateSecurityConfig(env)).toThrow(/META_APP_SECRET must be at least 32/);
  });

  it('accepts a minimal valid env without throwing (happy path)', () => {
    const env = baseEnv();
    expect(() => validateSecurityConfig(env)).not.toThrow();
  });

  it('L-A: source no longer references the misleading "stored in plaintext" warning', async () => {
    // The pre-fix warning string said tokens "will be stored in plaintext"
    // but tenant/storage.js refuses plaintext storage outright. Pin that
    // the contradicting message is gone from worker.js.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/will be stored in plaintext/);
  });
});

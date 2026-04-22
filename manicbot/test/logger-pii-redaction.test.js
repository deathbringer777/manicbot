/**
 * Tests for src/utils/logger.js — PII redaction correctness.
 *
 * Verifies that emails, phone numbers, bot tokens, Stripe keys and
 * known sensitive keys are scrubbed before reaching console output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture console output
let consoleLogs = [];
let consoleWarns = [];
let consoleErrors = [];

beforeEach(() => {
  consoleLogs = [];
  consoleWarns = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => consoleLogs.push(args.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...args) => consoleWarns.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const { log } = await import('../src/utils/logger.js');

describe('logger — PII redaction', () => {
  it('redacts email addresses in string values', () => {
    log.info('test', { msg: 'user john.doe@example.com registered' });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.msg).not.toContain('john.doe@example.com');
    expect(entry.msg).toContain('[email]');
  });

  it('redacts bot tokens (format: 123456789:ABCdef...)', () => {
    log.info('test', { msg: 'connecting 987654321:ABCDefghIJKlmnOPQrStUvWxYz1234567890' });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.msg).not.toContain('ABCDefghIJKlmnOPQrStUvWxYz1234567890');
    expect(entry.msg).toContain('[bot_token]');
  });

  it('redacts Stripe secret keys', () => {
    log.warn('test', { key: 'sk_live_abcdefghijklmnopqrstu' });
    const entry = JSON.parse(consoleWarns[0]);
    expect(entry.key).not.toContain('sk_live_');
    expect(entry.key).toContain('[stripe_key]');
  });

  it('redacts known sensitive key names entirely', () => {
    log.info('test', { password: 'super-secret-123', token: 'abc123', secret: 'xyz' });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.token).toBe('[REDACTED]');
    expect(entry.secret).toBe('[REDACTED]');
  });

  it('does NOT redact non-sensitive fields', () => {
    log.info('test', { tenantId: 't_abc123', action: 'booking', count: 5 });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.tenantId).toBe('t_abc123');
    expect(entry.action).toBe('booking');
    expect(entry.count).toBe(5);
  });

  it('logs errors with stack trace (truncated to 400 chars)', () => {
    const err = new Error('something went wrong');
    err.stack = 'Error: something went wrong\n    at ...'.padEnd(600, 'x');
    log.error('test.scope', err, { context: 'stripe' });
    const entry = JSON.parse(consoleErrors[0]);
    expect(entry.level).toBe('error');
    expect(entry.scope).toBe('test.scope');
    expect(entry.stack.length).toBeLessThanOrEqual(400);
    expect(entry.context).toBe('stripe');
  });

  it('includes ISO timestamp and level on all entries', () => {
    log.info('billing', { amount: 100 });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.level).toBe('info');
    expect(entry.scope).toBe('billing');
  });

  it('handles nested objects with redaction', () => {
    log.info('nested', { user: { email: 'a@b.com', name: 'Alice', password: 'pass' } });
    const entry = JSON.parse(consoleLogs[0]);
    expect(entry.user.email).toContain('[email]');
    expect(entry.user.name).toBe('Alice');
    expect(entry.user.password).toBe('[REDACTED]');
  });
});

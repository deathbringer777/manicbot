/**
 * P2-2 — `pathNeedsCtx` decides whether a request needs the full
 * tenant-ctx ladder built before dispatch. Non-ctx GETs (landing, public
 * search, embed widget) should short-circuit to tryLanding without paying
 * for a D1 round-trip + env-spread.
 */
import { describe, it, expect } from 'vitest';
import { pathNeedsCtx } from '../src/worker.js';

describe('pathNeedsCtx (P2-2)', () => {
  it('returns true for Telegram webhook paths', () => {
    expect(pathNeedsCtx('/webhook')).toBe(true);
    expect(pathNeedsCtx('/webhook/123')).toBe(true);
    expect(pathNeedsCtx('/webhook/wa')).toBe(true); // resolved earlier in tryMetaWebhooks but still ctx-needing if it falls through
    expect(pathNeedsCtx('/webhook/123456789')).toBe(true);
  });

  it('returns true for admin paths', () => {
    expect(pathNeedsCtx('/admin')).toBe(true);
    expect(pathNeedsCtx('/admin/')).toBe(true);
    expect(pathNeedsCtx('/admin/billing')).toBe(true);
    expect(pathNeedsCtx('/admin/export/csv')).toBe(true);
  });

  it('returns true for setup / remove-webhook', () => {
    expect(pathNeedsCtx('/setup')).toBe(true);
    expect(pathNeedsCtx('/remove-webhook')).toBe(true);
  });

  it('returns true for calendar', () => {
    expect(pathNeedsCtx('/calendar/abc123')).toBe(true);
    expect(pathNeedsCtx('/calendar/abc123.ics')).toBe(true);
  });

  it('returns false for landing & public surfaces', () => {
    expect(pathNeedsCtx('/')).toBe(false);
    expect(pathNeedsCtx('/about')).toBe(false);
    expect(pathNeedsCtx('/pricing')).toBe(false);
    expect(pathNeedsCtx('/login')).toBe(false);
    expect(pathNeedsCtx('/blog')).toBe(false);
    expect(pathNeedsCtx('/salons')).toBe(false);
  });

  it('returns false for /api/search/*', () => {
    expect(pathNeedsCtx('/api/search/salons')).toBe(false);
    expect(pathNeedsCtx('/api/search/masters')).toBe(false);
  });

  it('returns false for /embed/*', () => {
    expect(pathNeedsCtx('/embed/demo-chat.js')).toBe(false);
  });

  it('returns false for static asset paths', () => {
    expect(pathNeedsCtx('/favicon.ico')).toBe(false);
    expect(pathNeedsCtx('/cdn/t/x/logo.png')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(pathNeedsCtx(null)).toBe(false);
    expect(pathNeedsCtx(undefined)).toBe(false);
    expect(pathNeedsCtx('')).toBe(false);
  });

  it('returns false for similar-but-not-matching prefixes', () => {
    // Must not match /admin-app/...
    expect(pathNeedsCtx('/administrators')).toBe(false);
    // Must not match /webhookz/... or /webhooks
    expect(pathNeedsCtx('/webhooks')).toBe(false);
    expect(pathNeedsCtx('/webhookz')).toBe(false);
  });
});

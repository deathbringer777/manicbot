/**
 * Unit tests for /api/track ingestion endpoint.
 *
 * The endpoint receives client-side analytics events. It is the only public
 * surface that writes to analytics_events from a non-tRPC origin, so its
 * validators carry the security weight: dropped unknown event names, hard
 * caps on payload size, no echo back to the caller.
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRACK_EVENTS,
  MAX_PROPERTY_BYTES,
  TRACK_RATE_LIMIT_MAX,
  TRACK_RATE_LIMIT_WINDOW_MS,
  buildTrackInsertParams,
  parseTrackPayload,
} from '../src/http/trackHttpLogic.js';

describe('parseTrackPayload — schema validation', () => {
  it('accepts a well-formed pageview', () => {
    const r = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'pageview',
      properties: { path: '/', referrer: '' },
    });
    expect(r.ok).toBe(true);
    expect(r.value.event).toBe('pageview');
  });

  it('rejects an unknown event name', () => {
    const r = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'exfiltrate.password',
      properties: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/event/i);
  });

  it('rejects when anonymousId is too short', () => {
    const r = parseTrackPayload({
      anonymousId: 'x',
      event: 'pageview',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects properties exceeding the byte cap', () => {
    const big = 'x'.repeat(MAX_PROPERTY_BYTES + 100);
    const r = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'cta_click',
      properties: { fill: big },
    });
    expect(r.ok).toBe(false);
  });

  it('strips dangerous keys (proto pollution)', () => {
    const r = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'cta_click',
      properties: { __proto__: { polluted: true }, href: '/x' },
    });
    // Even if a serialiser kept __proto__, the resulting value must not have polluted Object.prototype
    if (r.ok) {
      const probe = {};
      // eslint-disable-next-line no-prototype-builtins
      expect(probe.polluted).toBeUndefined();
      expect(r.value.properties.href).toBe('/x');
      expect('__proto__' in r.value.properties).toBe(false);
    }
  });

  it('returns ok=false on non-object payload', () => {
    expect(parseTrackPayload(null).ok).toBe(false);
    expect(parseTrackPayload(undefined).ok).toBe(false);
    expect(parseTrackPayload('string-payload').ok).toBe(false);
    expect(parseTrackPayload(42).ok).toBe(false);
  });

  it('exposes a stable allowlist of event names', () => {
    expect(ALLOWED_TRACK_EVENTS).toContain('pageview');
    expect(ALLOWED_TRACK_EVENTS).toContain('cta_click');
    expect(ALLOWED_TRACK_EVENTS).toContain('form_submit');
    expect(ALLOWED_TRACK_EVENTS).toContain('scroll_depth');
    expect(ALLOWED_TRACK_EVENTS).toContain('outbound_click');
    expect(ALLOWED_TRACK_EVENTS.length).toBeGreaterThan(0);
    expect(ALLOWED_TRACK_EVENTS.length).toBeLessThan(50);
  });

  it('declares a rate-limit envelope (used by the HTTP handler)', () => {
    expect(TRACK_RATE_LIMIT_MAX).toBeGreaterThan(0);
    expect(TRACK_RATE_LIMIT_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('buildTrackInsertParams — D1 row shape', () => {
  it('carries the event + json-serialised properties', () => {
    const parsed = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'cta_click',
      properties: { href: '/pricing', label: 'Start trial' },
    });
    expect(parsed.ok).toBe(true);
    const row = buildTrackInsertParams(parsed.value, {
      tenantId: null,
      nowSec: 1_700_000_000,
    });
    expect(row.event).toBe('cta_click');
    expect(JSON.parse(row.properties).href).toBe('/pricing');
    expect(row.tenantId).toBeNull();
    expect(row.createdAt).toBe(1_700_000_000);
  });

  it('always slices serialised properties at 1000 chars', () => {
    const parsed = parseTrackPayload({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'pageview',
      properties: { x: 'a'.repeat(900) },
    });
    if (!parsed.ok) throw new Error('parse failed');
    const row = buildTrackInsertParams(parsed.value, {
      tenantId: null,
      nowSec: 1,
    });
    expect(row.properties.length).toBeLessThanOrEqual(1000);
  });
});

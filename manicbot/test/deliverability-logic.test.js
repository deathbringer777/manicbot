/**
 * Unit tests for the pure SPF / DKIM / DMARC parsers used by
 * `scripts/verify-deliverability.mjs`.
 *
 * These cover the logic the script depends on so we don't have to
 * round-trip through real DNS to know the parser is correct.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDmarc,
  parseSpf,
  parseDkim,
  dmarcVerdict,
  spfIncludes,
  REQUIRED_SPF_INCLUDES,
} from '../scripts/deliverability-logic.mjs';

describe('parseDmarc', () => {
  it('parses a full record with rua', () => {
    const r = parseDmarc('v=DMARC1; p=reject; rua=mailto:postmaster@example.com');
    expect(r).toEqual({ v: 'DMARC1', p: 'reject', rua: 'mailto:postmaster@example.com' });
  });
  it('strips surrounding quotes (dig output)', () => {
    const r = parseDmarc('"v=DMARC1; p=quarantine; pct=50"');
    expect(r.p).toBe('quarantine');
    expect(r.pct).toBe('50');
  });
  it('returns null for non-DMARC records', () => {
    expect(parseDmarc('v=spf1 ~all')).toBeNull();
    expect(parseDmarc('hello')).toBeNull();
    expect(parseDmarc('')).toBeNull();
  });
});

describe('parseSpf', () => {
  it('parses the production manicbot.com SPF', () => {
    const r = parseSpf('v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all');
    expect(r.v).toBe('spf1');
    expect(r.mechanisms).toEqual(['include:_spf.mx.cloudflare.net', 'include:_spf.resend.com']);
    expect(r.all).toBe('~all');
  });
  it('returns null for non-SPF', () => {
    expect(parseSpf('v=DMARC1; p=reject;')).toBeNull();
  });
  it('handles missing all qualifier', () => {
    const r = parseSpf('v=spf1 include:_spf.example.com');
    expect(r.all).toBeNull();
  });
});

describe('parseDkim', () => {
  it('detects a key', () => {
    const r = parseDkim('v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQ...');
    expect(r).toEqual({ present: true, revoked: false, hasKey: true });
  });
  it('detects a revoked key', () => {
    const r = parseDkim('v=DKIM1; k=rsa; p=');
    expect(r).toEqual({ present: true, revoked: true, hasKey: false });
  });
  it('returns absent when no p= tag', () => {
    expect(parseDkim('hello world')).toEqual({ present: false, revoked: false, hasKey: false });
  });
});

describe('dmarcVerdict', () => {
  it('returns pass for p=reject + rua', () => {
    const v = dmarcVerdict({ v: 'DMARC1', p: 'reject', rua: 'mailto:x@y.com' });
    expect(v.verdict).toBe('pass');
  });
  it('returns pass for p=quarantine + rua', () => {
    const v = dmarcVerdict({ v: 'DMARC1', p: 'quarantine', rua: 'mailto:x@y.com' });
    expect(v.verdict).toBe('pass');
  });
  it('returns warn when policy is strong but no rua', () => {
    const v = dmarcVerdict({ v: 'DMARC1', p: 'reject' });
    expect(v.verdict).toBe('warn');
    expect(v.reasons.join(' ')).toMatch(/rua/i);
  });
  it('returns fail for p=none', () => {
    const v = dmarcVerdict({ v: 'DMARC1', p: 'none', rua: 'mailto:x@y.com' });
    expect(v.verdict).toBe('fail');
  });
  it('returns fail for missing record', () => {
    expect(dmarcVerdict(null).verdict).toBe('fail');
  });
});

describe('spfIncludes + REQUIRED_SPF_INCLUDES', () => {
  it('extracts include hostnames', () => {
    const r = parseSpf('v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all');
    const inc = spfIncludes(r);
    expect(inc).toContain('_spf.mx.cloudflare.net');
    expect(inc).toContain('_spf.resend.com');
  });
  it('REQUIRED_SPF_INCLUDES contains the manicbot.com production set', () => {
    expect(REQUIRED_SPF_INCLUDES).toContain('_spf.resend.com');
    expect(REQUIRED_SPF_INCLUDES).toContain('_spf.mx.cloudflare.net');
  });
});

import { describe, it, expect } from 'vitest';
import { parseConfigObject } from '../src/channels/resolver.js';

// Post-audit #5 — getChannelConfig (resolver.js) parsed channel_configs.config
// with a bare JSON.parse and no try/catch. A corrupt/partial value threw and
// dark-screened the IG/WA webhook, cron health checks, and outbound sends.
// parseConfigObject is the defensive helper: never throws, always returns a
// plain object. (The two fallback-scan sites at lines 86/125 were already
// inside try/catch; this guards the hot path at getChannelConfig.)
describe('parseConfigObject — defensive channel_configs.config parse (#audit-5)', () => {
  it('returns {} for null / undefined / empty', () => {
    expect(parseConfigObject(null)).toEqual({});
    expect(parseConfigObject(undefined)).toEqual({});
    expect(parseConfigObject('')).toEqual({});
  });

  it('returns {} for malformed JSON instead of throwing', () => {
    expect(() => parseConfigObject('{page_id:')).not.toThrow();
    expect(parseConfigObject('{not json')).toEqual({});
    expect(parseConfigObject('}{')).toEqual({});
  });

  it('parses a valid JSON object', () => {
    expect(parseConfigObject('{"page_id":"123","ig_account_id":"9"}'))
      .toEqual({ page_id: '123', ig_account_id: '9' });
  });

  it('returns {} for valid JSON that is not a plain object (array / scalar / null)', () => {
    expect(parseConfigObject('"a string"')).toEqual({});
    expect(parseConfigObject('[1,2,3]')).toEqual({});
    expect(parseConfigObject('42')).toEqual({});
    expect(parseConfigObject('null')).toEqual({});
  });
});

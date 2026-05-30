/**
 * Delivery classification for the outbound relay + retry path.
 * Pins the WA/IG external_msg_id `.data`-hop fix (the regression that left
 * Meta delivery ids null) and the transient-vs-permanent split that gates retry.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyChannelSendResult,
  extractExternalMsgId,
  isTransientFailure,
} from '../src/channels/send-classify.js';

describe('extractExternalMsgId', () => {
  it('WhatsApp success → data.messages[0].id', () => {
    expect(extractExternalMsgId({ ok: true, data: { messages: [{ id: 'wamid.X' }] } })).toBe('wamid.X');
  });
  it('Instagram success → data.message_id', () => {
    expect(extractExternalMsgId({ ok: true, data: { recipient_id: 'r', message_id: 'mid.Y' } })).toBe('mid.Y');
  });
  it('Telegram success → result.message_id (stringified)', () => {
    expect(extractExternalMsgId({ ok: true, result: { message_id: 123 } })).toBe('123');
  });
  it('returns null when no id present', () => {
    expect(extractExternalMsgId({ ok: true, data: {} })).toBeNull();
    expect(extractExternalMsgId(null)).toBeNull();
  });
});

describe('classifyChannelSendResult', () => {
  it('WA success → sent + wamid (regression for the missing .data hop)', () => {
    const r = classifyChannelSendResult({ ok: true, data: { messages: [{ id: 'wamid.Z' }] } });
    expect(r.deliveryState).toBe('sent');
    expect(r.externalMsgId).toBe('wamid.Z');
    expect(r.transient).toBe(false);
  });
  it('outside_message_window → failed + permanent', () => {
    const r = classifyChannelSendResult({ ok: false, error: 'outside_message_window' });
    expect(r.deliveryState).toBe('failed');
    expect(r.errorCode).toBe('outside_message_window');
    expect(r.transient).toBe(false);
  });
  it('channel_token_unavailable → permanent', () => {
    expect(classifyChannelSendResult({ ok: false, error: 'channel_token_unavailable' }).transient).toBe(false);
  });
  it('429 rate limit → transient', () => {
    expect(classifyChannelSendResult({ ok: false, status: 429, error: 'rate' }).transient).toBe(true);
  });
  it('5xx → transient', () => {
    expect(classifyChannelSendResult({ ok: false, status: 503 }).transient).toBe(true);
  });
  it('dead token (401 + tokenDead) → permanent', () => {
    expect(
      classifyChannelSendResult({ ok: false, status: 401, tokenDead: true, error: 'OAuthException' }).transient,
    ).toBe(false);
  });
  it('generic 4xx → permanent', () => {
    expect(classifyChannelSendResult({ ok: false, status: 400, error: 'bad' }).transient).toBe(false);
  });
});

describe('isTransientFailure', () => {
  it('no result (fetch threw) → transient', () => {
    expect(isTransientFailure(null)).toBe(true);
    expect(isTransientFailure({ ok: false, error: 'relay_network_error' })).toBe(true);
  });
});

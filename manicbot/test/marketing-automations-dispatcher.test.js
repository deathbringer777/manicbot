/**
 * Worker-side marketing-automation dispatcher.
 *
 * Phase 2C of the marketing roadmap closed the loop on event-triggered
 * automations: `fireAutomationForEvent` SELECTs enabled rows whose
 * `trigger_type` matches the event, resolves the marketing_contact for
 * the triggering user, creates an ad-hoc campaign, and calls the
 * Worker-local `runCampaignSend` in single-recipient mode.
 *
 * This test pins:
 *   - `parseFirstSendStep` parses the JSON shape we expect.
 *   - No matching automations → counters are zero.
 *   - Matching automation but no `marketing_contact` for the user →
 *     `skipped` not `fired` (no consent path, no send).
 *   - Happy path → ad-hoc campaign INSERT + sender called with
 *     `singleContactId` matching the contact row.
 *   - Tenant_id-NULL platform-default rows fire alongside tenant rows.
 *   - Invalid `steps_json` is counted in `errors` but doesn't crash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the sender so we can assert call shape without running real send.
const senderCalls = [];
vi.mock('../src/services/marketing/sender.js', () => ({
  runCampaignSend: async (_ctx, tenantId, campaignId, opts) => {
    senderCalls.push({ tenantId, campaignId, opts });
    return { ok: true, total: 1, sent: 1, failed: 0, deferred: 0, status: 'sent' };
  },
}));

import { fireAutomationForEvent, parseFirstSendStep } from '../src/services/marketing/automations.js';

beforeEach(() => {
  senderCalls.length = 0;
});

/**
 * Mock D1 binding that responds to the three queries the helper makes,
 * in order:
 *   1. SELECT ... FROM marketing_automations WHERE trigger_type = ? ...
 *   2. SELECT id FROM marketing_contacts WHERE tenant_id = ? AND linked_user_chat_id = ? ...
 *   3. INSERT INTO marketing_campaigns ...
 */
function makeDb({ automations = [], contact = null, insertFail = false } = {}) {
  const insertedCampaigns = [];
  return {
    insertedCampaigns,
    prepare(sql) {
      const stmt = {
        boundArgs: null,
        bind(...args) {
          this.boundArgs = args;
          return this;
        },
        async first() {
          if (/FROM marketing_contacts/i.test(sql)) {
            return contact ? { id: contact.id } : null;
          }
          return null;
        },
        async all() {
          if (/FROM marketing_automations/i.test(sql)) {
            const [eventType, tenantId] = this.boundArgs ?? [];
            const rows = automations
              .filter((a) => a.trigger_type === eventType)
              .filter((a) => a.tenant_id === tenantId || a.tenant_id === null)
              .filter((a) => a.enabled === 1)
              .map((a) => ({
                id: a.id,
                tenant_id: a.tenant_id,
                name: a.name,
                steps_json: a.steps_json,
              }));
            return { results: rows };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO marketing_campaigns/i.test(sql)) {
            if (insertFail) throw new Error('insert_failed_for_test');
            insertedCampaigns.push(this.boundArgs);
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

function makeCtx(overrides = {}) {
  return { tenantId: 't_a', db: makeDb(overrides), ...overrides.ctx };
}

describe('parseFirstSendStep', () => {
  it('parses a valid steps_json with templateId + channel', () => {
    const r = parseFirstSendStep('[{"templateId":"tpl_42","channel":"email"}]');
    expect(r).toEqual({ templateId: 'tpl_42', channel: 'email', segmentId: null });
  });

  it('defaults channel to email when missing', () => {
    const r = parseFirstSendStep('[{"templateId":"tpl_42"}]');
    expect(r?.channel).toBe('email');
  });

  it('preserves sms and whatsapp channels', () => {
    expect(parseFirstSendStep('[{"templateId":"x","channel":"sms"}]')?.channel).toBe('sms');
    expect(parseFirstSendStep('[{"templateId":"x","channel":"whatsapp"}]')?.channel).toBe('whatsapp');
  });

  it('returns null on malformed JSON', () => {
    expect(parseFirstSendStep('{not-json')).toBeNull();
  });

  it('returns null on empty array', () => {
    expect(parseFirstSendStep('[]')).toBeNull();
  });

  it('returns null when first step lacks templateId', () => {
    expect(parseFirstSendStep('[{"channel":"email"}]')).toBeNull();
  });

  it('returns null on null / non-string input', () => {
    expect(parseFirstSendStep(null)).toBeNull();
    expect(parseFirstSendStep(undefined)).toBeNull();
    expect(parseFirstSendStep(42)).toBeNull();
  });

  it('captures segmentId when present', () => {
    const r = parseFirstSendStep('[{"templateId":"x","channel":"email","segmentId":"seg_1"}]');
    expect(r?.segmentId).toBe('seg_1');
  });
});

describe('fireAutomationForEvent — happy path', () => {
  it('fires a single tenant-scoped automation and calls sender with singleContactId', async () => {
    const db = makeDb({
      automations: [
        {
          id: 'auto_1', tenant_id: 't_a', enabled: 1,
          name: 'Thank-you on done',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_42","channel":"email"}]',
        },
      ],
      contact: { id: 7 },
    });
    const ctx = { tenantId: 't_a', db };

    const r = await fireAutomationForEvent(ctx, 'appointment.done', { chatId: 123, now: 1700000000 });

    expect(r.automations).toBe(1);
    expect(r.fired).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.errors).toBe(0);
    expect(db.insertedCampaigns.length).toBe(1);
    expect(senderCalls.length).toBe(1);
    expect(senderCalls[0].opts).toEqual({ singleContactId: 7 });
    expect(senderCalls[0].tenantId).toBe('t_a');
    // Campaign inserted under the tenant that triggered (even for platform defaults).
    expect(db.insertedCampaigns[0][1]).toBe('t_a');
  });

  it('fires platform-default (tenant_id=NULL) automations alongside tenant rows', async () => {
    const db = makeDb({
      automations: [
        { id: 'auto_p', tenant_id: null, enabled: 1, name: 'Platform default',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_p","channel":"email"}]' },
        { id: 'auto_t', tenant_id: 't_a', enabled: 1, name: 'Tenant override',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_t","channel":"email"}]' },
      ],
      contact: { id: 11 },
    });
    const ctx = { tenantId: 't_a', db };

    const r = await fireAutomationForEvent(ctx, 'appointment.done', { chatId: 99 });

    expect(r.automations).toBe(2);
    expect(r.fired).toBe(2);
    expect(senderCalls.length).toBe(2);
  });
});

describe('fireAutomationForEvent — no-ops and edges', () => {
  it('returns zeros when no automations match the event', async () => {
    const db = makeDb({ automations: [], contact: { id: 1 } });
    const ctx = { tenantId: 't_a', db };
    const r = await fireAutomationForEvent(ctx, 'appointment.done', { chatId: 123 });
    expect(r).toEqual({ fired: 0, skipped: 0, errors: 0, automations: 0 });
    expect(senderCalls.length).toBe(0);
  });

  it('skips when matching automation exists but the user has no marketing_contact', async () => {
    const db = makeDb({
      automations: [
        { id: 'auto_1', tenant_id: 't_a', enabled: 1, name: 'X',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_42","channel":"email"}]' },
      ],
      contact: null, // marketing_contacts lookup misses
    });
    const ctx = { tenantId: 't_a', db };
    const r = await fireAutomationForEvent(ctx, 'appointment.done', { chatId: 123 });
    expect(r.automations).toBe(1);
    expect(r.fired).toBe(0);
    expect(r.skipped).toBe(1);
    expect(senderCalls.length).toBe(0);
  });

  it('counts invalid steps_json as an error and does not crash', async () => {
    const db = makeDb({
      automations: [
        { id: 'auto_bad', tenant_id: 't_a', enabled: 1, name: 'Bad',
          trigger_type: 'appointment.done',
          steps_json: 'not-json' },
        { id: 'auto_good', tenant_id: 't_a', enabled: 1, name: 'Good',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_42","channel":"email"}]' },
      ],
      contact: { id: 7 },
    });
    const ctx = { tenantId: 't_a', db };
    const r = await fireAutomationForEvent(ctx, 'appointment.done', { chatId: 123 });
    expect(r.automations).toBe(2);
    expect(r.fired).toBe(1);
    expect(r.errors).toBe(1);
  });

  it('returns zeros when ctx is missing tenantId or db', async () => {
    expect(await fireAutomationForEvent({}, 'appointment.done', { chatId: 1 })).toEqual({
      fired: 0, skipped: 0, errors: 0, automations: 0,
    });
    expect(await fireAutomationForEvent({ tenantId: 't_a' }, 'appointment.done', { chatId: 1 })).toEqual({
      fired: 0, skipped: 0, errors: 0, automations: 0,
    });
  });

  it('returns zeros when eventType is empty', async () => {
    const ctx = makeCtx();
    expect(await fireAutomationForEvent(ctx, '', { chatId: 1 })).toEqual({
      fired: 0, skipped: 0, errors: 0, automations: 0,
    });
  });

  it('skips when chatId is missing (no way to resolve a contact)', async () => {
    const db = makeDb({
      automations: [
        { id: 'auto_1', tenant_id: 't_a', enabled: 1, name: 'X',
          trigger_type: 'appointment.done',
          steps_json: '[{"templateId":"tpl_42","channel":"email"}]' },
      ],
      contact: { id: 7 },
    });
    const ctx = { tenantId: 't_a', db };
    const r = await fireAutomationForEvent(ctx, 'appointment.done', {}); // no chatId
    expect(r.automations).toBe(1);
    expect(r.fired).toBe(0);
    expect(r.skipped).toBe(1);
  });
});

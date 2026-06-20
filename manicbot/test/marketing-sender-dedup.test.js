/**
 * runCampaignSend dedup across cron ticks (reliability fix, 2026-06-20).
 *
 * BUG: a campaign whose audience exceeds INLINE_CAP (500) stays
 * status='sending' so the next cron tick continues. But `resolveAudience`
 * re-ran the SAME `tenant_id`-scoped filter with `LIMIT cap` and did NOT
 * exclude contacts already recorded in `marketing_sends` — so every tick
 * returned the SAME first `cap` rows and re-sent to them. The campaign never
 * advanced past the first batch (spam + provider cost).
 *
 * FIX: `resolveAudience` excludes contacts already sent for THIS campaign via
 *   AND NOT EXISTS (SELECT 1 FROM marketing_sends ms
 *                   WHERE ms.campaign_id = ? AND ms.contact_id = <contact>.id)
 * applied to BOTH the rows query and the COUNT query, so each tick advances
 * to the next un-sent batch and `deferred` shrinks to 0 → terminal status.
 *
 * The shared `test/helpers/mock-db.js` SQL parser cannot model a NOT EXISTS
 * subquery (it would silently drop the clause), so this test uses a small
 * purpose-built stateful D1 mock that honours the campaign exclusion + LIMIT
 * — the same hand-rolled-ctx approach as marketing-sender-billing-gate.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCampaignSend } from '../src/services/marketing/sender.js';

// Resend always succeeds in this test so every targeted contact lands a
// marketing_sends row with status='sent'.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'mid-stub' }),
  })));
  vi.stubGlobal('crypto', {
    getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i; return arr; },
  });
});

const TENANT = 't_dedup';
const CAMPAIGN = 'cmp_dedup';

/**
 * Build a stateful ctx whose db models the two tables the sender touches:
 *   - marketing_campaigns  (one row, mutable status/stats)
 *   - marketing_templates  (one email template)
 *   - tenants              (billing_status + name)
 *   - marketing_contacts   (N seeded rows, filtered by tenant + consent + NOT EXISTS)
 *   - marketing_sends      (append-only; the dedup source of truth)
 *
 * Only the SQL shapes the sender actually emits are interpreted; anything else
 * returns empty. The `marketing_contacts` SELECT honours the campaign-scoped
 * NOT EXISTS exclusion and the trailing LIMIT so two ticks behave like prod.
 */
function makeCtx({ contactCount, inlineCap }) {
  const campaign = {
    id: CAMPAIGN, tenant_id: TENANT, status: 'scheduled', channel: 'email',
    template_id: 'tpl_1', segment_id: null,
  };
  const template = { id: 'tpl_1', tenant_id: TENANT, channel: 'email', subject: 'Hi', body: 'Hello', locale: 'en' };
  const contacts = [];
  for (let i = 1; i <= contactCount; i++) {
    contacts.push({
      id: i, email: `c${i}@example.com`, phone: null, name: `Contact ${i}`,
      unsubscribe_token: null, tenant_id: TENANT, unsubscribed: 0,
      consent_email: 1, consent_sms: 0, tags: null, lifecycle_stage: null, last_seen_at: 0,
    });
  }
  const sends = [];

  function alreadySent(contactId) {
    return sends.some((s) => s.campaign_id === CAMPAIGN && s.contact_id === contactId);
  }

  // The contacts SELECT carries the NOT EXISTS clause only after the fix. We
  // detect it and apply the exclusion; without it (unfixed code) we return the
  // first `cap` rows every time — reproducing the re-send loop.
  function selectContacts(sql, params) {
    const hasDedup = /not\s+exists/i.test(sql);
    const limMatch = sql.match(/LIMIT\s+\?/i);
    // params for the row query end with the cap when LIMIT ? is present.
    const cap = limMatch ? Number(params[params.length - 1]) : contactCount;
    let pool = contacts.filter((c) => c.tenant_id === TENANT && c.unsubscribed === 0 && c.consent_email === 1);
    if (hasDedup) pool = pool.filter((c) => !alreadySent(c.id));
    return pool.slice(0, cap).map((c) => ({
      id: c.id, email: c.email, phone: c.phone, name: c.name, unsubscribe_token: c.unsubscribe_token,
    }));
  }

  function countContacts(sql) {
    const hasDedup = /not\s+exists/i.test(sql);
    let pool = contacts.filter((c) => c.tenant_id === TENANT && c.unsubscribed === 0 && c.consent_email === 1);
    if (hasDedup) pool = pool.filter((c) => !alreadySent(c.id));
    return pool.length;
  }

  const db = {
    prepare(sql) {
      return {
        _args: [],
        bind(...args) { this._args = args; return this; },
        async first() {
          if (/FROM\s+marketing_campaigns/i.test(sql)) return { ...campaign };
          if (/billing_status[\s\S]*FROM\s+tenants/i.test(sql)) return { billing_status: 'active' };
          if (/FROM\s+marketing_templates/i.test(sql)) return { ...template };
          if (/SELECT\s+name\s+FROM\s+tenants/i.test(sql)) return { name: 'Dedup Salon' };
          if (/COUNT\(\*\)[\s\S]*FROM\s+marketing_contacts/i.test(sql)) {
            return { c: countContacts(sql) };
          }
          // single-contact mode is not used here
          return null;
        },
        async all() {
          if (/FROM\s+marketing_contacts/i.test(sql)) {
            return { results: selectContacts(sql, this._args) };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+marketing_sends/i.test(sql)) {
            // cols: id, campaign_id, contact_id, recipient, provider, status(lit), queued_at
            const [id, campaign_id, contact_id, recipient] = this._args;
            // INSERT OR IGNORE semantics: skip a duplicate (campaign_id, contact_id).
            if (/INSERT\s+OR\s+IGNORE/i.test(sql) && alreadySent(contact_id)) {
              return { meta: { changes: 0 } };
            }
            sends.push({ id, campaign_id, contact_id, recipient, status: 'queued' });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE\s+marketing_sends/i.test(sql)) {
            // UPDATE ... SET status='sent'/'failed' ... WHERE id = ?
            const id = this._args[this._args.length - 1];
            const row = sends.find((s) => s.id === id);
            if (row) row.status = /'failed'/i.test(sql) ? 'failed' : 'sent';
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (/UPDATE\s+marketing_campaigns/i.test(sql)) {
            const m = sql.match(/SET\s+status\s*=\s*'(\w+)'/i);
            if (m) campaign.status = m[1];
            return { meta: { changes: 1 } };
          }
          if (/UPDATE\s+marketing_contacts/i.test(sql)) {
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };

  return {
    ctx: { db, RESEND_API_KEY: 'k', RESEND_FROM: 'no-reply@manicbot.com' },
    state: { sends, campaign },
  };
}

describe('runCampaignSend — cross-tick dedup (no re-send loop)', () => {
  it('tick 2 targets the NEXT batch, never re-sending tick-1 contacts', async () => {
    const cap = 3;
    const { ctx, state } = makeCtx({ contactCount: 7, inlineCap: cap });

    // Tick 1: first `cap` contacts (1,2,3).
    const t1 = await runCampaignSend(ctx, TENANT, CAMPAIGN, { inlineCap: cap });
    expect(t1.sent).toBe(cap);
    expect(t1.deferred).toBe(7 - cap); // 4 remaining
    expect(t1.status).toBe('sending');

    const tick1Ids = state.sends.map((s) => s.contact_id).sort((a, b) => a - b);
    expect(tick1Ids).toEqual([1, 2, 3]);

    // Tick 2: must advance to contacts 4,5,6 — NOT re-send 1,2,3.
    const sendsBefore = state.sends.length;
    const t2 = await runCampaignSend(ctx, TENANT, CAMPAIGN, { inlineCap: cap });

    const tick2Ids = state.sends.slice(sendsBefore).map((s) => s.contact_id).sort((a, b) => a - b);
    // THIS is the assertion that fails against the unfixed code: without the
    // NOT EXISTS exclusion tick 2 returns [1,2,3] again (re-send loop).
    expect(tick2Ids).toEqual([4, 5, 6]);
    expect(t2.sent).toBe(cap);

    // No contact appears twice in marketing_sends.
    const allIds = state.sends.map((s) => s.contact_id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('drains the whole audience over enough ticks and ends status=sent (deferred→0)', async () => {
    const cap = 3;
    const { ctx, state } = makeCtx({ contactCount: 7, inlineCap: cap });

    let guard = 0;
    let last;
    do {
      last = await runCampaignSend(ctx, TENANT, CAMPAIGN, { inlineCap: cap });
      guard += 1;
    } while (last.status === 'sending' && guard < 10);

    // 7 contacts / cap 3 → 3 ticks (3+3+1). Final tick has no deferred tail.
    expect(guard).toBe(3);
    expect(last.status).toBe('sent');
    expect(last.deferred).toBe(0);

    // Exactly 7 sends, each a distinct contact, all delivered.
    expect(state.sends.length).toBe(7);
    const ids = state.sends.map((s) => s.contact_id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.sends.every((s) => s.status === 'sent')).toBe(true);
  });
});

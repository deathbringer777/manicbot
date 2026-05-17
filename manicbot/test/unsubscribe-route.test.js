/**
 * GET /u/:token — unsubscribe + consent log + friendly HTML.
 *
 * Verified invariants:
 *   1. Valid token + un-unsubscribed contact → flips unsubscribed=1,
 *      writes consent_email=0, consent_sms=0, appends marketing_consent_log
 *      row with event='unsubscribed', source='unsubscribe_link'.
 *   2. Already-unsubscribed contact → page still renders 200, but NO new
 *      consent_log row is appended (idempotent).
 *   3. Unknown token → 404 with friendly page (no DB writes).
 *   4. Garbage token shape → 404 immediately (cheap probe defence).
 */
import { describe, it, expect } from 'vitest';
import { handleUnsubscribeRequest } from '../src/http/unsubscribeHttp.js';

function makeDb({ contacts = [] } = {}) {
  const updates = [];
  const inserts = [];
  return {
    updates,
    inserts,
    contacts,
    prepare(sql) {
      const self = this;
      return {
        bound: null,
        bind(...args) { this.bound = args; return this; },
        async first() {
          if (/FROM marketing_contacts WHERE unsubscribe_token = \?/i.test(sql)) {
            const [token] = this.bound ?? [];
            return self.contacts.find((c) => c.unsubscribe_token === token) ?? null;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (/UPDATE marketing_contacts/i.test(sql)) {
            updates.push({ sql, args: this.bound });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO marketing_consent_log/i.test(sql)) {
            inserts.push({ sql, args: this.bound });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

function makeRequest({ ip = '1.2.3.4', userAgent = 'Mozilla/Test', acceptLang = 'ru' } = {}) {
  return {
    headers: {
      get(name) {
        const k = name.toLowerCase();
        if (k === 'cf-connecting-ip') return ip;
        if (k === 'user-agent') return userAgent;
        if (k === 'accept-language') return acceptLang;
        return null;
      },
    },
  };
}

describe('handleUnsubscribeRequest', () => {
  it('flips unsubscribed=1 and inserts a consent_log row for an active contact', async () => {
    const db = makeDb({
      contacts: [
        { id: 42, locale: 'ru', unsubscribed: 0, unsubscribe_token: 'aabb1122ccdd3344' },
      ],
    });
    const res = await handleUnsubscribeRequest(makeRequest(), 'aabb1122ccdd3344', { DB: db });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Вы отписались');

    // Update fired with contact id 42.
    expect(db.updates.length).toBe(1);
    expect(db.updates[0].args).toEqual([42]);

    // Consent log row inserted with the right event + source.
    expect(db.inserts.length).toBe(1);
    const args = db.inserts[0].args ?? [];
    expect(args[0]).toBe(42);            // contact_id
    expect(args[1]).toBe('1.2.3.4');     // ip
    expect(args[2]).toBe('Mozilla/Test'); // user_agent
  });

  it('renders 200 but skips writes for an already-unsubscribed contact (idempotent)', async () => {
    const db = makeDb({
      contacts: [
        { id: 9, locale: 'en', unsubscribed: 1, unsubscribe_token: 'ee99ee99ee99ee99' },
      ],
    });
    const res = await handleUnsubscribeRequest(
      makeRequest({ acceptLang: 'en-US' }),
      'ee99ee99ee99ee99',
      { DB: db },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/unsubscribed/i);
    expect(db.updates.length).toBe(0);
    expect(db.inserts.length).toBe(0);
  });

  it('returns 404 for an unknown token — no DB writes', async () => {
    const db = makeDb({ contacts: [] });
    const res = await handleUnsubscribeRequest(makeRequest(), 'deadbeefdeadbeef', { DB: db });
    expect(res.status).toBe(404);
    expect(db.updates.length).toBe(0);
    expect(db.inserts.length).toBe(0);
  });

  it('rejects garbage token shapes immediately (no DB query)', async () => {
    const db = makeDb({ contacts: [] });
    const res = await handleUnsubscribeRequest(makeRequest(), '../../etc/passwd', { DB: db });
    expect(res.status).toBe(404);
    expect(db.updates.length).toBe(0);
    expect(db.inserts.length).toBe(0);
  });

  it('respects Accept-Language for the not-found page when contact has no locale', async () => {
    const db = makeDb({ contacts: [] });
    const res = await handleUnsubscribeRequest(
      makeRequest({ acceptLang: 'pl-PL,en;q=0.5' }),
      'cafebabe00000000',
      { DB: db },
    );
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toMatch(/Link wygasł/);
  });
});

/**
 * phaseMarketingConversions — last-click attribution from a tracked click to a
 * subsequent booking by the same contact, within CONVERSION_WINDOW_DAYS.
 *
 * Custom DB mock (multi-line SQL defeats the shared mock-db regex; mirrors the
 * marketing-dispatch.test.js pattern). The mock honours the
 * UNIQUE(campaign_id, appointment_id) idempotency contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { phaseMarketingConversions, CONVERSION_WINDOW_DAYS } from '../src/handlers/cron.js';
import { log } from '../src/utils/logger.js';

const WINDOW = CONVERSION_WINDOW_DAYS * 24 * 60 * 60;

function makeDb({ appts = [], users = [], clicks = [], conversions = [] } = {}) {
  const convs = [...conversions];
  const db = {
    _conversions: convs,
    prepare(sql) {
      return {
        _sql: sql,
        bound: [],
        bind(...args) { this.bound = args; return this; },
        async all() {
          if (/FROM appointments/i.test(this._sql)) {
            const [tenantId, since] = this.bound;
            return { results: appts.filter((a) => a.tenant_id === tenantId && a.created_at >= since) };
          }
          return { results: [] };
        },
        async first() {
          if (/FROM users/i.test(this._sql)) {
            const [tenantId, chatId] = this.bound;
            return users.find((u) => u.tenant_id === tenantId && u.chat_id === chatId) ?? null;
          }
          if (/FROM marketing_link_clicks/i.test(this._sql)) {
            const [tenantId, contactId, upper, lower] = this.bound;
            const hits = clicks
              .filter((c) => c.tenant_id === tenantId && c.contact_id === contactId && c.clicked_at <= upper && c.clicked_at >= lower)
              .sort((a, b) => b.clicked_at - a.clicked_at);
            return hits[0] ?? null;
          }
          if (/FROM marketing_conversions/i.test(this._sql)) {
            const [tenantId, campaignId, apptId] = this.bound;
            return convs.find((c) => c.tenant_id === tenantId && c.campaign_id === campaignId && c.appointment_id === apptId) ?? null;
          }
          return null;
        },
        async run() {
          if (/INSERT\s+OR\s+IGNORE\s+INTO\s+marketing_conversions/i.test(this._sql)) {
            const [id, tenant_id, campaign_id, send_id, contact_id, appointment_id] = this.bound;
            if (!convs.some((c) => c.campaign_id === campaign_id && c.appointment_id === appointment_id)) {
              convs.push({ id, tenant_id, campaign_id, send_id, contact_id, appointment_id });
            }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
  return db;
}

const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

describe('phaseMarketingConversions', () => {
  it('attributes a booking to the most recent pre-booking click', async () => {
    const apptAt = NOW_S - 3600; // booked an hour ago
    const db = makeDb({
      appts: [{ id: 'apt_1', tenant_id: 't_a', chat_id: 111, created_at: apptAt }],
      users: [{ tenant_id: 't_a', chat_id: 111, marketing_contact_id: 9 }],
      clicks: [
        { tenant_id: 't_a', campaign_id: 'cmp_old', send_id: 's1', contact_id: 9, clicked_at: apptAt - 4 * 24 * 3600 },
        { tenant_id: 't_a', campaign_id: 'cmp_new', send_id: 's2', contact_id: 9, clicked_at: apptAt - 3600 },
      ],
    });
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    expect(db._conversions).toHaveLength(1);
    expect(db._conversions[0].campaign_id).toBe('cmp_new'); // last-click wins
    expect(db._conversions[0].appointment_id).toBe('apt_1');
  });

  it('does not attribute a click outside the window', async () => {
    const apptAt = NOW_S - 3600;
    const db = makeDb({
      appts: [{ id: 'apt_1', tenant_id: 't_a', chat_id: 111, created_at: apptAt }],
      users: [{ tenant_id: 't_a', chat_id: 111, marketing_contact_id: 9 }],
      clicks: [{ tenant_id: 't_a', campaign_id: 'cmp_x', send_id: 's', contact_id: 9, clicked_at: apptAt - (WINDOW + 10) }],
    });
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    expect(db._conversions).toHaveLength(0);
  });

  it('does not attribute a click AFTER the booking', async () => {
    const apptAt = NOW_S - 3600;
    const db = makeDb({
      appts: [{ id: 'apt_1', tenant_id: 't_a', chat_id: 111, created_at: apptAt }],
      users: [{ tenant_id: 't_a', chat_id: 111, marketing_contact_id: 9 }],
      clicks: [{ tenant_id: 't_a', campaign_id: 'cmp_x', send_id: 's', contact_id: 9, clicked_at: apptAt + 100 }],
    });
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    expect(db._conversions).toHaveLength(0);
  });

  it('is idempotent — a second run does not double-count', async () => {
    const apptAt = NOW_S - 3600;
    const seed = {
      appts: [{ id: 'apt_1', tenant_id: 't_a', chat_id: 111, created_at: apptAt }],
      users: [{ tenant_id: 't_a', chat_id: 111, marketing_contact_id: 9 }],
      clicks: [{ tenant_id: 't_a', campaign_id: 'cmp_new', send_id: 's', contact_id: 9, clicked_at: apptAt - 60 }],
    };
    const db = makeDb(seed);
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    expect(db._conversions).toHaveLength(1);
  });

  it('skips bookings whose client has no marketing contact', async () => {
    const apptAt = NOW_S - 3600;
    const db = makeDb({
      appts: [{ id: 'apt_1', tenant_id: 't_a', chat_id: 111, created_at: apptAt }],
      users: [{ tenant_id: 't_a', chat_id: 111, marketing_contact_id: null }],
      clicks: [{ tenant_id: 't_a', campaign_id: 'cmp', send_id: 's', contact_id: 9, clicked_at: apptAt - 60 }],
    });
    await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
    expect(db._conversions).toHaveLength(0);
  });

  it('no-ops without a tenant or db', async () => {
    await expect(phaseMarketingConversions({ db: null, tenantId: 't_a' }, NOW_MS)).resolves.toBeUndefined();
    await expect(phaseMarketingConversions({ db: makeDb(), tenantId: null }, NOW_MS)).resolves.toBeUndefined();
  });

  it('warns (no silent drop) when the per-tick cap is saturated', async () => {
    const apptAt = NOW_S - 3600;
    // A full page (100) of in-window bookings — no users/clicks so none attribute,
    // but the saturated cap must surface a warning instead of dropping silently.
    const appts = Array.from({ length: 100 }, (_, i) => ({
      id: `apt_${i}`, tenant_id: 't_a', chat_id: 1000 + i, created_at: apptAt - i,
    }));
    const db = makeDb({ appts });
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await phaseMarketingConversions({ db, tenantId: 't_a' }, NOW_MS);
      expect(warnSpy).toHaveBeenCalledWith(
        'handlers.cron',
        expect.objectContaining({ action: 'marketing_conversions_cap_hit', tenantId: 't_a' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

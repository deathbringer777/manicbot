import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { saveUser, getUser } from '../src/services/users.js';

/**
 * Regression for the saveUser landmine: it used INSERT OR REPLACE on 8 columns,
 * which re-created the whole row and silently wiped every other column
 * (email, dob, notes, tags, marketing_contact_id, first_source, avatars,
 * email_opt_in…) every time a registered client re-/start-ed the bot. The fix
 * is an ON CONFLICT(tenant_id, chat_id) DO UPDATE that touches only the
 * registration fields. See migration 0109.
 */
describe('saveUser preserves non-registration columns', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeCtx({ tenantId: 't_a' });
  });

  it('does not wipe email / CRM / opt-in columns on a registration update', async () => {
    // A fully-populated client row, as if the owner set email + CRM fields and
    // the client opted in earlier.
    ctx.db._getTable('users').push({
      tenant_id: 't_a', chat_id: 555,
      name: 'Анна', tg_username: 'anna', tg_lang: 'ru', phone: '+48500111222',
      registered_at: 1000, tos_accepted_at: 1000,
      email: 'anna@example.com', dob: '1990-05-01', ig_username: 'anna_ig',
      notes: 'VIP client', tags: 'vip,regular', marketing_contact_id: 42,
      first_source: 'instagram', first_touch_at: 900,
      avatar_url: 'https://img/anna.png', email_opt_in: 1, email_prompt_count: 1,
    });

    // Re-/start-style write — must NOT clobber the rest of the row.
    await saveUser(ctx, 555, {
      chatId: 555, name: 'Анна', phone: '+48500111222',
      tgUsername: 'anna', tgLang: 'ru', registeredAt: 2000, tosAcceptedAt: 2000,
    });

    const rows = ctx.db._getTable('users').filter(r => r.tenant_id === 't_a' && r.chat_id === 555);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Registration fields updated:
    expect(row.registered_at).toBe(2000);
    expect(row.tos_accepted_at).toBe(2000);
    // Everything else preserved (the bug = these become undefined):
    expect(row.email).toBe('anna@example.com');
    expect(row.dob).toBe('1990-05-01');
    expect(row.ig_username).toBe('anna_ig');
    expect(row.notes).toBe('VIP client');
    expect(row.tags).toBe('vip,regular');
    expect(row.marketing_contact_id).toBe(42);
    expect(row.first_source).toBe('instagram');
    expect(row.avatar_url).toBe('https://img/anna.png');
    expect(row.email_opt_in).toBe(1);
  });

  it('still inserts a fresh row when none exists', async () => {
    await saveUser(ctx, 777, {
      chatId: 777, name: 'Bob', phone: '+48999888777',
      tgUsername: 'bob', tgLang: 'en', registeredAt: 1500, tosAcceptedAt: 1500,
    });
    const rows = ctx.db._getTable('users').filter(r => r.chat_id === 777);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bob');
    expect(rows[0].phone).toBe('+48999888777');
    expect(rows[0].tenant_id).toBe('t_a');
  });

  it('getUser returns the new email / marketingContactId / opt-in fields', async () => {
    ctx.db._getTable('users').push({
      tenant_id: 't_a', chat_id: 999, name: 'Cara', phone: '+1',
      email: 'cara@example.com', marketing_contact_id: 7,
      email_opt_in: 0, email_prompt_last_at: 12345, email_prompt_count: 2,
    });
    const u = await getUser(ctx, 999);
    expect(u.email).toBe('cara@example.com');
    expect(u.marketingContactId).toBe(7);
    expect(u.emailOptIn).toBe(0);
    expect(u.emailPromptLastAt).toBe(12345);
    expect(u.emailPromptCount).toBe(2);
  });
});

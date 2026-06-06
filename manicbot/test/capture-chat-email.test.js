import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import {
  captureChatEmail, setChatEmailOptOut, normalizeEmail, shouldAskEmail,
} from '../src/services/marketing/contacts.js';

function seedUser(ctx, chatId, extra = {}) {
  ctx.db._getTable('users').push({ tenant_id: ctx.tenantId, chat_id: chatId, name: null, phone: null, ...extra });
}
const contacts = (ctx) => ctx.db._getTable('marketing_contacts');
const consentLog = (ctx) => ctx.db._getTable('marketing_consent_log');

describe('normalizeEmail', () => {
  it('accepts and lowercases valid emails', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });
  it('rejects junk', () => {
    expect(normalizeEmail('notanemail')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('a'.repeat(300) + '@x.co')).toBeNull();
  });
});

describe('captureChatEmail', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeCtx({ tenantId: 't_a' });
    seedUser(ctx, 555, { phone: '+48500111222', name: 'Анна' });
  });

  it('rejects an invalid email without writing', async () => {
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'nope' });
    expect(r.ok).toBe(false);
    expect(contacts(ctx)).toHaveLength(0);
  });

  it('fresh capture writes contact + consent + links the user', async () => {
    const r = await captureChatEmail(ctx, {
      chatId: 555, email: 'Anna@Example.com', name: 'Анна', phone: '+48500111222',
      tgUsername: 'anna', locale: 'ru', source: 'chat_optin_telegram',
    });
    expect(r.ok).toBe(true);
    const c = contacts(ctx);
    expect(c).toHaveLength(1);
    expect(c[0].email).toBe('anna@example.com');
    expect(c[0].consent_email).toBe(1);
    expect(c[0].unsubscribed).toBe(0);
    expect(c[0].linked_user_chat_id).toBe(555);
    expect(c[0].unsubscribe_token).toBeTruthy();
    expect(c[0].tenant_id).toBe('t_a');
    const cl = consentLog(ctx);
    expect(cl).toHaveLength(1);
    expect(cl[0].event).toBe('subscribed');
    expect(cl[0].source).toBe('chat_optin_telegram');
    expect(cl[0].note).toBe('email');
    const u = ctx.db._getTable('users').find((x) => x.chat_id === 555);
    expect(u.email).toBe('anna@example.com');
    expect(u.email_opt_in).toBe(1);
    expect(u.marketing_contact_id).toBe(c[0].id);
  });

  it('dedups by email — flips consent, +lead_count, no duplicate row', async () => {
    contacts(ctx).push({ id: 9, tenant_id: 't_a', email: 'anna@example.com', phone: null, name: 'Анна', consent_email: 0, unsubscribed: 0, lead_count: 1, linked_user_chat_id: null });
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', source: 'chat_optin_telegram' });
    expect(r.ok).toBe(true);
    expect(r.contactId).toBe(9);
    const c = contacts(ctx);
    expect(c).toHaveLength(1);
    expect(c[0].consent_email).toBe(1);
    expect(c[0].lead_count).toBe(2);
    expect(c[0].linked_user_chat_id).toBe(555);
    expect(consentLog(ctx)).toHaveLength(1);
  });

  it('merges a phone-first contact instead of creating a second row (R2)', async () => {
    contacts(ctx).push({ id: 5, tenant_id: 't_a', email: null, phone: '+48500111222', name: 'Анна', consent_email: 0, unsubscribed: 0, lead_count: 1, linked_user_chat_id: 555 });
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', phone: '+48500111222', source: 'chat_optin_telegram' });
    expect(r.ok).toBe(true);
    expect(r.contactId).toBe(5);
    const c = contacts(ctx);
    expect(c).toHaveLength(1);
    expect(c[0].email).toBe('anna@example.com');
    expect(c[0].consent_email).toBe(1);
  });

  it('spontaneous capture (grantConsent:false) stores email but logs no consent', async () => {
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', grantConsent: false, source: 'chat_volunteered' });
    expect(r.ok).toBe(true);
    const c = contacts(ctx);
    expect(c).toHaveLength(1);
    expect(c[0].consent_email).toBe(0);
    expect(consentLog(ctx)).toHaveLength(0);
    const u = ctx.db._getTable('users').find((x) => x.chat_id === 555);
    expect(u.email).toBe('anna@example.com');
    expect(u.email_opt_in == null).toBe(true); // not granted → opt-in untouched
  });

  it('is idempotent on re-capture (one contact row, lead_count climbs)', async () => {
    await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', source: 'chat_optin_telegram' });
    await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', source: 'chat_optin_telegram' });
    expect(contacts(ctx)).toHaveLength(1);
    expect(contacts(ctx)[0].lead_count).toBe(2);
  });
});

describe('setChatEmailOptOut', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeCtx({ tenantId: 't_a' });
    seedUser(ctx, 555, { email: 'anna@example.com', email_opt_in: 1 });
  });

  it('flips user + contact to unsubscribed and logs it', async () => {
    contacts(ctx).push({ id: 3, tenant_id: 't_a', email: 'anna@example.com', linked_user_chat_id: 555, consent_email: 1, unsubscribed: 0 });
    const r = await setChatEmailOptOut(ctx, 555);
    expect(r.ok).toBe(true);
    const u = ctx.db._getTable('users').find((x) => x.chat_id === 555);
    expect(u.email_opt_in).toBe(0);
    const c = contacts(ctx)[0];
    expect(c.consent_email).toBe(0);
    expect(c.unsubscribed).toBe(1);
    const cl = consentLog(ctx);
    expect(cl).toHaveLength(1);
    expect(cl[0].event).toBe('unsubscribed');
    expect(cl[0].source).toBe('chat_settings');
  });
});

describe('shouldAskEmail', () => {
  const now = 1_000_000;
  it('asks a fresh user with no email/opt-in', () => {
    expect(shouldAskEmail({}, now)).toBe(true);
    expect(shouldAskEmail(null, now)).toBe(true);
  });
  it('does not ask once email is set', () => {
    expect(shouldAskEmail({ email: 'a@b.co' }, now)).toBe(false);
  });
  it('does not ask a decliner', () => {
    expect(shouldAskEmail({ emailOptIn: 0 }, now)).toBe(false);
  });
  it('respects the cooldown', () => {
    expect(shouldAskEmail({ emailPromptLastAt: now - 100 }, now, { cooldownSec: 1000 })).toBe(false);
    expect(shouldAskEmail({ emailPromptLastAt: now - 2000 }, now, { cooldownSec: 1000 })).toBe(true);
  });
  it('respects the prompt cap', () => {
    expect(shouldAskEmail({ emailPromptCount: 3 }, now, { maxPrompts: 3 })).toBe(false);
  });
});

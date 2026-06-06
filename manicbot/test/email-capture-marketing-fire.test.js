/**
 * Killer-feature seam: a successful consented capture fires the
 * `contact.email_captured` event exactly once so the marketing automation
 * engine can greet the new contact. A spontaneous-without-consent capture does
 * NOT fire, and an engine failure never fails the capture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

vi.mock('../src/services/marketing/automations.js', () => ({
  fireAutomationForEvent: vi.fn(async () => ({ fired: 0 })),
}));

import { captureChatEmail } from '../src/services/marketing/contacts.js';
import { fireAutomationForEvent } from '../src/services/marketing/automations.js';

function seedUser(ctx, chatId) {
  ctx.db._getTable('users').push({ tenant_id: ctx.tenantId, chat_id: chatId, name: 'Анна', phone: null });
}

describe('captureChatEmail → contact.email_captured', () => {
  let ctx;
  beforeEach(() => { vi.clearAllMocks(); ctx = makeCtx({ tenantId: 't_a' }); seedUser(ctx, 555); });

  it('fires the event once after a consented capture', async () => {
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', source: 'chat_optin_telegram' });
    expect(r.ok).toBe(true);
    expect(fireAutomationForEvent).toHaveBeenCalledTimes(1);
    expect(fireAutomationForEvent.mock.calls[0][1]).toBe('contact.email_captured');
    expect(fireAutomationForEvent.mock.calls[0][2]).toMatchObject({ chatId: 555 });
  });

  it('does NOT fire when consent is not granted', async () => {
    await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', grantConsent: false });
    expect(fireAutomationForEvent).not.toHaveBeenCalled();
  });

  it('still succeeds when the engine throws', async () => {
    fireAutomationForEvent.mockRejectedValueOnce(new Error('boom'));
    const r = await captureChatEmail(ctx, { chatId: 555, email: 'anna@example.com', source: 'chat_optin_telegram' });
    expect(r.ok).toBe(true);
  });
});

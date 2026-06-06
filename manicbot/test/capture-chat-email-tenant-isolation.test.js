import { describe, it, expect } from 'vitest';
import { makeCtx, createMockD1 } from './helpers/mock-db.js';
import { captureChatEmail } from '../src/services/marketing/contacts.js';

describe('captureChatEmail tenant isolation', () => {
  it('same email under two tenants → two distinct contacts, no cross-tenant bleed', async () => {
    const db = createMockD1();
    const ctxA = makeCtx({ tenantId: 't_a', db });
    const ctxB = makeCtx({ tenantId: 't_b', db });
    db._getTable('users').push({ tenant_id: 't_a', chat_id: 1, phone: null });
    db._getTable('users').push({ tenant_id: 't_b', chat_id: 1, phone: null });

    await captureChatEmail(ctxA, { chatId: 1, email: 'shared@example.com', source: 'chat_optin_telegram' });
    await captureChatEmail(ctxB, { chatId: 1, email: 'shared@example.com', source: 'chat_optin_web' });

    const all = db._getTable('marketing_contacts');
    expect(all).toHaveLength(2);
    const a = all.find((c) => c.tenant_id === 't_a');
    const b = all.find((c) => c.tenant_id === 't_b');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.id).not.toBe(b.id);

    // Each user is linked to its OWN tenant's contact, never the other's.
    const uA = db._getTable('users').find((u) => u.tenant_id === 't_a' && u.chat_id === 1);
    const uB = db._getTable('users').find((u) => u.tenant_id === 't_b' && u.chat_id === 1);
    expect(uA.marketing_contact_id).toBe(a.id);
    expect(uB.marketing_contact_id).toBe(b.id);
    expect(uA.marketing_contact_id).not.toBe(uB.marketing_contact_id);
  });

  it('a capture under tenant B never mutates tenant A’s existing contact', async () => {
    const db = createMockD1();
    const ctxB = makeCtx({ tenantId: 't_b', db });
    db._getTable('users').push({ tenant_id: 't_b', chat_id: 1, phone: null });
    // Pre-existing A contact with the same email, already consented.
    db._getTable('marketing_contacts').push({ id: 100, tenant_id: 't_a', email: 'shared@example.com', consent_email: 1, unsubscribed: 0, lead_count: 5, linked_user_chat_id: 999 });

    await captureChatEmail(ctxB, { chatId: 1, email: 'shared@example.com', source: 'chat_optin_web' });

    const a = db._getTable('marketing_contacts').find((c) => c.id === 100);
    expect(a.lead_count).toBe(5);              // untouched
    expect(a.linked_user_chat_id).toBe(999);   // untouched
    const all = db._getTable('marketing_contacts');
    expect(all).toHaveLength(2);               // B created its own
  });
});

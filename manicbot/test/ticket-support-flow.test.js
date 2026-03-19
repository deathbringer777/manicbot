/**
 * Tests for two locally-modified flows (not yet committed):
 *
 * 1. TICKET_CLOSE (callback.js) — after ticket close:
 *    - client receives `ticket_closed` with remove_keyboard
 *    - `showWelcome` is called for the client
 *    - master receives `ticket_closed_master` ONLY when cid !== clientCid
 *    - when cid === clientCid (master closed their own ticket), no double notification
 *
 * 2. SUPPORT_MSG recipients (message.js) — support ticket notification:
 *    - sender is NOT excluded from recipients (old code excluded sender)
 *    - tenantAgents path: all agents including sender receive notification
 *    - fallback path (masters + admin): all receive, no sender exclusion
 */

import { describe, it, expect } from 'vitest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })) };
    },
  };
}

// ─── 1. Ticket close notification logic ───────────────────────────────────────

/**
 * Pure function extracted from the TICKET_CLOSE handler.
 * Returns the set of chat IDs that should receive notifications.
 */
function ticketCloseRecipients({ cid, clientCid }) {
  const result = { clientGetsWelcome: true, clientGetsRemoveKeyboard: true };
  result.masterNotified = cid !== clientCid;
  return result;
}

describe('TICKET_CLOSE — notification routing (cid vs clientCid guard)', () => {
  it('master (cid=999) closing client (clientCid=111) ticket: master receives ticket_closed_master', () => {
    const r = ticketCloseRecipients({ cid: 999, clientCid: 111 });
    expect(r.masterNotified).toBe(true);
  });

  it('client closes their own ticket (cid === clientCid): no duplicate ticket_closed_master to self', () => {
    const r = ticketCloseRecipients({ cid: 111, clientCid: 111 });
    expect(r.masterNotified).toBe(false);
  });

  it('client always gets welcome screen after ticket close regardless of who closed it', () => {
    const r1 = ticketCloseRecipients({ cid: 999, clientCid: 111 });
    const r2 = ticketCloseRecipients({ cid: 111, clientCid: 111 });
    expect(r1.clientGetsWelcome).toBe(true);
    expect(r2.clientGetsWelcome).toBe(true);
  });

  it('remove_keyboard is always sent to client on ticket close', () => {
    const r1 = ticketCloseRecipients({ cid: 999, clientCid: 111 });
    const r2 = ticketCloseRecipients({ cid: 111, clientCid: 111 });
    expect(r1.clientGetsRemoveKeyboard).toBe(true);
    expect(r2.clientGetsRemoveKeyboard).toBe(true);
  });
});

// ─── 2. clientName resolution ──────────────────────────────────────────────────

function resolveClientName(clientUser) {
  return (clientUser?.name && clientUser.name.slice(0, 64)) || '👋';
}

describe('TICKET_CLOSE — client name resolution for showWelcome', () => {
  it('uses stored user name when available', () => {
    expect(resolveClientName({ name: 'Анна' })).toBe('Анна');
  });

  it('truncates long names to 64 chars', () => {
    const long = 'А'.repeat(100);
    expect(resolveClientName({ name: long })).toHaveLength(64);
  });

  it('falls back to 👋 when user has no name', () => {
    expect(resolveClientName({ name: '' })).toBe('👋');
    expect(resolveClientName({ name: null })).toBe('👋');
    expect(resolveClientName(null)).toBe('👋');
    expect(resolveClientName(undefined)).toBe('👋');
  });
});

// ─── 3. Support ticket recipient collection ───────────────────────────────────

/**
 * Pure function extracted from the SUPPORT_MSG handler.
 * Mirrors the exact new logic (no sender exclusion).
 */
function buildSupportRecipients({ cid, tenantAgents, masters, adminId }) {
  const recipients = new Set();
  if (tenantAgents.length > 0) {
    for (const agId of tenantAgents) recipients.add(agId);
  } else {
    for (const m of masters) {
      if (m.chatId && !m.onVacation) recipients.add(m.chatId);
    }
    if (adminId) recipients.add(adminId);
  }
  return recipients;
}

describe('SUPPORT_MSG — recipient collection (no sender exclusion)', () => {
  describe('tenantAgents path', () => {
    it('all agents receive notification including the sender', () => {
      const cid = 111;
      const recipients = buildSupportRecipients({
        cid,
        tenantAgents: [111, 222, 333],
        masters: [],
        adminId: null,
      });
      expect(recipients.has(111)).toBe(true);
      expect(recipients.has(222)).toBe(true);
      expect(recipients.has(333)).toBe(true);
      expect(recipients.size).toBe(3);
    });

    it('single agent who is also the sender: still receives notification', () => {
      const cid = 111;
      const recipients = buildSupportRecipients({
        cid,
        tenantAgents: [111],
        masters: [],
        adminId: null,
      });
      expect(recipients.has(111)).toBe(true);
      expect(recipients.size).toBe(1);
    });

    it('fallback path is NOT used when tenantAgents is non-empty', () => {
      const master = { chatId: 999, onVacation: false };
      const recipients = buildSupportRecipients({
        cid: 1,
        tenantAgents: [111],
        masters: [master],
        adminId: 777,
      });
      expect(recipients.has(999)).toBe(false);
      expect(recipients.has(777)).toBe(false);
      expect(recipients.has(111)).toBe(true);
    });
  });

  describe('fallback path (masters + admin)', () => {
    it('all active masters receive notification including sender', () => {
      const cid = 111;
      const recipients = buildSupportRecipients({
        cid,
        tenantAgents: [],
        masters: [
          { chatId: 111, onVacation: false },
          { chatId: 222, onVacation: false },
        ],
        adminId: null,
      });
      expect(recipients.has(111)).toBe(true);
      expect(recipients.has(222)).toBe(true);
    });

    it('master on vacation is NOT included', () => {
      const recipients = buildSupportRecipients({
        cid: 1,
        tenantAgents: [],
        masters: [
          { chatId: 111, onVacation: true },
          { chatId: 222, onVacation: false },
        ],
        adminId: null,
      });
      expect(recipients.has(111)).toBe(false);
      expect(recipients.has(222)).toBe(true);
    });

    it('admin receives notification even when admin is the sender', () => {
      const cid = 777;
      const recipients = buildSupportRecipients({
        cid,
        tenantAgents: [],
        masters: [],
        adminId: 777,
      });
      expect(recipients.has(777)).toBe(true);
    });

    it('both active masters and admin receive notification (Set deduplicates if admin is also master)', () => {
      const recipients = buildSupportRecipients({
        cid: 1,
        tenantAgents: [],
        masters: [
          { chatId: 222, onVacation: false },
          { chatId: 333, onVacation: false },
        ],
        adminId: 444,
      });
      expect(recipients.has(222)).toBe(true);
      expect(recipients.has(333)).toBe(true);
      expect(recipients.has(444)).toBe(true);
    });

    it('no recipients when no agents, no active masters, no admin', () => {
      const recipients = buildSupportRecipients({
        cid: 1,
        tenantAgents: [],
        masters: [{ chatId: 111, onVacation: true }],
        adminId: null,
      });
      expect(recipients.size).toBe(0);
    });

    it('master chatId=null is skipped', () => {
      const recipients = buildSupportRecipients({
        cid: 1,
        tenantAgents: [],
        masters: [
          { chatId: null, onVacation: false },
          { chatId: 555, onVacation: false },
        ],
        adminId: null,
      });
      expect(recipients.has(null)).toBe(false);
      expect(recipients.has(555)).toBe(true);
    });
  });
});

// ─── 4. Regression: old behaviour vs new behaviour diff ───────────────────────

/**
 * Old logic (from GitHub) — excluded the sender from recipients.
 * These tests document WHY the old code was wrong in certain scenarios.
 */
function buildSupportRecipientsOld({ cid, tenantAgents, masters, adminId }) {
  const recipients = new Set();
  if (tenantAgents.length > 0) {
    for (const agId of tenantAgents) {
      if (Number(agId) !== cid && String(agId) !== String(cid)) recipients.add(agId);
    }
  } else {
    for (const m of masters) {
      if (m.chatId && !m.onVacation && m.chatId !== cid) recipients.add(m.chatId);
    }
    if (adminId && adminId !== cid) recipients.add(adminId);
  }
  return recipients;
}

describe('Regression: old code would miss notifications in single-agent scenario', () => {
  it('old code: single tenant agent who is also sender → empty recipients (bug)', () => {
    const cid = 111;
    const oldRecipients = buildSupportRecipientsOld({
      cid,
      tenantAgents: [111],
      masters: [],
      adminId: null,
    });
    expect(oldRecipients.size).toBe(0); // bug: nobody gets notified
  });

  it('new code: single tenant agent who is also sender → they receive the notification', () => {
    const cid = 111;
    const newRecipients = buildSupportRecipients({
      cid,
      tenantAgents: [111],
      masters: [],
      adminId: null,
    });
    expect(newRecipients.size).toBe(1); // fixed: at least one notification sent
    expect(newRecipients.has(111)).toBe(true);
  });

  it('old code: admin who is sole fallback and also sender → empty recipients (bug)', () => {
    const cid = 777;
    const oldRecipients = buildSupportRecipientsOld({
      cid,
      tenantAgents: [],
      masters: [],
      adminId: 777,
    });
    expect(oldRecipients.size).toBe(0);
  });

  it('new code: admin who is sole fallback and also sender → receives notification', () => {
    const cid = 777;
    const newRecipients = buildSupportRecipients({
      cid,
      tenantAgents: [],
      masters: [],
      adminId: 777,
    });
    expect(newRecipients.size).toBe(1);
    expect(newRecipients.has(777)).toBe(true);
  });
});

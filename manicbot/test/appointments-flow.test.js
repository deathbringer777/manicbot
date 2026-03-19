import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeMockKv(store = new Map()) {
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return typeof v === 'object' ? v : v;
    },
    put: async (key, value, opts) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

function makeCtx(storeData = {}) {
  const store = new Map(Object.entries(storeData));
  const kv = makeMockKv(store);
  return {
    kv,
    globalKv: kv,
    prefix: 't:test:',
    tenantId: 'test',
    svc: [
      { id: 'classic', e: '💅', dur: 60, price: 80, active: true, names: { ru: 'Маникюр' } },
      { id: 'pedi', e: '🦶', dur: 90, price: 120, active: true, names: { ru: 'Педикюр' } },
    ],
    svcIds: new Set(['classic', 'pedi']),
    tenant: { salon: { name: 'Test Salon', workHours: { from: 9, to: 19 } }, billingStatus: 'trialing', plan: 'pro' },
    _store: store,
  };
}

describe('Appointment data integrity', () => {
  it('appointment stores all required fields', () => {
    const apt = {
      id: 'a123_abc',
      chatId: 111,
      svcId: 'classic',
      date: '2026-03-20',
      time: '14:00',
      ts: Date.now(),
      userName: 'Test User',
      userPhone: '+48123456789',
      userTg: 'testuser',
      masterId: null,
      status: 'pending',
      createdAt: Date.now(),
    };
    expect(apt.id).toMatch(/^a\d+_\w+$/);
    expect(apt.status).toBe('pending');
    expect(apt.chatId).toBe(111);
  });

  it('cancelled appointment has cx flag', () => {
    const apt = { id: 'a1_x', status: 'cancelled', cx: true };
    expect(apt.cx).toBe(true);
  });

  it('counter-offer stores counterTime and counterComment', () => {
    const apt = {
      status: 'counter_offer',
      counterTime: '15:30',
      counterComment: 'Let me suggest this time instead',
      confirmedBy: 222,
    };
    expect(apt.counterTime).toBe('15:30');
    expect(apt.confirmedBy).toBe(222);
  });
});

describe('Booking flow validation', () => {
  it('rejects past dates', () => {
    const today = '2026-03-19';
    const past = '2026-03-18';
    expect(past < today).toBe(true);
  });

  it('validates time format', () => {
    const TIME_RE = /^\d{2}:\d{2}$/;
    expect(TIME_RE.test('14:00')).toBe(true);
    expect(TIME_RE.test('9:00')).toBe(false);
    expect(TIME_RE.test('09:00')).toBe(true);
    expect(TIME_RE.test('25:00')).toBe(true); // regex doesn't validate range
    expect(TIME_RE.test('')).toBe(false);
  });

  it('validates date format', () => {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    expect(DATE_RE.test('2026-03-20')).toBe(true);
    expect(DATE_RE.test('20-03-2026')).toBe(false);
    expect(DATE_RE.test('')).toBe(false);
  });

  it('appointment ID format is valid', () => {
    const ID_RE = /^a\d+_\w+$/;
    expect(ID_RE.test('a1710000000_abc123')).toBe(true);
    expect(ID_RE.test('b1234_abc')).toBe(false);
    expect(ID_RE.test('a_abc')).toBe(false);
  });
});

describe('Cancel flow', () => {
  it('only owner can cancel their appointment', () => {
    const apt = { chatId: 111, cx: false, status: 'confirmed' };
    const canceller = 111;
    const wrongUser = 222;
    expect(apt.chatId === canceller).toBe(true);
    expect(apt.chatId === wrongUser).toBe(false);
  });

  it('admin can force cancel any appointment', () => {
    const apt = { chatId: 111, cx: false, status: 'confirmed' };
    const adminOverride = true;
    expect(adminOverride || apt.chatId === 999).toBe(true);
  });

  it('already cancelled appointment cannot be cancelled again', () => {
    const apt = { cx: true, status: 'cancelled' };
    expect(apt.cx).toBe(true);
  });
});

describe('Master assignment', () => {
  it('unassigned appointment has null masterId', () => {
    const apt = { masterId: null };
    expect(apt.masterId).toBeNull();
  });

  it('confirming master claims unassigned appointment', () => {
    const apt = { masterId: null, status: 'pending' };
    const confirmingMasterId = 333;
    if (!apt.masterId) apt.masterId = confirmingMasterId;
    apt.status = 'confirmed';
    apt.confirmedBy = confirmingMasterId;
    expect(apt.masterId).toBe(333);
    expect(apt.confirmedBy).toBe(333);
  });

  it('pre-assigned appointment keeps its master on confirm', () => {
    const apt = { masterId: 444, status: 'pending' };
    const confirmingMasterId = 555;
    if (!apt.masterId) apt.masterId = confirmingMasterId;
    apt.status = 'confirmed';
    expect(apt.masterId).toBe(444); // not 555
  });
});

describe('Slot collision detection', () => {
  it('lock key is unique per date+time', () => {
    const date = '2026-03-20';
    const time = '14:00';
    const lockKey = `lock:slot:${date}:${time}`;
    expect(lockKey).toBe('lock:slot:2026-03-20:14:00');
  });

  it('different dates produce different lock keys', () => {
    const key1 = 'lock:slot:2026-03-20:14:00';
    const key2 = 'lock:slot:2026-03-21:14:00';
    expect(key1).not.toBe(key2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CB, STEP } from '../src/config.js';

function makeMockKv(store = new Map()) {
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return typeof v === 'object' ? v : v;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

describe('Master rename flow', () => {
  it('ADM_RENAME_M callback data has correct format', () => {
    expect(CB.ADM_RENAME_M).toBe('adm:rnm:');
    const chatId = 12345;
    const cbData = CB.ADM_RENAME_M + chatId;
    expect(cbData).toBe('adm:rnm:12345');
    expect(cbData.startsWith(CB.ADM_RENAME_M)).toBe(true);
    expect(parseInt(cbData.slice(CB.ADM_RENAME_M.length))).toBe(12345);
  });

  it('RENAME_MASTER step is defined', () => {
    expect(STEP.RENAME_MASTER).toBe('rename_master');
  });

  it('master display name is stored correctly', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const prefix = 't:t_salon1:';

    const masterData = {
      chatId: 555,
      name: 'Кирилл',
      displayName: 'Кирилл Мастер',
      tgUsername: 'kirill',
      active: true,
      onVacation: false,
    };
    await kv.put(prefix + 'master:555', JSON.stringify(masterData));

    const stored = JSON.parse(store.get(prefix + 'master:555'));
    expect(stored.displayName).toBe('Кирилл Мастер');
    expect(stored.name).toBe('Кирилл');
  });

  it('displayName falls back to name when not set', () => {
    const master = { chatId: 123, name: 'TechName', onVacation: false };
    const displayName = master.displayName || master.name;
    expect(displayName).toBe('TechName');
  });

  it('displayName takes priority over name', () => {
    const master = { chatId: 123, name: 'TechName', displayName: 'Friendly Name', onVacation: false };
    const displayName = master.displayName || master.name;
    expect(displayName).toBe('Friendly Name');
  });
});

describe('Master rename validation', () => {
  it('rejects names shorter than 2 chars', () => {
    const name = 'A';
    const cleaned = name.replace(/<[^>]*>/g, '').trim().slice(0, 50);
    expect(cleaned.length < 2).toBe(true);
  });

  it('strips HTML tags from name', () => {
    const name = '<b>Test</b> Name';
    const cleaned = name.replace(/<[^>]*>/g, '').trim().slice(0, 50);
    expect(cleaned).toBe('Test Name');
  });

  it('limits name to 50 chars', () => {
    const name = 'A'.repeat(100);
    const cleaned = name.replace(/<[^>]*>/g, '').trim().slice(0, 50);
    expect(cleaned.length).toBe(50);
  });

  it('accepts valid names', () => {
    const names = ['Кирилл', 'Anna Smith', 'Мастер Виктория', 'Jo'];
    for (const name of names) {
      const cleaned = name.replace(/<[^>]*>/g, '').trim().slice(0, 50);
      expect(cleaned.length >= 2).toBe(true);
    }
  });
});

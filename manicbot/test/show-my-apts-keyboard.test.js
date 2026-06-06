/**
 * Regression test: showMyApts non-empty state must have both "Book" and
 * "Main menu" buttons, each on its own row.
 *
 * Bug: the m_book (CB.BOOK) button was absent from the non-empty keyboard,
 * leaving only the back_m (CB.MAIN) button, which caused both to render
 * side-by-side when Telegram fell back to its default layout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Dependency mocks (hoisted by Vitest) ────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/telegram.js', () => ({
  send: (...a) => mockSend(...a),
  sendPhoto: vi.fn(),
  trySendPhoto: vi.fn(),
  editPhoto: vi.fn(),
  api: vi.fn(),
}));

vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn().mockResolvedValue('ru'),
}));

vi.mock('../src/services/state.js', () => ({
  clearState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/users.js', () => ({
  getRole: vi.fn().mockResolvedValue('client'),
  isPlatformAdmin: vi.fn().mockResolvedValue(false),
  // showMyApts reads the client to decide whether to show the email-unsubscribe
  // row (0114). null → not subscribed → no extra row, so the layout below holds.
  getUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/services/appointments.js', () => ({
  getApts: vi.fn(),
}));

vi.mock('../src/services/services.js', () => ({
  loadAboutPhotos: vi.fn().mockResolvedValue([]),
  loadAboutDesc: vi.fn().mockResolvedValue(null),
  loadInstagramUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/ui/admin.js', () => ({
  showAdminPanel: vi.fn(),
  showMasterPanel: vi.fn(),
  showAdminApts: vi.fn(), showAdminAllApts: vi.fn(), showMasterAllApts: vi.fn(),
  showMastersList: vi.fn(), showClientsList: vi.fn(), showServicesList: vi.fn(),
  showServiceEdit: vi.fn(), showServicePhotos: vi.fn(), showAboutSettings: vi.fn(),
  showAboutPhotos: vi.fn(), showAboutDescEdit: vi.fn(), showAboutInstagramEdit: vi.fn(),
  showAdminCancelAllConfirm: vi.fn(), showAdminSettings: vi.fn(), showTenantSupportList: vi.fn(),
}));

vi.mock('../src/ui/sysadmin.js', () => ({
  showPlatformAdminPanel: vi.fn(),
}));

import { CB } from '../src/config.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx() {
  return {
    kv: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    globalKv: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    prefix: 't:test:',
    tenantId: 'test',
    svc: [
      { id: 'classic', e: '💅', dur: 60, price: 80, active: true, names: { ru: 'Маникюр' } },
    ],
    svcIds: new Set(['classic']),
    tenant: {
      salon: { name: 'Test Salon' },
      billingStatus: 'trialing',
      plan: 'pro',
    },
  };
}

function makeApt(overrides = {}) {
  return {
    id: 'a1_test',
    chatId: 111,
    svcId: 'classic',
    date: '2026-06-01',
    time: '10:00',
    status: 'confirmed',
    userName: 'Test User',
    userPhone: '+48100000000',
    userTg: 'testuser',
    masterId: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('showMyApts keyboard layout', () => {
  let getApts;
  let showMyApts;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ getApts } = await import('../src/services/appointments.js'));
    ({ showMyApts } = await import('../src/ui/screens.js'));
  });

  it('empty state: both m_book and back_m are present on separate rows', async () => {
    getApts.mockResolvedValue([]);
    const ctx = makeCtx();
    await showMyApts(ctx, 111);

    expect(mockSend).toHaveBeenCalledOnce();
    const [, , , opts] = mockSend.mock.calls[0];
    const kb = opts.reply_markup.inline_keyboard;

    const bookRow = kb.find(row => row.some(btn => btn.callback_data === CB.BOOK));
    const mainRow = kb.find(row => row.some(btn => btn.callback_data === CB.MAIN));

    expect(bookRow).toBeDefined();
    expect(mainRow).toBeDefined();
    // Must be on separate rows
    expect(bookRow).not.toBe(mainRow);
  });

  it('non-empty state: both m_book and back_m are present on separate rows', async () => {
    getApts.mockResolvedValue([makeApt()]);
    const ctx = makeCtx();
    await showMyApts(ctx, 111);

    expect(mockSend).toHaveBeenCalledOnce();
    const [, , , opts] = mockSend.mock.calls[0];
    const kb = opts.reply_markup.inline_keyboard;

    const bookRow = kb.find(row => row.some(btn => btn.callback_data === CB.BOOK));
    const mainRow = kb.find(row => row.some(btn => btn.callback_data === CB.MAIN));

    expect(bookRow).toBeDefined();
    expect(mainRow).toBeDefined();
    // Must be on separate rows
    expect(bookRow).not.toBe(mainRow);
  });

  it('non-empty state: each of m_book and back_m row has exactly one button', async () => {
    getApts.mockResolvedValue([makeApt()]);
    const ctx = makeCtx();
    await showMyApts(ctx, 111);

    const [, , , opts] = mockSend.mock.calls[0];
    const kb = opts.reply_markup.inline_keyboard;

    const bookRow = kb.find(row => row.some(btn => btn.callback_data === CB.BOOK));
    const mainRow = kb.find(row => row.some(btn => btn.callback_data === CB.MAIN));

    expect(bookRow).toHaveLength(1);
    expect(mainRow).toHaveLength(1);
  });

  it('non-empty with 2 apts: cancel-all button row present, m_book and back_m still separate', async () => {
    getApts.mockResolvedValue([makeApt({ id: 'a1_x' }), makeApt({ id: 'a2_y', time: '11:00' })]);
    const ctx = makeCtx();
    await showMyApts(ctx, 111);

    const [, , , opts] = mockSend.mock.calls[0];
    const kb = opts.reply_markup.inline_keyboard;

    const bookRow = kb.find(row => row.some(btn => btn.callback_data === CB.BOOK));
    const mainRow = kb.find(row => row.some(btn => btn.callback_data === CB.MAIN));

    expect(bookRow).toBeDefined();
    expect(mainRow).toBeDefined();
    expect(bookRow).not.toBe(mainRow);
  });
});

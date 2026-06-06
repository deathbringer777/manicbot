/**
 * onMsg routing for email capture: the EMAIL_WAIT branch (prompted reply) and
 * the spontaneous catch (bare email in free chat). Heavy collaborators are
 * mocked; captureChatEmail is spied while normalizeEmail stays real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STEP } from '../src/config.js';

const h = vi.hoisted(() => ({ state: { step: 'idle' } }));

vi.mock('../src/telegram.js', () => ({ send: vi.fn(async () => {}), api: vi.fn(async () => {}), sendIcs: vi.fn(async () => {}) }));
vi.mock('../src/services/state.js', () => ({
  getState: vi.fn(async () => h.state),
  setState: vi.fn(async () => {}), clearState: vi.fn(async () => {}), checkRateLimit: vi.fn(async () => true),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'), setLang: vi.fn(async () => {}),
  getChatHistory: vi.fn(async () => []), appendChatTurn: vi.fn(async () => {}), clearChatHistory: vi.fn(async () => {}),
}));
vi.mock('../src/billing/features.js', () => ({ isInactive: vi.fn(() => false), canUse: vi.fn(() => true), getMastersLimit: vi.fn(() => 99) }));
vi.mock('../src/ai.js', () => ({
  runWorkersAI: vi.fn(async () => ''), parseAIActions: vi.fn(() => ({ text: '', actions: [] })), executeAIAction: vi.fn(async () => {}),
  validateActionParams: vi.fn(() => true), buildAISystemPrompt: vi.fn(() => ''), sanitizeUserInput: vi.fn((s) => s),
}));
vi.mock('../src/services/users.js', () => ({
  getUser: vi.fn(async () => ({ chatId: 555, name: 'Анна', phone: '+1', email: null, emailOptIn: null })),
  getRole: vi.fn(async () => 'client'),
  isBlocked: vi.fn(async () => false), isPlatformAdmin: vi.fn(async () => false),
  isAdmin: vi.fn(async () => false), isMaster: vi.fn(async () => false),
  canManageApt: vi.fn(async () => false), getAdminId: vi.fn(async () => null), setAdminId: vi.fn(async () => {}),
  getMaster: vi.fn(async () => null), saveMaster: vi.fn(async () => {}), listMasters: vi.fn(async () => []),
  resolveMasterInput: vi.fn(async () => null), blockUser: vi.fn(async () => {}), unblockUser: vi.fn(async () => {}),
  saveUser: vi.fn(async () => {}), upsertUserFromTelegram: vi.fn(async () => {}), masterTelegramRecipient: vi.fn(() => null),
}));
vi.mock('../src/services/marketing/contacts.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, captureChatEmail: vi.fn(async () => ({ ok: true })) };
});

import { onMsg } from '../src/handlers/message.js';
import { captureChatEmail } from '../src/services/marketing/contacts.js';
import { clearState } from '../src/services/state.js';

function makeCtx() {
  return {
    tenantId: 't1', channel: { type: 'telegram' }, env: {},
    tenant: { billingStatus: 'active', plan: 'pro', salon: {} },
    svc: [{ id: 'classic', dur: 60, price: 80, active: true, names: { ru: 'Маникюр' } }],
    svcIds: new Set(['classic']),
  };
}
function makeMsg(text) { return { chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Анна' }, text }; }

describe('onMsg email routing', () => {
  beforeEach(() => { vi.clearAllMocks(); h.state = { step: 'idle' }; });

  it('EMAIL_WAIT + valid email → captures (prompted) and clears state', async () => {
    h.state = { step: STEP.EMAIL_WAIT };
    await onMsg(makeCtx(), makeMsg('Test@Example.com'));
    expect(captureChatEmail).toHaveBeenCalledTimes(1);
    expect(captureChatEmail.mock.calls[0][1]).toMatchObject({ chatId: 555, grantConsent: true });
    expect(clearState).toHaveBeenCalled();
  });

  it('EMAIL_WAIT + invalid email → no capture', async () => {
    h.state = { step: STEP.EMAIL_WAIT };
    await onMsg(makeCtx(), makeMsg('not-an-email'));
    expect(captureChatEmail).not.toHaveBeenCalled();
  });

  it('spontaneous bare email at idle → captures as chat_volunteered', async () => {
    h.state = { step: 'idle' };
    await onMsg(makeCtx(), makeMsg('hey, write me at test@example.com please'));
    expect(captureChatEmail).toHaveBeenCalled();
    expect(captureChatEmail.mock.calls[0][1]).toMatchObject({ source: 'chat_volunteered', grantConsent: true });
  });
});

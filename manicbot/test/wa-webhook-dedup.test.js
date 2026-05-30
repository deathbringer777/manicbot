/**
 * WhatsApp inbound dedup by wamid.
 *
 * Meta retries WA webhooks for up to 24h on 5xx. Without dedup every retry
 * replays the message — duplicate AI replies, duplicate bookings,
 * duplicate analytics. Telegram and Instagram already dedup
 * (claimTelegramUpdate by update_id; claimMetaMessage by mid); this test
 * locks in the equivalent WA behaviour via claimWAMessage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimSpy = vi.fn();
const resolveSpy = vi.fn();
const getChannelConfigSpy = vi.fn();
const buildChannelCtxSpy = vi.fn();
const handleInboundSpy = vi.fn();
const initServicesSpy = vi.fn();
const verifyMetaSignatureSpy = vi.fn();
const normalizeSpy = vi.fn();

vi.mock('../src/utils/dedup.js', () => ({
  claimWAMessage: (...args) => claimSpy(...args),
  claimMetaMessage: vi.fn(async () => true), // IG path unused but module exports it
}));

vi.mock('../src/channels/resolver.js', () => ({
  resolveTenantFromWhatsApp: (...args) => resolveSpy(...args),
  resolveTenantFromInstagram: vi.fn(),
  getChannelConfig: (...args) => getChannelConfigSpy(...args),
  buildChannelCtx: (...args) => buildChannelCtxSpy(...args),
}));

vi.mock('../src/handlers/inbound.js', () => ({
  handleInbound: (...args) => handleInboundSpy(...args),
}));

vi.mock('../src/services/services.js', () => ({
  initServices: (...args) => initServicesSpy(...args),
  getConfig: vi.fn(),
}));

vi.mock('../src/channels/meta-verify.js', () => ({
  verifyMetaSignature: (...args) => verifyMetaSignatureSpy(...args),
  handleHubChallenge: vi.fn(),
}));

vi.mock('../src/channels/whatsapp.js', () => ({
  WhatsAppAdapter: class {
    constructor() { this.normalize = normalizeSpy; }
  },
}));

vi.mock('../src/channels/instagram.js', () => ({
  InstagramAdapter: class {},
  parseInstagramIgnoreSenderIds: () => new Set(),
}));

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

vi.mock('../src/utils/logger.js', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { tryMetaWebhooks } = await import('../src/http/metaWebhooksHttp.js');

const PHONE_NUMBER_ID = '15551234567';
const WAMID_A = 'wamid.AAA_first_message';
const WAMID_B = 'wamid.BBB_second_message';

function buildWAEntry(wamids) {
  return {
    entry: [{
      id: 'WA_BUSINESS_ACCOUNT_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          messages: wamids.map(id => ({
            from: '15559999999',
            id,
            timestamp: '1700000000',
            type: 'text',
            text: { body: 'hi' },
          })),
        },
      }],
    }],
  };
}

function makeReq(body) {
  return new Request('https://manicbot.com/webhook/wa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=stub',
    },
    body: JSON.stringify(body),
  });
}

function makeExecCtx() {
  // Capture the background task synchronously so the test can await it.
  const tasks = [];
  return {
    waitUntil: p => tasks.push(p),
    _tasks: tasks,
  };
}

const env = {
  META_APP_SECRET: 'x'.repeat(32),
  MANICBOT: { get: async () => null, put: async () => {} },
  // A4: the atomic D1 dedup backend requires the DB binding to be forwarded by
  // the webhook caller. A sentinel is enough here — claimWAMessage is spied.
  DB: { __fakeD1: true },
};

describe('WhatsApp webhook — inbound dedup by wamid', () => {
  beforeEach(() => {
    claimSpy.mockReset();
    resolveSpy.mockReset();
    getChannelConfigSpy.mockReset();
    buildChannelCtxSpy.mockReset();
    handleInboundSpy.mockReset();
    initServicesSpy.mockReset();
    verifyMetaSignatureSpy.mockReset();
    normalizeSpy.mockReset();

    verifyMetaSignatureSpy.mockResolvedValue(true);
    resolveSpy.mockResolvedValue({ tenantId: 't_test', channelConfig: { id: 'cc1' } });
    getChannelConfigSpy.mockResolvedValue({ id: 'cc1', token: 'EAA...', config: { phone_number_id: PHONE_NUMBER_ID } });
    buildChannelCtxSpy.mockResolvedValue({ db: {}, tenantId: 't_test' });
    initServicesSpy.mockResolvedValue(undefined);
    normalizeSpy.mockReturnValue({ channel: 'whatsapp', tenantId: 't_test', text: 'hi' });
    handleInboundSpy.mockResolvedValue(undefined);
  });

  it('processes a fresh wamid (first delivery)', async () => {
    claimSpy.mockResolvedValue(true);
    const url = new URL('https://manicbot.com/webhook/wa');
    const execCtx = makeExecCtx();
    const res = await tryMetaWebhooks(makeReq(buildWAEntry([WAMID_A])), env, url, execCtx);
    expect(res?.status).toBe(200);
    await Promise.all(execCtx._tasks);

    expect(claimSpy).toHaveBeenCalledWith(
      expect.objectContaining({ MANICBOT: expect.anything() }),
      String(PHONE_NUMBER_ID),
      WAMID_A,
    );
    expect(handleInboundSpy).toHaveBeenCalledTimes(1);
  });

  it('skips a replayed wamid (duplicate delivery)', async () => {
    claimSpy.mockResolvedValue(false); // KV already holds the claim
    const url = new URL('https://manicbot.com/webhook/wa');
    const execCtx = makeExecCtx();
    const res = await tryMetaWebhooks(makeReq(buildWAEntry([WAMID_A])), env, url, execCtx);
    expect(res?.status).toBe(200);
    await Promise.all(execCtx._tasks);

    expect(claimSpy).toHaveBeenCalledOnce();
    // Critical: handler MUST NOT be called when the wamid is a replay.
    expect(handleInboundSpy).not.toHaveBeenCalled();
    expect(initServicesSpy).not.toHaveBeenCalled();
  });

  it('processes a change with mixed fresh+replayed wamids (any-fresh wins)', async () => {
    // First call (WAMID_A) is a replay; second (WAMID_B) is fresh.
    claimSpy
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const url = new URL('https://manicbot.com/webhook/wa');
    const execCtx = makeExecCtx();
    const res = await tryMetaWebhooks(makeReq(buildWAEntry([WAMID_A, WAMID_B])), env, url, execCtx);
    expect(res?.status).toBe(200);
    await Promise.all(execCtx._tasks);

    expect(claimSpy).toHaveBeenCalledTimes(2);
    expect(handleInboundSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards the DB binding to claimWAMessage so the atomic D1 path engages (A4)', async () => {
    claimSpy.mockResolvedValue(true);
    const url = new URL('https://manicbot.com/webhook/wa');
    const execCtx = makeExecCtx();
    const res = await tryMetaWebhooks(makeReq(buildWAEntry([WAMID_A])), env, url, execCtx);
    expect(res?.status).toBe(200);
    await Promise.all(execCtx._tasks);
    // Before the fix the caller passed only { MANICBOT } → no atomic dedup.
    expect(claimSpy).toHaveBeenCalledWith(
      expect.objectContaining({ MANICBOT: expect.anything(), DB: expect.anything() }),
      String(PHONE_NUMBER_ID),
      WAMID_A,
    );
  });

  it('does not gate status-only changes (delivered/read receipts have no messages array)', async () => {
    const url = new URL('https://manicbot.com/webhook/wa');
    const execCtx = makeExecCtx();
    const statusOnly = {
      entry: [{
        id: 'WA_BUSINESS_ACCOUNT_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            statuses: [{ id: WAMID_A, status: 'delivered' }],
          },
        }],
      }],
    };
    const res = await tryMetaWebhooks(makeReq(statusOnly), env, url, execCtx);
    expect(res?.status).toBe(200);
    await Promise.all(execCtx._tasks);

    // No messages array → claimWAMessage is never invoked. The current
    // normalize() returns null for status-only entries, so handleInbound is
    // also not called — but that's the adapter's contract, not ours.
    expect(claimSpy).not.toHaveBeenCalled();
  });
});

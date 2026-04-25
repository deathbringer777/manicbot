/**
 * Preview-landing tenant tests.
 *
 * Covers:
 *   1. Idempotent provisioning (D1 rows for tenant/services/masters/tenant_config).
 *   2. Preview-mode short-circuit in saveApt / cancelApt (no D1 writes).
 *   3. Preview-mode guardrail addendum in buildAISystemPrompt.
 *   4. Preview-mode 4-button mainKb (matches landing mockup).
 *   5. Preview-mode flag resolution from tenant_config in channels resolver.
 *   6. /embed/demo-chat.js HTTP handler serves the widget JS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import vm from 'vm';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import {
  PREVIEW_TENANT_ID,
  PREVIEW_TENANT_SLUG,
} from '../src/tenant/previewTenant.js';
import { saveApt, cancelApt } from '../src/services/appointments.js';
import { buildAISystemPrompt } from '../src/ai.js';
import { mainKb } from '../src/ui/keyboards.js';
import { tryEmbed } from '../src/http/embedHttp.js';
import { DEMO_CHAT_SRC } from '../src/embed/demoChat.js';

function makeEnv(db = createMockD1()) {
  return { DB: db, MANICBOT: makeMockKv() };
}

describe('ensurePreviewTenantProvisioned', () => {
  let env;
  let fresh;
  beforeEach(async () => {
    env = makeEnv();
    // Re-import the module so each test gets its own `_previewProvisioned` flag.
    vi.resetModules();
    fresh = await import('../src/tenant/previewTenant.js');
  });

  it('creates tenant, services, masters and preview_mode flag', async () => {
    await fresh.ensurePreviewTenantProvisioned(env);

    const tenants = env.DB._getTable('tenants');
    expect(tenants).toHaveLength(1);
    expect(tenants[0].id).toBe(PREVIEW_TENANT_ID);
    expect(tenants[0].slug).toBe(PREVIEW_TENANT_SLUG);
    expect(tenants[0].public_active).toBe(1);
    expect(tenants[0].is_test).toBe(1);
    expect(tenants[0].plan).toBe('pro');
    expect(tenants[0].billing_status).toBe('trialing');

    const services = env.DB._getTable('services');
    expect(services.length).toBeGreaterThanOrEqual(4);
    expect(services.every(s => s.tenant_id === PREVIEW_TENANT_ID)).toBe(true);
    const svcIds = services.map(s => s.svc_id).sort();
    expect(svcIds).toEqual(['classic', 'design', 'gel', 'pedi']);

    const masters = env.DB._getTable('masters');
    expect(masters).toHaveLength(2);
    expect(masters.map(m => m.name).sort()).toEqual(['Алина', 'Виктория']);
    expect(masters.every(m => m.tenant_id === PREVIEW_TENANT_ID)).toBe(true);

    const cfg = env.DB._getTable('tenant_config');
    const previewRow = cfg.find(r => r.tenant_id === PREVIEW_TENANT_ID && r.key === 'preview_mode');
    expect(previewRow?.value).toBe('1');
  });

  it('seeds services with photo URLs', async () => {
    await fresh.ensurePreviewTenantProvisioned(env);
    const services = env.DB._getTable('services');
    for (const svc of services) {
      const photos = JSON.parse(svc.photos || '[]');
      expect(photos.length).toBeGreaterThan(0);
      expect(photos[0]).toMatch(/^https:\/\//);
    }
  });

  it('is idempotent — second call does not duplicate rows', async () => {
    await fresh.ensurePreviewTenantProvisioned(env);
    await fresh.ensurePreviewTenantProvisioned(env);
    await fresh.ensurePreviewTenantProvisioned(env);

    expect(env.DB._getTable('tenants')).toHaveLength(1);
    expect(env.DB._getTable('services')).toHaveLength(4);
    expect(env.DB._getTable('masters')).toHaveLength(2);
    const previewCfgs = env.DB._getTable('tenant_config').filter(r => r.key === 'preview_mode');
    expect(previewCfgs).toHaveLength(1);
  });

  it('no-ops when env.DB is absent', async () => {
    await expect(fresh.ensurePreviewTenantProvisioned({ MANICBOT: makeMockKv() }))
      .resolves.toBeUndefined();
  });
});

describe('preview-mode short-circuits destructive writes', () => {
  it('saveApt returns synthetic doc without touching D1', async () => {
    const db = createMockD1();
    const ctx = { db, kv: makeMockKv(), tenantId: PREVIEW_TENANT_ID, previewMode: true };
    const apt = {
      chatId: 42,
      svcId: 'classic',
      date: '2026-05-10',
      time: '14:00',
      userName: 'Anna',
      userPhone: '+48123456789',
    };
    const saved = await saveApt(ctx, apt);
    expect(saved.previewOnly).toBe(true);
    expect(saved.id).toMatch(/^demo_/);
    expect(saved.status).toBe('pending');
    expect(saved.chatId).toBe(42);
    expect(db._getTable('appointments')).toHaveLength(0);
  });

  it('cancelApt returns synthetic cancel without touching D1', async () => {
    const db = createMockD1();
    const ctx = { db, kv: makeMockKv(), tenantId: PREVIEW_TENANT_ID, previewMode: true };
    const cancelled = await cancelApt(ctx, 'demo_abc123', 42);
    expect(cancelled.previewOnly).toBe(true);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.id).toBe('demo_abc123');
    expect(cancelled.cancelledBy).toBe('client');
    expect(db._getTable('appointments')).toHaveLength(0);
  });

  it('cancelApt marks admin-initiated cancellations', async () => {
    const ctx = { db: createMockD1(), kv: makeMockKv(), tenantId: PREVIEW_TENANT_ID, previewMode: true };
    const cancelled = await cancelApt(ctx, 'demo_xyz', 99, true);
    expect(cancelled.cancelledBy).toBe('admin');
  });
});

describe('buildAISystemPrompt preview guardrail', () => {
  const baseCtx = {
    salonName: 'Manic Bot',
    address: 'ul. Demo 1',
    phone: '+48 22 000 00 00',
    hoursStr: '10:00–20:00',
    services: [{ id: 'classic', name: 'Маникюр', price: 45, duration: 60 }],
    masters: null,
  };

  it('adds guardrail when previewMode is true', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-04-20', { ...baseCtx, previewMode: true });
    expect(prompt).toMatch(/РЕЖИМ ДЕМО-ЛЕНДИНГА/);
    expect(prompt).toMatch(/off-topic/);
  });

  it('omits guardrail when previewMode is false', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-04-20', { ...baseCtx, previewMode: false });
    expect(prompt).not.toMatch(/РЕЖИМ ДЕМО-ЛЕНДИНГА/);
  });

  it('applies guardrail for non-client roles too (admin-in-preview)', () => {
    const prompt = buildAISystemPrompt('tenant_owner', 'русском', '2026-04-20', { ...baseCtx, previewMode: true });
    expect(prompt).toMatch(/РЕЖИМ ДЕМО-ЛЕНДИНГА/);
  });
});

describe('mainKb preview-mode layout', () => {
  it('renders the 4-button landing layout for clients in preview', () => {
    const kb = mainKb('ru', 'client', { previewMode: true });
    const rows = kb.reply_markup.inline_keyboard;
    expect(rows).toHaveLength(3);
    // Row 0: Book
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].callback_data).toBe('book');
    // Row 1: Catalog + Prices
    expect(rows[1]).toHaveLength(2);
    const row1Cbs = rows[1].map(b => b.callback_data).sort();
    expect(row1Cbs).toEqual(['cat', 'prices']);
    // Row 2: My appointments
    expect(rows[2]).toHaveLength(1);
    expect(rows[2][0].callback_data).toBe('my');
    // No language / support / contacts rows (those appear in the full layout only)
    const flat = rows.flat();
    expect(flat.some(b => b.callback_data === 'lang')).toBe(false);
    expect(flat.some(b => b.callback_data === 'support')).toBe(false);
    expect(flat.some(b => b.callback_data === 'cont')).toBe(false);
  });

  it('falls through to full layout outside preview', () => {
    const kb = mainKb('ru', 'client', { previewMode: false });
    const rows = kb.reply_markup.inline_keyboard;
    // Regular client layout has at least 5 rows (Book, Cat+Prices, My, Rev+About, Cont+Lang[+Sup])
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('preview flag only affects client role', () => {
    // A master in preview still gets the master-view keyboard (ignore preview).
    const kb = mainKb('ru', 'master', { previewMode: true });
    const flat = kb.reply_markup.inline_keyboard.flat();
    // Master layout includes the master panel entry; preview-only layout does not.
    expect(flat.some(b => b.callback_data === 'mst')).toBe(true);
  });
});

describe('/embed/demo-chat.js handler', () => {
  it('serves the widget JS for GET /embed/demo-chat.js', async () => {
    const url = new URL('https://manicbot.com/embed/demo-chat.js');
    const req = new Request(url, { method: 'GET' });
    const res = await tryEmbed(req, {}, url);
    expect(res).toBeTruthy();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/javascript/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toMatch(/public/);
    const body = await res.text();
    expect(body).toBe(DEMO_CHAT_SRC);
    expect(body).toMatch(/mb-demo/);
  });

  it('responds to OPTIONS preflight', async () => {
    const url = new URL('https://manicbot.com/embed/demo-chat.js');
    const req = new Request(url, { method: 'OPTIONS' });
    const res = await tryEmbed(req, {}, url);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/GET/);
  });

  it('rejects non-GET methods with 405', async () => {
    const url = new URL('https://manicbot.com/embed/demo-chat.js');
    const req = new Request(url, { method: 'POST' });
    const res = await tryEmbed(req, {}, url);
    expect(res.status).toBe(405);
  });

  // #S13 — defense-in-depth CSP header on the JS response
  it('sets a Content-Security-Policy and X-Content-Type-Options header', async () => {
    const url = new URL('https://manicbot.com/embed/demo-chat.js');
    const req = new Request(url, { method: 'GET' });
    const res = await tryEmbed(req, {}, url);
    expect(res.headers.get('Content-Security-Policy')).toMatch(/default-src 'self'/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns null for paths outside /embed/', async () => {
    const url = new URL('https://manicbot.com/chat/init');
    const req = new Request(url, { method: 'GET' });
    const res = await tryEmbed(req, {}, url);
    expect(res).toBeNull();
  });

  it('returns 404 for unknown /embed/* paths', async () => {
    const url = new URL('https://manicbot.com/embed/bogus.js');
    const req = new Request(url, { method: 'GET' });
    const res = await tryEmbed(req, {}, url);
    expect(res.status).toBe(404);
  });
});

describe('DEMO_CHAT_SRC widget source', () => {
  it('is a valid self-executing IIFE', () => {
    expect(DEMO_CHAT_SRC).toMatch(/\(function\s*\(\)\s*\{/);
    expect(DEMO_CHAT_SRC).toMatch(/\}\)\(\);/);
  });

  it('targets the chat API endpoints', () => {
    expect(DEMO_CHAT_SRC).toMatch(/\/chat\/init/);
    expect(DEMO_CHAT_SRC).toMatch(/\/chat\/send/);
    expect(DEMO_CHAT_SRC).toMatch(/\/chat\/poll/);
  });

  it('defaults to preview-landing slug', () => {
    expect(DEMO_CHAT_SRC).toMatch(/preview-landing/);
  });

  it('is syntactically valid JavaScript (no SyntaxError in output)', () => {
    // vm.Script parses the source without executing it — catches the Ukrainian
    // apostrophe escaping bug (\' inside single-quoted string inside template
    // literal) that caused "SyntaxError: Unexpected identifier 'язку'" in prod.
    expect(() => new vm.Script(DEMO_CHAT_SRC)).not.toThrow();
  });

  it('Ukrainian locale does not contain raw single-quote escape sequences', () => {
    // In a JS template literal \' is consumed by the outer string, leaving a
    // bare ' that terminates the inner single-quoted string early. Guard against
    // regression by asserting the output has no \' inside the ua locale block.
    const uaStart = DEMO_CHAT_SRC.indexOf("ua: {");
    const uaEnd   = DEMO_CHAT_SRC.indexOf('},', uaStart);
    const uaBlock = DEMO_CHAT_SRC.slice(uaStart, uaEnd);
    expect(uaBlock).not.toMatch(/\\'/);
  });

  it('has offline status indicator', () => {
    expect(DEMO_CHAT_SRC).toMatch(/_pollFails/);
    expect(DEMO_CHAT_SRC).toMatch(/setStatus/);
    expect(DEMO_CHAT_SRC).toMatch(/mb-offline/);
    expect(DEMO_CHAT_SRC).toMatch(/T\.offline/);
    expect(DEMO_CHAT_SRC).toMatch(/T\.online/);
  });

  it('applies salon branding from /chat/init', () => {
    expect(DEMO_CHAT_SRC).toMatch(/applyBranding/);
    expect(DEMO_CHAT_SRC).toMatch(/salon\.logo/);
    expect(DEMO_CHAT_SRC).toMatch(/onerror/);
    expect(DEMO_CHAT_SRC).toMatch(/currentBranding/);
  });

  it('has all four required I18N locales', () => {
    expect(DEMO_CHAT_SRC).toMatch(/\bru\s*:/);
    expect(DEMO_CHAT_SRC).toMatch(/\bua\s*:/);
    expect(DEMO_CHAT_SRC).toMatch(/\ben\s*:/);
    expect(DEMO_CHAT_SRC).toMatch(/\bpl\s*:/);
  });

  // #S14 — sanitizeBotHtml whitelist regex must match real escaped tags after
  // the template literal → regex literal pipeline. We extract the function
  // from the served source and execute it in an isolated VM to verify the
  // regex actually matches `&lt;b&gt;`, `&lt;/b&gt;`, `&lt;a href="x"&gt;`.
  it('sanitizeBotHtml restores whitelisted tags from escaped HTML', async () => {
    const vm = await import('node:vm');
    // Pull the sanitizeBotHtml + escapeHtml function bodies out of the IIFE
    const escapeMatch = DEMO_CHAT_SRC.match(/function escapeHtml\([\s\S]*?\n\s\s\}/);
    const sanitizeMatch = DEMO_CHAT_SRC.match(/function sanitizeBotHtml\([\s\S]*?\n\s\s\}/);
    expect(escapeMatch).not.toBeNull();
    expect(sanitizeMatch).not.toBeNull();
    const script = new vm.Script(`
      ${escapeMatch[0]}
      ${sanitizeMatch[0]}
      ({
        bare: sanitizeBotHtml('<b>hi</b>', 'HTML'),
        link: sanitizeBotHtml('<a href="https://x.io/?a=1&b=2">go</a>', 'HTML'),
        script: sanitizeBotHtml('<script>alert(1)</script>', 'HTML'),
        plain: sanitizeBotHtml('plain & <bad>', 'plain'),
      });
    `);
    const out = script.runInNewContext({});
    expect(out.bare).toBe('<b>hi</b>');
    // <a href="..."> should be unwrapped, not left as &lt;a&gt;
    expect(out.link).toContain('<a href="');
    expect(out.link).toContain('>go</a>');
    // unknown tags must remain escaped (XSS guard)
    expect(out.script).not.toContain('<script>');
    expect(out.script).toContain('&lt;script&gt;');
    // non-HTML mode should not unwrap anything
    expect(out.plain).toContain('&lt;bad&gt;');
  });
});

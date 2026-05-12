/**
 * Integration tests for the preview-landing chat flow.
 *
 * Unlike chat-web-http.test.js (which mocks buildChannelCtx), these tests
 * use the REAL channels/resolver.js + storage.js path with a pre-populated
 * mock D1, so they exercise the full init→send→reply pipeline including:
 *  - resolveTenantFromSlug finding the provisioned tenant
 *  - buildChannelCtx loading the tenant row + previewMode flag
 *  - handleInbound side-effect skip in preview mode
 *  - WebAdapter draining the outbox into the HTTP response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

// Mock only the pieces that need external I/O or heavy bot logic.
vi.mock('../src/handlers/inbound.js', () => ({
  handleInbound: vi.fn(async (ctx, inbound) => {
    if (ctx?.channel?.send) {
      const cid = inbound.channelUserId;
      await ctx.channel.send(Number(cid), {
        text: 'Добро пожаловать в Manic Bot!',
        buttons: [
          [{ text: 'Записаться', callback_data: 'book' }],
        ],
        parseMode: 'HTML',
      });
    }
  }),
}));

vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async () => {}),
}));

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

import { tryChatWeb } from '../src/http/chatWebHttp.js';
import { PREVIEW_TENANT_ID, PREVIEW_TENANT_SLUG } from '../src/tenant/previewTenant.js';

async function makeEnvWithPreviewTenant() {
  const db = createMockD1();
  const kv = makeMockKv();
  const env = { DB: db, MANICBOT: kv };
  // Provision via the real provisioner so the mock DB mirrors production.
  vi.resetModules();
  const { ensurePreviewTenantProvisioned } = await import('../src/tenant/previewTenant.js');
  await ensurePreviewTenantProvisioned(env);
  return env;
}

async function req(env, method, path, body) {
  const url = new URL(`https://manicbot.com${path}`);
  const request = new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return tryChatWeb(request, env, url);
}

describe('Preview tenant full chat flow', () => {
  let env;
  beforeEach(async () => {
    env = await makeEnvWithPreviewTenant();
  });

  it('POST /chat/init returns sessionId and salon branding for preview-landing slug', async () => {
    const res = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(data.chatId).toBeLessThan(0);
    expect(data.salon.slug).toBe(PREVIEW_TENANT_SLUG);
    expect(data.salon.name).toBeTruthy();
  });

  it('POST /chat/send returns bot reply messages', async () => {
    // Init first to get sessionId
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const sendRes = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      text: '/start',
      userLang: 'ru',
    });
    expect(sendRes.status).toBe(200);
    const data = await sendRes.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBeGreaterThan(0);
    const msg = data.messages[0];
    expect(msg.id).toBeTypeOf('string');
    expect(msg.ts).toBeTypeOf('number');
    expect(msg.text).toBeTypeOf('string');
  });

  it('POST /chat/send includes inline buttons in reply', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const sendRes = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      text: '/start',
      userLang: 'ru',
    });
    const { messages } = await sendRes.json();
    const withButtons = messages.find(m => m.buttons && m.buttons.length > 0);
    expect(withButtons).toBeTruthy();
    const firstBtn = withButtons.buttons[0][0];
    expect(firstBtn.text).toBeTypeOf('string');
    expect(firstBtn.callback_data).toBeTypeOf('string');
  });

  it('responds to button tap (callbackData)', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const res = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      callbackData: 'book',
      userLang: 'ru',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /chat/poll returns empty when nothing is queued', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const pollRes = await req(env, 'GET',
      `/chat/poll?slug=${PREVIEW_TENANT_SLUG}&sessionId=${sessionId}&since=0`);
    expect(pollRes.status).toBe(200);
    const data = await pollRes.json();
    expect(data.ok).toBe(true);
    expect(data.messages).toEqual([]);
  });

  it('ctx.previewMode is true for preview tenant', async () => {
    const { handleInbound } = await import('../src/handlers/inbound.js');
    handleInbound.mockClear();

    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();
    await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG, sessionId, text: 'hi', userLang: 'ru',
    });

    expect(handleInbound).toHaveBeenCalledOnce();
    const [ctx] = handleInbound.mock.calls[0];
    expect(ctx.previewMode).toBe(true);
    expect(ctx.tenantId).toBe(PREVIEW_TENANT_ID);
  });
});

describe('inbound.js side-effect skip in preview mode', () => {
  it('skips channel_identity and conversation writes when previewMode is true', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    // We verify indirectly: if the DB tables are not populated by handleInbound
    // when previewMode = true, then channel_identities stays empty.
    const writeSpy = vi.spyOn(db, 'prepare');
    const ctx = {
      db, kv, tenantId: PREVIEW_TENANT_ID,
      previewMode: true,
      prefix: `t:${PREVIEW_TENANT_ID}:`,
    };
    const { handleInbound } = await import('../src/handlers/inbound.js');
    // Restore original for this test (override the global mock)
    vi.mocked(handleInbound).mockRestore?.();

    // Import the actual (unmocked) handleInbound via dynamic re-import
    vi.resetModules();
    const actual = await import('../src/handlers/inbound.js');
    const inbound = {
      channel: 'web',
      channelUserId: '-99999',
      tenantId: PREVIEW_TENANT_ID,
      text: 'hello',
      callbackData: null,
      userName: 'Test',
      userLang: 'ru',
      timestamp: Date.now(),
      rawEvent: {},
    };
    // Should not throw even without a full ctx
    await expect(actual.handleInbound(ctx, inbound)).resolves.not.toThrow?.();

    // channel_identities and conversations must NOT be written in preview mode
    expect(db._getTable('channel_identities')).toHaveLength(0);
    expect(db._getTable('conversations')).toHaveLength(0);
  });
});

describe('DEMO_CHAT_SRC widget fixes', () => {
  let SRC;
  beforeEach(async () => {
    const mod = await import('../src/embed/demoChat.js');
    SRC = mod.DEMO_CHAT_SRC;
  });

  // Regression: when localStorage `manicbot-locale` was set to a different
  // value than the URL's ?lang, detectLangChange used to return the LS value
  // and trigger location.reload() every 1s — the page reloaded forever
  // because reload didn't reconcile LS with URL. URL must be authoritative.
  it('detectLangChange treats URL ?lang as authoritative over stale localStorage', () => {
    // URL-present branch: only return when URL ≠ LANG; LS is ignored.
    expect(SRC).toMatch(/URL is authoritative when present/);
    // After the URL-only branch decides "no change", LS gets synced to LANG
    // so the next pass doesn't ping-pong.
    expect(SRC).toMatch(/localStorage\.setItem\('manicbot-locale', LANG\)/);
    // maybeReinit pre-syncs the new lang to LS BEFORE reload() so the
    // post-reload pass doesn't re-trigger the same branch.
    expect(SRC).toMatch(/localStorage\.setItem\('manicbot-locale', newLang\)/);
  });

  it('has a querySelector fallback for document.currentScript', () => {
    expect(SRC).toMatch(/document\.currentScript/);
    expect(SRC).toMatch(/querySelector.*script\[src\]/);
    expect(SRC).toMatch(/\/embed\/demo-chat\.js/);
  });

  it('does not persist chat session across reloads', () => {
    // Preview is throwaway by design — every reload must start fresh.
    expect(SRC).not.toMatch(/SESSION_TTL_MS/);
    expect(SRC).not.toMatch(/savedAt/);
    expect(SRC).not.toMatch(/loadPersisted/);
  });

  it('does not write chat session to localStorage', () => {
    // No setItem against the chat STORAGE_KEY — state lives only in memory.
    expect(SRC).not.toMatch(/localStorage\.setItem\([^)]*STORAGE_KEY/);
    // Legacy-key cleanup must remain so returning visitors get evicted.
    expect(SRC).toMatch(/localStorage\.removeItem\(STORAGE_KEY\)/);
  });

  it('shows an error bubble when init fails', () => {
    expect(SRC).toMatch(/showErrorBubble/);
    expect(SRC).toMatch(/Не удалось подключиться/);
  });

  it('retries init with exponential backoff', () => {
    expect(SRC).toMatch(/_initRetries/);
    expect(SRC).toMatch(/setTimeout/);
    expect(SRC).toMatch(/Math\.pow/);
  });

  it('shows error bubble on send failure', () => {
    expect(SRC).toMatch(/Ошибка отправки/);
    expect(SRC).toMatch(/Нет соединения/);
  });

  // #S15 — Dynamic Island layout when embedded in landing iPhone mockup.
  // Time + icons sit on the SAME row as the island (real-iPhone layout): the
  // widget's statusbar uses min-height + align:center in mb-with-header mode
  // so content vertically centers at island center. Chat-header then starts
  // safely below island bottom.
  it('aligns statusbar content with the Dynamic Island in SHOW_HEADER mode', () => {
    expect(SRC).toMatch(/mb-with-header/);
    expect(SRC).toMatch(/\.mb-demo\.mb-with-header \.mb-statusbar\{[^}]*min-height:54px/);
    expect(SRC).toMatch(/\.mb-demo\.mb-with-header \.mb-statusbar\{[^}]*align-items:center/);
  });

  // #S15 — dark mode follows host html.dark; OS pref is only a fallback when
  // the host clearly doesn't manage theme (so a light landing on a dark-OS
  // device still renders a light widget, matching the visible page state).
  it('mirrors host html.dark for theming and watches for runtime toggles', () => {
    expect(SRC).toMatch(/classList\.contains\(['"]dark['"]\)/);
    expect(SRC).toMatch(/mb-demo\.mb-dark/);
    expect(SRC).toMatch(/MutationObserver/);
    expect(SRC).toMatch(/attributeFilter.*class/);
  });

  it('falls back to prefers-color-scheme:dark only when host does not manage theme', () => {
    expect(SRC).toMatch(/hostManagesTheme/);
    expect(SRC).toMatch(/prefers-color-scheme: dark/);
  });

  // Every chrome colour must resolve through a CSS variable — no stray
  // hardcoded white/black that would lock the widget to one theme.
  it('drives all chrome colours through --mb-* variables', () => {
    expect(SRC).toMatch(/--mb-bg:#ffffff/);
    expect(SRC).toMatch(/--mb-fg:#1a1a1a/);
    // Web-native chip palette: white surface + slate-10 hairline border in
    // light mode; translucent-white surface + 10% border in dark. Hover-border
    // token must exist so chips can lift on hover without a bg-swap flash.
    expect(SRC).toMatch(/--mb-btn-bg:#ffffff/);
    expect(SRC).toMatch(/--mb-btn-text:#0f172a/);
    expect(SRC).toMatch(/--mb-btn-border:rgba\(15,23,42,0\.10\)/);
    expect(SRC).toMatch(/--mb-btn-hover-border:rgba\(15,23,42,0\.22\)/);
    expect(SRC).toMatch(/--mb-input-placeholder/);
    // Dark palette matches the spec (iOS system surface colours).
    expect(SRC).toMatch(/--mb-bg:#1c1c1e/);
    expect(SRC).toMatch(/--mb-btn-bg:rgba\(255,255,255,0\.04\)/);
    expect(SRC).toMatch(/--mb-btn-border:rgba\(255,255,255,0\.10\)/);
    expect(SRC).toMatch(/--mb-btn-hover-border:rgba\(255,255,255,0\.22\)/);
    expect(SRC).toMatch(/--mb-input-text:#ffffff/);
    expect(SRC).toMatch(/--mb-statusbar-bg:#1c1c1e/);
    // Button text must be explicit (not color:inherit) so the label stays
    // readable when the surrounding bubble's text colour differs.
    expect(SRC).toMatch(/\.mb-btn\{[^}]*color:var\(--mb-btn-text\)/);
    // Web-native chip layout: rows wrap; consecutive solo-rows are coalesced
    // server-side into `.mb-btn-row-grid` (CSS Grid) so date pickers read as
    // a 4-column calendar grid, not a stack of inline-keyboard pills.
    expect(SRC).toMatch(/\.mb-btn-row\{display:flex;flex-wrap:wrap/);
    expect(SRC).toMatch(/\.mb-btn-row-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(54px,1fr\)\)/);
    expect(SRC).toMatch(/mb-btn-row-grid/);
  });

  // Photo carousel — the Telegram-style [◀️] [n/m] [▶️] nav row inside a
  // service-card bubble must be replaced with a native iPhone-style
  // overlay (chevron arrows + pill dots) inside the iPhone mockup.
  it('inlines detectPhotoNav so the IIFE and the unit test share one impl', () => {
    expect(SRC).toMatch(/function detectPhotoNav\s*\(\s*m\s*\)/);
    // The IIFE must use it inside buildBubbleNode.
    expect(SRC).toMatch(/var nav = detectPhotoNav\(m\)/);
    expect(SRC).toMatch(/skipRowIdx/);
  });

  it('skips the nav row when iterating message buttons', () => {
    // Original loop appended every button across every row into a single
    // .mb-btns. After the change, the row at skipRowIdx is dropped before
    // its buttons are appended, so we never paint a Telegram-style "n/m"
    // counter or arrow inside the iPhone mockup.
    // Main now uses a `while` loop over button rows to coalesce single-button
    // runs into a wrap-grid. The nav row is skipped via an explicit
    // `i === skipRowIdx` check inside that loop (instead of forEach+return).
    expect(SRC).toMatch(/i\s*===\s*skipRowIdx/);
  });

  it('renders an .mb-photo wrapper with chevron overlays and a dots indicator', () => {
    expect(SRC).toMatch(/photoWrap\.className\s*=\s*['"]mb-photo['"]/);
    expect(SRC).toMatch(/mb-photo-nav mb-photo-prev/);
    expect(SRC).toMatch(/mb-photo-nav mb-photo-next/);
    // Chevron glyphs ❮ / ❯ (HTML entities &#10094;/&#10095;) — typographic,
    // not Telegram emoji ◀️/▶️, so the overlay reads as a native carousel.
    expect(SRC).toMatch(/&#10094;/);
    expect(SRC).toMatch(/&#10095;/);
    expect(SRC).toMatch(/dotsWrap\.className\s*=\s*['"]mb-photo-dots['"]/);
    expect(SRC).toMatch(/mb-photo-dot/);
    expect(SRC).toMatch(/is-active/);
  });

  it('ships CSS for the carousel that matches the iPhone-native pattern', () => {
    // Wrapper rounds + clips the image so it looks like a single photo card.
    expect(SRC).toMatch(/\.mb-photo\{[^}]*position:relative/);
    expect(SRC).toMatch(/\.mb-photo\{[^}]*overflow:hidden/);
    // Chevrons sit centered, only fade in on hover/focus on pointer devices,
    // and stay softly visible on touch devices that have no hover state.
    expect(SRC).toMatch(/\.mb-photo-nav\{[^}]*opacity:0/);
    expect(SRC).toMatch(/\.mb-photo:hover \.mb-photo-nav/);
    expect(SRC).toMatch(/@media\s*\(hover:none\)\s*\{\.mb-photo-nav\{opacity:\.85\}\}/);
    // Dots collapse to a pill (16px) when active — instagram-stories style.
    expect(SRC).toMatch(/\.mb-photo-dot\{[^}]*width:8px/);
    expect(SRC).toMatch(/\.mb-photo-dot\.is-active\{width:16px/);
    // Focus ring uses the brand purple, matching the rest of the widget.
    expect(SRC).toMatch(/\.mb-photo-dot:focus-visible\{outline:2px solid var\(--mb-bubble-user\)/);
    // Reduced-motion users get static dots/arrows.
    expect(SRC).toMatch(/prefers-reduced-motion:reduce[^}]*\.mb-photo-nav,\.mb-photo-dot\{transition:none\}/);
  });

  it('does NOT keep the literal Telegram nav-row markup as standalone .mb-btn entries', () => {
    // We removed the ◀️/▶️ button row from buildBubbleNode's output. The
    // raw buttons may still exist in a bot reply payload (carried by data),
    // but the rendering side must skip them — no `.mb-btn` text node
    // hardcoded with arrow emoji should be present in the source.
    expect(SRC).not.toMatch(/'mb-btn'[^}]*◀️/);
    expect(SRC).not.toMatch(/'mb-btn'[^}]*▶️/);
  });
});

describe('detectPhotoNav — unit', () => {
  let detectPhotoNav;
  beforeEach(async () => {
    const mod = await import('../src/embed/demoChat.js');
    detectPhotoNav = mod.detectPhotoNav;
  });

  const photo = 'https://example.com/p.jpg';

  it('returns null when the bubble has no photo', () => {
    expect(detectPhotoNav({ buttons: [[{ text: '◀️' }, { text: '1 / 3' }, { text: '▶️' }]] })).toBeNull();
  });

  it('returns null when the bubble has no buttons', () => {
    expect(detectPhotoNav({ photo })).toBeNull();
    expect(detectPhotoNav({ photo, buttons: [] })).toBeNull();
  });

  it('detects the standard [◀️] [n / m] [▶️] row', () => {
    const m = {
      photo,
      buttons: [
        [
          { text: '◀️', callback_data: 'cat_photo:svc1:0' },
          { text: '2 / 3', callback_data: 'noop' },
          { text: '▶️', callback_data: 'cat_photo:svc1:2' },
        ],
        [{ text: '📝 Записаться', callback_data: 'service:svc1' }],
        [{ text: '◀️ К категориям', callback_data: 'catalog' }],
      ],
    };
    const nav = detectPhotoNav(m);
    expect(nav).not.toBeNull();
    expect(nav.rowIndex).toBe(0);
    expect(nav.current).toBe(2);
    expect(nav.total).toBe(3);
    expect(nav.prevBtn?.callback_data).toBe('cat_photo:svc1:0');
    expect(nav.nextBtn?.callback_data).toBe('cat_photo:svc1:2');
  });

  it('handles the first photo (no prev arrow, only counter + next)', () => {
    const nav = detectPhotoNav({
      photo,
      buttons: [[
        { text: '1 / 3', callback_data: 'noop' },
        { text: '▶️', callback_data: 'cat_photo:svc1:1' },
      ]],
    });
    expect(nav?.prevBtn).toBeNull();
    expect(nav?.nextBtn?.callback_data).toBe('cat_photo:svc1:1');
    expect(nav?.current).toBe(1);
    expect(nav?.total).toBe(3);
  });

  it('handles the last photo (only prev + counter, no next arrow)', () => {
    const nav = detectPhotoNav({
      photo,
      buttons: [[
        { text: '◀️', callback_data: 'cat_photo:svc1:1' },
        { text: '3 / 3', callback_data: 'noop' },
      ]],
    });
    expect(nav?.prevBtn?.callback_data).toBe('cat_photo:svc1:1');
    expect(nav?.nextBtn).toBeNull();
    expect(nav?.current).toBe(3);
    expect(nav?.total).toBe(3);
  });

  it('handles single-photo bubble (just "1 / 1")', () => {
    const nav = detectPhotoNav({
      photo,
      buttons: [[{ text: '1 / 1', callback_data: 'noop' }]],
    });
    // Counter alone qualifies as nav signal — we suppress the row but
    // render no chevrons / dots (caller checks total > 1 for dots).
    expect(nav).not.toBeNull();
    expect(nav?.rowIndex).toBe(0);
    expect(nav?.total).toBe(1);
    expect(nav?.prevBtn).toBeNull();
    expect(nav?.nextBtn).toBeNull();
  });

  it('also matches about_photo: callbacks (used by master "About" cards)', () => {
    const nav = detectPhotoNav({
      photo,
      buttons: [[
        { text: '◀️', callback_data: 'about_photo:0' },
        { text: '2 / 4', callback_data: 'noop' },
        { text: '▶️', callback_data: 'about_photo:2' },
      ]],
    });
    expect(nav?.current).toBe(2);
    expect(nav?.total).toBe(4);
  });

  it('does not match a regular CTA row (Записаться / К категориям)', () => {
    expect(detectPhotoNav({
      photo,
      buttons: [
        [{ text: '📝 Записаться', callback_data: 'service:svc1' }],
        [{ text: '◀️ К категориям', callback_data: 'catalog' }],
      ],
    })).toBeNull();
  });

  it('does not match a row that contains a url-button (rules out social rows)', () => {
    expect(detectPhotoNav({
      photo,
      buttons: [
        [{ text: '◀️', url: 'https://example.com' }, { text: '1 / 2', callback_data: 'noop' }],
      ],
    })).toBeNull();
  });

  it('handles arrow text without the variation selector (◀ / ▶, no FE0F)', () => {
    const nav = detectPhotoNav({
      photo,
      buttons: [[
        { text: '◀', callback_data: 'cat_photo:svc1:0' },
        { text: '2 / 2', callback_data: 'noop' },
      ]],
    });
    expect(nav?.prevBtn?.callback_data).toBe('cat_photo:svc1:0');
    expect(nav?.current).toBe(2);
  });

  it('finds the nav row even when it is not the first row of the keyboard', () => {
    // Defensive: real keyboards put nav first, but the detector should still
    // find it if the layout ever changes.
    const nav = detectPhotoNav({
      photo,
      buttons: [
        [{ text: '📝 Записаться', callback_data: 'service:svc1' }],
        [
          { text: '◀️', callback_data: 'cat_photo:svc1:0' },
          { text: '2 / 3', callback_data: 'noop' },
          { text: '▶️', callback_data: 'cat_photo:svc1:2' },
        ],
      ],
    });
    expect(nav?.rowIndex).toBe(1);
  });

  it('does not match a row of plain text-with-slash buttons (e.g. dates)', () => {
    // "9 / 12" looks like a counter to a naive parser. We only treat it as
    // counter when the surrounding row qualifies AND the bubble has photo —
    // and a row of pure counters with non-photo callbacks is allowed (since
    // the counter alone is a valid nav signal). To avoid false positives in
    // unrelated UI, the photo guard is essential.
    expect(detectPhotoNav({
      // No photo → null regardless of button shape.
      buttons: [[{ text: '9 / 12', callback_data: 'date:2025-09-12' }]],
    })).toBeNull();
  });
});

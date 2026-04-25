/**
 * Tests for the "living chat" welcome animation that ships in the widget.
 *
 * The widget itself is a string-IIFE (DEMO_CHAT_SRC) executed in the browser,
 * so we can't run its DOM logic in node. Instead we:
 *   1. Inspect the source string for required animation features (classes,
 *      keyframes, helper functions, i18n strings).
 *   2. Lift the pure helper `splitWelcomeForStaging` into a real function via
 *      vm + Function and verify its grouping behaviour.
 *   3. Mock telegram `send` to verify `showWelcome` picks the right template
 *      variant based on whether the visitor's name is known.
 */
import { describe, it, expect, vi } from 'vitest';
import vm from 'vm';
import { DEMO_CHAT_SRC } from '../src/embed/demoChat.js';

describe('DEMO_CHAT_SRC — welcome animation features', () => {
  it('contains the staged welcome flow helpers', () => {
    expect(DEMO_CHAT_SRC).toMatch(/function renderWelcomeFlow\b/);
    expect(DEMO_CHAT_SRC).toMatch(/function splitWelcomeForStaging\b/);
    expect(DEMO_CHAT_SRC).toMatch(/function setHeaderTypingState\b/);
    expect(DEMO_CHAT_SRC).toMatch(/function prefersReducedMotion\b/);
    expect(DEMO_CHAT_SRC).toMatch(/function sleep\b/);
  });

  it('declares all animation CSS classes referenced by the flow', () => {
    const classes = ['mb-init-pending', 'mb-anim-in', 'mb-stagger', 'mb-typing-state'];
    for (const cls of classes) {
      expect(DEMO_CHAT_SRC, `class ${cls}`).toContain(cls);
    }
  });

  it('declares all entrance keyframes', () => {
    const kf = ['mb-bubble-in', 'mb-btn-in', 'mb-typing-in', 'mb-chrome-in', 'mb-pulse-dot'];
    for (const name of kf) {
      const re = new RegExp(`@keyframes\\s+${name}`);
      expect(DEMO_CHAT_SRC, `keyframes ${name}`).toMatch(re);
    }
  });

  it('staggers the first 6 buttons via :nth-child rules', () => {
    for (let i = 1; i <= 6; i++) {
      const re = new RegExp(`mb-stagger\\s*>\\s*\\*:nth-child\\(${i}\\)`);
      expect(DEMO_CHAT_SRC, `stagger nth-child(${i})`).toMatch(re);
    }
  });

  it('respects prefers-reduced-motion', () => {
    expect(DEMO_CHAT_SRC).toMatch(/@media\(prefers-reduced-motion:reduce\)/);
    expect(DEMO_CHAT_SRC).toMatch(/prefers-reduced-motion: reduce/); // matchMedia query
  });

  it('localizes the "typing…" subtitle for all 4 languages', () => {
    expect(DEMO_CHAT_SRC).toContain('печатает…');     // ru
    expect(DEMO_CHAT_SRC).toContain('друкує…');       // ua
    expect(DEMO_CHAT_SRC).toContain('typing…');       // en
    expect(DEMO_CHAT_SRC).toContain('pisze…');        // pl
  });

  it('toggles mb-init-pending on the widget root during init', () => {
    expect(DEMO_CHAT_SRC).toMatch(/classList\.add\(['"]mb-init-pending['"]\)/);
    expect(DEMO_CHAT_SRC).toMatch(/classList\.remove\(['"]mb-init-pending['"]\)/);
  });

  it('drives the welcome via /chat/init and a direct /chat/send /start (bypassing sendRaw)', () => {
    // The init() body should POST /chat/init then /chat/send (the /start) — not
    // wrap it through sendRaw, because sendRaw renders bubbles immediately.
    const initBody = DEMO_CHAT_SRC.match(/async function init\(\)[^]*?^\s{2}\}/m)?.[0] || '';
    expect(initBody).toMatch(/postJson\(['"]\/chat\/init['"]/);
    expect(initBody).toMatch(/postJson\(['"]\/chat\/send['"]/);
    expect(initBody).toMatch(/renderWelcomeFlow\(/);
  });

  it('animates fresh sendRaw bot replies, user echoes, and poll messages', () => {
    // Every call site that creates a NEW bubble (not a restored one from
    // localStorage) should pass { animate: true } to renderBubble.
    const animateCalls = DEMO_CHAT_SRC.match(/renderBubble\([^)]*animate:\s*true/g) || [];
    // At least 4: welcome chunks (1) + sendRaw (2) + user echo (3) + poll (4).
    expect(animateCalls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('splitWelcomeForStaging — grouping logic', () => {
  // Lift the function out of DEMO_CHAT_SRC by extracting its body and wiring
  // it into a vm sandbox — same logic the browser would run.
  const fnSrc = (function () {
    const m = DEMO_CHAT_SRC.match(
      /function splitWelcomeForStaging\s*\([\s\S]*?\n  \}/,
    );
    return m ? m[0] : null;
  })();

  if (!fnSrc) {
    it.skip('could not locate splitWelcomeForStaging in DEMO_CHAT_SRC', () => {});
  } else {
    const ctx = vm.createContext({});
    vm.runInContext(fnSrc + '; this.split = splitWelcomeForStaging;', ctx);
    const split = ctx.split;

    it('returns single-chunk array for single-paragraph text', () => {
      expect(split('hello')).toEqual(['hello']);
    });

    it('returns 2 chunks for 2 paragraphs', () => {
      const out = split('A\n\nB');
      expect(out).toEqual(['A', 'B']);
    });

    it('returns 3 chunks for 3 paragraphs', () => {
      const out = split('A\n\nB\n\nC');
      expect(out).toEqual(['A', 'B', 'C']);
    });

    it('groups 5 paragraphs into 3 buckets (first 2 / middle / last)', () => {
      const out = split('A\n\nB\n\nC\n\nD\n\nE');
      expect(out).toHaveLength(3);
      expect(out[0]).toBe('A\n\nB');         // greeting (first 2)
      expect(out[1]).toBe('C\n\nD');         // middle
      expect(out[2]).toBe('E');               // CTA (last)
    });

    it('groups 6 paragraphs into 3 buckets (first 2 / middle 3 / last)', () => {
      const out = split('A\n\nB\n\nC\n\nD\n\nE\n\nF');
      expect(out).toHaveLength(3);
      expect(out[0]).toBe('A\n\nB');
      expect(out[1]).toBe('C\n\nD\n\nE');
      expect(out[2]).toBe('F');
    });

    it('handles empty input gracefully', () => {
      expect(split('')).toEqual(['']);
      expect(split(null)).toEqual(['']);
      expect(split(undefined)).toEqual(['']);
    });

    it('trims whitespace inside paragraph splits', () => {
      const out = split('A   \n\n  B  \n\nC');
      expect(out).toEqual(['A', 'B', 'C']);
    });
  }
});

// ─── showWelcome — variant selection ──────────────────────────────────────
// screens.js calls fill(t(lg, key), { s, n }) where key ∈ {welcome, welcome_anon}.
// We mock telegram.send so the rendered text is captured and verified.

vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true })),
  trySendPhoto: vi.fn(async () => null),
  editPhoto: vi.fn(async () => null),
  api: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'en'),
}));

vi.mock('../src/services/state.js', () => ({
  clearState: vi.fn(async () => {}),
}));

vi.mock('../src/services/users.js', () => ({
  getRole: vi.fn(async () => 'client'),
  isPlatformAdmin: vi.fn(async () => false),
}));

describe('showWelcome — picks welcome / welcome_anon by name presence', () => {
  it('uses welcome_anon when name is the legacy 👋 fallback', async () => {
    const tg = await import('../src/telegram.js');
    tg.send.mockClear();
    const { showWelcome } = await import('../src/ui/screens.js');
    const ctx = { tenant: { salon: { name: 'Manic Bot' } } };

    await showWelcome(ctx, 12345, '👋');
    // Pull the second send call (first is the keyboard-clear zero-width-space).
    const calls = tg.send.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const welcomeText = calls[1][2];
    expect(welcomeText).toContain('Manic Bot');
    expect(welcomeText).toMatch(/Hi! 👋/);          // anon greeting (en)
    expect(welcomeText).not.toMatch(/Hi,\s*<b>/);   // no named greeting
  });

  it('uses welcome_anon when name is empty', async () => {
    const tg = await import('../src/telegram.js');
    tg.send.mockClear();
    const { showWelcome } = await import('../src/ui/screens.js');
    const ctx = { tenant: { salon: { name: 'Manic Bot' } } };

    await showWelcome(ctx, 12345, '');
    const welcomeText = tg.send.mock.calls[1][2];
    expect(welcomeText).toMatch(/Hi! 👋/);
    expect(welcomeText).not.toMatch(/<b><\/b>/);   // no orphan empty-bold
  });

  it('uses welcome_anon when name is whitespace only', async () => {
    const tg = await import('../src/telegram.js');
    tg.send.mockClear();
    const { showWelcome } = await import('../src/ui/screens.js');
    const ctx = { tenant: { salon: { name: 'Manic Bot' } } };

    await showWelcome(ctx, 12345, '   ');
    const welcomeText = tg.send.mock.calls[1][2];
    expect(welcomeText).toMatch(/Hi! 👋/);
  });

  it('uses welcome (named) when a real first name is provided', async () => {
    const tg = await import('../src/telegram.js');
    tg.send.mockClear();
    const { showWelcome } = await import('../src/ui/screens.js');
    const ctx = { tenant: { salon: { name: 'Manic Bot' } } };

    await showWelcome(ctx, 12345, 'Maria');
    const welcomeText = tg.send.mock.calls[1][2];
    expect(welcomeText).toContain('Maria');
    expect(welcomeText).toMatch(/Hi,\s*<b>Maria<\/b>!\s*👋/);
  });

  it('escapes HTML in the name when rendering the named variant', async () => {
    const tg = await import('../src/telegram.js');
    tg.send.mockClear();
    const { showWelcome } = await import('../src/ui/screens.js');
    const ctx = { tenant: { salon: { name: 'Manic Bot' } } };

    await showWelcome(ctx, 12345, '<script>x</script>');
    const welcomeText = tg.send.mock.calls[1][2];
    expect(welcomeText).not.toMatch(/<script>/);
    expect(welcomeText).toMatch(/&lt;script&gt;/);
  });
});

/**
 * Regression tests for "Режим клиента" / Client View button.
 *
 * Bug: the button used CB.MAIN which routes through showHomeByRole(),
 * always sending admins back to the admin panel.
 *
 * Fix: button now uses CB.CLIENT_VIEW ('cv') which calls showWelcome() directly.
 */
import { describe, it, expect } from 'vitest';
import { CB } from '../src/config.js';
import { adminKb, masterKb } from '../src/ui/keyboards.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function flatButtons(keyboard) {
  return keyboard.reply_markup.inline_keyboard.flat();
}

function makeTenantCtx(plan = 'pro', billingStatus = 'active') {
  return { tenantId: 't_test', db: {}, tenant: { plan, billingStatus } };
}

// ── CB constant ────────────────────────────────────────────────────────────

describe('CB.CLIENT_VIEW constant', () => {
  it('exists in CB', () => {
    expect(CB.CLIENT_VIEW).toBeDefined();
  });

  it('has a different value than CB.MAIN', () => {
    expect(CB.CLIENT_VIEW).not.toBe(CB.MAIN);
  });

  it('is a short string (callback_data size limit)', () => {
    // Telegram callback_data max 64 bytes
    expect(CB.CLIENT_VIEW.length).toBeLessThanOrEqual(10);
  });
});

// ── Admin keyboard ─────────────────────────────────────────────────────────

describe('adminKb — Режим клиента button', () => {
  it('uses CB.CLIENT_VIEW (not CB.MAIN)', () => {
    const kb = adminKb('ru', makeTenantCtx());
    const buttons = flatButtons(kb);
    const clientBtn = buttons.find(b => b.text?.includes('клиента') || b.text?.includes('client') || b.callback_data === CB.CLIENT_VIEW);
    expect(clientBtn).toBeDefined();
    expect(clientBtn.callback_data).toBe(CB.CLIENT_VIEW);
  });

  it('does NOT use CB.MAIN for the client view button', () => {
    const kb = adminKb('ru', makeTenantCtx());
    const buttons = flatButtons(kb);
    const clientBtn = buttons.find(b => b.text?.includes('клиента') || b.text?.includes('client'));
    expect(clientBtn?.callback_data).not.toBe(CB.MAIN);
  });

  it('has exactly one CLIENT_VIEW button', () => {
    const kb = adminKb('en', makeTenantCtx());
    const buttons = flatButtons(kb);
    const clientBtns = buttons.filter(b => b.callback_data === CB.CLIENT_VIEW);
    expect(clientBtns).toHaveLength(1);
  });

  it('works for all supported locales', () => {
    for (const lg of ['ru', 'en', 'ua', 'pl']) {
      const kb = adminKb(lg, makeTenantCtx());
      const buttons = flatButtons(kb);
      const clientBtn = buttons.find(b => b.callback_data === CB.CLIENT_VIEW);
      expect(clientBtn).toBeDefined();
    }
  });

  it('still contains ADM_MAIN callback for back navigation', () => {
    // ADM_MAIN is used from other places — make sure it's still in the system
    expect(CB.ADM_MAIN).toBeDefined();
    expect(CB.MAIN).toBeDefined();
  });
});

// ── Master keyboard ────────────────────────────────────────────────────────

describe('masterKb — Режим клиента button', () => {
  it('uses CB.CLIENT_VIEW (not CB.MAIN)', () => {
    const kb = masterKb('ru', makeTenantCtx('pro'));
    const buttons = flatButtons(kb);
    const clientBtn = buttons.find(b => b.text?.includes('клиента') || b.text?.includes('client') || b.callback_data === CB.CLIENT_VIEW);
    expect(clientBtn).toBeDefined();
    expect(clientBtn.callback_data).toBe(CB.CLIENT_VIEW);
  });

  it('does NOT use CB.MAIN for the client view button', () => {
    const kb = masterKb('ru');
    const buttons = flatButtons(kb);
    const clientBtn = buttons.find(b => b.text?.includes('клиента') || b.text?.includes('client'));
    expect(clientBtn?.callback_data).not.toBe(CB.MAIN);
  });
});

// ── Behavioral contract ────────────────────────────────────────────────────

describe('CLIENT_VIEW routing contract', () => {
  it('CB.CLIENT_VIEW is distinct from CB.MAIN so routing is unambiguous', () => {
    // This test documents the invariant that fixes the bug:
    // - CB.MAIN → showHomeByRole() → re-checks real role → admin goes back to admin panel
    // - CB.CLIENT_VIEW → showWelcome() → always shows client welcome screen
    expect(CB.CLIENT_VIEW).not.toBe(CB.MAIN);
    expect(CB.CLIENT_VIEW).not.toBe(CB.ADM_MAIN);
    expect(CB.CLIENT_VIEW).not.toBe(CB.NOOP);
  });
});

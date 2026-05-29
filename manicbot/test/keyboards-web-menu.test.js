/**
 * mainKb web-only client menu adjustments.
 *
 * On the public web chat (ctx.channel.type === 'web') the client menu:
 *   - hides "Moje wizyty" (CB.MY) — a web visitor is an anonymous session;
 *   - hides "Wsparcie" (CB.SUPPORT) — clients use the salon's own channels;
 *   - shows an Instagram deep-link button only when the salon has a real
 *     per-tenant Instagram URL (ctx.salonInstagramUrl).
 * Telegram / WhatsApp / Instagram menus are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { mainKb } from '../src/ui/keyboards.js';
import { CB } from '../src/config.js';

function flatCallbacks(kb) {
  return kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
}
function flatUrls(kb) {
  return kb.reply_markup.inline_keyboard.flat().map((b) => b.url).filter(Boolean);
}

const webCtx = (over = {}) => ({ channel: { type: 'web' }, ...over });
const tgCtx = (over = {}) => ({ channel: { type: 'telegram' }, ...over });

describe('mainKb web client menu', () => {
  it('hides Moje wizyty and Wsparcie on web', () => {
    const cbs = flatCallbacks(mainKb('pl', 'client', webCtx()));
    expect(cbs).toContain(CB.BOOK);
    expect(cbs).toContain(CB.CATALOG);
    expect(cbs).toContain(CB.ABOUT);
    expect(cbs).toContain(CB.LANG);
    expect(cbs).not.toContain(CB.MY);
    expect(cbs).not.toContain(CB.SUPPORT);
  });

  it('keeps Moje wizyty and Wsparcie on Telegram', () => {
    const cbs = flatCallbacks(mainKb('pl', 'client', tgCtx()));
    expect(cbs).toContain(CB.MY);
    expect(cbs).toContain(CB.SUPPORT);
  });

  it('keeps Moje wizyty on WhatsApp/Instagram (not web)', () => {
    expect(flatCallbacks(mainKb('pl', 'client', { channel: { type: 'whatsapp' } }))).toContain(CB.MY);
    expect(flatCallbacks(mainKb('pl', 'client', { channel: { type: 'instagram' } }))).toContain(CB.MY);
  });

  it('shows the Instagram button on web when the salon has an IG url', () => {
    const kb = mainKb('pl', 'client', webCtx({ salonInstagramUrl: 'https://instagram.com/mysalon' }));
    expect(flatUrls(kb)).toContain('https://instagram.com/mysalon');
  });

  it('hides the Instagram button on web when no IG url is set', () => {
    expect(flatUrls(mainKb('pl', 'client', webCtx()))).toHaveLength(0);
    expect(flatUrls(mainKb('pl', 'client', webCtx({ salonInstagramUrl: null })))).toHaveLength(0);
  });

  it('never shows the menu Instagram button on Telegram even if a url is present', () => {
    // salonInstagramUrl is only ever set on web sessions; guard is isWeb-gated.
    const kb = mainKb('pl', 'client', tgCtx({ salonInstagramUrl: 'https://instagram.com/x' }));
    expect(flatUrls(kb)).toHaveLength(0);
  });
});

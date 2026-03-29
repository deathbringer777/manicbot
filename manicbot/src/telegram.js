/**
 * @fileoverview Channel-Aware Telegram Bridge
 *
 * This module provides the low-level messaging API. All UI code calls these
 * functions without knowing which channel is active. The bridge checks
 * `ctx.channel.type` and routes each call:
 *
 *  - `telegram`  → calls Telegram Bot API directly (original behaviour)
 *  - `whatsapp`  → delegates to ctx.channel.send() / .edit() / etc.
 *  - `instagram` → same delegation to adapter
 *
 * This means all ~100+ `send()` calls in handlers/UI files work transparently
 * on all three channels with zero handler changes.
 *
 * See also: src/channels/ui-renderer.js (button normalization, calendar adaptation)
 * See also: src/channels/whatsapp.js + instagram.js (channel adapters)
 */
import { API_TIMEOUT_MS } from './config.js';
import { extractButtonRows, truncateButtonText, adaptCalendarForMeta } from './channels/ui-renderer.js';

// ── Channel detection ────────────────────────────────────────────────────────

function isTelegram(ctx) {
  return !ctx.channel || ctx.channel.type === 'telegram';
}

/**
 * Extract and normalize buttons from Telegram-format extra object for WA/IG.
 * Applies calendar adaptation and 20-char truncation for non-Telegram channels.
 * @param {object} extra - Telegram-style { reply_markup: { inline_keyboard: [...] } }
 * @param {string} [channelType] - 'whatsapp' or 'instagram'
 * @returns {Array<Array<{text:string, callbackData:string}>>|null}
 */
function extractAndTruncateButtons(extra, channelType) {
  let rows = extractButtonRows(extra);
  if (!rows) return null;

  // Adapt calendar grids for WA/IG (too many buttons for Meta platforms)
  const maxButtons = channelType === 'instagram' ? 13 : 10;
  rows = adaptCalendarForMeta(rows, maxButtons);

  return rows.map(row =>
    row.map(btn => ({
      ...btn,
      text: truncateButtonText(btn.text, 20),
    }))
  );
}

/**
 * Check if extra contains a Telegram reply keyboard with request_contact.
 * If so, returns true (caller should send text prompt instead).
 */
function hasRequestContact(extra) {
  const kb = extra?.reply_markup?.keyboard;
  if (!kb) return false;
  return kb.some(row => row.some(btn => btn.request_contact));
}

/**
 * WA/IG adapters return `{ ok: false, error }` on Graph failures; handlers rarely check.
 * Log so Cloudflare logs show why DMs are silent.
 * @param {Promise<unknown>} p
 * @param {string} op
 * @param {string} channelType
 */
function logMetaAdapterResult(p, op, channelType) {
  const label = channelType || 'meta';
  return Promise.resolve(p).then(r => {
    if (r && typeof r === 'object' && r.ok === false) {
      console.error(`[${label}] ${op} failed:`, r.error ?? r.status ?? r);
    }
    return r;
  });
}

// ── Telegram API (original, used for TG channel) ────────────────────────────

async function tgApi(ctx, method, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(`${ctx.TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (r.status === 429) {
      const retryAfter = r.headers.get('Retry-After') || '?';
      console.error(`TG 429 rate-limited: ${method}, Retry-After: ${retryAfter}`);
      return { ok: false, description: `Rate limited (retry after ${retryAfter}s)`, error_code: 429 };
    }
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, description: `Non-JSON response: ${text.slice(0, 200)}` }; }
  } catch (e) {
    console.error('TG API error:', method, e.message);
    return { ok: false, description: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Channel-aware public API ─────────────────────────────────────────────────

/**
 * Raw Telegram API call. For non-Telegram channels, returns a safe no-op.
 */
export async function api(ctx, method, body) {
  if (!isTelegram(ctx)) {
    // TG-specific methods (setChatMenuButton, setMyCommands, deleteMessage, getChat, etc.)
    // are no-ops for WA/IG channels.
    return { ok: true, result: {} };
  }
  return tgApi(ctx, method, body);
}

export function send(ctx, chatId, text, extra = {}) {
  if (isTelegram(ctx)) {
    return tgApi(ctx, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  }

  // ── WA / IG bridge ──
  // Handle request_contact keyboard → replace with text prompt
  if (hasRequestContact(extra)) {
    return logMetaAdapterResult(
      ctx.channel.send(String(chatId), {
        text: text + '\n\nPlease type your phone number (e.g. +48123456789):',
        parseMode: 'HTML',
      }),
      'send',
      ctx.channel.type,
    );
  }

  // Handle remove_keyboard → send text only
  if (extra?.reply_markup?.remove_keyboard) {
    return logMetaAdapterResult(
      ctx.channel.send(String(chatId), { text, parseMode: 'HTML' }),
      'send',
      ctx.channel.type,
    );
  }

  const buttons = extractAndTruncateButtons(extra, ctx.channel.type);
  return logMetaAdapterResult(
    ctx.channel.send(String(chatId), { text, buttons, parseMode: 'HTML' }),
    'send',
    ctx.channel.type,
  );
}

export function edit(ctx, chatId, msgId, text, extra = {}) {
  if (isTelegram(ctx)) {
    return tgApi(ctx, 'editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', ...extra });
  }
  const buttons = extractAndTruncateButtons(extra, ctx.channel.type);
  return logMetaAdapterResult(
    ctx.channel.edit(String(chatId), msgId, { text, buttons, parseMode: 'HTML' }),
    'edit',
    ctx.channel.type,
  );
}

export function answerCb(ctx, cbId, text = '') {
  if (isTelegram(ctx)) {
    return tgApi(ctx, 'answerCallbackQuery', { callback_query_id: cbId, text });
  }
  return ctx.channel.answerCallback(cbId, text);
}

export async function sendPhoto(ctx, chatId, url, caption, extra = {}) {
  if (isTelegram(ctx)) {
    const res = await tgApi(ctx, 'sendPhoto', { chat_id: chatId, photo: url, caption, parse_mode: 'HTML', ...extra });
    if (res.ok) return res;
    return send(ctx, chatId, `🖼 ${caption}`, extra);
  }
  try {
    return await logMetaAdapterResult(
      ctx.channel.sendPhoto(String(chatId), url, caption, extra),
      'sendPhoto',
      ctx.channel.type,
    );
  } catch (e) {
    // Fallback: send as text with caption
    return send(ctx, chatId, `🖼 ${caption}`, extra);
  }
}

export async function editPhoto(ctx, chatId, msgId, url, caption, extra = {}) {
  if (isTelegram(ctx)) {
    try {
      const body = {
        chat_id: chatId,
        message_id: msgId,
        media: { type: 'photo', media: url, caption: (caption || '').slice(0, 1024), parse_mode: 'HTML' },
      };
      if (extra.reply_markup) body.reply_markup = extra.reply_markup;
      const res = await tgApi(ctx, 'editMessageMedia', body);
      if (res && res.ok) return res;
    } catch (_) { /* fallback below */ }
    return null;
  }
  // WA/IG: no edit support, send new photo
  try {
    return await logMetaAdapterResult(
      ctx.channel.sendPhoto(String(chatId), url, caption, extra),
      'sendPhoto',
      ctx.channel.type,
    );
  } catch (_) {
    return null;
  }
}

export async function sendIcs(ctx, chatId, content, fname, caption) {
  if (isTelegram(ctx)) {
    try {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      fd.append('document', new Blob([content], { type: 'text/calendar' }), fname);
      fd.append('caption', caption);
      fd.append('parse_mode', 'HTML');
      const r = await fetch(`${ctx.TG}/sendDocument`, { method: 'POST', body: fd });
      if (!r.ok) console.error('sendIcs HTTP', r.status, await r.text().catch(() => ''));
      return r;
    } catch (e) {
      console.error('sendIcs error:', e.message);
      return null;
    }
  }
  // WA/IG: try sendDocument, fallback to text
  try {
    return await logMetaAdapterResult(
      ctx.channel.sendDocument(String(chatId), content, fname, caption),
      'sendDocument',
      ctx.channel.type,
    );
  } catch (e) {
    console.error('sendIcs channel error:', e.message);
    return send(ctx, chatId, caption);
  }
}

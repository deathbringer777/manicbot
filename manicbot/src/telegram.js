import { API_TIMEOUT_MS } from './config.js';

export async function api(ctx, method, body) {
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

export function send(ctx, chatId, text, extra = {}) {
  return api(ctx, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

export function edit(ctx, chatId, msgId, text, extra = {}) {
  return api(ctx, 'editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', ...extra });
}

export function answerCb(ctx, cbId, text = '') {
  return api(ctx, 'answerCallbackQuery', { callback_query_id: cbId, text });
}

export async function sendPhoto(ctx, chatId, url, caption, extra = {}) {
  const res = await api(ctx, 'sendPhoto', { chat_id: chatId, photo: url, caption, parse_mode: 'HTML', ...extra });
  if (res.ok) return res;
  return send(ctx, chatId, `🖼 ${caption}`, extra);
}

export async function editPhoto(ctx, chatId, msgId, url, caption, extra = {}) {
  try {
    const body = {
      chat_id: chatId,
      message_id: msgId,
      media: { type: 'photo', media: url, caption: (caption || '').slice(0, 1024), parse_mode: 'HTML' },
    };
    if (extra.reply_markup) body.reply_markup = extra.reply_markup;
    const res = await api(ctx, 'editMessageMedia', body);
    if (res && res.ok) return res;
  } catch (_) { /* fallback below */ }
  return null;
}

export async function sendIcs(ctx, chatId, content, fname, caption) {
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

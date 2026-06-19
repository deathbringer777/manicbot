'use strict';
/**
 * Telegram Bot API helper for crons.
 *
 * Direct Bot API (not the Worker /admin/notify proxy) because cron flows need
 * inline keyboards and photos. Credentials come from the environment only:
 *   TELEGRAM_TOKEN (or TG_BOT_TOKEN) + CHAT_ID (or TG_CHAT_ID)
 * When unconfigured every send is a silent no-op — a cron must never crash
 * because notifications are missing.
 */
const fs = require('fs');
const { httpJson } = require('./http');

const CHUNK_LIMIT = 3500; // Telegram hard limit is 4096; keep headroom like the Worker does

/**
 * Build a multipart/form-data body (string) for sendDocument. Text documents
 * only (UTF-8) — that's all the cron needs; httpJson writes the string as UTF-8
 * and sets Content-Length to match, so binary encoding isn't required.
 */
function buildMultipart(boundary, fields, file) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n${file.content}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return parts.join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function chunkText(text) {
  const chunks = [];
  let rest = String(text ?? '');
  while (rest.length > CHUNK_LIMIT) {
    // Prefer to break on a newline inside the window to keep messages readable.
    let cut = rest.lastIndexOf('\n', CHUNK_LIMIT);
    if (cut < CHUNK_LIMIT * 0.5) cut = CHUNK_LIMIT;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks;
}

function createTg({
  token = process.env.TELEGRAM_TOKEN || process.env.TG_BOT_TOKEN || '',
  chatId = process.env.CHAT_ID || process.env.TG_CHAT_ID || '',
  transport = httpJson,
} = {}) {
  const configured = Boolean(token && chatId);
  const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

  async function call(method, body) {
    if (!configured) return null;
    const res = await transport(api(method), { method: 'POST', body, timeoutMs: 15000 });
    if (!res?.data?.ok) {
      const desc = res?.data?.description || res?.body || `status ${res?.status}`;
      throw new Error(`Telegram ${method} failed: ${desc}`);
    }
    return res.data.result;
  }

  async function sendMessage(text, { keyboard, parseMode = 'HTML', chatId: overrideChat } = {}) {
    if (!configured) return null;
    const chunks = chunkText(text);
    let last = null;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body = {
        chat_id: overrideChat || chatId,
        text: chunks[i],
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(isLast && keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      };
      last = await call('sendMessage', body);
    }
    return last;
  }

  async function sendPhoto(photoUrl, caption, { keyboard, parseMode = 'HTML', chatId: overrideChat } = {}) {
    return call('sendPhoto', {
      chat_id: overrideChat || chatId,
      photo: photoUrl,
      ...(caption ? { caption, ...(parseMode ? { parse_mode: parseMode } : {}) } : {}),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  // Upload a (text) file as a Telegram document — used to attach the SEO/GEO
  // markdown report. Multipart, so it goes through `transport` directly, not `call`.
  async function sendDocument(filePath, { caption, parseMode = 'HTML', chatId: overrideChat, filename, fsImpl = fs } = {}) {
    if (!configured) return null;
    const content = fsImpl.readFileSync(filePath, 'utf8');
    const name = filename || String(filePath).split(/[\\/]/).pop();
    const boundary = `----manicbotcron${content.length}x${name.length}`;
    const fields = { chat_id: overrideChat || chatId, ...(caption ? { caption, ...(parseMode ? { parse_mode: parseMode } : {}) } : {}) };
    const body = buildMultipart(boundary, fields, { field: 'document', filename: name, content, contentType: 'text/markdown; charset=utf-8' });
    const res = await transport(api('sendDocument'), {
      method: 'POST', body,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      timeoutMs: 30000,
    });
    if (!res?.data?.ok) {
      const desc = res?.data?.description || res?.body || `status ${res?.status}`;
      throw new Error(`Telegram sendDocument failed: ${desc}`);
    }
    return res.data.result;
  }

  async function editMessageText(messageId, text, { keyboard, parseMode = 'HTML', chatId: overrideChat } = {}) {
    return call('editMessageText', {
      chat_id: overrideChat || chatId,
      message_id: messageId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  async function answerCallback(callbackQueryId, text) {
    return call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  return { configured, sendMessage, sendPhoto, sendDocument, editMessageText, answerCallback };
}

module.exports = { createTg, escapeHtml, chunkText, buildMultipart };

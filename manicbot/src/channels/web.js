/**
 * @fileoverview WebAdapter — ChannelAdapter for the built-in web chat widget.
 *
 * Unlike Telegram/WA/IG, the web channel has no external API:
 *  - Inbound: a browser POSTs JSON to /chat/send; the Worker calls adapter.normalize().
 *  - Outbound: every `send()` call appends to an in-memory array on the adapter
 *    (so the /chat/send HTTP response can return the bot's replies synchronously)
 *    AND to a KV queue keyed by chatId (so out-of-band messages like reminders
 *    pushed from cron or another isolate can be picked up by /chat/poll).
 *
 * Message shape pushed to the client (both sync and polled):
 *   {
 *     id: string,              // stable message id (for dedup)
 *     ts: number,              // unix seconds
 *     text: string,            // HTML (renderer strips unsafe tags client-side)
 *     buttons: Array<Array<{text, callback_data, url?}>> | null,
 *     photo: string | null,
 *     editMessageId: string | null,
 *   }
 *
 * Design parity with other adapters:
 *  - constructor(ctx) stores ctx — same as whatsapp.js / instagram.js
 *  - normalize(payload) returns `InboundMessage` via `makeInbound(...)`
 *  - send/edit/sendPhoto/answerCallback/renderButtons match the interface
 *
 * The web channel has no 24h message window (it's a live chat session) and no
 * external token to decrypt — channelConfig is synthetic and built on the fly.
 */

import { makeInbound } from './types.js';
import { nowSec } from '../utils/time.js';
import { randomId } from '../utils/security.js';

/** KV key prefix for out-of-band outbox (async messages). */
function outboxKey(tenantId, chatId) {
  return `web:outbox:${tenantId}:${chatId}`;
}

/** Max messages held in the KV outbox at any time. */
const OUTBOX_CAP = 100;
/** TTL for KV outbox entries (long enough to survive reconnects). */
const OUTBOX_TTL_SEC = 24 * 3600;

/** @implements {import('./interface.js').ChannelAdapter} */
export class WebAdapter {
  /**
   * @param {object} ctx - Tenant context (must have ctx.tenantId).
   */
  constructor(ctx) {
    this._ctx = ctx;
    /** @type {'web'} */
    this.type = 'web';
    /**
     * In-memory queue populated during the current request cycle. The
     * /chat/send HTTP handler reads this after `handleInbound` returns and
     * ships it back inline as the response body.
     * @type {Array<object>}
     */
    this._outbox = [];
    /**
     * SECURITY: the chat_id of the active web session. Only `send()` calls
     * targeting THIS chat_id are allowed to write to the outbox; everything
     * else (staff notifications, cross-user messages) is rejected at the
     * adapter level so it can be rerouted via Telegram by `telegram.js:send`.
     * Set by chatWebHttp.js after `buildChannelCtx`.
     * @type {number|null}
     */
    this.activeChatId = null;
  }

  /**
   * Set the active session chat_id for this adapter instance. Called by
   * `chatWebHttp.js` once per request after the adapter is constructed.
   * @param {number} chatId
   */
  setActiveChat(chatId) {
    this.activeChatId = typeof chatId === 'number' ? chatId : Number(chatId);
  }

  /**
   * SECURITY guard — true only if the recipient matches the active session.
   * Used by both `WebAdapter.send` and `telegram.js:send` to decide whether
   * a message belongs in the web outbox or must be rerouted via Telegram.
   * @param {number|string} userId
   * @returns {boolean}
   */
  isActiveRecipient(userId) {
    if (this.activeChatId == null) return false;
    return Number(userId) === this.activeChatId;
  }

  // ── normalize ──────────────────────────────────────────────────────────────

  /**
   * Convert a POST /chat/send body into an InboundMessage.
   *
   * Expected payload shape:
   *   {
   *     sessionId: string,        // client-side persistent id
   *     chatId: number,           // derived from sessionId by the HTTP handler
   *     text?: string,
   *     callbackData?: string,    // when the client taps an inline button
   *     userName?: string,
   *     userLang?: 'ru'|'en'|'ua'|'pl',
   *   }
   *
   * @param {object} payload
   * @returns {import('./types.js').InboundMessage|null}
   */
  normalize(payload) {
    try {
      if (!payload || typeof payload !== 'object') return null;
      const chatIdRaw = payload.chatId;
      if (typeof chatIdRaw !== 'number' || !Number.isFinite(chatIdRaw)) return null;
      return makeInbound({
        channel: 'web',
        // IMPORTANT: channelUserId is a string form of the numeric chatId so
        // that `_inboundToMsg` (default branch) parses it back to an int and
        // sets msg.chat.id as a number — consistent with Telegram's contract.
        channelUserId: String(chatIdRaw),
        tenantId: this._ctx?.tenantId ?? null,
        text: typeof payload.text === 'string' ? payload.text : null,
        callbackData: typeof payload.callbackData === 'string' ? payload.callbackData : null,
        userName: typeof payload.userName === 'string' ? payload.userName.slice(0, 64) : null,
        userLang: typeof payload.userLang === 'string' ? payload.userLang.slice(0, 8) : null,
        rawEvent: payload,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('[web] normalize error:', e?.message);
      return null;
    }
  }

  // ── send ───────────────────────────────────────────────────────────────────

  /**
   * Append an outbound message to the in-memory queue and KV outbox.
   * No external API call — the HTTP handler reads this._outbox and returns
   * the messages inline, and /chat/poll reads the KV copy for async pushes.
   *
   * SECURITY: only the active session's chat_id is accepted. Messages
   * addressed to staff (salon owner / master) MUST be rerouted via Telegram
   * by the caller — `telegram.js:send` checks `isActiveRecipient` and falls
   * back to the Telegram API for non-active chat_ids before reaching us.
   * If somebody bypasses that path, this is the second line of defence:
   * we refuse the write entirely instead of leaking into the client's chat.
   *
   * @param {number|string} userId - Web chatId (number or numeric string)
   * @param {import('./types.js').OutboundMessage} outbound
   * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
   */
  async send(userId, outbound) {
    if (!this.isActiveRecipient(userId)) {
      console.warn(
        '[web] SECURITY: refused send to non-active recipient',
        { recipient: String(userId), active: this.activeChatId, tenantId: this._ctx?.tenantId },
      );
      return { ok: false, error: 'not_active_recipient' };
    }
    const normalized = this._buildPublicMessage(outbound);
    this._outbox.push(normalized);
    await this._pushToKv(userId, normalized);
    return { ok: true, id: normalized.id };
  }

  /**
   * The web widget supports inline replacement by editMessageId — the client
   * replaces the matching message in place when it receives an entry with the
   * same id. We emit a new outbox entry with `editMessageId` set so pollers
   * can reconcile.
   *
   * SECURITY: same active-recipient guard as `send()`.
   */
  async edit(userId, msgId, outbound) {
    if (!this.isActiveRecipient(userId)) {
      console.warn('[web] SECURITY: refused edit to non-active recipient', { recipient: String(userId), active: this.activeChatId });
      return { ok: false, error: 'not_active_recipient' };
    }
    const normalized = this._buildPublicMessage({ ...outbound, editMessageId: String(msgId) });
    this._outbox.push(normalized);
    await this._pushToKv(userId, normalized);
    return { ok: true, id: normalized.id };
  }

  /**
   * No-op — the web widget doesn't need callback acknowledgment. The client
   * handles the button tap locally (shows spinner, then waits for the bot's
   * next message).
   */
  async answerCallback(_cbId, _text = '') {
    return null;
  }

  /**
   * Send a photo (URL or data-URL) as a dedicated photo message.
   * SECURITY: delegates to `send()` which enforces the active-recipient guard.
   */
  async sendPhoto(userId, url, caption) {
    return this.send(userId, { text: caption ?? '', photo: url });
  }

  /**
   * Send a document — the web widget renders it as a downloadable link card.
   * SECURITY: delegates to `send()` which enforces the active-recipient guard.
   */
  async sendDocument(userId, content, filename, caption) {
    if (typeof content === 'string' && /^https?:\/\//.test(content)) {
      return this.send(userId, {
        text: `<a href="${this._escapeHtml(content)}" download="${this._escapeHtml(filename)}">${this._escapeHtml(caption ?? filename)}</a>`,
      });
    }
    return this.send(userId, { text: `📎 ${caption ?? filename}` });
  }

  /**
   * Return metadata for the button renderer — handlers build Telegram-style
   * inline keyboard rows, and the ui-renderer unwraps them on receive.
   */
  renderButtons(rows) {
    return { type: 'web_buttons', rows };
  }

  // ── Public queue accessors (used by chatWebHttp) ──────────────────────────

  /** Drain and return the in-memory outbox (called by the HTTP handler). */
  drainOutbox() {
    const msgs = this._outbox;
    this._outbox = [];
    return msgs;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build the on-wire message shape that the widget client expects.
   * @private
   */
  _buildPublicMessage(outbound) {
    const text = outbound?.text ?? '';
    const rawButtons = outbound?.buttons ?? null;
    return {
      id: randomId(12),
      ts: nowSec(),
      text,
      parseMode: outbound?.parseMode ?? 'HTML',
      buttons: this._flattenButtons(rawButtons),
      photo: outbound?.photo ?? null,
      editMessageId: outbound?.editMessageId ?? null,
    };
  }

  /**
   * Normalize button shape. Handlers may produce:
   *   a) Telegram-style inline_keyboard: [[{ text, callback_data }], ...]
   *   b) our own metadata wrapper: { type: 'web_buttons', rows: [...] }
   * Return (a).
   * @private
   */
  _flattenButtons(rows) {
    if (!rows) return null;
    if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.rows)) {
      return this._flattenButtons(rows.rows);
    }
    if (!Array.isArray(rows)) return null;
    return rows.map((row) =>
      Array.isArray(row)
        ? row.map((b) => ({
            text: b?.text ?? '',
            callback_data: b?.callback_data ?? b?.callbackData ?? null,
            url: b?.url ?? null,
          }))
        : [],
    );
  }

  /**
   * Append a message to the KV outbox for out-of-band polling consumers.
   * Best-effort — errors are logged but do not fail the request path.
   * @private
   */
  async _pushToKv(userId, publicMessage) {
    const kv = this._ctx?.kv;
    const tenantId = this._ctx?.tenantId;
    if (!kv || !tenantId || userId == null) return;
    const key = outboxKey(tenantId, String(userId));
    try {
      let list = [];
      try {
        const raw = await kv.get(key, 'json');
        if (Array.isArray(raw)) list = raw;
      } catch {
        /* stale/corrupt — overwrite */
      }
      list.push(publicMessage);
      if (list.length > OUTBOX_CAP) list = list.slice(-OUTBOX_CAP);
      await kv.put(key, JSON.stringify(list), { expirationTtl: OUTBOX_TTL_SEC });
    } catch (e) {
      console.error('[web] KV outbox push failed:', e?.message);
    }
  }

  _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// ── Standalone helpers exported for the HTTP handler + tests ────────────────

/**
 * Derive a deterministic 48-bit negative integer chat_id from a session id.
 * Negative to keep web chat IDs out of the positive Telegram user-id namespace.
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
export async function chatIdFromSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') throw new Error('sessionId required');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
  const arr = new Uint8Array(buf);
  // First 6 bytes → unsigned 48-bit int, offset by 1 so we never hit 0, negated.
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + arr[i];
  return -(n + 1);
}

/** Generate a cryptographically-random 32-byte hex session id. */
export function generateSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Read the KV outbox for a given (tenant, chat) pair and optionally clear it.
 * Used by GET /chat/poll.
 *
 * @param {object} ctx
 * @param {number|string} chatId
 * @param {object} [opts]
 * @param {number} [opts.sinceTs] - return only messages with ts > sinceTs
 * @param {boolean} [opts.clear=true] - clear KV after read
 * @returns {Promise<Array<object>>}
 */
export async function readOutbox(ctx, chatId, { sinceTs = 0, clear = true } = {}) {
  if (!ctx?.kv || !ctx?.tenantId || chatId == null) return [];
  const key = outboxKey(ctx.tenantId, String(chatId));
  let list = [];
  try {
    const raw = await ctx.kv.get(key, 'json');
    if (Array.isArray(raw)) list = raw;
  } catch {
    return [];
  }
  const filtered = sinceTs > 0 ? list.filter((m) => (m?.ts ?? 0) > sinceTs) : list;
  if (clear && list.length > 0) {
    try { await ctx.kv.delete(key); } catch { /* best effort */ }
  }
  return filtered;
}

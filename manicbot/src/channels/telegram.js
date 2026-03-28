/**
 * @fileoverview TelegramAdapter — wraps the existing telegram.js API without modifying it.
 *
 * Implements the ChannelAdapter interface for Telegram.
 * telegram.js is never modified; this adapter calls its exported functions internally.
 */

import { makeInbound } from './types.js';
import { send, edit, answerCb, sendPhoto, sendIcs, api } from '../telegram.js';

/** @implements {import('./interface.js').ChannelAdapter} */
export class TelegramAdapter {
  /**
   * @param {object} ctx - Tenant context with ctx.TG set
   */
  constructor(ctx) {
    this._ctx = ctx;
    /** @type {'telegram'} */
    this.type = 'telegram';
  }

  /**
   * Convert a raw Telegram update into a normalized InboundMessage.
   * Accepts either { message } or { callback_query } shapes.
   *
   * @param {{ message?: object, callback_query?: object }} update
   * @returns {import('./types.js').InboundMessage}
   */
  normalize(update) {
    // ── Callback query ────────────────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from ?? {};
      return makeInbound({
        channel: 'telegram',
        channelUserId: String(cb.message?.chat?.id ?? from.id ?? ''),
        tenantId: this._ctx.tenantId ?? null,
        callbackData: cb.data ?? null,
        callbackMessageId: cb.message?.message_id ? String(cb.message.message_id) : null,
        userName: from.first_name ?? null,
        userLang: from.language_code ?? null,
        rawEvent: update,
        timestamp: Date.now(),
      });
    }

    // ── Regular message ───────────────────────────────────────────────
    const msg = update.message ?? update;
    const from = msg.from ?? {};
    const contact = msg.contact
      ? {
          phone: msg.contact.phone_number ?? null,
          firstName: msg.contact.first_name ?? null,
          lastName: msg.contact.last_name ?? null,
        }
      : null;

    // Extract photo (Telegram sends array sorted by size — take last/largest)
    let photo = null;
    if (msg.photo && msg.photo.length) {
      photo = msg.photo[msg.photo.length - 1]?.file_id ?? null;
    }

    return makeInbound({
      channel: 'telegram',
      channelUserId: String(msg.chat?.id ?? from.id ?? ''),
      tenantId: this._ctx.tenantId ?? null,
      text: msg.text ?? null,
      contact,
      photo,
      userName: from.first_name ?? null,
      userLang: from.language_code ?? null,
      rawEvent: update,
      timestamp: (msg.date ?? 0) * 1000 || Date.now(),
    });
  }

  /**
   * Send a message. Converts OutboundMessage.buttons → Telegram inline_keyboard.
   *
   * @param {string} userId - chat_id
   * @param {import('./types.js').OutboundMessage} outbound
   */
  send(userId, outbound) {
    const extra = this._buildExtra(outbound);
    return send(this._ctx, userId, outbound.text, extra);
  }

  /**
   * Edit an existing message.
   *
   * @param {string} userId - chat_id
   * @param {string|number} msgId - message_id to edit
   * @param {import('./types.js').OutboundMessage} outbound
   */
  edit(userId, msgId, outbound) {
    const extra = this._buildExtra(outbound);
    return edit(this._ctx, userId, msgId, outbound.text, extra);
  }

  /**
   * Answer a callback query (Telegram-specific acknowledgment).
   *
   * @param {string} cbId - callback_query_id
   * @param {string} [text='']
   */
  answerCallback(cbId, text = '') {
    return answerCb(this._ctx, cbId, text);
  }

  /**
   * Send a photo.
   *
   * @param {string} userId
   * @param {string} url
   * @param {string} caption
   * @param {object} [extra={}]
   */
  sendPhoto(userId, url, caption, extra = {}) {
    return sendPhoto(this._ctx, userId, url, caption, extra);
  }

  /**
   * Send a document / ICS file.
   *
   * @param {string} userId
   * @param {string|Uint8Array} content
   * @param {string} filename
   * @param {string} caption
   */
  sendDocument(userId, content, filename, caption) {
    return sendIcs(this._ctx, userId, content, filename, caption);
  }

  /**
   * Make a raw Telegram API call (escape hatch for rarely-needed calls).
   *
   * @param {string} method
   * @param {object} body
   */
  callApi(method, body) {
    return api(this._ctx, method, body);
  }

  /**
   * Convert button rows to Telegram reply_markup.
   * Each row is [{text, callbackData}] — converts callbackData → callback_data.
   *
   * @param {Array<Array<{text:string, callbackData:string}>>} rows
   * @returns {{ reply_markup: { inline_keyboard: object[][] } }}
   */
  renderButtons(rows) {
    if (!rows || rows.length === 0) return {};
    const inline_keyboard = rows.map(row =>
      row.map(btn => ({
        text: btn.text,
        callback_data: btn.callbackData ?? btn.callback_data ?? '',
        ...(btn.url ? { url: btn.url } : {}),
      }))
    );
    return { reply_markup: { inline_keyboard } };
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Build the `extra` object for send()/edit() from an OutboundMessage.
   * @private
   */
  _buildExtra(outbound) {
    const extra = {};
    if (outbound.buttons && outbound.buttons.length) {
      extra.reply_markup = {
        inline_keyboard: outbound.buttons.map(row =>
          row.map(btn => ({
            text: btn.text,
            callback_data: btn.callbackData ?? btn.callback_data ?? '',
            ...(btn.url ? { url: btn.url } : {}),
          }))
        ),
      };
    }
    return extra;
  }
}

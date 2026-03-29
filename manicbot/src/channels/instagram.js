/**
 * @fileoverview InstagramAdapter — implements ChannelAdapter for Instagram Messaging API.
 *
 * Outbound messages use **graph.facebook.com** with **Page ID** + **Page access token**
 * (Messenger Platform / Instagram-connected Page). This matches channel config in Mini App.
 *
 * API reference: https://developers.facebook.com/docs/messenger-platform/instagram
 * Graph API version: v21.0
 *
 * Instagram constraints:
 *  - Quick replies: max 13, title max 20 chars (auto-truncated)
 *  - No message editing
 *  - No template system (outside 24h window → skip, no fallback)
 *  - No text formatting (HTML stripped to plain text)
 *  - Documents: limited; we fall back to a text link
 */

import { makeInbound } from './types.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Parse Worker secret INSTAGRAM_IGNORE_SENDER_IDS (comma/whitespace-separated IGSIDs).
 * Used to skip platform-owned or echo-equivalent senders that should not hit onMsg/AI.
 * @param {string|undefined|null} raw
 * @returns {Set<string>}
 */
export function parseInstagramIgnoreSenderIds(raw) {
  if (raw == null || raw === '') return new Set();
  return new Set(
    String(raw)
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean),
  );
}
const MAX_QUICK_REPLIES = 13;
const MAX_TITLE_LEN = 20;

/** @implements {import('./interface.js').ChannelAdapter} */
export class InstagramAdapter {
  /**
   * @param {object} ctx - Channel context with ctx.channelConfig.config.page_id and ctx.channelConfig.token
   */
  constructor(ctx) {
    this._ctx = ctx;
    /** @type {'instagram'} */
    this.type = 'instagram';

    const cfg = ctx.channelConfig?.config ?? {};
    this._pageId = cfg.page_id ?? null;
    this._token = ctx.channelConfig?.token ?? null;
    if (this._token && String(this._token).startsWith('IGAA')) {
      console.warn(
        '[ig] Token starts with IGAA — Instagram product tokens often cannot call POST /{page-id}/messages. ' +
          'Use a Facebook Page access token (usually EAA…) for the Page linked to this IG account; save it in Mini App → Channels.',
      );
    }
    /** @type {Set<string>} */
    this._ignoreSenderIds = ctx.instagramIgnoreSenderIds instanceof Set
      ? ctx.instagramIgnoreSenderIds
      : parseInstagramIgnoreSenderIds(ctx.instagramIgnoreSenderIds);
  }

  // ── normalize ──────────────────────────────────────────────────────────────

  /**
   * One webhook entry may contain several `messaging` items (read receipt, then text).
   * Meta often puts the user message after a non-message event — we must scan all items.
   *
   * @param {object} messaging - Single element from entry.messaging[]
   * @param {object} entry - Full entry (stored on inbound.rawEvent)
   * @returns {import('./types.js').InboundMessage|null}
   */
  normalizeMessaging(messaging, entry) {
    try {
      if (!messaging) return null;
      if (messaging.message?.is_echo === true) return null;
      // Read / delivery / typing — no user payload for the bot
      if (!messaging.message && !messaging.postback) return null;

      if (messaging.message) {
        const rawT = messaging.message.text;
        const hasText = rawT != null && String(rawT).trim().length > 0;
        const hasAttach = !!(messaging.message.attachments?.length);
        const hasQr = !!messaging.message.quick_reply;
        if (!hasText && !hasAttach && !hasQr) return null;
      }

      const senderId = messaging.sender?.id;
      if (senderId != null && this._ignoreSenderIds.has(String(senderId))) return null;

      const ts = messaging.timestamp ?? Date.now();

      let text = null;
      let photo = null;
      let callbackData = null;

      if (messaging.message) {
        text = messaging.message.text ?? null;
        if (messaging.message.attachments?.length) {
          const att = messaging.message.attachments[0];
          if (att.type === 'image') photo = att.payload?.url ?? null;
        }
        if (messaging.message.quick_reply) {
          callbackData = messaging.message.quick_reply.payload ?? null;
        }
      }

      if (messaging.postback) {
        callbackData = messaging.postback.payload ?? null;
        text = messaging.postback.title ?? null;
      }

      return makeInbound({
        channel: 'instagram',
        tenantId: this._ctx.tenantId ?? null,
        channelUserId: String(senderId ?? ''),
        text,
        photo,
        callbackData,
        rawEvent: entry,
        timestamp: ts,
      });
    } catch (e) {
      console.error('[ig] normalizeMessaging error:', e.message);
      return null;
    }
  }

  /**
   * Convert a raw Instagram webhook entry into an InboundMessage (first actionable item).
   * For full batches use normalizeMessaging per item in the HTTP layer.
   *
   * @param {object} entry - A single entry from the webhook payload
   * @returns {import('./types.js').InboundMessage|null}
   */
  normalize(entry) {
    for (const m of entry?.messaging ?? []) {
      const one = this.normalizeMessaging(m, entry);
      if (one) return one;
    }
    return null;
  }

  // ── send ───────────────────────────────────────────────────────────────────

  /**
   * Send a message to an Instagram user (identified by their IGSID).
   *
   * @param {string} userId - IGSID
   * @param {import('./types.js').OutboundMessage} outbound
   */
  async send(userId, outbound) {
    const text = this.htmlToPlainText(outbound.text ?? '');
    const buttons = outbound.buttons;

    let body;
    if (!buttons || buttons.length === 0) {
      body = {
        recipient: { id: userId },
        message: { text: text.slice(0, 2000) },
      };
    } else {
      // Flatten all rows into quick_replies (max 13)
      const flat = buttons.flat().slice(0, MAX_QUICK_REPLIES);
      const quickReplies = flat.map(btn => ({
        content_type: 'text',
        title: (btn.text ?? '').slice(0, MAX_TITLE_LEN),
        payload: btn.callbackData ?? btn.callback_data ?? btn.text ?? '',
      }));

      body = {
        recipient: { id: userId },
        message: {
          text: text.slice(0, 2000) || ' ',
          quick_replies: quickReplies,
        },
      };
    }

    return this._post(`/${this._pageId}/messages`, body);
  }

  /**
   * Instagram doesn't support editing — sends a new message instead.
   */
  async edit(userId, _msgId, outbound) {
    return this.send(userId, outbound);
  }

  /**
   * No-op — Instagram messaging has no callback acknowledgment.
   */
  async answerCallback(_cbId, _text = '') {
    return null;
  }

  /**
   * Send an image via URL.
   *
   * @param {string} userId
   * @param {string} url
   * @param {string} caption
   */
  async sendPhoto(userId, url, caption) {
    // First send the image attachment
    const body = {
      recipient: { id: userId },
      message: {
        attachment: {
          type: 'image',
          payload: { url, is_reusable: false },
        },
      },
    };
    const res = await this._post(`/${this._pageId}/messages`, body);
    // If caption provided, follow up with text
    if (caption) {
      await this.send(userId, { text: caption });
    }
    return res;
  }

  /**
   * Send a document — Instagram has limited file support, fall back to hyperlink text.
   *
   * @param {string} userId
   * @param {string} content - URL or raw content
   * @param {string} filename
   * @param {string} caption
   */
  async sendDocument(userId, content, filename, caption) {
    const text = caption ? `📎 ${caption}` : `📎 ${filename}`;
    // If it's a URL, include it
    const link = typeof content === 'string' && content.startsWith('http') ? `\n${content}` : '';
    return this.send(userId, { text: text + link });
  }

  /**
   * Convert button rows to IG quick_replies metadata (for ui-renderer awareness).
   *
   * @param {Array<Array<{text:string, callbackData:string}>>} rows
   * @returns {{ type: 'instagram_quick_replies', rows: object[][] }}
   */
  renderButtons(rows) {
    return { type: 'instagram_quick_replies', rows };
  }

  // ── HTML conversion ────────────────────────────────────────────────────────

  /**
   * Strip all HTML tags and decode entities.
   * Instagram does not support any markup.
   *
   * @param {string} html
   * @returns {string}
   */
  htmlToPlainText(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * POST to the Instagram Graph API.
   * @private
   */
  async _post(path, body) {
    if (!this._token || !this._pageId) {
      console.error('[ig] missing token or page_id');
      return { ok: false, error: 'not_configured' };
    }
    try {
      const res = await fetch(`${GRAPH_API}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`[ig] POST ${path} failed ${res.status}:`, JSON.stringify(data));
        return { ok: false, status: res.status, error: data.error?.message ?? 'unknown' };
      }
      return { ok: true, data };
    } catch (e) {
      console.error('[ig] fetch error:', e.message);
      return { ok: false, error: e.message };
    }
  }
}

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
import { isWithinMessageWindow } from '../handlers/inbound.js';
import { graphPost } from './graph-api.js';
import { log } from '../utils/logger.js';

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
    // 2026-03 Meta API split: the Instagram Login product issues IGAA tokens
    // that authenticate against graph.instagram.com (NOT graph.facebook.com)
    // and post messages to /me/messages (NOT /{pageId}/messages). The channel
    // config is tagged with api='instagram_direct' by /admin/ig-set-direct-token.
    this._api = cfg.api === 'instagram_direct' ? 'instagram_direct' : 'facebook';
    this._igUserId = cfg.ig_user_id ?? null;
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
          for (const att of messaging.message.attachments) {
            if (att.type === 'image' && !photo) {
              photo = att.payload?.url ?? null;
            }
          }
          if (messaging.message.attachments.length > 1) {
            log.warn('channels.instagram', { message: 'normalizeMessaging: multiple attachments received, only first image kept', count: messaging.message.attachments.length });
          }
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
      log.error('channels.instagram', e instanceof Error ? e : new Error(String(e.message)));
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
    // Instagram: outside 24h window messages will be rejected by Meta
    if (this._ctx?.db && this._ctx?.tenantId) {
      const inWindow = await isWithinMessageWindow(this._ctx, 'instagram', String(userId));
      if (!inWindow) {
        log.warn('channels.instagram', { message: 'skipping send — outside 24h message window' });
        return { ok: false, error: 'outside_message_window' };
      }
    }
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

    // Path + host depend on the API generation:
    //   • instagram_direct → POST /me/messages on graph.instagram.com
    //   • legacy (Page Messenger) → POST /{pageId}/messages on graph.facebook.com
    const path = this._api === 'instagram_direct' ? '/me/messages' : `/${this._pageId}/messages`;
    return this._post(path, body);
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
    // page_id is OPTIONAL on the new instagram_direct API path (/me/messages).
    if (!this._token) {
      log.error('channels.instagram', new Error('missing token'));
      return { ok: false, error: 'not_configured' };
    }
    if (this._api !== 'instagram_direct' && !this._pageId) {
      log.error('channels.instagram', new Error('missing page_id for legacy IG outbound'));
      return { ok: false, error: 'not_configured' };
    }
    const host = this._api === 'instagram_direct' ? 'instagram' : 'facebook';
    const result = await graphPost(path, this._token, body, { label: 'ig', host });
    // Sprint 2: If Meta reports the token is dead (OAuthException / code 190),
    // mark the channel config as needs_reauth so the admin UI surfaces it.
    //
    // 2026-05-14 hardening: do NOT auto-deactivate on a *single* failure
    // for IG-direct (Mar-2026 Meta API). Reasons:
    //   • Mid-deploy host/path mismatch (legacy code calling /me/messages on
    //     graph.facebook.com) returns code 190 even with a valid IGAA token.
    //     That false-positive cost us 2h on May 14.
    //   • Real token death surfaces consistently — phaseChannelHealth already
    //     captures it as a fatal error_events row every 6h.
    // We still emit `integration.needs_reauth` for operator visibility, but
    // leave active=1 so transient host mismatches don't take the channel
    // offline irreversibly without operator action.
    if (!result.ok && result.tokenDead && this._ctx?.db && this._ctx?.tenantId) {
      const shouldDeactivate = this._api !== 'instagram_direct';
      try {
        if (shouldDeactivate) {
          const { dbRun } = await import('../utils/db.js');
          await dbRun(this._ctx,
            `UPDATE channel_configs SET active = 0, updated_at = ?
             WHERE tenant_id = ? AND channel_type = 'instagram'`,
            Math.floor(Date.now() / 1000), this._ctx.tenantId,
          );
        }
        const { logEvent } = await import('../utils/events.js');
        await logEvent(this._ctx, 'integration.needs_reauth', {
          level: 'warn',
          tenantId: this._ctx.tenantId,
          message: shouldDeactivate
            ? 'Instagram token dead — marked needs_reauth'
            : 'Instagram-direct outbound 401 — investigating, channel left active',
          data: { code: result.errorCode, type: result.errorType, path, api: this._api },
        });
        // PR 3 — also stamp a structured `error_events` row so the
        // IGHealthCard surfaces the broken state to the operator
        // immediately (logEvent above goes to a separate audit log).
        try {
          const { captureError } = await import('../utils/errorCapture.js');
          const { CHANNEL_ERROR_TYPE } = await import('./error-types.js');
          await captureError(this._ctx, new Error(`Instagram token dead (${result.errorCode || result.errorType || 'unknown'})`), {
            source: 'channels.instagram.send',
            tenantId: this._ctx.tenantId,
            severity: shouldDeactivate ? 'fatal' : 'error',
            path: 'channels.instagram.send',
            errorType: CHANNEL_ERROR_TYPE.IG_INTEGRATION_NEEDS_REAUTH,
            channelType: 'instagram',
            api: this._api,
            graphCode: String(result.errorCode || ''),
            graphErrorType: String(result.errorType || ''),
          });
        } catch { /* monitoring must never break the send flow */ }
      } catch (e) {
        log.error('channels.instagram', e instanceof Error ? e : new Error(String(e?.message)));
      }
    }
    return result;
  }
}

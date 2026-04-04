/**
 * @fileoverview WhatsAppAdapter — implements ChannelAdapter for WhatsApp Cloud API.
 *
 * API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 * Graph API version: v21.0
 *
 * Button routing rules:
 *  - 0 buttons → plain text message
 *  - 1-3 buttons → interactive type=button (reply buttons)
 *  - 4-10 buttons → interactive type=list (single section)
 *  - >10 buttons → paginated list sections (max 10 per section)
 *
 * 24-hour window: WA only allows free-form messages within 24h of the last user message.
 * Outside the window,  sendTemplateMessage() must be used instead.
 */

import { makeInbound } from './types.js';
import { nowSec } from '../utils/time.js';
import { graphPost } from './graph-api.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const MAX_BUTTON_BUTTONS = 3;
const MAX_LIST_ITEMS = 10;
const MAX_BUTTON_TITLE = 20;

/** Static i18n for WA interactive list chrome (section title + action button). */
const WA_I18N = {
  ru: { options: 'Варианты', more: 'Ещё', button: 'Выбрать' },
  en: { options: 'Options',  more: 'More',  button: 'Choose'  },
  pl: { options: 'Opcje',    more: 'Więcej', button: 'Wybierz' },
  ua: { options: 'Варіанти', more: 'Ще',    button: 'Вибрати' },
};
/** @param {string|null|undefined} lang */
function waI18n(lang) { return WA_I18N[lang] ?? WA_I18N.ru; }

/** @implements {import('./interface.js').ChannelAdapter} */
export class WhatsAppAdapter {
  /**
   * @param {object} ctx - Channel context with ctx.channelConfig.config.phone_number_id and ctx.channelConfig.token
   */
  constructor(ctx) {
    this._ctx = ctx;
    /** @type {'whatsapp'} */
    this.type = 'whatsapp';

    const cfg = ctx.channelConfig?.config ?? {};
    this._phoneNumberId = cfg.phone_number_id ?? null;
    this._token = ctx.channelConfig?.token ?? null;
  }

  // ── normalize ──────────────────────────────────────────────────────────────

  /**
   * Convert a raw WhatsApp webhook entry into an InboundMessage.
   * WA sends: { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages, metadata } }] }] }
   *
   * @param {object} entry - A single entry from the webhook payload
   * @returns {import('./types.js').InboundMessage|null}
   */
  normalize(entry) {
    try {
      const change = entry?.changes?.[0]?.value;
      if (!change?.messages?.length) return null;

      const msg = change.messages[0];
      const from = msg.from; // phone number string
      const ts = parseInt(msg.timestamp ?? '0', 10) * 1000 || Date.now();

      let text = null;
      let contact = null;
      let photo = null;
      let callbackData = null;

      switch (msg.type) {
        case 'text':
          text = msg.text?.body ?? null;
          break;

        case 'interactive': {
          const ia = msg.interactive;
          if (ia?.type === 'button_reply') {
            callbackData = ia.button_reply?.id ?? null;
            text = ia.button_reply?.title ?? null;
          } else if (ia?.type === 'list_reply') {
            callbackData = ia.list_reply?.id ?? null;
            text = ia.list_reply?.title ?? null;
          }
          break;
        }

        case 'contacts':
          if (msg.contacts?.length) {
            const c = msg.contacts[0];
            const phone = c.phones?.[0]?.phone ?? null;
            contact = {
              phone,
              firstName: c.name?.first_name ?? null,
              lastName: c.name?.last_name ?? null,
            };
          }
          break;

        case 'image':
          photo = msg.image?.id ?? null; // media_id; requires separate GET to get URL
          break;

        default:
          break;
      }

      // Profile / display name from contacts array in change.value
      const profile = change.contacts?.find(c => c.wa_id === from);
      const userName = profile?.profile?.name ?? null;

      return makeInbound({
        channel: 'whatsapp',
        channelUserId: from,
        tenantId: this._ctx.tenantId ?? null,
        text,
        contact,
        photo,
        callbackData,
        userName,
        rawEvent: entry,
        timestamp: ts,
      });
    } catch (e) {
      console.error('[wa] normalize error:', e.message);
      return null;
    }
  }

  // ── send ───────────────────────────────────────────────────────────────────

  /**
   * Send a message to a WhatsApp phone number.
   *
   * @param {string} userId - Recipient phone number
   * @param {import('./types.js').OutboundMessage} outbound
   */
  async send(userId, outbound) {
    const text = this.htmlToWhatsApp(outbound.text ?? '');
    const buttons = outbound.buttons;

    let body;
    if (!buttons || buttons.length === 0) {
      // Plain text
      body = {
        messaging_product: 'whatsapp',
        to: userId,
        type: 'text',
        text: { body: text, preview_url: false },
      };
    } else {
      body = this._buildInteractive(userId, text, buttons, outbound.lang ?? null);
    }

    return this._post(`/${this._phoneNumberId}/messages`, body);
  }

  /**
   * WhatsApp doesn't support editing — send a new message instead.
   */
  async edit(userId, _msgId, outbound) {
    return this.send(userId, outbound);
  }

  /**
   * No-op — WhatsApp has no callback acknowledgment mechanism.
   */
  async answerCallback(_cbId, _text = '') {
    return null;
  }

  /**
   * Send a photo via URL.
   *
   * @param {string} userId
   * @param {string} url
   * @param {string} caption
   */
  async sendPhoto(userId, url, caption) {
    const body = {
      messaging_product: 'whatsapp',
      to: userId,
      type: 'image',
      image: { link: url, caption: (caption ?? '').slice(0, 1024) },
    };
    return this._post(`/${this._phoneNumberId}/messages`, body);
  }

  /**
   * Send a document via URL (or fall back to text link for non-URL content).
   *
   * @param {string} userId
   * @param {string} content - URL or raw content
   * @param {string} filename
   * @param {string} caption
   */
  async sendDocument(userId, content, filename, caption) {
    // If content looks like a URL, use document message; otherwise send as text link
    if (typeof content === 'string' && content.startsWith('http')) {
      const body = {
        messaging_product: 'whatsapp',
        to: userId,
        type: 'document',
        document: { link: content, filename, caption: (caption ?? '').slice(0, 1024) },
      };
      return this._post(`/${this._phoneNumberId}/messages`, body);
    }
    // Fallback: send caption with note
    return this.send(userId, { text: `📎 ${caption ?? filename}` });
  }

  /**
   * Convert button rows to the WA-preferred format (not the channel wire format —
   * that's built internally in send()). Returns metadata for ui-renderer.
   *
   * @param {Array<Array<{text:string, callbackData:string}>>} rows
   * @returns {{ type: 'whatsapp_buttons', rows: object[][] }}
   */
  renderButtons(rows) {
    return { type: 'whatsapp_buttons', rows };
  }

  // ── HTML conversion ────────────────────────────────────────────────────────

  /**
   * Convert Telegram HTML markup to WhatsApp formatting.
   * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```monospace```
   *
   * @param {string} html
   * @returns {string}
   */
  htmlToWhatsApp(html) {
    if (!html) return '';
    return html
      .replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*')
      .replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*')
      .replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_')
      .replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_')
      .replace(/<s>([\s\S]*?)<\/s>/gi, '~$1~')
      .replace(/<code>([\s\S]*?)<\/code>/gi, '```$1```')
      .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```$1```')
      .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, '') // strip remaining tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build an interactive message body for WA.
   * @param {string} userId
   * @param {string} text
   * @param {Array} buttonRows
   * @param {string|null} [lang]
   * @private
   */
  _buildInteractive(userId, text, buttonRows, lang = null) {
    const i18n = waI18n(lang);
    const flat = buttonRows.flat();

    if (flat.length <= MAX_BUTTON_BUTTONS) {
      // Reply buttons
      return {
        messaging_product: 'whatsapp',
        to: userId,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text.slice(0, 1024) || ' ' },
          action: {
            buttons: flat.map(btn => ({
              type: 'reply',
              reply: {
                id: (btn.callbackData ?? btn.callback_data ?? btn.text).slice(0, 256),
                title: (btn.text ?? '').slice(0, MAX_BUTTON_TITLE),
              },
            })),
          },
        },
      };
    }

    // List message (max 10 items per section; paginate if > 10)
    const sections = [];
    for (let i = 0; i < flat.length; i += MAX_LIST_ITEMS) {
      const chunk = flat.slice(i, i + MAX_LIST_ITEMS);
      sections.push({
        title: sections.length === 0 ? i18n.options : `${i18n.more} (${sections.length + 1})`,
        rows: chunk.map(btn => ({
          id: (btn.callbackData ?? btn.callback_data ?? btn.text).slice(0, 200),
          title: (btn.text ?? '').slice(0, MAX_BUTTON_TITLE),
        })),
      });
    }

    return {
      messaging_product: 'whatsapp',
      to: userId,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: text.slice(0, 1024) || ' ' },
        action: {
          button: i18n.button,
          sections,
        },
      },
    };
  }

  /**
   * POST to the Graph API.
   * @private
   */
  async _post(path, body) {
    if (!this._token || !this._phoneNumberId) {
      console.error('[wa] missing token or phone_number_id');
      return { ok: false, error: 'not_configured' };
    }
    return graphPost(path, this._token, body, { label: 'wa' });
  }
}

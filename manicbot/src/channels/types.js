/**
 * @fileoverview Normalized message types for the Channel Adapter Layer.
 * All channel adapters (Telegram, WhatsApp, Instagram) convert to/from these types.
 */

/**
 * Normalized inbound message — the single format seen by all handlers.
 *
 * @typedef {object} InboundMessage
 * @property {'telegram'|'whatsapp'|'instagram'} channel - Source channel identifier
 * @property {string}  channelUserId     - Platform-specific user ID (TG chat_id, WA phone, IG IGSID)
 * @property {string|null} tenantId      - Resolved tenant ID (set by resolver, may be null pre-resolve)
 * @property {string|null} text          - Plain text content of the message, or null
 * @property {object|null} contact       - Shared contact: { phone, firstName, lastName } or null
 * @property {string|null} photo         - Photo URL or media_id, or null
 * @property {string|null} callbackData  - Callback/postback/quick-reply payload, or null
 * @property {string|null} callbackMessageId - Message ID to answer callback for (Telegram), or null
 * @property {string|null} userName      - User's display / first name, or null
 * @property {string|null} userLang      - BCP-47 lang code from the channel, or null
 * @property {object}      rawEvent      - Original raw webhook payload (channel-specific)
 * @property {number}      timestamp     - Unix epoch milliseconds
 */

/**
 * Normalized outbound message — what handlers produce; adapters convert to channel format.
 *
 * @typedef {object} OutboundMessage
 * @property {string}        text              - Message text (may contain HTML for Telegram)
 * @property {'HTML'|'MarkdownV2'|'plain'} [parseMode='HTML'] - Markup mode for the text
 * @property {Array<Array<{text:string, callbackData:string}>>} [buttons] - Button rows (null = no buttons)
 * @property {string|null}   [photo]           - Photo URL to send
 * @property {object|null}   [document]        - Document to send: { content, filename, caption }
 * @property {string|null}   [editMessageId]   - If set, request an edit of this message ID
 * @property {string|null}   [lang]            - BCP-47 lang code for channel-specific UI chrome (WA section titles)
 */

/**
 * Creates an InboundMessage with sensible defaults.
 * All fields are explicitly listed to act as documentation / schema.
 *
 * @param {Partial<InboundMessage>} fields
 * @returns {InboundMessage}
 */
export function makeInbound(fields = {}) {
  return {
    channel: fields.channel ?? 'telegram',
    channelUserId: fields.channelUserId ?? '',
    tenantId: fields.tenantId ?? null,
    text: fields.text ?? null,
    contact: fields.contact ?? null,
    photo: fields.photo ?? null,
    callbackData: fields.callbackData ?? null,
    callbackMessageId: fields.callbackMessageId ?? null,
    userName: fields.userName ?? null,
    userLang: fields.userLang ?? null,
    rawEvent: fields.rawEvent ?? {},
    timestamp: fields.timestamp ?? Date.now(),
  };
}

/**
 * Creates an OutboundMessage with sensible defaults.
 *
 * @param {Partial<OutboundMessage>} fields
 * @returns {OutboundMessage}
 */
export function makeOutbound(fields = {}) {
  return {
    text: fields.text ?? '',
    parseMode: fields.parseMode ?? 'HTML',
    buttons: fields.buttons ?? null,
    photo: fields.photo ?? null,
    document: fields.document ?? null,
    editMessageId: fields.editMessageId ?? null,
  };
}

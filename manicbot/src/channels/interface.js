/**
 * @fileoverview ChannelAdapter interface (JSDoc only — no runtime enforcement).
 *
 * Every channel adapter (TelegramAdapter, WhatsAppAdapter, InstagramAdapter) must implement
 * the methods defined here. The `type` property identifies the channel universally.
 *
 * @typedef {'telegram'|'whatsapp'|'instagram'} ChannelType
 */

/**
 * @typedef {object} ChannelAdapter
 *
 * @property {ChannelType} type
 *   Channel identifier string.
 *
 * @property {function(object): import('./types.js').InboundMessage} normalize
 *   Convert a raw channel webhook payload into a normalized InboundMessage.
 *   For Telegram pass { message } or { callback_query }.
 *   For WhatsApp/Instagram pass the full entry object from the webhook.
 *
 * @property {function(string, import('./types.js').OutboundMessage): Promise<any>} send
 *   Send a new message to the given channelUserId.
 *   Implementations convert OutboundMessage.buttons to the channel-specific format.
 *
 * @property {function(string, string|number, import('./types.js').OutboundMessage): Promise<any>} edit
 *   Edit an existing message identified by (channelUserId, msgId).
 *   Channels that do not support editing (WhatsApp, Instagram) MUST send a new message instead.
 *
 * @property {function(string, string=): Promise<any>} answerCallback
 *   Acknowledge a callback/interactive event.
 *   - Telegram: calls answerCallbackQuery
 *   - WhatsApp / Instagram: no-op (returns immediately)
 *
 * @property {function(string, string, string, object=): Promise<any>} sendPhoto
 *   Send a photo to channelUserId.
 *   Params: (channelUserId, photoUrl, caption, extra?)
 *
 * @property {function(string, string|Uint8Array, string, string): Promise<any>} sendDocument
 *   Send a document/file to channelUserId.
 *   Params: (channelUserId, content, filename, caption)
 *
 * @property {function(Array<Array<{text:string, callbackData:string}>>): object} renderButtons
 *   Convert a button rows array into the channel-native markup object.
 *   - Telegram: { reply_markup: { inline_keyboard: [...] } }
 *   - WhatsApp: { interactive: { ... } } structure (partial, used by adaptButtonsForChannel)
 *   - Instagram: { quick_replies: [...] }
 */

// This file is documentation only — no exports needed at runtime.
// Import types via JSDoc: @type {import('./interface.js').ChannelAdapter}

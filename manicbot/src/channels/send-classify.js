/**
 * @fileoverview Classify a channel adapter send result into a persisted
 * delivery outcome. Single source of truth for the outbound relay + retry path.
 *
 * Adapters (telegram/whatsapp/instagram) ultimately return the shape of
 * `graphPost` / the Telegram Bot API:
 *   WhatsApp success:  { ok:true, data:{ messages:[{ id }] } }
 *   Instagram success: { ok:true, data:{ recipient_id, message_id } }
 *   Telegram success:  { ok:true, result:{ message_id } }
 *   failure:           { ok:false, error, status?, errorCode?, tokenDead? }
 *
 * NOTE: the previous inline extraction in messengerOutboundHttp.js read
 * `sendResult.messages[0].id` / `.message_id` WITHOUT the `.data` hop, so
 * WhatsApp + Instagram external_msg_id was ALWAYS null (delivered-correlation
 * + inbound dedup broke for Meta). `extractExternalMsgId` fixes that.
 */

/** Errors that are permanent — retrying won't help until the operator acts. */
const PERMANENT_ERRORS = new Set([
  'outside_message_window',
  'channel_token_unavailable',
  'channel_not_supported',
  'not_configured',
]);

/**
 * Pull the external message id out of a successful adapter result, handling
 * the `.data` wrapper (WA/IG) and the Bot-API `.result` wrapper (TG).
 * @returns {string|null}
 */
export function extractExternalMsgId(sendResult) {
  if (!sendResult || typeof sendResult !== 'object') return null;
  const d = sendResult.data ?? sendResult;
  const id =
    d?.messages?.[0]?.id ??       // WhatsApp Cloud API
    d?.message_id ??              // Instagram (graph)
    d?.result?.message_id ??      // Telegram Bot API
    sendResult.external_msg_id ??
    sendResult.message_id ??
    null;
  return id == null ? null : String(id);
}

/**
 * Decide whether a FAILED send is worth retrying. Transient = network blips,
 * 429 rate limits, 5xx. Permanent = window closed, dead token, unsupported,
 * other 4xx.
 * @returns {boolean}
 */
export function isTransientFailure(sendResult) {
  if (!sendResult) return true; // no result at all = fetch threw = transient
  const status = Number(sendResult.status) || 0;
  if (status === 429 || status >= 500) return true;
  if (sendResult.tokenDead) return false; // dead token: permanent until re-auth
  const err = String(sendResult.error ?? '');
  if (PERMANENT_ERRORS.has(err)) return false;
  if (status >= 400 && status < 500) return false; // other 4xx = permanent
  // Unknown shape with no status: a thrown fetch surfaces as relay_network_error.
  return err === '' || err === 'relay_network_error';
}

/**
 * Map an adapter send result to a delivery outcome.
 * @returns {{ deliveryState: 'sent'|'failed', externalMsgId: string|null, errorCode: string|null, transient: boolean }}
 */
export function classifyChannelSendResult(sendResult) {
  const ok = !!sendResult && sendResult.ok !== false;
  if (ok) {
    return {
      deliveryState: 'sent',
      externalMsgId: extractExternalMsgId(sendResult),
      errorCode: null,
      transient: false,
    };
  }
  return {
    deliveryState: 'failed',
    externalMsgId: null,
    errorCode: sendResult?.error ? String(sendResult.error) : 'channel_send_failed',
    transient: isTransientFailure(sendResult),
  };
}

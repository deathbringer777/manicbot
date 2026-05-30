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
 * Whether a FAILED send is SAFE to auto-retry from the background queue.
 *
 * STRICTER than `isTransientFailure`: only DEFINITIVE server rejections (429 /
 * 5xx — the channel said no, so the message did NOT deliver) qualify. A thrown
 * fetch / no-result is transient but AMBIGUOUS (the message might have actually
 * delivered before the socket died) — auto-retrying it would risk a duplicate
 * message to the client, so we never do. Those stay `failed` for manual retry,
 * where a human decides.
 * @returns {boolean}
 */
export function isAutoRetryable(sendResult) {
  if (!sendResult) return false; // ambiguous (fetch threw) → manual retry only
  if (sendResult.tokenDead) return false;
  const status = Number(sendResult.status) || 0;
  return status === 429 || status >= 500;
}

/**
 * Decide what the outbound-retry queue consumer does with a (re)send result.
 *   - 'sent'   → success; stamp delivered + ack.
 *   - 'retry'  → safely-retryable AND budget remains; redeliver.
 *   - 'failed' → permanent, ambiguous, or budget exhausted; mark failed + ack.
 *
 * @param {{ ok?: boolean, autoRetry?: boolean }} result - from performOutboundSend
 * @param {number} attempts - current delivery attempt (1-based)
 * @param {number} maxAttempts
 * @returns {'sent'|'retry'|'failed'}
 */
export function planRetryAction(result, attempts, maxAttempts) {
  if (result?.ok) return 'sent';
  if (result?.autoRetry && attempts < maxAttempts) return 'retry';
  return 'failed';
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
      autoRetry: false,
    };
  }
  return {
    deliveryState: 'failed',
    externalMsgId: null,
    errorCode: sendResult?.error ? String(sendResult.error) : 'channel_send_failed',
    transient: isTransientFailure(sendResult),
    autoRetry: isAutoRetryable(sendResult),
  };
}

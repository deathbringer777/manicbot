/**
 * Pure-function processor for Resend webhook events.
 *
 * Mapping from Resend event types to the D1 ops the route handler must
 * perform. Kept as a pure function (no I/O, no DB) so it can be tested
 * in isolation. The handler at `app/api/resend/webhook/route.ts`
 * imports `processResendEvent`, then applies `sendUpdate` to
 * `marketing_sends` and `suppress` to `email_suppressions`.
 *
 * Resend documentation: https://resend.com/docs/dashboard/webhooks/event-types
 *
 * Event matrix:
 *   email.sent          → no marketing_sends update (we already wrote
 *                         `sent_at` at provider.sendEmail return).
 *   email.delivered     → marketing_sends.delivered_at + status='delivered'
 *   email.opened        → marketing_sends.opened_at (status unchanged
 *                         unless still 'sent' — then promote to 'opened'
 *                         for the dashboard).
 *   email.clicked       → marketing_sends.clicked_at (same promote rule)
 *   email.bounced       → marketing_sends.bounced_at + status='bounced'
 *                         + email_suppressions row (hard bounces)
 *   email.complained    → marketing_sends.complained_at + status='complained'
 *                         + email_suppressions row
 *   email.delivery_delayed → email_suppressions only (retry storm signal)
 *   email.failed        → marketing_sends.status='failed' (provider gave
 *                         up after retries — distinct from initial-send
 *                         failure which is already 'failed')
 *
 * `sent_at` is preserved on later events for chronology. Status promotion
 * is monotonic: never overwrite 'bounced' or 'complained' with 'opened'.
 */

export interface ResendEvent {
  type: string;
  /** ISO timestamp from Resend. Optional; route uses request time when missing. */
  created_at?: string;
  data: {
    email_id?: string;
    to?: string | string[];
    from?: string;
    bounce?: { type?: string; message?: string };
    complaint?: { type?: string };
  };
}

/** Status promotion rank — higher wins, terminal events stick. */
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  // Terminal/negative states beat any positive status — the dashboard
  // needs to surface them even after a delivered ping.
  bounced: 10,
  complained: 11,
  failed: 9,
};

export interface SendUpdate {
  /** Looked up via `marketing_sends.provider_message_id = ?` */
  providerMessageId: string;
  /** Column-level patch for the matched row. */
  set: {
    status?: string;
    deliveredAt?: number;
    openedAt?: number;
    clickedAt?: number;
    bouncedAt?: number;
    complainedAt?: number;
  };
  /** Used by the caller to apply monotonic status promotion in SQL. */
  statusRank?: number;
}

export interface SuppressOp {
  emails: string[];
  reason: string;
  /** JSON-encoded slice of the event for audit. */
  detail: string;
}

export type ProcessOutcome =
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | "delivery_delayed"
  | "sent"
  | "ignored";

export interface ProcessResult {
  outcome: ProcessOutcome;
  /** marketing_sends update — undefined when the event carries no email_id. */
  sendUpdate?: SendUpdate;
  /** email_suppressions insert — undefined when not a suppression-worthy event. */
  suppress?: SuppressOp;
}

/**
 * Pure mapping from a Resend webhook event to D1 ops. Returns an outcome
 * tag the caller can log/metric on. `nowSec` lets tests pin the clock.
 */
export function processResendEvent(
  event: ResendEvent,
  nowSec: number,
): ProcessResult {
  const type = event.type;
  const emailId = event.data?.email_id;
  const recipients = normalizeRecipients(event.data?.to);

  switch (type) {
    case "email.sent":
      // We already marked `sent_at` at send time. Webhook arrival is a
      // confirmation Resend accepted the message — not informative
      // enough to update.
      return { outcome: "sent" };

    case "email.delivered":
      return {
        outcome: "delivered",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "delivered", deliveredAt: nowSec },
              statusRank: STATUS_RANK.delivered,
            }
          : undefined,
      };

    case "email.opened":
      return {
        outcome: "opened",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "opened", openedAt: nowSec },
              statusRank: STATUS_RANK.opened,
            }
          : undefined,
      };

    case "email.clicked":
      return {
        outcome: "clicked",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "clicked", clickedAt: nowSec },
              statusRank: STATUS_RANK.clicked,
            }
          : undefined,
      };

    case "email.bounced":
      return {
        outcome: "bounced",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "bounced", bouncedAt: nowSec },
              statusRank: STATUS_RANK.bounced,
            }
          : undefined,
        suppress:
          recipients.length > 0
            ? { emails: recipients, reason: type, detail: detailFor(event) }
            : undefined,
      };

    case "email.complained":
      return {
        outcome: "complained",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "complained", complainedAt: nowSec },
              statusRank: STATUS_RANK.complained,
            }
          : undefined,
        suppress:
          recipients.length > 0
            ? { emails: recipients, reason: type, detail: detailFor(event) }
            : undefined,
      };

    case "email.delivery_delayed":
      return {
        outcome: "delivery_delayed",
        suppress:
          recipients.length > 0
            ? { emails: recipients, reason: type, detail: detailFor(event) }
            : undefined,
      };

    case "email.failed":
      return {
        outcome: "failed",
        sendUpdate: emailId
          ? {
              providerMessageId: emailId,
              set: { status: "failed" },
              statusRank: STATUS_RANK.failed,
            }
          : undefined,
      };

    default:
      return { outcome: "ignored" };
  }
}

function normalizeRecipients(to: string | string[] | undefined): string[] {
  if (!to) return [];
  const arr = Array.isArray(to) ? to : [to];
  return arr
    .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
    .filter((e) => e.length > 0);
}

function detailFor(event: ResendEvent): string {
  try {
    return JSON.stringify(event.data ?? {}).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Svix replay-protection window. Svix's own SDK rejects webhooks whose
 * `svix-timestamp` is more than 5 minutes away from the receiver's clock
 * (in either direction) — a captured signed payload must not be replayable
 * forever. Mirror that contract here since we verify signatures manually.
 */
export const SVIX_TIMESTAMP_TOLERANCE_SEC = 300;

/**
 * Returns true when the `svix-timestamp` header value is a valid unix-seconds
 * integer within ±SVIX_TIMESTAMP_TOLERANCE_SEC of `nowSec`. Anything else
 * (missing, non-numeric, float-ish, out of window) is stale/forged → reject.
 */
export function isSvixTimestampFresh(
  tsHeader: string | null,
  nowSec: number,
  toleranceSec: number = SVIX_TIMESTAMP_TOLERANCE_SEC,
): boolean {
  if (!tsHeader || !/^\d+$/.test(tsHeader.trim())) return false;
  const ts = Number(tsHeader.trim());
  if (!Number.isSafeInteger(ts)) return false;
  return Math.abs(nowSec - ts) <= toleranceSec;
}

/**
 * Admin-app companion to the Worker `recordEvent` helper at
 * `manicbot/src/utils/analytics.js`. Same target table
 * (`analytics_events`, migration 0029 + 0055), same column order, same
 * fire-and-forget contract: analytics writes MUST NOT break user-visible
 * flows. A failure logs and returns false; the calling tRPC mutation
 * still succeeds.
 *
 * ## Canonical event names
 *
 * Domain.event slugs. Currently wired for the pre-launch funnel:
 *
 *   - signup.started               — /register POST received
 *   - signup.email_verified        — code accepted on /verify-email
 *   - signup.completed             — full register + email-verify path done
 *   - bot.linked                   — first channel connected for a tenant
 *   - salon.profile_completed      — name + slug + city + description all set
 *   - service.first_created        — first service row for a tenant
 *   - booking.link_first_shared    — first /start with the booking slug
 *   - booking.first_external       — first booking from a non-owner user
 *   - appointment.first_paid       — first appointment paid via Stripe
 *   - payment.method_added         — Stripe `payment_method.attached`
 *   - subscription.started         — Stripe `customer.subscription.created`
 *   - subscription.renewed         — Stripe `invoice.payment_succeeded` (renewal)
 *   - subscription.churn_warning   — billing trial_will_end / invoice_upcoming
 *   - support.message_sent         — support reply (either direction)
 *   - system.god_mode_action       — `adminProcedure` mutation
 *   - trial.started                — new tenant provisioned
 *   - trial.warning_3d             — cron: trial_end_at - now < 3 days
 *   - trial.expired                — cron: billing_status flipped to expired
 *
 * Keep names stable — the God Mode `/system/events` page + future
 * dashboards grep on these.
 */

import { analyticsEvents } from "~/server/db/schema";
import { log } from "~/server/utils/logger";
import type { getDb } from "~/server/db";

type DrizzleDb = ReturnType<typeof getDb>;

export interface RecordEventInput {
  db: DrizzleDb;
  event: string;
  tenantId?: string | null;
  userId?: string | number | null;
  properties?: Record<string, unknown>;
}

/**
 * Insert one analytics event. Returns true on success, false on failure
 * (failures never throw — analytics never blocks the hot path).
 */
export async function recordEvent(input: RecordEventInput): Promise<boolean> {
  const { db, event, tenantId = null, userId = null } = input;
  if (!event) return false;
  try {
    const propsJson = JSON.stringify(input.properties ?? {});
    const props = propsJson.length > 1000 ? propsJson.slice(0, 1000) : propsJson;
    await db.insert(analyticsEvents).values({
      tenantId,
      userId: userId == null ? null : String(userId),
      event,
      properties: props,
      createdAt: Math.floor(Date.now() / 1000),
    });
    return true;
  } catch (e) {
    log.error("recordEvent", e instanceof Error ? e : new Error(String(e)));
    return false;
  }
}

/**
 * Canonical pre-launch funnel slugs. Importing from a single source keeps
 * the writer (this module's callers) and the reader (the God Mode page +
 * future dashboards) in lockstep — a typo here breaks tests instead of
 * silently producing a `signup.startd` row that no dashboard knows
 * about.
 */
export const ANALYTICS_EVENTS = {
  // Signup funnel
  SIGNUP_STARTED: "signup.started",
  SIGNUP_EMAIL_VERIFIED: "signup.email_verified",
  SIGNUP_COMPLETED: "signup.completed",
  // Activation
  BOT_LINKED: "bot.linked",
  SALON_PROFILE_COMPLETED: "salon.profile_completed",
  SERVICE_FIRST_CREATED: "service.first_created",
  BOOKING_LINK_FIRST_SHARED: "booking.link_first_shared",
  BOOKING_FIRST_EXTERNAL: "booking.first_external",
  APPOINTMENT_FIRST_PAID: "appointment.first_paid",
  // Billing
  PAYMENT_METHOD_ADDED: "payment.method_added",
  SUBSCRIPTION_STARTED: "subscription.started",
  SUBSCRIPTION_RENEWED: "subscription.renewed",
  SUBSCRIPTION_CHURN_WARNING: "subscription.churn_warning",
  // Support + admin
  SUPPORT_MESSAGE_SENT: "support.message_sent",
  SYSTEM_GOD_MODE_ACTION: "system.god_mode_action",
  // Trial lifecycle
  TRIAL_STARTED: "trial.started",
  TRIAL_WARNING_3D: "trial.warning_3d",
  TRIAL_EXPIRED: "trial.expired",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

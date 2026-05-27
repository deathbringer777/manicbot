/**
 * Centralized email service — all email scenarios go through here.
 * Uses Resend HTTP transport (resend.ts) + branded templates (templates.ts).
 */

import type { Lang } from "~/lib/i18n";
import { sendResendEmail, type SendEmailResult } from "./resend";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";
import { getRuntimeEnv } from "~/server/runtimeEnv";
import {
  verificationEmailHtml,
  verificationCodeEmailHtml,
  passwordResetEmailHtml,
  passwordResetCodeEmailHtml,
  welcomeEmailHtml,
  subscriptionWelcomeEmailHtml,
  subscriptionConfirmEmailHtml,
  emailChangeEmailHtml,
  emailChangeCodeEmailHtml,
  loginAlertEmailHtml,
  roleRequestAdminEmailHtml,
  roleRequestDecisionEmailHtml,
  permissionElevationCodeEmailHtml,
  paymentFailedEmailHtml,
  paymentFailedEmailText,
  planUpgradeEmailHtml,
  planUpgradeEmailText,
  masterInviteEmailHtml,
  masterInviteEmailText,
  supportReplyEmailHtml,
  supportReplyEmailText,
  ownershipTransferRequestEmailHtml,
  ownershipTransferCompletedOldOwnerEmailHtml,
  ownershipTransferCompletedNewOwnerEmailHtml,
  getOwnershipCopy,
  getEmailCopy,
  getPermissionElevationCopy,
} from "./templates";

function baseUrl(): string {
  return authPublicBaseUrl() || "";
}

/** Registration: 6-digit verification code (CSPRNG, 15-min TTL). */
export async function sendVerificationCodeEmail(
  to: string,
  code: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.verificationCode.subject,
    html: verificationCodeEmailHtml(code, lang),
  });
}

/** Registration: email verification link (legacy). */
export async function sendVerificationEmail(
  to: string,
  token: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const url = `${baseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.verification.subject,
    html: verificationEmailHtml(url, lang),
  });
}

/**
 * #N1 — DEPRECATED. URL-token password reset email. Kept temporarily for any
 * straggling caller; will be removed once all in-flight tokens expire (1h).
 * New code MUST use `sendPasswordResetCodeEmail` (6-digit code, no URL).
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.passwordReset.subject,
    html: passwordResetEmailHtml(url, lang),
  });
}

/**
 * Password reset via 6-digit code. Mirror of `sendVerificationCodeEmail`.
 * Email body contains the code; user types it into the reset form. Eliminates
 * the URL-based leakage path (Referer headers, MTA logs, browser history).
 */
export async function sendPasswordResetCodeEmail(
  to: string,
  code: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.passwordResetCode.subject,
    html: passwordResetCodeEmailHtml(code, lang),
  });
}

/** Welcome email after verification. */
export async function sendWelcomeEmail(
  to: string,
  name: string | null,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const dashboardUrl = `${baseUrl()}/dashboard`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.welcome.subject,
    html: welcomeEmailHtml(name, dashboardUrl, lang),
  });
}

/**
 * Newsletter "Stay in the loop" post-confirmation acknowledgement.
 * Sent ONLY after the subscriber clicks the DOI confirm-click link from
 * `sendNewsletterConfirmEmail` (migration 0092 + Worker
 * `/confirm-subscription`). The Worker mints `unsubscribe_token` at
 * confirm-time (migration 0090 column) and passes it in here as
 * `unsubscribeToken` — we build the absolute one-click URL pointing at
 * the Worker's `/u/<token>` endpoint, which serves both
 * `marketing_contacts` and `newsletter_subscribers` via fallthrough.
 *
 * Distinct from registration welcome:
 *   * The subscriber is NOT necessarily a web_user.
 *   * No dashboard CTA — newsletters point to the marketing list, not to
 *     an account they may not own.
 *
 * Headers (RFC 8058 one-click):
 *   * `List-Unsubscribe: <https://manicbot.com/u/<token>>`
 *   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * Gmail / Apple Mail render an "Unsubscribe" affordance in the message
 * header and POST to the URL when the user clicks it. The Worker handler
 * returns 204 on the POST path.
 */
export async function sendNewsletterWelcomeEmail(
  to: string,
  lang: Lang = "en",
  unsubscribeToken: string,
): Promise<SendEmailResult> {
  const origin = (
    getRuntimeEnv("WORKER_PUBLIC_URL") || "https://manicbot.com"
  ).replace(/\/+$/, "");
  const unsubscribeUrl = `${origin}/u/${unsubscribeToken}`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.subscriptionWelcome.subject,
    html: subscriptionWelcomeEmailHtml(unsubscribeUrl, lang),
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

/**
 * Newsletter DOI confirm-click email. First touch after POST /api/subscribe.
 * The Worker mints a 32-hex `confirm_token` (7-day TTL) and passes it here;
 * we build the absolute URL pointing at the Worker's `/confirm-subscription`
 * route which closes the loop (stamps `confirmed_at`, mints unsub token,
 * triggers the welcome email via this module).
 */
export async function sendNewsletterConfirmEmail(
  to: string,
  lang: Lang = "en",
  confirmToken: string,
): Promise<SendEmailResult> {
  // Match `sendNewsletterWelcomeEmail` — use `getRuntimeEnv` so the same
  // helper resolves on edge (where `process.env` is empty at request time).
  const origin = (
    getRuntimeEnv("WORKER_PUBLIC_URL") || "https://manicbot.com"
  ).replace(/\/+$/, "");
  const confirmUrl = `${origin}/confirm-subscription?token=${encodeURIComponent(confirmToken)}`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.subscriptionConfirm.subject,
    html: subscriptionConfirmEmailHtml(confirmUrl, lang),
  });
}

/**
 * #N1 — DEPRECATED. URL-token email-change verification. Kept temporarily for
 * straggling callers; will be removed once all in-flight tokens expire (1h).
 * New code MUST use `sendEmailChangeCodeVerification` (6-digit code, no URL).
 */
export async function sendEmailChangeVerification(
  to: string,
  token: string,
  newEmail: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const url = `${baseUrl()}/confirm-email-change?token=${encodeURIComponent(token)}`;
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.emailChange.subject,
    html: emailChangeEmailHtml(url, newEmail, lang),
  });
}

/**
 * Email-change verification via 6-digit code. Body contains the code; user
 * types it into the settings dialog. Eliminates URL leakage path.
 */
export async function sendEmailChangeCodeVerification(
  to: string,
  code: string,
  newEmail: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.emailChangeCode.subject,
    html: emailChangeCodeEmailHtml(code, newEmail, lang),
  });
}

/** Login from a new IP address alert. */
export async function sendLoginAlert(
  to: string,
  ip: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const time = new Date().toLocaleString("en-GB", { timeZone: "Europe/Warsaw" });
  const copy = getEmailCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.loginAlert.subject,
    html: loginAlertEmailHtml(ip, time, lang),
  });
}

/** Role change request: notify admin(s). */
export async function sendRoleChangeAdminNotification(
  adminEmails: string[],
  userName: string,
  userEmail: string,
  currentRole: string,
  requestedRole: string,
  reason: string | null,
  lang: Lang = "en",
): Promise<SendEmailResult[]> {
  const reviewUrl = `${baseUrl()}/role-requests`;
  const copy = getEmailCopy(lang);
  const results: SendEmailResult[] = [];
  for (const to of adminEmails) {
    results.push(await sendResendEmail({
      to,
      subject: copy.roleRequestAdmin.subject,
      html: roleRequestAdminEmailHtml(userName, userEmail, currentRole, requestedRole, reason, reviewUrl, lang),
    }));
  }
  return results;
}

/** Role change request: notify user of decision. */
export async function sendRoleChangeDecisionEmail(
  to: string,
  decision: "approved" | "denied",
  oldRole: string,
  newRole: string,
  adminNote: string | null,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const dashboardUrl = `${baseUrl()}/dashboard`;
  const copy = getEmailCopy(lang);
  const subject = decision === "approved"
    ? copy.roleRequestDecision.approvedSubject
    : copy.roleRequestDecision.deniedSubject;
  return sendResendEmail({
    to,
    subject,
    html: roleRequestDecisionEmailHtml(decision, oldRole, newRole, adminNote, dashboardUrl, lang),
  });
}

/** Phase 2: permission elevation 6-digit code sent to OWNER's email. */
export async function sendPermissionElevationCodeEmail(
  to: string,
  code: string,
  targetEmail: string,
  permissions: string[],
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const copy = getPermissionElevationCopy(lang);
  return sendResendEmail({
    to,
    subject: copy.subject,
    html: permissionElevationCodeEmailHtml(code, targetEmail, permissions, lang),
  });
}

// ─── #P1-5 — New transactional emails (relax.md §5) ─────────────────────

/**
 * #P1-5 — Stripe `invoice.payment_failed` notification.
 * Fired from `src/billing/webhooks.js` after the tenant is flipped into
 * grace_period. We surface the failed amount + plan and CTA to update the
 * payment method in the dashboard. No card metadata is included.
 */
export async function sendPaymentFailedEmail(
  to: string,
  amountFormatted: string,
  planLabel: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const updatePaymentUrl = `${baseUrl()}/dashboard/billing`;
  const copy = getEmailCopy(lang);
  const options = { amountFormatted, planLabel, updatePaymentUrl };
  return sendResendEmail({
    to,
    subject: copy.paymentFailed.subject,
    html: paymentFailedEmailHtml(options, lang),
    text: paymentFailedEmailText(options, lang),
  });
}

/**
 * #P1-5 — `customer.subscription.updated` plan-tier UPGRADE notification.
 * Only emitted when the new plan is strictly higher than the previous one;
 * the upgrade-vs-downgrade check lives in the webhook caller.
 */
export async function sendPlanUpgradeEmail(
  to: string,
  oldPlanLabel: string,
  newPlanLabel: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const dashboardUrl = `${baseUrl()}/dashboard`;
  const copy = getEmailCopy(lang);
  const options = { oldPlanLabel, newPlanLabel, dashboardUrl };
  return sendResendEmail({
    to,
    subject: copy.planUpgrade.subject,
    html: planUpgradeEmailHtml(options, lang),
    text: planUpgradeEmailText(options, lang),
  });
}

/**
 * #P1-5 — master-invite email. Sent when a tenant_owner adds a master row
 * to `tenant_roles`. Best-effort: callers should pass the master's email
 * if available and skip sending otherwise (Telegram-only masters get no
 * email — their notification arrives via the bot).
 */
export async function sendMasterInviteEmail(
  to: string,
  salonName: string,
  roleLabel: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const dashboardUrl = `${baseUrl()}/dashboard`;
  const copy = getEmailCopy(lang);
  const options = { salonName, roleLabel, dashboardUrl };
  return sendResendEmail({
    to,
    subject: copy.masterInvite.subject,
    html: masterInviteEmailHtml(options, lang),
    text: masterInviteEmailText(options, lang),
  });
}

/**
 * #P1-5 — support-reply notification. Fired from `support.replyToTicket`
 * after a platform support / technical_support / system_admin agent
 * replies. The reply preview is capped at 240 chars and HTML-stripped
 * inside the template so we never leak nested links/scripts into the
 * inbox. Full content stays in the ticket UI.
 */
export async function sendSupportReplyEmail(
  to: string,
  ticketId: string,
  previewText: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const ticketUrl = `${baseUrl()}/support/tickets/${encodeURIComponent(ticketId)}`;
  const copy = getEmailCopy(lang);
  const options = { ticketId, previewText, ticketUrl };
  return sendResendEmail({
    to,
    subject: copy.supportReply.subject,
    html: supportReplyEmailHtml(options, lang),
    text: supportReplyEmailText(options, lang),
  });
}

/* ── Ownership transfer ───────────────────────────────────────────────────── */

export async function sendOwnershipTransferRequestEmail(opts: {
  to: string;
  fromName: string;
  toName: string;
  toEmail: string;
  tenantName: string;
  confirmUrl: string;
  lang: Lang;
}): Promise<SendEmailResult> {
  const c = getOwnershipCopy(opts.lang).request;
  return sendResendEmail({
    to: opts.to,
    subject: c.subject,
    html: ownershipTransferRequestEmailHtml(opts),
  });
}

export async function sendOwnershipTransferCompletedToOldOwnerEmail(opts: {
  to: string;
  newOwnerName: string;
  tenantName: string;
  lang: Lang;
}): Promise<SendEmailResult> {
  const c = getOwnershipCopy(opts.lang).oldOwner;
  return sendResendEmail({
    to: opts.to,
    subject: c.subject,
    html: ownershipTransferCompletedOldOwnerEmailHtml(opts),
  });
}

export async function sendOwnershipTransferCompletedToNewOwnerEmail(opts: {
  to: string;
  oldOwnerName: string;
  tenantName: string;
  lang: Lang;
}): Promise<SendEmailResult> {
  const c = getOwnershipCopy(opts.lang).newOwner;
  return sendResendEmail({
    to: opts.to,
    subject: c.subject,
    html: ownershipTransferCompletedNewOwnerEmailHtml(opts),
  });
}

// ─── Masters-tab overhaul: 4 new senders ─────────────────────────────────

/** Scenario A: web_user already exists → in-app accept link. */
export async function sendMasterInviteExistingUserEmail(
  to: string,
  invitationId: string,
  salonName: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const { masterInviteExistingUserHtml, masterInviteExistingUserText, getInviteExistingUserSubject } =
    await import("./templates");
  const acceptUrl = `${baseUrl()}/invitations/${encodeURIComponent(invitationId)}`;
  return sendResendEmail({
    to,
    subject: getInviteExistingUserSubject(lang, salonName),
    html: masterInviteExistingUserHtml({ salonName, acceptUrl }, lang),
    text: masterInviteExistingUserText({ salonName, acceptUrl }, lang),
  });
}

/** Scenario B: no web_user → magic-link register with invite token. */
export async function sendMasterInviteNewUserEmail(
  to: string,
  token: string,
  salonName: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const { masterInviteNewUserHtml, masterInviteNewUserText, getInviteNewUserSubject } =
    await import("./templates");
  const registerUrl = `${baseUrl()}/register/invite/${encodeURIComponent(token)}`;
  return sendResendEmail({
    to,
    subject: getInviteNewUserSubject(lang, salonName),
    html: masterInviteNewUserHtml({ salonName, registerUrl }, lang),
    text: masterInviteNewUserText({ salonName, registerUrl }, lang),
  });
}

/**
 * Owner triggered a password reset for a `salon_created` master account.
 * The new credentials (login + plaintext password) are emailed to the OWNER,
 * not the master — the master's stored email is a synthetic
 * `*.salon.manicbot.local` mailbox that doesn't accept mail, so direct
 * delivery would mean the password vanishes. The owner is expected to hand
 * the credentials over through a trusted channel. Caller MUST NOT log
 * `newPassword`.
 */
export async function sendMasterPasswordResetCredentialsToOwnerEmail(
  ownerEmail: string,
  masterName: string,
  masterLogin: string,
  newPassword: string,
  salonName: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const {
    masterPasswordResetCredentialsForOwnerHtml,
    masterPasswordResetCredentialsForOwnerText,
    getPasswordResetCredentialsForOwnerSubject,
  } = await import("./templates");
  const loginUrl = `${baseUrl()}/login`;
  return sendResendEmail({
    to: ownerEmail,
    subject: getPasswordResetCredentialsForOwnerSubject(lang, salonName, masterName),
    html: masterPasswordResetCredentialsForOwnerHtml(
      { salonName, masterName, masterLogin, newPassword, loginUrl },
      lang,
    ),
    text: masterPasswordResetCredentialsForOwnerText(
      { salonName, masterName, masterLogin, newPassword, loginUrl },
      lang,
    ),
  });
}

/**
 * Generic OTP for destructive mutations. `actionLabel` is the localized
 * human-readable summary ("Archive master Olga" / "Reset password for Anna")
 * shown in the email body. Pair with auth.requestActionOtp() server-side.
 */
export async function sendActionOtpEmail(
  to: string,
  code: string,
  actionLabel: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const { actionOtpEmailHtml, actionOtpEmailText, getActionOtpSubject } = await import("./templates");
  return sendResendEmail({
    to,
    subject: getActionOtpSubject(lang),
    html: actionOtpEmailHtml({ code, actionLabel }, lang),
    text: actionOtpEmailText({ code, actionLabel }, lang),
  });
}

/**
 * "We're sorry to see you go" — sent after the retention flow confirms
 * cancellation (migration 0087). Fire-and-forget; a Resend hiccup must NOT
 * block the Stripe cancel mutation.
 */
export async function sendSubscriptionCancelledEmail(
  to: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const {
    subscriptionCancelledEmailHtml,
    getSubscriptionCancelledSubject,
  } = await import("./templates");
  const resumeUrl = `${baseUrl()}/settings?section=billing`;
  return sendResendEmail({
    to,
    subject: getSubscriptionCancelledSubject(lang),
    html: subscriptionCancelledEmailHtml(resumeUrl, lang),
  });
}

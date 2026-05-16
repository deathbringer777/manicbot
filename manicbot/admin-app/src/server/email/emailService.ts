/**
 * Centralized email service — all email scenarios go through here.
 * Uses Resend HTTP transport (resend.ts) + branded templates (templates.ts).
 */

import type { Lang } from "~/lib/i18n";
import { sendResendEmail, type SendEmailResult } from "./resend";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";
import {
  verificationEmailHtml,
  verificationCodeEmailHtml,
  passwordResetEmailHtml,
  passwordResetCodeEmailHtml,
  welcomeEmailHtml,
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
  const registerUrl = `${baseUrl()}/register?invite=${encodeURIComponent(token)}`;
  return sendResendEmail({
    to,
    subject: getInviteNewUserSubject(lang, salonName),
    html: masterInviteNewUserHtml({ salonName, registerUrl }, lang),
    text: masterInviteNewUserText({ salonName, registerUrl }, lang),
  });
}

/**
 * Owner triggered a password reset for a salon-owned master account.
 * The new plaintext lands directly in the master's inbox — the owner never
 * sees it. Caller MUST NOT log this password.
 */
export async function sendMasterPasswordResetByOwnerEmail(
  to: string,
  newPassword: string,
  salonName: string,
  lang: Lang = "en",
): Promise<SendEmailResult> {
  const {
    masterPasswordResetByOwnerHtml,
    masterPasswordResetByOwnerText,
    getPasswordResetByOwnerSubject,
  } = await import("./templates");
  const loginUrl = `${baseUrl()}/login`;
  return sendResendEmail({
    to,
    subject: getPasswordResetByOwnerSubject(lang, salonName),
    html: masterPasswordResetByOwnerHtml({ salonName, newPassword, loginUrl }, lang),
    text: masterPasswordResetByOwnerText({ salonName, newPassword, loginUrl }, lang),
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

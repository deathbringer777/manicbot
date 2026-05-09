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

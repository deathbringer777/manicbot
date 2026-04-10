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
  welcomeEmailHtml,
  emailChangeEmailHtml,
  loginAlertEmailHtml,
  roleRequestAdminEmailHtml,
  roleRequestDecisionEmailHtml,
  getEmailCopy,
} from "./templates";

function baseUrl(): string {
  return authPublicBaseUrl() || "";
}

/** Registration: 6-digit verification code. */
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

/** Password reset link. */
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

/** Email change: verification sent to the NEW address. */
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

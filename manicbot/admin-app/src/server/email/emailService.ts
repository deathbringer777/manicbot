/**
 * Centralized email service — all email scenarios go through here.
 * Uses Resend HTTP transport (resend.ts) + branded templates (templates.ts).
 */

import type { Lang } from "~/lib/i18n";
import { sendResendEmail, type SendEmailResult } from "./resend";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";
import {
  verificationEmailHtml,
  passwordResetEmailHtml,
  welcomeEmailHtml,
  emailChangeEmailHtml,
  loginAlertEmailHtml,
  getEmailCopy,
} from "./templates";

function baseUrl(): string {
  return authPublicBaseUrl() || "";
}

/** Registration: email verification link. */
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

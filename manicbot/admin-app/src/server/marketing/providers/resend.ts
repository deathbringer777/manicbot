import { sendResendEmail, isResendConfigured } from "~/server/email/resend";
import type {
  MarketingProvider,
  EmailPayload,
  SendResult,
  HealthResult,
  ChannelType,
} from "./types";

export const resendProvider: MarketingProvider = {
  name: "resend",
  channels: ["email"],

  isConfigured(channel: ChannelType): boolean {
    return channel === "email" && isResendConfigured();
  },

  async sendEmail(p: EmailPayload): Promise<SendResult> {
    const r = await sendResendEmail({ to: p.to, subject: p.subject, html: p.html });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  async checkHealth(): Promise<HealthResult> {
    if (!isResendConfigured()) {
      return { status: "not_configured", detail: "RESEND_API_KEY not set" };
    }
    // Resend has no lightweight account endpoint — consider configured = ok.
    return { status: "ok" };
  },
};

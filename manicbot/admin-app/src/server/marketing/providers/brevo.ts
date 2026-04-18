import {
  sendBrevoEmail,
  sendBrevoSms,
  checkBrevoHealth,
  isBrevoConfigured,
  isBrevoSmsConfigured,
} from "~/server/email/brevo";
import type {
  MarketingProvider,
  EmailPayload,
  SmsPayload,
  SendResult,
  HealthResult,
  ChannelType,
} from "./types";

export const brevoProvider: MarketingProvider = {
  name: "brevo",
  channels: ["email", "sms"],

  isConfigured(channel: ChannelType): boolean {
    if (channel === "email") return isBrevoConfigured();
    if (channel === "sms") return isBrevoSmsConfigured();
    return false;
  },

  async sendEmail(p: EmailPayload): Promise<SendResult> {
    const r = await sendBrevoEmail(p);
    return r.ok ? { ok: true, messageId: r.messageId } : { ok: false, error: r.error };
  },

  async sendSms(p: SmsPayload): Promise<SendResult> {
    const r = await sendBrevoSms({ to: p.to, text: p.text, tag: p.tag });
    return r.ok ? { ok: true, messageId: r.messageId } : { ok: false, error: r.error };
  },

  async checkHealth(): Promise<HealthResult> {
    if (!isBrevoConfigured() && !isBrevoSmsConfigured()) {
      return { status: "not_configured", detail: "BREVO_API_KEY not set" };
    }
    const r = await checkBrevoHealth();
    if (r.ok) return { status: "ok", account: r.email, plan: r.plan };
    return { status: "down", detail: r.error };
  },
};

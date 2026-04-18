/**
 * Unified provider interface for the marketing module.
 * Implementations: brevo, resend. Providers are loaded lazily and never throw
 * at import time — missing env vars surface as `ok: false` from send calls and
 * `status: "not_configured"` from health checks.
 */

export type ProviderName = "brevo" | "resend" | "twilio";
export type ChannelType = "email" | "sms" | "whatsapp";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface HealthResult {
  status: "ok" | "not_configured" | "degraded" | "down";
  detail?: string;
  account?: string;
  plan?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  toName?: string;
  tags?: string[];
}

export interface SmsPayload {
  to: string;
  text: string;
  tag?: string;
}

export interface MarketingProvider {
  readonly name: ProviderName;
  readonly channels: ChannelType[];
  isConfigured(channel: ChannelType): boolean;
  sendEmail?(p: EmailPayload): Promise<SendResult>;
  sendSms?(p: SmsPayload): Promise<SendResult>;
  checkHealth(): Promise<HealthResult>;
}

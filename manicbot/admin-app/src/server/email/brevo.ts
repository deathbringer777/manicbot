/**
 * Transactional / marketing email + SMS via Brevo HTTP API (Edge-safe fetch).
 * https://developers.brevo.com/reference/sendtransacemail
 * https://developers.brevo.com/reference/sendtransacsms
 *
 * DORMANT integration — wired in the admin marketing module but not invoked
 * from any call site yet. Swap `sendResendEmail` → `sendBrevoEmail` in
 * `emailService.ts` to flip providers.
 *
 * Reads runtime secrets through `getRuntimeEnv` (same pattern as resend.ts) so
 * it works under @cloudflare/next-on-pages at the Edge as well as Node/tests.
 */

import { getRuntimeEnv } from "~/server/runtimeEnv";
import { log } from "~/server/utils/logger";

const BREVO_EMAIL_API = "https://api.brevo.com/v3/smtp/email";
const BREVO_SMS_API = "https://api.brevo.com/v3/transactionalSMS/sms";
const BREVO_ACCOUNT_API = "https://api.brevo.com/v3/account";

export type BrevoResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string };

function getKey(): string | undefined {
  return getRuntimeEnv("BREVO_API_KEY")?.trim() || undefined;
}
function getFrom(): string | undefined {
  return getRuntimeEnv("BREVO_FROM")?.trim() || undefined;
}
function getSmsSender(): string | undefined {
  // 11 chars max, alphanumeric — see Brevo SMS docs
  return getRuntimeEnv("BREVO_SMS_SENDER")?.trim() || undefined;
}

/** Parse `"Name <addr@dom>"` → `{ name, email }`. Falls back to raw email. */
export function parseFromAddress(raw: string): { email: string; name?: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = (m[1] ?? "").trim();
    const email = (m[2] ?? "").trim();
    return name ? { email, name } : { email };
  }
  return { email: raw.trim() };
}

export function isBrevoConfigured(): boolean {
  return Boolean(getKey() && getFrom());
}

export function isBrevoSmsConfigured(): boolean {
  return Boolean(getKey() && getSmsSender());
}

/**
 * Send a transactional / marketing email via Brevo.
 * Returns ok:false with `brevo_not_configured` when env missing.
 */
export async function sendBrevoEmail(opts: {
  to: string;
  subject: string;
  html: string;
  toName?: string;
  tags?: string[];
}): Promise<BrevoResult> {
  const key = getKey();
  const from = getFrom();
  if (!key || !from) {
    log.warn("brevo.email", { message: "BREVO_API_KEY or BREVO_FROM not set — email not sent" });
    return { ok: false, error: "brevo_not_configured" };
  }

  const sender = parseFromAddress(from);

  try {
    const res = await fetch(BREVO_EMAIL_API, {
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [opts.toName ? { email: opts.to, name: opts.toName } : { email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
        ...(opts.tags && opts.tags.length ? { tags: opts.tags } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      messageId?: string;
      message?: string;
      code?: string;
    };

    if (!res.ok) {
      const msg =
        typeof data?.message === "string"
          ? data.message
          : `brevo_http_${res.status}`;
      log.error("brevo.email", new Error(msg), { status: res.status });
      return { ok: false, error: msg };
    }

    log.info("brevo.email", { messageId: data.messageId, from: sender.email });
    return { ok: true, messageId: data.messageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch_failed";
    log.error("brevo.email", e instanceof Error ? e : new Error(message));
    return { ok: false, error: message };
  }
}

/**
 * Send a transactional SMS via Brevo.
 * Requires BREVO_API_KEY + BREVO_SMS_SENDER. `to` must include country code, e.g. `+48...`.
 * Reserved for the Max-plan add-on; not wired anywhere yet.
 */
export async function sendBrevoSms(opts: {
  to: string;
  text: string;
  type?: "transactional" | "marketing";
  tag?: string;
}): Promise<BrevoResult> {
  const key = getKey();
  const sender = getSmsSender();
  if (!key || !sender) {
    log.warn("brevo.sms", { message: "BREVO_API_KEY or BREVO_SMS_SENDER not set — sms not sent" });
    return { ok: false, error: "brevo_sms_not_configured" };
  }

  try {
    const res = await fetch(BREVO_SMS_API, {
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        recipient: opts.to,
        content: opts.text,
        type: opts.type ?? "transactional",
        ...(opts.tag ? { tag: opts.tag } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      reference?: string;
      messageId?: number | string;
      message?: string;
    };

    if (!res.ok) {
      const msg =
        typeof data?.message === "string"
          ? data.message
          : `brevo_http_${res.status}`;
      log.error("brevo.sms", new Error(msg), { status: res.status });
      return { ok: false, error: msg };
    }

    const id = data.messageId != null ? String(data.messageId) : data.reference;
    log.info("brevo.sms", { messageId: id, sender });
    return { ok: true, messageId: id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch_failed";
    log.error("brevo.sms", e instanceof Error ? e : new Error(message));
    return { ok: false, error: message };
  }
}

/**
 * Health check: calls GET /v3/account. Used by the providers dashboard
 * to show connection status without sending a test email.
 */
export async function checkBrevoHealth(): Promise<
  | { ok: true; email: string; plan?: string }
  | { ok: false; error: string }
> {
  const key = getKey();
  if (!key) return { ok: false, error: "brevo_not_configured" };

  try {
    const res = await fetch(BREVO_ACCOUNT_API, {
      method: "GET",
      headers: { "api-key": key, accept: "application/json" },
    });
    const data = (await res.json().catch(() => ({}))) as {
      email?: string;
      plan?: Array<{ type?: string }>;
      message?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data?.message ?? `brevo_http_${res.status}` };
    }
    return {
      ok: true,
      email: data.email ?? "",
      plan: data.plan?.[0]?.type,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch_failed" };
  }
}

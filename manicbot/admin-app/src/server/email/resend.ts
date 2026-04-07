/**
 * Transactional email via Resend HTTP API (Edge-safe fetch).
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * On Cloudflare Pages (via @cloudflare/next-on-pages), runtime secrets set in
 * the Pages dashboard are only exposed through getRequestContext().env at
 * request time — process.env is empty on the Edge Runtime. getRuntimeEnv()
 * reads the Cloudflare request context first and falls back to process.env
 * for tests / Node / build time.
 */

import { getRuntimeEnv } from "~/server/runtimeEnv";

const RESEND_API = "https://api.resend.com/emails";

export type SendEmailResult = { ok: true } | { ok: false; error: string };

function getKey(): string | undefined {
  return getRuntimeEnv("RESEND_API_KEY")?.trim() || undefined;
}
function getFrom(): string | undefined {
  return getRuntimeEnv("RESEND_FROM")?.trim() || undefined;
}

export function isResendConfigured(): boolean {
  return Boolean(getKey() && getFrom());
}

/**
 * Send one email. Returns ok:false if env missing (caller may treat as misconfiguration).
 */
export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const key = getKey();
  const from = getFrom();
  if (!key || !from) {
    console.error("[resend] RESEND_API_KEY or RESEND_FROM not set — email not sent");
    return { ok: false, error: "resend_not_configured" };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
      statusCode?: number;
    };

    if (!res.ok) {
      const msg =
        typeof data?.message === "string"
          ? data.message
          : `resend_http_${res.status}`;
      console.error(`[resend] send failed to=${opts.to} status=${res.status} error=${msg} body=${JSON.stringify(data)}`);
      return { ok: false, error: msg };
    }

    console.log(`[resend] sent to=${opts.to} id=${data.id ?? "?"} from=${from}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch_failed";
    console.error(`[resend] fetch error to=${opts.to}: ${message}`);
    return { ok: false, error: message };
  }
}

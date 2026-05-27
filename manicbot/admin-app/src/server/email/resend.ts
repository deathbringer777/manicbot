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
import { log } from "~/server/utils/logger";

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
 *
 * #P1-5 — `text` is now an optional plain-text alternative. Resend serves
 * the `text` part alongside `html` so MUAs that prefer text/plain (corporate
 * filters, accessibility tools) get a real text payload instead of falling
 * back to a tag-stripped HTML rendering. Templates that ship a `text` body
 * should pass it here; everything else continues to be HTML-only.
 *
 * 0090 — `headers` is an optional map of additional message headers to
 * include in the Resend payload. First consumer is the newsletter welcome
 * (`List-Unsubscribe` + `List-Unsubscribe-Post` for RFC 8058 one-click).
 */
export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<SendEmailResult> {
  const key = getKey();
  const from = getFrom();
  if (!key || !from) {
    log.warn("resend.email", { message: "RESEND_API_KEY or RESEND_FROM not set — email not sent" });
    return { ok: false, error: "resend_not_configured" };
  }

  try {
    const body: Record<string, unknown> = {
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    };
    if (opts.text) body.text = opts.text;
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      body.headers = opts.headers;
    }
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
      log.error("resend.email", new Error(msg), { status: res.status });
      return { ok: false, error: msg };
    }

    log.info("resend.email", { messageId: data.id, from });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch_failed";
    log.error("resend.email", e instanceof Error ? e : new Error(message));
    return { ok: false, error: message };
  }
}

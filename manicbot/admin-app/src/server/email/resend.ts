/**
 * Transactional email via Resend HTTP API (Edge-safe fetch).
 * https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API = "https://api.resend.com/emails";

export type SendEmailResult = { ok: true } | { ok: false; error: string };

export function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim(),
  );
}

/**
 * Send one email. Returns ok:false if env missing (caller may treat as misconfiguration).
 */
export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!key || !from) {
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
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      const msg =
        typeof data?.message === "string"
          ? data.message
          : `resend_http_${res.status}`;
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch_failed";
    return { ok: false, error: message };
  }
}

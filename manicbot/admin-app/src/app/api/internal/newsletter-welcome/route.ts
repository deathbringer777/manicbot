/**
 * POST /api/internal/newsletter-welcome — internal endpoint called by the
 * Worker (manicbot/src/http/subscribeHttp.js) after a new row lands in
 * `newsletter_subscribers`. Resend lives only in admin-app, so the Worker
 * cannot send the email directly — it hands off via this Bearer-authed route.
 *
 * Auth: `Authorization: Bearer <INTERNAL_API_TOKEN>` (Pages env var, same
 * value as the Worker secret). On mismatch / missing → 401. Constant-time
 * comparison via `processNewsletterWelcomeRequest`.
 *
 * On success → 200, body stamped with `welcome_sent_at`.
 * On send failure → 500, body stamped with `welcome_send_error`.
 *
 * Per-call cost = one Resend POST + one D1 UPDATE. The handler runs at the
 * edge (Next.js edge runtime).
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "~/server/db";
import { newsletterSubscribers } from "~/server/db/schema";
import { sendNewsletterWelcomeEmail } from "~/server/email/emailService";
import { log } from "~/server/utils/logger";
import { processNewsletterWelcomeRequest } from "~/server/newsletter/processWelcomeRequest";

export const runtime = "edge";

export async function POST(req: Request) {
  const expectedToken = process.env.INTERNAL_API_TOKEN ?? null;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const db = getDb();
  const result = await processNewsletterWelcomeRequest({
    authorizationHeader: req.headers.get("authorization"),
    body,
    expectedToken,
    sendEmail: (email, lang) => sendNewsletterWelcomeEmail(email, lang),
    stampSentAt: async (email, nowSec) => {
      await db
        .update(newsletterSubscribers)
        .set({ welcomeSentAt: nowSec, welcomeSendError: null })
        .where(eq(newsletterSubscribers.email, email));
    },
    stampSendError: async (email, errorText) => {
      await db
        .update(newsletterSubscribers)
        .set({ welcomeSendError: errorText.slice(0, 500) })
        .where(eq(newsletterSubscribers.email, email));
    },
  });

  if (result.status === 401) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (result.status === 400) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (result.status === 500) {
    log.error("api.newsletter-welcome", new Error(result.error));
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

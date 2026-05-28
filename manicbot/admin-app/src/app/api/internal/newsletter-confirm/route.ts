/**
 * POST /api/internal/newsletter-confirm — internal endpoint called by the
 * Worker `subscribeHttp.js dispatchConfirmEmail` after a new row lands in
 * `newsletter_subscribers`. Sends the DOI confirm-click email via Resend.
 *
 * Auth: `Authorization: Bearer <INTERNAL_API_TOKEN>` (Pages env var, same
 * value as the Worker secret). On mismatch / missing → 401. Constant-time
 * comparison via `processNewsletterConfirmRequest`.
 *
 * On success → 200. On send failure → 500, `welcome_send_error` stamped
 * (the column is reused for both confirm and welcome dispatch errors —
 * one row, one error bucket).
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "~/server/db";
import { newsletterSubscribers } from "~/server/db/schema";
import { sendNewsletterConfirmEmail } from "~/server/email/emailService";
import { log } from "~/server/utils/logger";
import { processNewsletterConfirmRequest } from "~/server/newsletter/processConfirmRequest";

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
  const result = await processNewsletterConfirmRequest({
    authorizationHeader: req.headers.get("authorization"),
    body,
    expectedToken,
    sendEmail: (email, lang, confirmToken) => sendNewsletterConfirmEmail(email, lang, confirmToken),
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
    log.error("api.newsletter-confirm", new Error(result.error));
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

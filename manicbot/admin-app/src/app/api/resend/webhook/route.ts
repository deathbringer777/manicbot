/**
 * Resend webhook handler — bounce / complaint / delivered events.
 *
 * When Resend reports a hard bounce or spam complaint, add the email to the
 * suppression list so we stop sending to it. Prevents the Resend domain
 * reputation from tanking.
 *
 * Signature verification uses Resend's Svix-compatible webhook signing.
 * Expects RESEND_WEBHOOK_SECRET env var in the admin-app Pages project.
 */

import { NextResponse } from "next/server";
import { getDb } from "~/server/db";
import { emailSuppressions } from "~/server/db/schema";
import { sql } from "drizzle-orm";
import { log } from "~/server/utils/logger";

export const runtime = "edge";

interface ResendEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    to?: string | string[];
    from?: string;
    bounce?: { type?: string; message?: string };
    complaint?: { type?: string };
  };
}

async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const secretBytes = secret.startsWith("whsec_")
    ? Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(secret);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Header format: "v1,<base64> v1,<base64> ..." — any match is valid.
  for (const part of svixSignature.split(" ")) {
    const [, received] = part.split(",");
    if (received && timingSafeStrEq(expected, received)) return true;
  }
  return false;
}

function timingSafeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  const rawBody = await req.text();
  const valid = await verifySvixSignature(rawBody, req.headers, secret);
  if (!valid) return new Response("Invalid signature", { status: 403 });

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const type = event.type;
  const recipients = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to];
  const now = Math.floor(Date.now() / 1000);

  // Hard bounce or complaint → suppress
  const shouldSuppress =
    type === "email.bounced" ||
    type === "email.complained" ||
    type === "email.delivery_delayed"; // optional: delayed repeatedly → suppress

  if (shouldSuppress) {
    const db = getDb();
    for (const addr of recipients.filter(Boolean) as string[]) {
      try {
        await db
          .insert(emailSuppressions)
          .values({
            email: addr.toLowerCase(),
            reason: type,
            source: "resend",
            suppressedAt: now,
            detail: JSON.stringify(event.data).slice(0, 500),
          })
          .onConflictDoUpdate({
            target: emailSuppressions.email,
            set: {
              reason: sql`excluded.reason`,
              suppressedAt: sql`excluded.suppressed_at`,
              detail: sql`excluded.detail`,
            },
          });
      } catch (e) {
        log.error("resend-webhook.suppress", e instanceof Error ? e : new Error(String((e as Error).message)), { email: addr });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

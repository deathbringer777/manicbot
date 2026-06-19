/**
 * Resend webhook handler — bounce / complaint / delivered / opened / clicked
 * events. Closes the loop on `marketing_sends` so the dashboard sees real
 * delivery status, not just "we handed it to Resend".
 *
 * The pure-function event matrix lives in
 * `~/server/marketing/webhooks/processResendEvent.ts` so the mapping is
 * unit-testable without a DB. This handler is the I/O wrapper:
 *   1. Verify Svix signature (Resend uses Svix-compatible signing).
 *   2. Parse + dispatch to `processResendEvent`.
 *   3. Apply `sendUpdate` to `marketing_sends` (last-write-wins on status,
 *      timestamps idempotent via COALESCE so retries can't clobber).
 *   4. Apply `suppress` to `email_suppressions` (existing reputation guard).
 *
 * `RESEND_WEBHOOK_SECRET` env var (Pages secret) is required. Without it
 * the endpoint returns 503 — never accept unsigned events.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "~/server/db";
import { emailSuppressions } from "~/server/db/schema";
import { log } from "~/server/utils/logger";
import { getRuntimeEnv } from "~/server/runtimeEnv";
import {
  processResendEvent,
  isSvixTimestampFresh,
  type ResendEvent,
} from "~/server/marketing/webhooks/processResendEvent";

export const runtime = "edge";

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
  const secret = getRuntimeEnv("RESEND_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  // Replay protection: Svix's standard ±5 min freshness window. A captured
  // webhook (valid signature, old timestamp) must not be re-playable later.
  if (!isSvixTimestampFresh(req.headers.get("svix-timestamp"), Math.floor(Date.now() / 1000))) {
    return new Response("Stale timestamp", { status: 403 });
  }

  const rawBody = await req.text();
  const valid = await verifySvixSignature(rawBody, req.headers, secret);
  if (!valid) return new Response("Invalid signature", { status: 403 });

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const result = processResendEvent(event, now);
  const db = getDb();

  // 1) marketing_sends update — closes the delivery-status loop.
  if (result.sendUpdate) {
    const u = result.sendUpdate;
    try {
      // Use COALESCE on timestamp columns so duplicate/retry webhooks
      // don't clobber the original timestamp. Status promotion rule:
      // terminal states (bounced / complained / failed) always win;
      // otherwise the new status overwrites. Webhooks usually arrive
      // in chronological order so this is monotonic enough in practice.
      await db.run(sql`
        UPDATE marketing_sends
        SET
          status = CASE
            WHEN ${u.set.status ?? null} IN ('bounced', 'complained', 'failed')
              THEN ${u.set.status ?? null}
            WHEN status IN ('bounced', 'complained', 'failed')
              THEN status
            ELSE COALESCE(${u.set.status ?? null}, status)
          END,
          delivered_at  = COALESCE(delivered_at,  ${u.set.deliveredAt ?? null}),
          opened_at     = COALESCE(opened_at,     ${u.set.openedAt ?? null}),
          clicked_at    = COALESCE(clicked_at,    ${u.set.clickedAt ?? null}),
          bounced_at    = COALESCE(bounced_at,    ${u.set.bouncedAt ?? null}),
          complained_at = COALESCE(complained_at, ${u.set.complainedAt ?? null})
        WHERE provider_message_id = ${u.providerMessageId}
      `);
    } catch (e) {
      log.error(
        "resend-webhook.marketingSends",
        e instanceof Error ? e : new Error(String((e as Error).message)),
        { providerMessageId: u.providerMessageId, outcome: result.outcome },
      );
    }
  }

  // 2) email_suppressions insert — hard bounce / complaint / delayed.
  if (result.suppress) {
    const s = result.suppress;
    for (const addr of s.emails) {
      try {
        await db
          .insert(emailSuppressions)
          .values({
            email: addr,
            reason: s.reason,
            source: "resend",
            suppressedAt: now,
            detail: s.detail,
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
        log.error(
          "resend-webhook.suppress",
          e instanceof Error ? e : new Error(String((e as Error).message)),
          { email: addr, outcome: result.outcome },
        );
      }
    }
  }

  return NextResponse.json({ ok: true, outcome: result.outcome });
}

/**
 * Build a stable unsubscribe URL for a marketing contact.
 *
 * Generates an `unsubscribe_token` (32 random hex chars) on first use and
 * persists it to `marketing_contacts.unsubscribe_token`. The token is the
 * public-facing key on `GET /u/:token` (served by the Worker).
 *
 * Public origin resolution order:
 *   1. `WORKER_PUBLIC_URL` env (admin-app deploy)
 *   2. fallback `https://manicbot.com`
 */

import { eq } from "drizzle-orm";
import { marketingContacts } from "~/server/db/schema";
import { getRuntimeEnv } from "~/server/runtimeEnv";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

const FALLBACK_ORIGIN = "https://manicbot.com";

function publicOrigin(): string {
  const v = getRuntimeEnv("WORKER_PUBLIC_URL") || getRuntimeEnv("NEXT_PUBLIC_BASE_URL");
  if (!v) return FALLBACK_ORIGIN;
  return v.replace(/\/+$/, "");
}

function generateToken(): string {
  // Web Crypto is available on Edge / Node 19+.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Returns `https://<origin>/u/<token>`. If the contact has no token yet,
 * we generate one and persist it. Pass `existingToken` to skip the DB hit
 * if the caller already loaded it.
 */
export async function ensureUnsubscribeToken(
  db: DbInstance,
  contactId: number,
  existingToken?: string | null,
): Promise<string> {
  if (existingToken && existingToken.length >= 16) return existingToken;
  const token = generateToken();
  await db
    .update(marketingContacts)
    .set({ unsubscribeToken: token })
    .where(eq(marketingContacts.id, contactId));
  return token;
}

export function buildUnsubscribeUrl(token: string): string {
  return `${publicOrigin()}/u/${token}`;
}

/**
 * Convenience: get-or-create the token, then return the full URL.
 */
export async function getUnsubscribeUrl(
  db: DbInstance,
  contactId: number,
  existingToken?: string | null,
): Promise<string> {
  const t = await ensureUnsubscribeToken(db, contactId, existingToken);
  return buildUnsubscribeUrl(t);
}

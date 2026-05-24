/**
 * Pure-function newsletter welcome processor — extracted so the API route
 * is testable without spinning up a Next.js Request/Response harness.
 *
 * Flow:
 *   1. Constant-time-compare the Bearer token against env.INTERNAL_API_TOKEN.
 *   2. Parse + validate `{ email, lang }` from the JSON body.
 *   3. Call the supplied `sendEmail` (real: sendNewsletterWelcomeEmail; tests:
 *      a vi.fn that records the call).
 *   4. On success, run the supplied `updateRow` to stamp `welcome_sent_at`.
 *   5. Return a structured `{ status, body? }` so the route wrapper can
 *      turn it into a NextResponse.
 *
 * No I/O lives here — that's the route wrapper's job. This is the unit
 * test surface.
 */

import type { Lang } from "~/lib/i18n";
import type { SendEmailResult } from "~/server/email/resend";

export type ProcessWelcomeResult =
  | { status: 200; sent: true }
  | { status: 401 }
  | { status: 400 }
  | { status: 500; error: string };

export interface ProcessWelcomeInput {
  authorizationHeader: string | null;
  body: unknown;
  expectedToken: string | null;
  sendEmail: (email: string, lang: Lang) => Promise<SendEmailResult>;
  stampSentAt: (email: string, nowSec: number) => Promise<void>;
  stampSendError: (email: string, error: string) => Promise<void>;
  now?: () => number;
}

const ALLOWED_LANGS: ReadonlySet<Lang> = new Set(["ru", "ua", "en", "pl"]);
const MAX_EMAIL_LEN = 254;
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@.]+\.[^\s@]{2,}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Constant-time string comparison. Identical to the helper used by the
 * Resend webhook signature checker — copied locally to keep this module
 * dependency-free for unit tests.
 */
function timingSafeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/);
  const token = m?.[1];
  return token ? token.trim() : null;
}

export async function processNewsletterWelcomeRequest(
  input: ProcessWelcomeInput,
): Promise<ProcessWelcomeResult> {
  if (!input.expectedToken) {
    // Env unset — return 401 (NOT 503) so a misconfigured Pages deploy
    // looks the same as a stolen Worker token. Distinguishing them would
    // help an attacker probe deploy state.
    return { status: 401 };
  }
  const bearer = extractBearer(input.authorizationHeader);
  if (!bearer || !timingSafeStrEq(bearer, input.expectedToken)) {
    return { status: 401 };
  }

  if (!isPlainObject(input.body)) {
    return { status: 400 };
  }

  const rawEmail = input.body.email;
  if (typeof rawEmail !== "string" || rawEmail.length > MAX_EMAIL_LEN) {
    return { status: 400 };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return { status: 400 };
  }

  const rawLang = input.body.lang;
  const lang: Lang =
    typeof rawLang === "string" && ALLOWED_LANGS.has(rawLang as Lang)
      ? (rawLang as Lang)
      : "en";

  try {
    const result = await input.sendEmail(email, lang);
    if (!result.ok) {
      const err = result.error ?? "send_failed";
      await input.stampSendError(email, err);
      return { status: 500, error: err };
    }
    const now = Math.floor((input.now?.() ?? Date.now()) / 1000);
    await input.stampSentAt(email, now);
    return { status: 200, sent: true };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    await input.stampSendError(email, msg).catch(() => undefined);
    return { status: 500, error: msg };
  }
}

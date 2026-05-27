/**
 * Pure-function newsletter DOI-confirm processor (migration 0092).
 *
 * Mirror of `processWelcomeRequest` but for the FIRST email that goes out
 * on POST /api/subscribe — the confirm-click message. The Worker dispatches
 * here with `{ email, lang, confirmToken }`; we validate inputs, ask the
 * supplied `sendEmail` to mint and send the confirm-click email, then
 * return a `{ status, body? }` shape the route wrapper can convert to a
 * NextResponse.
 *
 * No I/O lives in this module — the route wrapper does that. Keeping this
 * file pure makes it the unit-test surface and lets the integration test
 * inject a vi.fn for `sendEmail`.
 */

import type { Lang } from "~/lib/i18n";
import type { SendEmailResult } from "~/server/email/resend";

export type ProcessConfirmResult =
  | { status: 200; sent: true }
  | { status: 401 }
  | { status: 400 }
  | { status: 500; error: string };

export interface ProcessConfirmInput {
  authorizationHeader: string | null;
  body: unknown;
  expectedToken: string | null;
  sendEmail: (email: string, lang: Lang, confirmToken: string) => Promise<SendEmailResult>;
  stampSendError: (email: string, error: string) => Promise<void>;
}

const ALLOWED_LANGS: ReadonlySet<Lang> = new Set(["ru", "ua", "en", "pl"]);
const MAX_EMAIL_LEN = 254;
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@.]+\.[^\s@]{2,}$/;
const TOKEN_SHAPE_RE = /^[a-f0-9]{32,64}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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

export async function processNewsletterConfirmRequest(
  input: ProcessConfirmInput,
): Promise<ProcessConfirmResult> {
  if (!input.expectedToken) return { status: 401 };
  const bearer = extractBearer(input.authorizationHeader);
  if (!bearer || !timingSafeStrEq(bearer, input.expectedToken)) {
    return { status: 401 };
  }

  if (!isPlainObject(input.body)) return { status: 400 };

  const rawEmail = input.body.email;
  if (typeof rawEmail !== "string" || rawEmail.length > MAX_EMAIL_LEN) {
    return { status: 400 };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) return { status: 400 };

  const rawToken = (input.body as { confirmToken?: unknown }).confirmToken;
  if (typeof rawToken !== "string" || !TOKEN_SHAPE_RE.test(rawToken)) {
    return { status: 400 };
  }

  const rawLang = input.body.lang;
  const lang: Lang =
    typeof rawLang === "string" && ALLOWED_LANGS.has(rawLang as Lang)
      ? (rawLang as Lang)
      : "en";

  try {
    const result = await input.sendEmail(email, lang, rawToken);
    if (!result.ok) {
      const err = result.error ?? "send_failed";
      await input.stampSendError(email, err);
      return { status: 500, error: err };
    }
    return { status: 200, sent: true };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    await input.stampSendError(email, msg).catch(() => undefined);
    return { status: 500, error: msg };
  }
}

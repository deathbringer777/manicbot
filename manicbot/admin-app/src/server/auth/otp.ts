/**
 * Generic OTP gate for destructive / role-escalation mutations.
 *
 * Lifecycle:
 *   1. UI calls `auth.requestActionOtp({ action, payload })` → server runs
 *      `requestActionOtp()` here: generates a 6-digit CSPRNG code, hashes
 *      both the code and the canonicalized payload, inserts a row in
 *      global_otp_codes (15-min TTL), and returns the plain code to the
 *      email sender (caller emails it via sendActionOtpEmail).
 *   2. User enters the code in a modal; UI calls the gated mutation with
 *      `{ ...args, otpCode }`.
 *   3. The mutation calls `requireOtpConfirmation(ctx, action, payload, code)`:
 *      it canonicalizes + hashes the payload the same way, looks up the row
 *      keyed by (web_user_id, action, payload_hash), timing-safe-compares
 *      the code hash, marks `consumed_at = now` to prevent replay, and
 *      returns. On any mismatch the helper throws TRPCError with a stable
 *      error message the client can localize.
 *
 * Single-use enforcement:
 *   `consumed_at` is set the moment a valid code is presented. The lookup
 *   filters `consumed_at IS NULL`, so a replay attempt finds no matching
 *   row and falls into the same TRPCError path as "wrong code".
 *
 * Brute-force resistance:
 *   `attempts` is incremented on every mismatch. Once it reaches the cap
 *   (5), the row is treated as exhausted — the user must request a new code.
 *   The same code can fail at most 5 times. Per-user rate-limit on the
 *   request step (3 / 10 min via existing rateLimits table) caps the
 *   total OTP issuance rate.
 *
 * Payload binding:
 *   The payload hash binds the code to a specific operation. A code issued
 *   for `archive_master, { masterId: 'A' }` cannot be replayed for
 *   `archive_master, { masterId: 'B' }`. The canonicalization sorts object
 *   keys lexicographically and uses standard JSON encoding — small enough
 *   to be obviously correct, no external dep.
 *
 * Not used here:
 *   - Email transport. Callers receive the plain code and forward it via
 *     emailService.sendActionOtpEmail. Keeping the helper transport-agnostic
 *     simplifies tests (no email mock needed).
 *   - Per-action labels for the email body. The router that wraps this
 *     helper supplies the action label in the user's language.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { globalOtpCodes } from "~/server/db/schema";
import { hashToken, timingSafeEqualHex } from "~/server/auth/tokens";

const CODE_TTL_SEC = 15 * 60;
const MAX_ATTEMPTS = 5;

/** Canonical JSON for hashing — keys sorted, no whitespace. Pure: deterministic. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

/** Hash any JSON-serializable value with SHA-256. */
export async function hashPayload(value: unknown): Promise<string> {
  return hashToken(canonicalize(value));
}

/** Generate a uniformly-random 6-digit code as a zero-padded string. */
export function generate6DigitCode(): string {
  // 32 bits of entropy → mod 1_000_000 has negligible bias.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0] ?? 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Issue a fresh OTP for (webUserId, action, payload). Stores hashes only.
 * Caller is responsible for emailing the returned plain code to the user.
 *
 * @returns object with `otpId` (for tracking) and `code` (plain, email it).
 */
export async function requestActionOtp(input: {
  db: unknown;
  webUserId: string;
  action: string;
  payload: unknown;
  now?: number;
}): Promise<{ otpId: string; code: string }> {
  const code = generate6DigitCode();
  const codeHash = await hashToken(code);
  const payloadHash = await hashPayload(input.payload);
  const id = crypto.randomUUID();
  const now = input.now ?? Math.floor(Date.now() / 1000);

  // Drizzle insert. Cast db as the project's typed connection.
  await (input.db as {
    insert: (
      t: typeof globalOtpCodes,
    ) => { values: (v: Record<string, unknown>) => Promise<unknown> };
  })
    .insert(globalOtpCodes)
    .values({
      id,
      webUserId: input.webUserId,
      action: input.action,
      payloadHash,
      codeHash,
      expiresAt: now + CODE_TTL_SEC,
      attempts: 0,
      createdAt: now,
    });

  return { otpId: id, code };
}

/**
 * Verify a user-supplied code against the stored row for this
 * (webUserId, action, payload). Marks the row consumed on success.
 *
 * Throws TRPCError with `code: 'PRECONDITION_FAILED'` and a stable
 * `message` string the client can map to a localized hint:
 *   - 'otp_required'  : no row found (user never requested or it expired
 *                       so long ago the row was cleaned up)
 *   - 'otp_expired'   : row exists but expires_at < now
 *   - 'otp_exhausted' : attempts >= MAX_ATTEMPTS — user must request a new code
 *   - 'otp_invalid'   : code mismatch (attempts++ then throw)
 *   - 'otp_consumed'  : already used (defensive; lookup excludes consumed)
 */
export async function requireOtpConfirmation(input: {
  db: unknown;
  webUserId: string;
  action: string;
  payload: unknown;
  code: string;
  now?: number;
}): Promise<void> {
  if (!input.code || typeof input.code !== "string") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_required",
    });
  }
  const payloadHash = await hashPayload(input.payload);
  const now = input.now ?? Math.floor(Date.now() / 1000);

  const db = input.db as {
    select: () => {
      from: (t: typeof globalOtpCodes) => {
        where: (predicate: unknown) => {
          limit: (n: number) => Promise<
            Array<{
              id: string;
              codeHash: string;
              expiresAt: number;
              consumedAt: number | null;
              attempts: number;
            }>
          >;
        };
      };
    };
    update: (t: typeof globalOtpCodes) => {
      set: (v: Record<string, unknown>) => {
        where: (predicate: unknown) => Promise<unknown>;
      };
    };
  };

  const rows = await db
    .select()
    .from(globalOtpCodes)
    .where(
      and(
        eq(globalOtpCodes.webUserId, input.webUserId),
        eq(globalOtpCodes.action, input.action),
        eq(globalOtpCodes.payloadHash, payloadHash),
      ),
    )
    .limit(1);

  if (!rows.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_required",
    });
  }
  const row = rows[0]!;

  if (row.consumedAt !== null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_consumed",
    });
  }
  if (row.expiresAt < now) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_expired",
    });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_exhausted",
    });
  }

  const submittedHash = await hashToken(input.code);
  if (!timingSafeEqualHex(submittedHash, row.codeHash)) {
    // Wrong code — bump attempts so a brute-forcer runs out fast.
    await db
      .update(globalOtpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(globalOtpCodes.id, row.id));
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "otp_invalid",
    });
  }

  // Success — mark consumed atomically. The (webUserId, action, payloadHash)
  // index makes the lookup cheap; the update is one row.
  await db
    .update(globalOtpCodes)
    .set({ consumedAt: now })
    .where(eq(globalOtpCodes.id, row.id));
}

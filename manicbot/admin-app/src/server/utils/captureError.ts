/**
 * Admin-app mirror of the Worker's `captureError` (manicbot/src/utils/errorCapture.js).
 *
 * Writes to D1 `error_events` so failures inside admin-app tRPC procedures
 * surface in the God Mode `/errors` dashboard alongside Worker captures.
 *
 * Contract:
 *   - Best-effort. Never throws — D1 hiccups must not break the calling mutation.
 *   - One row per (fingerprint, tenant_id) — same semantics as the Worker helper.
 *     Existing row → UPDATE count / last_seen + status-aware regression flip.
 *     Missing row  → INSERT a fresh `status='open'` row.
 *   - PII stripping: tokens, bearer headers, API keys masked from message + stack
 *     before persistence (defense-in-depth — callers should not pass raw secrets,
 *     but we redact anyway).
 *
 * Source bucket is always `"admin-app"` — surfaces the writer in the dashboard
 * source filter without callers having to repeat it.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { errorEvents } from "~/server/db/schema";
import type { getDb } from "~/server/db";
import { log } from "~/server/utils/logger";

export type Db = ReturnType<typeof getDb>;

export type CaptureSeverity = "warning" | "error" | "fatal";

export interface CaptureErrorInput {
  /** Required. Short slug like `email.transport_failed` — drives Drizzle queries on `error_type`. */
  errorType: string;
  /** Required. Human-readable summary, capped at 2000 chars. */
  message: string;
  /** Defaults to `"error"`. */
  severity?: CaptureSeverity;
  /** Optional tenant scope. Null for platform-wide errors. */
  tenantId?: string | null;
  /** Optional acting user id (for support escalation). */
  userId?: string | null;
  /** Optional path / route — e.g. tRPC procedure name. */
  path?: string | null;
  /** Optional JSON-serialisable context. Capped at 4000 chars after stringify. */
  context?: Record<string, unknown> | null;
  /** Optional pre-computed fingerprint. When omitted, derived from errorType+message+path. */
  fingerprint?: string;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_CONTEXT_LEN = 4000;
const MAX_PATH_LEN = 500;
const MAX_ERROR_TYPE_LEN = 64;

// Order matters — more specific patterns first so generic hex doesn't shadow them.
const PII_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\d{6,}:[A-Za-z0-9_-]{30,}/g, replace: "[REDACTED_TG_TOKEN]" },
  { re: /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: "Bearer [REDACTED_BEARER]" },
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: "[REDACTED_API_KEY]" },
  { re: /\bre_[A-Za-z0-9]{16,}\b/g, replace: "[REDACTED_API_KEY]" },
];

function stripPII(text: string): string {
  let out = text;
  for (const { re, replace } of PII_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

function bound(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * FNV-1a 32-bit hex — deterministic, dependency-free.
 * Same algorithm as the Worker helper so cross-source dedup works when an
 * issue surfaces in both Worker and admin-app contexts.
 */
function fingerprintHash(parts: Array<string | null | undefined>): string {
  const input = parts.filter((p) => p != null).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Capture an admin-app error into `error_events`. Returns silently on any
 * D1 failure — caller's primary mutation must not break because the
 * sidecar audit row failed.
 *
 * @returns `{ ok, id?, regressed? }` — `id` is the row id, `regressed` true
 * when this fire reopened a previously resolved row.
 */
export async function captureError(
  db: Db,
  input: CaptureErrorInput,
): Promise<{ ok: boolean; id?: number; regressed?: boolean }> {
  if (!db) return { ok: false };
  if (!input.errorType || !input.message) return { ok: false };

  const now = Math.floor(Date.now() / 1000);
  const severity = input.severity ?? "error";
  const errorType = bound(input.errorType, MAX_ERROR_TYPE_LEN);
  const message = bound(stripPII(input.message), MAX_MESSAGE_LEN);
  const path = input.path ? bound(input.path, MAX_PATH_LEN) : null;
  const tenantId = input.tenantId ?? null;
  const userId = input.userId ?? null;
  const fingerprint = input.fingerprint ?? fingerprintHash([errorType, message, path]);

  let contextJson: string | null = null;
  if (input.context) {
    try {
      const raw = JSON.stringify(input.context);
      contextJson = bound(stripPII(raw), MAX_CONTEXT_LEN);
    } catch {
      // Non-serialisable context — drop silently.
      contextJson = null;
    }
  }

  try {
    // One row per (fingerprint, tenant_id). tenant_id NULL is a distinct
    // bucket from any concrete tenant — handled by the IS NULL branch.
    const existing = await db
      .select({
        id: errorEvents.id,
        status: errorEvents.status,
        count: errorEvents.count,
      })
      .from(errorEvents)
      .where(
        and(
          eq(errorEvents.fingerprint, fingerprint),
          tenantId === null ? isNull(errorEvents.tenantId) : eq(errorEvents.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      const inserted = await db
        .insert(errorEvents)
        .values({
          fingerprint,
          source: "admin-app",
          severity,
          message,
          path,
          tenantId,
          userId,
          context: contextJson,
          errorType,
          title: message.slice(0, 200),
          count: 1,
          firstSeen: now,
          lastSeen: now,
          createdAt: now,
          status: "open",
          environment: "production",
          usersAffected: 1,
        })
        .returning({ id: errorEvents.id });
      return { ok: true, id: inserted[0]?.id };
    }

    const row = existing[0]!;
    // Status-aware fire:
    //   - open / snoozed → bump count + last_seen
    //   - resolved → flip back to open (regression)
    //   - ignored  → bump count, never reopen
    const wasResolved = row.status === "resolved";
    await db
      .update(errorEvents)
      .set({
        count: row.count + 1,
        lastSeen: now,
        message,
        path,
        context: contextJson,
        errorType,
        status:
          row.status === "resolved" || (row.status === "snoozed" )
            ? "open"
            : row.status,
        resolvedAt: row.status === "resolved" ? null : undefined,
        snoozeUntil: row.status === "snoozed" ? null : undefined,
      })
      .where(eq(errorEvents.id, row.id));
    return { ok: true, id: row.id, regressed: wasResolved };
  } catch (e) {
    log.warn(
      "captureError.write_failed",
      e instanceof Error
        ? { message: e.message, errorType }
        : { raw: String(e), errorType },
    );
    return { ok: false };
  }
}

/**
 * Build a stable fingerprint without going through `captureError`. Useful
 * for tests + callers that want to dedup their own error families.
 */
export function buildFingerprint(parts: Array<string | null | undefined>): string {
  return fingerprintHash(parts);
}

/**
 * Defensive sql tag re-export — keeps Drizzle's `sql` import noise at the
 * top of files that only consume `captureError`. Not used by this module
 * but exported so callers don't need a second drizzle-orm import for
 * trivial uses.
 */
export { sql };

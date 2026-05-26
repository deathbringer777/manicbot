/**
 * notifyOrCapture — guarded wrapper around `notifyWebUser`.
 *
 * Solves two problems that the bare `notifyWebUser` doesn't:
 *
 *   1. **Fire-and-forget kills the D1 binding.** On Cloudflare Pages
 *      the request context (and the `env.DB` handle it carries) is
 *      torn down with the response. A `void notifyWebUser(...)` whose
 *      Drizzle insert races past the mutation `return` ends up calling
 *      `.prepare()` on a dead handle → silent throw → caught at the
 *      `notifyWebUser` boundary → `{ ok: false, error: 'db_insert_failed' }`
 *      returned. The caller's `.catch()` never fires because nothing
 *      threw upstream of it. Net effect in production: ZERO rows ever
 *      written to `user_notifications`.
 *
 *      This wrapper is meant to be `await`-ed inline in the mutation
 *      hot path so the insert completes before the response is sent.
 *
 *   2. **Silent `{ ok: false }` returns leave no operator trace.**
 *      `notifyWebUser` catches Drizzle errors and returns a normalized
 *      `{ ok: false, error }` shape. We mirror that into a
 *      `error_events` row via `captureError` so the failure surfaces
 *      in God Mode `/errors` instead of being invisible.
 *
 * Return shape is designed to spread cleanly into a tRPC mutation
 * response:
 *
 *   ```ts
 *   const bell = await notifyOrCapture(ctx.db, payload, opts);
 *   return { ..., ...bell };
 *   // → { ..., bellQueued: true } on the happy path
 *   // → { ..., bellQueued: true, bellSkippedByPrefs: true } on opt-out
 *   // → { ..., bellQueued: false, bellError: "db_insert_failed" } on failure
 *   ```
 *
 * The wrapper itself NEVER throws — `captureError` is wrapped in
 * try/catch so a sidecar D1 failure can never break the caller.
 */
import { captureError } from "~/server/utils/captureError";
import { notifyWebUser, type NotifyWebUserInput, type NotifyWebUserResult } from "~/server/services/notifyWebUser";
import type { getDb } from "~/server/db";
import { log } from "~/server/utils/logger";

export type Db = ReturnType<typeof getDb>;

export interface NotifyOrCaptureOptions {
  /** tRPC procedure / route name. Stored on `error_events.path` for triage. */
  path: string;
  /** Optional acting user id (the caller — NOT the recipient). */
  userId?: string | null;
  /** Extra context merged into the `error_events.context` payload. */
  extraContext?: Record<string, unknown>;
}

export interface NotifyOrCaptureResult {
  bellQueued: boolean;
  bellSkippedByPrefs?: true;
  bellError?: string;
}

/**
 * Run `notifyWebUser`, normalize the result for the mutation response,
 * and write a `notify.bell_write_failed` row to `error_events` on
 * `{ ok: false }` so the operator can see it in God Mode.
 *
 * Guaranteed to never throw — both the notify call and the captureError
 * sidecar are guarded.
 */
export async function notifyOrCapture(
  db: Db,
  payload: NotifyWebUserInput,
  opts: NotifyOrCaptureOptions,
): Promise<NotifyOrCaptureResult> {
  let result: NotifyWebUserResult;
  try {
    result = await notifyWebUser(db, payload);
  } catch (e) {
    // notifyWebUser already swallows its own internal throws, but be
    // defensive in case a future refactor stops doing that — we never
    // want to break the caller.
    log.error(
      "notifyOrCapture.notify_threw",
      e instanceof Error ? e : new Error(String(e)),
    );
    result = { ok: false, id: null, error: "notify_threw" };
  }

  if (result.ok) {
    return {
      bellQueued: true,
      ...(result.skippedByPrefs ? { bellSkippedByPrefs: true as const } : {}),
    };
  }

  const reason = result.error ?? "unknown";
  try {
    await captureError(db, {
      errorType: "notify.bell_write_failed",
      severity: "error",
      message: `Bell write failed (${payload.kind}): ${reason}`,
      tenantId: payload.tenantId ?? null,
      userId: opts.userId ?? null,
      path: opts.path,
      context: {
        webUserId: payload.webUserId,
        kind: payload.kind,
        reason,
        sourceSlug: payload.sourceSlug ?? null,
        sourceId: payload.sourceId ?? null,
        ...opts.extraContext,
      },
    });
  } catch (e) {
    // captureError is best-effort. A D1 hiccup writing the audit row
    // must NEVER break the primary mutation flow.
    log.warn(
      "notifyOrCapture.captureError_failed",
      e instanceof Error
        ? { message: e.message, kind: payload.kind }
        : { raw: String(e), kind: payload.kind },
    );
  }

  return {
    bellQueued: false,
    bellError: reason,
  };
}

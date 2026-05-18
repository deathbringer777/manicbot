/**
 * notifyWebUser — admin-app-side in-app notification writer.
 *
 * Drizzle-based mirror of the Worker `src/services/userNotify.js`. Used by
 * any tRPC procedure that needs to drop a row into `user_notifications`
 * (the platform-wide bell feed). Always idempotent via the partial UNIQUE
 * `(web_user_id, source_slug, source_id, kind)` index on the table — the
 * caller may invoke this on retry without producing duplicates as long as
 * `sourceSlug` + `sourceId` are passed.
 *
 * Pure boundary contract:
 *   - Validates inputs (title <=200 chars, body <=1000 chars).
 *   - Returns the inserted id, or null when dedup short-circuited.
 *   - Never throws — DB failures bubble up as `{ ok:false, error }`.
 */
import { eq } from "drizzle-orm";
import { userNotifications, webUsers } from "~/server/db/schema";
import { getDb } from "~/server/db";
import { log } from "~/server/utils/logger";
import { parsePrefs, shouldDeliver } from "~/lib/notifications/prefs";

export type Db = ReturnType<typeof getDb>;

export interface NotifyWebUserInput {
  webUserId: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  tenantId?: string | null;
  sourceSlug?: string | null;
  sourceId?: string | null;
}

export interface NotifyWebUserResult {
  ok: boolean;
  id: string | null;
  deduped?: boolean;
  /** True when the user opted out of this category (no row written). */
  skippedByPrefs?: boolean;
  error?: string;
}

const TITLE_MAX = 200;
const BODY_MAX = 1000;
const LINK_MAX = 500;

export function buildNotificationId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `n_${now.toString(36)}_${rand}`;
}

export async function notifyWebUser(
  db: Db,
  input: NotifyWebUserInput,
): Promise<NotifyWebUserResult> {
  if (!input.webUserId) return { ok: false, id: null, error: "missing_web_user_id" };
  if (!input.kind) return { ok: false, id: null, error: "missing_kind" };
  if (!input.title) return { ok: false, id: null, error: "missing_title" };

  const title = String(input.title).slice(0, TITLE_MAX);
  const body = input.body ? String(input.body).slice(0, BODY_MAX) : null;
  const link = input.link ? String(input.link).slice(0, LINK_MAX) : null;
  const sourceSlug = input.sourceSlug ?? null;
  const sourceId = input.sourceId ?? null;

  // Respect the user's in-app opt-out. Read prefs first; on any error we
  // fall through to writing — defaults are "deliver everything in-app".
  // Self-test (`support.test`) is always written so the settings UI can
  // confirm delivery even when the user has opted out of the support
  // category for some reason.
  if (input.kind !== "support.test") {
    try {
      const rows = await db
        .select({ raw: webUsers.notificationPrefs })
        .from(webUsers)
        .where(eq(webUsers.id, input.webUserId))
        .limit(1);
      const prefs = parsePrefs(rows[0]?.raw ?? null);
      if (!shouldDeliver(input.kind, prefs, "inapp")) {
        return { ok: true, id: null, skippedByPrefs: true };
      }
    } catch {
      // Swallow — prefs read MUST NOT block a notification write.
    }
  }

  const id = buildNotificationId();
  const createdAt = Math.floor(Date.now() / 1000);

  try {
    const result = await db
      .insert(userNotifications)
      .values({
        id,
        tenantId: input.tenantId ?? null,
        webUserId: input.webUserId,
        kind: input.kind,
        title,
        body,
        link,
        sourceSlug,
        sourceId,
        readAt: null,
        createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: userNotifications.id });

    if (result.length === 0) {
      return { ok: true, id: null, deduped: true };
    }
    return { ok: true, id: result[0]!.id };
  } catch (e) {
    log.error(
      "notifyWebUser.insert",
      e instanceof Error ? e : new Error(String(e)),
    );
    return { ok: false, id: null, error: "db_insert_failed" };
  }
}

/**
 * Fan-out helper: notify many users with the same payload. Each call is
 * independent — failures are isolated, never abort the loop.
 */
export async function notifyManyWebUsers(
  db: Db,
  webUserIds: string[],
  payload: Omit<NotifyWebUserInput, "webUserId">,
): Promise<{ ok: number; deduped: number; failed: number; skippedByPrefs: number }> {
  let ok = 0;
  let deduped = 0;
  let failed = 0;
  let skippedByPrefs = 0;
  for (const webUserId of webUserIds) {
    const r = await notifyWebUser(db, { ...payload, webUserId });
    if (!r.ok) failed++;
    else if (r.skippedByPrefs) skippedByPrefs++;
    else if (r.deduped) deduped++;
    else ok++;
  }
  return { ok, deduped, failed, skippedByPrefs };
}

/**
 * Bell backfill for pending master_invitations.
 *
 * Runs on every `auth.getMyRole` as fire-and-forget. Picks up any
 * pending invitation matching the caller's email and writes a
 * `user_notifications` row (idempotent via the partial UNIQUE on
 * `(web_user_id, source_slug, source_id, kind)`).
 *
 * Why this exists: the send-time write in `salon.sendMasterInvitation`
 * only landed in PR #151. Invites created before that deploy left no
 * bell row, so the recipient saw nothing. The backfill also acts as a
 * safety net for any future race where the send-time write is lost
 * (Resend failure, request abort mid-mutation, etc.). The send path is
 * still primary — backfill is the floor, not the ceiling.
 *
 * Errors are intentionally swallowed: the bell is a UX nicety, but
 * `auth.getMyRole` is on the critical path. We never want a transient
 * D1 hiccup to log a user out.
 */
import { and, eq, gt, sql } from "drizzle-orm";

import { masterInvitations, tenants, webUsers } from "~/server/db/schema";
import { notifyWebUser } from "~/server/services/notifyWebUser";
import type { getDb } from "~/server/db";
import { log } from "~/server/utils/logger";

export type Db = ReturnType<typeof getDb>;

export type Lang = "ru" | "ua" | "en" | "pl";

export interface BackfillResult {
  attempted: number;
}

function copyForLang(lang: Lang, salonName: string): { title: string; body: string } {
  switch (lang) {
    case "ru":
      return {
        title: `Приглашение от салона «${salonName}»`,
        body: "Вас приглашают присоединиться как мастера. Нажмите, чтобы принять.",
      };
    case "ua":
      return {
        title: `Запрошення від салону «${salonName}»`,
        body: "Вас запрошують приєднатися як майстра. Натисніть, щоб прийняти.",
      };
    case "pl":
      return {
        title: `Zaproszenie od salonu „${salonName}"`,
        body: "Zapraszamy Cię do dołączenia jako mistrz. Kliknij, aby zaakceptować.",
      };
    default:
      return {
        title: `Invitation from ${salonName}`,
        body: "You're invited to join as a master. Click to accept.",
      };
  }
}

function normalizeLang(raw: unknown): Lang {
  if (raw === "ru" || raw === "ua" || raw === "pl" || raw === "en") return raw;
  return "en";
}

/**
 * Find pending invitations for the caller's email and surface them in
 * the bell. Idempotent on `(web_user_id, source_slug, source_id, kind)`.
 *
 * @returns Number of `notifyWebUser` calls attempted. Duplicates short
 * circuit inside `notifyWebUser` (no bell row written), but still count
 * as attempted here — the bell is the source of truth for dedup.
 */
export async function backfillPendingInviteNotifications(
  db: Db,
  webUserId: string,
  email: string | null,
  nowUnix: number = Math.floor(Date.now() / 1000),
): Promise<BackfillResult> {
  if (!email) return { attempted: 0 };
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { attempted: 0 };
  if (!webUserId) return { attempted: 0 };

  let rows: Array<{
    invitationId: string;
    tenantId: string;
    tenantName: string | null;
    inviteeLang: string | null;
  }> = [];

  try {
    rows = await db
      .select({
        invitationId: masterInvitations.id,
        tenantId: masterInvitations.tenantId,
        tenantName: tenants.name,
        inviteeLang: webUsers.lang,
      })
      .from(masterInvitations)
      .leftJoin(tenants, eq(tenants.id, masterInvitations.tenantId))
      .leftJoin(webUsers, eq(webUsers.id, webUserId))
      .where(
        and(
          eq(masterInvitations.email, normalized),
          eq(masterInvitations.status, "pending"),
          gt(masterInvitations.tokenExpiresAt, sql`${nowUnix}`),
        ),
      );
  } catch (e) {
    log.warn(
      "backfillPendingInvites.select_failed",
      e instanceof Error ? { message: e.message } : { raw: String(e) },
    );
    return { attempted: 0 };
  }

  if (rows.length === 0) return { attempted: 0 };

  let attempted = 0;
  for (const row of rows) {
    const lang = normalizeLang(row.inviteeLang);
    const salonName = row.tenantName ?? "ManicBot";
    const { title, body } = copyForLang(lang, salonName);

    try {
      await notifyWebUser(db, {
        webUserId,
        kind: "master.invite",
        title,
        body,
        link: `/invitations/${row.invitationId}`,
        tenantId: row.tenantId,
        sourceSlug: "master_invitations",
        sourceId: row.invitationId,
      });
    } catch (e) {
      // Swallow — bell write is never on the critical path.
      log.warn(
        "backfillPendingInvites.notify_failed",
        e instanceof Error
          ? { message: e.message, invitationId: row.invitationId }
          : { raw: String(e), invitationId: row.invitationId },
      );
    }
    attempted++;
  }

  return { attempted };
}

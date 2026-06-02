/**
 * Pending master invitations addressed to a given email.
 *
 * A user can be invited to become a master in another salon. The invitation
 * row (`master_invitations`) is keyed by the recipient's email (stored
 * lowercased at send time — see salon.sendMasterInvitation). This helper
 * surfaces the still-actionable ones so the dashboard can render a sidebar
 * "Invitations" section + count badge.
 *
 * Security: scoped strictly by the CALLER's own email. It never returns
 * invitations addressed to anyone else, so it is safe behind a plain
 * `protectedProcedure` (no tenant guard needed — this is not tenant data).
 *
 * The status='pending' + non-expired filter mirrors
 * backfillPendingInviteNotifications so the bell and the sidebar agree on what
 * counts as "actionable".
 */
import { and, eq, gt, sql } from "drizzle-orm";

import { masterInvitations, tenants } from "~/server/db/schema";
import type { getDb } from "~/server/db";

type Db = ReturnType<typeof getDb>;

export interface PendingInvitation {
  invitationId: string;
  tenantId: string;
  /** Display name of the inviting salon (display_name → name → "ManicBot"). */
  salonName: string;
  createdAt: number;
}

export async function listPendingInvitationsForEmail(
  db: Db,
  args: { email: string | null; nowUnix?: number },
): Promise<PendingInvitation[]> {
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1000);
  if (!args.email) return [];
  const normalized = args.email.trim().toLowerCase();
  if (!normalized) return [];

  const rows = await db
    .select({
      invitationId: masterInvitations.id,
      tenantId: masterInvitations.tenantId,
      tenantName: tenants.name,
      tenantDisplayName: tenants.displayName,
      createdAt: masterInvitations.createdAt,
    })
    .from(masterInvitations)
    .leftJoin(tenants, eq(tenants.id, masterInvitations.tenantId))
    .where(
      and(
        eq(masterInvitations.email, normalized),
        eq(masterInvitations.status, "pending"),
        gt(masterInvitations.tokenExpiresAt, sql`${nowUnix}`),
      ),
    );

  return rows.map((r) => ({
    invitationId: r.invitationId,
    tenantId: r.tenantId,
    salonName: r.tenantDisplayName || r.tenantName || "ManicBot",
    createdAt: r.createdAt,
  }));
}

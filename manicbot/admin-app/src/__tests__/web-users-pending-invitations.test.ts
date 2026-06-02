/**
 * Pending-invitations helper — drives the sidebar "Invitations" section
 * (webUsers.myPendingInvitations) and its count badge.
 *
 * Contract:
 *   - Returns pending master_invitations addressed to the CALLER's own email
 *     (case-insensitive, stored lowercased at send time). Scoped by recipient
 *     email — never leaks invitations addressed to anyone else.
 *   - status='pending' + token_expires_at > now filtering is enforced in SQL
 *     (the same WHERE as backfillPendingInviteNotifications, covered by
 *     auth-backfill-invites.test.ts). The Drizzle mock resolves the chain to
 *     the rows it is given, so these tests pin the email guards + row shaping
 *     (salonName preference, id/createdAt passthrough), not the SQL filter.
 *   - No DB round-trip when the caller has no usable email.
 */
import { describe, it, expect, vi } from "vitest";
import { makeAwaitableChain } from "./helpers/db-mock";
import { listPendingInvitationsForEmail } from "~/server/auth/pendingInvitations";

type SelectMock = ReturnType<typeof vi.fn>;
function dbWithSelect(rows: unknown[]): { db: { select: SelectMock } } {
  return { db: { select: vi.fn(() => makeAwaitableChain(rows)) } };
}

const NOW = 1_700_000_000;

describe("listPendingInvitationsForEmail", () => {
  it("returns [] and does not hit the DB when email is null", async () => {
    const { db } = dbWithSelect([]);
    const out = await listPendingInvitationsForEmail(db as never, { email: null, nowUnix: NOW });
    expect(out).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns [] and does not hit the DB when email is blank/whitespace", async () => {
    const { db } = dbWithSelect([]);
    const out = await listPendingInvitationsForEmail(db as never, { email: "   ", nowUnix: NOW });
    expect(out).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("shapes rows: prefers tenant displayName, passes through ids + createdAt", async () => {
    const rows = [
      { invitationId: "inv_a", tenantId: "t_a", tenantName: "Raw A", tenantDisplayName: "Pretty A", createdAt: 111 },
      { invitationId: "inv_b", tenantId: "t_b", tenantName: "Raw B", tenantDisplayName: null, createdAt: 222 },
    ];
    const { db } = dbWithSelect(rows);
    const out = await listPendingInvitationsForEmail(db as never, { email: "Me@Example.COM", nowUnix: NOW });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { invitationId: "inv_a", tenantId: "t_a", salonName: "Pretty A", createdAt: 111 },
      { invitationId: "inv_b", tenantId: "t_b", salonName: "Raw B", createdAt: 222 },
    ]);
  });

  it("falls back to 'ManicBot' when both tenant names are null", async () => {
    const rows = [
      { invitationId: "inv_c", tenantId: "t_c", tenantName: null, tenantDisplayName: null, createdAt: 333 },
    ];
    const { db } = dbWithSelect(rows);
    const out = await listPendingInvitationsForEmail(db as never, { email: "me@example.com", nowUnix: NOW });
    expect(out[0]!.salonName).toBe("ManicBot");
  });

  it("returns [] when no pending rows match (single SELECT, no leakage)", async () => {
    const { db } = dbWithSelect([]);
    const out = await listPendingInvitationsForEmail(db as never, { email: "nobody@example.com", nowUnix: NOW });
    expect(out).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

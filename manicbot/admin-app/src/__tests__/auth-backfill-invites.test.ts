/**
 * Backfill regression: pending master_invitations that pre-date the
 * 2026-05-17 `salon.sendMasterInvitation` notification wiring (or any
 * future race where the original `notifyWebUser` insert was dropped)
 * MUST surface in the bell on the recipient's next `auth.getMyRole`.
 *
 * Contract:
 *   - One `notifyWebUser` call per active pending invitation matching the
 *     caller's email (case-insensitive).
 *   - `kind='master.invite'`, `sourceSlug='master_invitations'`,
 *     `sourceId=invitationId` — same shape as the send-time write so the
 *     partial UNIQUE on `(web_user_id, source_slug, source_id, kind)`
 *     dedups against any existing row.
 *   - `link=/invitations/{id}` so the bell click lands on the accept page.
 *   - No notification for expired / accepted / revoked rows.
 *   - No-op when caller has no email (anonymous / corrupted session).
 *   - No-op when no pending rows match (the common case — single SELECT).
 *
 * The helper is intentionally pure-ish: it takes a Drizzle `db` + the
 * caller's `webUserId` + `email` + an optional clock, and returns the
 * number of bell writes attempted. Errors do not bubble — the bell
 * backfill is fire-and-forget by design (auth must not fail because of
 * a downstream notification write).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type NotifyArgs = [unknown, Record<string, unknown>];
const notifyWebUserMock = vi.fn<(...args: NotifyArgs) => Promise<{ ok: boolean; id: string }>>(
  async () => ({ ok: true, id: "n_test" }),
);
vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: (...args: NotifyArgs) => notifyWebUserMock(...args),
}));

import { backfillPendingInviteNotifications } from "~/server/auth/backfillPendingInvites";
import { makeAwaitableChain } from "./helpers/db-mock";

type SelectMock = ReturnType<typeof vi.fn>;

function dbWithSelect(rows: unknown[]): { db: { select: SelectMock } } {
  return {
    db: {
      select: vi.fn(() => makeAwaitableChain(rows)),
    },
  };
}

const NOW = 1_700_000_000;

describe("backfillPendingInviteNotifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes one bell entry per pending invitation matching the caller email", async () => {
    const rows = [
      {
        invitationId: "inv_aaa",
        tenantId: "t_one",
        tenantName: "Salon One",
        inviteeLang: "ru",
      },
      {
        invitationId: "inv_bbb",
        tenantId: "t_two",
        tenantName: "Salon Two",
        inviteeLang: "en",
      },
    ];
    const { db } = dbWithSelect(rows);

    const result = await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      "Invitee@Example.COM",
      NOW,
    );

    expect(result.attempted).toBe(2);
    expect(notifyWebUserMock).toHaveBeenCalledTimes(2);

    const firstPayload = notifyWebUserMock.mock.calls[0]![1];
    expect(firstPayload).toMatchObject({
      webUserId: "w_invitee",
      kind: "master.invite",
      sourceSlug: "master_invitations",
      sourceId: "inv_aaa",
      tenantId: "t_one",
      link: "/invitations/inv_aaa",
    });
    expect(typeof firstPayload.title).toBe("string");
    expect((firstPayload.title as string).length).toBeGreaterThan(0);
    // Russian language — title should be in Russian.
    expect(firstPayload.title).toMatch(/Salon One/);

    const secondPayload = notifyWebUserMock.mock.calls[1]![1];
    expect(secondPayload).toMatchObject({
      webUserId: "w_invitee",
      kind: "master.invite",
      sourceSlug: "master_invitations",
      sourceId: "inv_bbb",
      tenantId: "t_two",
      link: "/invitations/inv_bbb",
    });
  });

  it("no-ops when the caller has no email", async () => {
    const { db } = dbWithSelect([]);
    const result = await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      null,
      NOW,
    );
    expect(result.attempted).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });

  it("no-ops when the caller email is blank/whitespace", async () => {
    const { db } = dbWithSelect([]);
    const result = await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      "   ",
      NOW,
    );
    expect(result.attempted).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });

  it("no-ops when no pending invitations match", async () => {
    const { db } = dbWithSelect([]);
    const result = await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      "nobody@example.com",
      NOW,
    );
    expect(result.attempted).toBe(0);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });

  it("swallows notifyWebUser failures — bell write must never break auth", async () => {
    notifyWebUserMock.mockRejectedValueOnce(new Error("boom"));
    const rows = [
      { invitationId: "inv_aaa", tenantId: "t_one", tenantName: "Salon One", inviteeLang: "en" },
    ];
    const { db } = dbWithSelect(rows);

    await expect(
      backfillPendingInviteNotifications(db as never, "w_invitee", "invitee@example.com", NOW),
    ).resolves.toMatchObject({ attempted: 1 });
  });

  it("swallows db errors — bell write must never break auth", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("d1 unavailable");
      }),
    };

    await expect(
      backfillPendingInviteNotifications(db as never, "w_invitee", "invitee@example.com", NOW),
    ).resolves.toMatchObject({ attempted: 0 });
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });

  it("uses Polish copy when inviteeLang='pl'", async () => {
    const rows = [
      { invitationId: "inv_pl", tenantId: "t_pl", tenantName: "Salon Polska", inviteeLang: "pl" },
    ];
    const { db } = dbWithSelect(rows);

    await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      "invitee@example.com",
      NOW,
    );

    const payload = notifyWebUserMock.mock.calls[0]![1];
    expect(payload.title).toMatch(/Salon Polska/);
    expect(payload.title).toMatch(/Zaproszenie|zaprasz/i);
  });

  it("falls back to English copy when inviteeLang is null", async () => {
    const rows = [
      { invitationId: "inv_x", tenantId: "t_x", tenantName: "Salon X", inviteeLang: null },
    ];
    const { db } = dbWithSelect(rows);

    await backfillPendingInviteNotifications(
      db as never,
      "w_invitee",
      "invitee@example.com",
      NOW,
    );

    const payload = notifyWebUserMock.mock.calls[0]![1];
    expect(payload.title).toMatch(/Salon X/);
    expect(payload.title).toMatch(/Invitation from/);
  });
});

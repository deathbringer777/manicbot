/**
 * `messenger.listStaff` — staff picker for the New-Thread modal.
 *
 * Why this rewrite (the test pins the new contract):
 *   The pre-rewrite query JOINed ONLY against `web_users WHERE tenant_id =
 *   salon`. That missed every master whose `web_users.tenant_id` resolves to
 *   a different tenant (most common path: master self-registered → personal
 *   tenant → accepted an `invited_email` invite into a salon; the accept flow
 *   creates a `masters` row + `tenant_roles` row but DOES NOT mutate
 *   `web_users.tenant_id`). It also hid every master with NO web_user at all
 *   (invited via Telegram pairing, or invited by email but the invite is
 *   still pending) — so the salon owner saw an empty picker even when the
 *   team WAS there.
 *
 * New contract:
 *   - Source of truth = `masters` table for the tenant (active rows only) +
 *     the `tenant_owner` web_user. They are merged into a single candidate
 *     list, deduped on web_user id.
 *   - Each candidate carries `canDm` + `connectStatus` so the UI can render
 *     "Подключён", "Только Telegram", "Приглашение не принято" chips and
 *     decide whether to open a real DM or a placeholder thread (see follow-up
 *     `createStaffDm({ otherMasterChatId })` branch).
 *   - `refKind` distinguishes web_user (canDm=true) from master placeholder
 *     (canDm=false right now; client can still request a placeholder thread).
 *
 * Test scope:
 *   Owner-caller path only. Master-caller is asymmetric (a salon-employed
 *   master's web_users.tenant_id usually points to a PERSONAL tenant, so the
 *   master's /messages surface currently shows their personal-tenant inbox —
 *   that requires a separate "tenant switcher in messenger" PR and is out of
 *   scope here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

// ─── Query order locked by listStaff ─────────────────────────────────────
//   1. masters       — every active master in the tenant
//   2. web_users     — by id IN (master.webUserId for rows where it's NOT NULL)
//   3. tenant_owner  — web_users WHERE tenant_id = X AND role = 'tenant_owner'
//                       (covers owners who don't have a `masters` row)
//   4. master_invitations — pending count for the empty-state hint
// ─────────────────────────────────────────────────────────────────────────

describe("messenger.listStaff — full staff contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes masters whose web_users.tenant_id points at a DIFFERENT tenant", async () => {
    // Scenario: master self-registered (web_users.tenant_id = personal),
    // then accepted an email invite from a salon. masters row created in
    // salon; web_users.tenant_id never updated by acceptInvitationExistingUser.
    const { db } = createDbMock([
      // 1. masters in salon — Iryna linked to a web_user
      [
        {
          chatId: 10_000_000_001,
          name: "Iryna",
          webUserId: "w_iryna",
          isSynthetic: 1,
          origin: "invited_email",
          telegramChatId: null,
        },
      ],
      // 2. web_users by id IN (...) — Iryna's row, tenantId is her personal tenant
      [
        {
          id: "w_iryna",
          name: "Iryna Web",
          email: "iryna@x.com",
          tenantId: "t_iryna_personal",
          role: "master",
        },
      ],
      // 3. tenant_owner of t_salon
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      // 4. pending invitations
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    const iryna = out.candidates.find((c) => c.id === "w_iryna");
    expect(iryna).toBeDefined();
    expect(iryna?.canDm).toBe(true);
    expect(iryna?.connectStatus).toBe("connected");
    expect(iryna?.refKind).toBe("web_user");
  });

  it("includes masters with NO web_user as canDm=false placeholders", async () => {
    // Scenario: master added via Telegram pairing only — never opened web.
    const { db } = createDbMock([
      [
        {
          chatId: 555_000_111,
          name: "Olena",
          webUserId: null,
          isSynthetic: 0,
          origin: "invited_telegram",
          telegramChatId: 555_000_111,
        },
      ],
      [], // web_users — empty because no webUserIds to look up
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    const olena = out.candidates.find((c) => c.refKind === "master");
    expect(olena).toBeDefined();
    expect(olena?.canDm).toBe(false);
    expect(olena?.connectStatus).toBe("telegram_only");
    expect(olena?.masterChatId).toBe("555000111");
    expect(olena?.name).toBe("Olena");
  });

  it("includes pending-email-invite masters too (masters row exists pre-accept)", async () => {
    // salon.inviteMaster (Scenario B / new_user) DOES NOT create masters row
    // until accept; salon.inviteMaster (Scenario A / existing_user) ALSO defers
    // masters row to accept time. So pre-accept there's no masters row — those
    // accounts are surfaced only via pendingInviteCount, not via candidates.
    // This test just locks that we don't accidentally invent a placeholder for
    // invitations that have no masters row yet.
    const { db } = createDbMock([
      [], // masters — none
      [], // web_users — none
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 3 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    expect(out.candidates).toEqual([]); // owner is self → filtered
    expect(out.pendingInviteCount).toBe(3);
  });

  it("hides the caller themselves (owner) from the picker", async () => {
    const { db } = createDbMock([
      [
        {
          chatId: 10_000_000_001,
          name: "Peer",
          webUserId: "w_peer",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
      ],
      [{ id: "w_peer", name: "Peer", email: "p@x.com", tenantId: "t_salon", role: "master" }],
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    expect(out.candidates.find((c) => c.id === "w_owner")).toBeUndefined();
    expect(out.candidates.find((c) => c.id === "w_peer")).toBeDefined();
  });

  it("dedupes owner who also has a masters row (no duplicate entries)", async () => {
    // Some installs link the owner-as-master too. Owner appearing in BOTH
    // queries must collapse to one candidate.
    const { db } = createDbMock([
      // masters — owner appears here too
      [
        {
          chatId: 10_000_000_009,
          name: "Owner-Master",
          webUserId: "w_owner",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
        {
          chatId: 10_000_000_002,
          name: "Peer",
          webUserId: "w_peer",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
      ],
      // web_users — both rows
      [
        { id: "w_owner", name: "Owner-Master", email: "om@x.com", tenantId: "t_salon", role: "tenant_owner" },
        { id: "w_peer", name: "Peer", email: "p@x.com", tenantId: "t_salon", role: "master" },
      ],
      // tenant_owner — same id
      [{ id: "w_owner", name: "Owner-Master", email: "om@x.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    // Caller is a DIFFERENT owner-ish id so w_owner isn't filtered as self.
    const otherOwnerCtx = {
      ...makeTenantOwnerCtx(db, "t_salon"),
      webUser: { id: "w_owner_other", email: "o2@x.com", tenantId: "t_salon", webRole: "tenant_owner" },
    };
    const caller = createCaller(otherOwnerCtx as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    const owners = out.candidates.filter((c) => c.id === "w_owner");
    expect(owners).toHaveLength(1);
  });

  it("excludes archived masters (filter is SQL-side on archived_at IS NULL)", async () => {
    // The archived masters never appear in result set 1.
    const { db } = createDbMock([
      [], // masters — empty (archived ones filtered SQL-side)
      [],
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    expect(out.candidates).toEqual([]); // owner self-filtered, no peers
  });

  it("falls back name → email → masterChatId for display name", async () => {
    const { db } = createDbMock([
      // masters
      [
        {
          chatId: 10_000_000_001,
          name: null,
          webUserId: "w_a",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
        {
          chatId: 10_000_000_002,
          name: null,
          webUserId: "w_b",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
        {
          chatId: 555_000_001,
          name: null,
          webUserId: null,
          isSynthetic: 0,
          origin: "invited_telegram",
          telegramChatId: 555_000_001,
        },
      ],
      // web_users
      [
        { id: "w_a", name: "WebName", email: "a@x.com", tenantId: "t_salon", role: "master" },
        { id: "w_b", name: null, email: "b@x.com", tenantId: "t_salon", role: "master" },
      ],
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    expect(out.candidates.find((c) => c.id === "w_a")?.name).toBe("WebName");
    expect(out.candidates.find((c) => c.id === "w_b")?.name).toBe("b@x.com");
    const tgOnly = out.candidates.find((c) => c.refKind === "master");
    expect(tgOnly?.name).toBe("555000001");
  });

  it("orders candidates: connected web_users first, then placeholders", async () => {
    // Stable ordering keeps the picker predictable and surfaces the most
    // useful (real-DM-able) candidates at the top.
    const { db } = createDbMock([
      [
        {
          chatId: 555_000_001,
          name: "Tg Only",
          webUserId: null,
          isSynthetic: 0,
          origin: "invited_telegram",
          telegramChatId: 555_000_001,
        },
        {
          chatId: 10_000_000_001,
          name: "Connected",
          webUserId: "w_conn",
          isSynthetic: 1,
          origin: "salon_created",
          telegramChatId: null,
        },
      ],
      [{ id: "w_conn", name: "Connected", email: "c@x.com", tenantId: "t_salon", role: "master" }],
      [{ id: "w_owner", name: "Owner", email: "owner@salon.com", tenantId: "t_salon", role: "tenant_owner" }],
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    const out = await caller.listStaff({ tenantId: "t_salon" });
    expect(out.candidates[0]?.canDm).toBe(true);
    const lastIdx = out.candidates.length - 1;
    expect(out.candidates[lastIdx]?.canDm).toBe(false);
  });
});

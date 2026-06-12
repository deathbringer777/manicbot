/**
 * salon.getInvitationContext — PII masking (audit 2026-06-12, TI-1).
 *
 * The procedure is deliberately reachable by ANY authenticated user (the
 * accept page must work before the recipient is a tenant member), keyed only
 * by the unguessable invitation UUID. But it used to return the inviter's
 * and invitee's FULL emails to whoever held the id. Now: when the caller's
 * email does not match the invitation (and the caller is not system_admin),
 * both emails come back masked (k***@example.com) — still enough for the
 * "sign in as …" hint, no longer a PII disclosure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { maskEmail } from "~/server/lib/maskEmail";
import { createDbMock, makeTenantOwnerCtx, makeAdminCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(salonRouter);

const NOW = Math.floor(Date.now() / 1000);
const invitationRow = () => ({
  id: "inv_1",
  tenantId: "t_inviting",
  email: "invitee@example.com",
  status: "pending",
  scenario: "master",
  tokenExpiresAt: NOW + 3600,
  inviterUserId: "w_inviter",
  tenantName: "Salon X",
});
const inviterRow = () => ({ email: "inviter@example.com" });

describe("maskEmail — unit", () => {
  it("keeps first char + domain", () => {
    expect(maskEmail("kirill@gmail.com")).toBe("k***@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
  });
  it("handles null / malformed input", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("not-an-email")).toBe("***");
  });
});

describe("salon.getInvitationContext — PII masking (TI-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("masks inviter + invitee emails when the caller's email does NOT match", async () => {
    // makeTenantOwnerCtx email = owner@test.com ≠ invitee@example.com.
    // Queue: #1 invitation row, #2 inviter row, #3 caller's owned-tenant row
    // (tenant_owner with a different tenantId triggers the dual-role lookup).
    const { db } = createDbMock([
      [invitationRow()],
      [inviterRow()],
      [{ name: "Caller Salon", isPersonal: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_caller") as never);
    const r = await caller.getInvitationContext({ invitationId: "inv_1" });
    expect(r.emailMatch).toBe(false);
    // inviter@example.com → i***@example.com; invitee@example.com → i***@example.com
    expect(r.inviterEmail).toBe("i***@example.com");
    expect(r.email).toBe("i***@example.com");
    expect(r.email).not.toContain("invitee@");
    expect(r.inviterEmail).not.toContain("inviter@");
  });

  it("returns full emails when the caller IS the invitee (emailMatch)", async () => {
    const { db } = createDbMock([
      [{ ...invitationRow(), email: "owner@test.com" }],
      [inviterRow()],
      [{ name: "Caller Salon", isPersonal: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_caller") as never);
    const r = await caller.getInvitationContext({ invitationId: "inv_1" });
    expect(r.emailMatch).toBe(true);
    expect(r.email).toBe("owner@test.com");
    expect(r.inviterEmail).toBe("inviter@example.com");
  });

  it("returns full emails for system_admin", async () => {
    const { db } = createDbMock([[invitationRow()], [inviterRow()]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.getInvitationContext({ invitationId: "inv_1" });
    expect(r.email).toBe("invitee@example.com");
    expect(r.inviterEmail).toBe("inviter@example.com");
  });
});

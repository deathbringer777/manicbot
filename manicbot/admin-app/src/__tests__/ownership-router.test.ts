/**
 * Phase 2 cleanup: orphan-router pin for `ownershipRouter`.
 *
 * The ownership router is security-sensitive (migration 0071 partial UNIQUE
 * idx_ott_one_pending). This file pins:
 *   - auth gates (every mutation refuses unauth + non-owner roles)
 *   - cross-tenant IDOR (an owner of tenant A can't peek tenant B)
 *   - getPending happy path (returns the active row when present, null otherwise)
 *   - confirmTransfer (public procedure) refuses unknown tokens
 *
 * The full email-send flow + token consumption is exercised by
 * `ownership-logic.test.ts` (the pure-helper layer); this file pins the
 * tRPC surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { ownershipRouter } from "~/server/api/routers/ownership";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const TENANT = "t_ownership_pin";
const callerFactory = createCallerFactory(ownershipRouter);

describe("ownership.getPending — auth gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getPending({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects masters (tenant_owner+system_admin only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, TENANT) as never);
    await expect(caller.getPending({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects support staff", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeSupportCtx(db) as never);
    await expect(caller.getPending({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a tenant_owner of a DIFFERENT tenant (cross-tenant IDOR)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_some_other") as never);
    await expect(caller.getPending({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ownership.getPending — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no pending transfer exists", async () => {
    // Empty select result → no pending row.
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.getPending({ tenantId: TENANT } as never);
    expect(result).toBeNull();
  });

  it("returns the active row when present", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const pendingRow = {
      id: "ott_test_xyz",
      tenantId: TENANT,
      fromUserId: "w_owner",
      toUserId: "w_target",
      expiresAt: nowSec + 86400,
      createdAt: nowSec,
      toName: "Target User",
      toEmail: "target@test.com",
    };
    const { db } = createDbMock([[pendingRow]]);
    const caller = callerFactory(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.getPending({ tenantId: TENANT } as never);
    expect(result).toMatchObject({
      id: "ott_test_xyz",
      tenantId: TENANT,
      toEmail: "target@test.com",
    });
  });

  it("system_admin can fetch pending for any tenant", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    // Admin reaches the procedure (tenantOwnerProcedure allows system_admin).
    // assertTenantOwner accepts system_admin too.
    const result = await caller.getPending({ tenantId: TENANT } as never);
    expect(result).toBeNull();
  });
});

describe("ownership.cancelTransfer — auth gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.cancelTransfer({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects masters", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, TENANT) as never);
    await expect(caller.cancelTransfer({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cross-tenant: owner of t_a cannot cancel transfer on t_b", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.cancelTransfer({ tenantId: "t_b" } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ownership.confirmTransfer — public procedure but token-gated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an empty/missing token", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.confirmTransfer({ token: "" } as never))
      .rejects.toThrow();
  });

  it("rejects a clearly-invalid token (token not found in DB)", async () => {
    // confirmTransfer queries by tokenHash; no row matches → NOT_FOUND.
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.confirmTransfer({ token: "definitely-not-a-real-token-xyz" } as never),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST|FORBIDDEN/) });
  });
});

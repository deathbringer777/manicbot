/**
 * Phase 2 cleanup: orphan-router pin for `tenantsRouter`.
 *
 * The tenants router is system-admin-only — every procedure is
 * `adminProcedure`. Pins:
 *   - role gates on every procedure
 *   - getAll happy path returns array
 *   - getAll respects `test` filter input shape
 *   - getById NOT_FOUND when row missing
 *   - update zod input validation (plan + billingStatus enums)
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
import { tenantsRouter } from "~/server/api/routers/tenants";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(tenantsRouter);

describe("tenants.getAll — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getAll()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner (admin-only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.getAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects master", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, "t") as never);
    await expect(caller.getAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects support staff", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeSupportCtx(db) as never);
    await expect(caller.getAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tenants.getAll — happy path + filter shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin gets array (empty DB → empty array)", async () => {
    // tenants select + 4 Promise.all queries (bots, userCounts, aptCounts, masterCounts)
    const { db } = createDbMock([[], [], [], [], []]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getAll();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("admin can pass { test: true } and the input shape parses", async () => {
    const { db } = createDbMock([[], [], [], [], []]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getAll({ test: true });
    expect(Array.isArray(result)).toBe(true);
  });

  it("admin can pass { test: false } too", async () => {
    const { db } = createDbMock([[], [], [], [], []]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getAll({ test: false });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("tenants.getById — adminProcedure + NOT_FOUND when missing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects tenant_owner", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(
      caller.getById({ id: "t_missing" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND for an unknown tenant id", async () => {
    // Empty tenant row in slot 0 of the Promise.all → router throws NOT_FOUND.
    const { db } = createDbMock([[], [], [{ count: 0 }], [{ count: 0 }], [], []]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    await expect(
      caller.getById({ id: "t_does_not_exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tenants.update — adminProcedure + zod enum boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.update({ id: "t", plan: "pro" } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects plan outside {start, pro, max} enum", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    await expect(
      caller.update({
        id: "t",
        // @ts-expect-error — intentionally invalid plan
        plan: "enterprise",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects billingStatus outside the 4-element enum", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    await expect(
      caller.update({
        id: "t",
        // @ts-expect-error — intentionally invalid status
        billingStatus: "expired",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a valid plan update from admin", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.update({ id: "t", plan: "pro" } as never);
    expect(result).toEqual({ success: true });
  });
});

describe("tenants.deactivate / activate — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deactivate refuses tenant_owner", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(
      caller.deactivate({ id: "t" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("activate refuses unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.activate({ id: "t" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

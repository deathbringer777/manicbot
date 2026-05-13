/**
 * Tests for the errorEvents router: auth gating, filter validation, pagination,
 * and the resolve / stats / clear procedures.
 *
 * We mock the Drizzle DB and the database module so we can exercise the
 * router behaviour without a real D1 binding (same pattern as
 * `search-router.test.ts`, `consent-router.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { errorEventsRouter } from "~/server/api/routers/errorEvents";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(errorEventsRouter);

describe("errorEventsRouter auth gating", () => {
  it("rejects unauthenticated callers on list", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner callers (admin-only)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin on stats", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin on resolve", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.resolve({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin on clear", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.clear()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("errorEventsRouter.list", () => {
  const rows = [
    {
      id: 1,
      fingerprint: "fp_a",
      source: "worker",
      severity: "error",
      message: "Boom",
      stack: null,
      path: "/webhook/abc",
      tenantId: "t_1",
      userId: null,
      context: null,
      count: 3,
      firstSeen: 1_700_000_000,
      lastSeen: 1_700_000_100,
      resolvedAt: null,
      createdAt: 1_700_000_000,
    },
  ];

  beforeEach(() => vi.clearAllMocks());

  it("returns paginated rows + total", async () => {
    // First select call returns rows, second returns the count.
    const { db } = createDbMock([rows, [{ count: 1 }]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.list({});
    expect(out.rows).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.rows[0]!.message).toBe("Boom");
  });

  it("accepts severity, source, tenantId, search, date filters", async () => {
    const { db } = createDbMock([rows, [{ count: 1 }]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.list({
      severity: "error",
      source: "worker",
      tenantId: "t_1",
      search: "boom",
      dateFrom: 1_700_000_000,
      dateTo: 1_700_000_999,
      limit: 25,
      offset: 0,
    });
    expect(out.rows).toBeDefined();
    expect(out.total).toBe(1);
  });

  it("rejects an oversized limit", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(caller.list({ limit: 9999 })).rejects.toThrow();
  });

  it("rejects an invalid severity", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.list({ severity: "catastrophic" as never }),
    ).rejects.toThrow();
  });
});

describe("errorEventsRouter.get", () => {
  it("returns a single row by id", async () => {
    const row = {
      id: 42,
      fingerprint: "fp_x",
      source: "admin-app",
      severity: "fatal",
      message: "Crash",
      stack: "Error: Crash\n  at foo",
      path: "/dashboard",
      tenantId: null,
      userId: null,
      context: null,
      count: 1,
      firstSeen: 1_700_000_000,
      lastSeen: 1_700_000_000,
      resolvedAt: null,
      createdAt: 1_700_000_000,
    };
    const { db } = createDbMock([[row]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.get({ id: 42 });
    expect(out?.id).toBe(42);
    expect(out?.stack).toContain("Crash");
  });

  it("returns null for an unknown id", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.get({ id: 999 });
    expect(out).toBeNull();
  });
});

describe("errorEventsRouter.stats", () => {
  it("aggregates counts by severity for 24h and 7d windows", async () => {
    // Four select calls, in order: 24h-by-severity, 24h-total,
    // 7d-by-severity, 7d-total.
    const { db } = createDbMock([
      [
        { severity: "fatal", count: 2 },
        { severity: "error", count: 7 },
        { severity: "warning", count: 12 },
      ],
      [{ count: 21 }],
      [
        { severity: "fatal", count: 5 },
        { severity: "error", count: 33 },
        { severity: "warning", count: 60 },
      ],
      [{ count: 98 }],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.stats();
    expect(out.last24h.fatal).toBe(2);
    expect(out.last24h.error).toBe(7);
    expect(out.last24h.warning).toBe(12);
    expect(out.last24h.total).toBe(21);
    expect(out.last7d.fatal).toBe(5);
    expect(out.last7d.error).toBe(33);
    expect(out.last7d.warning).toBe(60);
    expect(out.last7d.total).toBe(98);
  });

  it("returns zeros when there are no rows", async () => {
    const { db } = createDbMock([[], [{ count: 0 }], [], [{ count: 0 }]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.stats();
    expect(out.last24h.total).toBe(0);
    expect(out.last7d.total).toBe(0);
    expect(out.last24h.fatal).toBe(0);
  });
});

describe("errorEventsRouter.resolve", () => {
  it("sets resolved_at on the target row", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    const out = await caller.resolve({ id: 7 });
    expect(out.ok).toBe(true);
    expect(mock.updateCalls).toHaveLength(1);
    expect(mock.updateCalls[0]!.values.resolvedAt).toBeTypeOf("number");
  });
});

describe("errorEventsRouter.clear", () => {
  it("issues a delete with a WHERE clause (never an unguarded delete)", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    const out = await caller.clear();
    expect(out.ok).toBe(true);
    expect(mock.deleteCalls).toHaveLength(1);
    expect(mock.deleteCalls[0]!.whereCalled).toBe(true);
  });
});

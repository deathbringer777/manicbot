/**
 * notifications router — scoped read/write.
 *
 * Critical invariants:
 *  - Every read + mutation is scoped by ctx.webUser.id. There is no way for
 *    a signed-in user to read or mark-read another user's row.
 *  - Unauthenticated callers are refused by protectedProcedure.
 *  - dismiss requires the row to belong to the caller (404 otherwise).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { notificationsRouter } from "~/server/api/routers/notifications";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(notificationsRouter);

describe("notificationsRouter — auth", () => {
  it("list throws UNAUTHORIZED when no web session", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("unreadCount throws UNAUTHORIZED", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.unreadCount()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("markRead throws UNAUTHORIZED", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.markRead({ ids: ["n_1"] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("dismiss throws UNAUTHORIZED", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.dismiss({ id: "n_1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("notificationsRouter — happy path", () => {
  it("list returns rows from the mock (scope is enforced by the WHERE)", async () => {
    const fakeRows = [
      { id: "n_1", webUserId: "w_owner", title: "Hello", body: null, readAt: null, link: null, kind: "reminder.fired", tenantId: "t_1", sourceSlug: "reminders", sourceId: "rm_1:1", createdAt: 1 },
    ];
    const { db } = createDbMock([fakeRows]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const rows = await caller.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "n_1", title: "Hello" });
  });

  it("unreadCount returns the integer count", async () => {
    const { db } = createDbMock([[{ c: 3 }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const { count } = await caller.unreadCount();
    expect(count).toBe(3);
  });

  it("unreadCount defaults to 0 when no rows", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const { count } = await caller.unreadCount();
    expect(count).toBe(0);
  });

  it("markRead caps at 100 ids (zod boundary)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const tooMany = Array.from({ length: 101 }, (_, i) => `n_${i}`);
    await expect(
      caller.markRead({ ids: tooMany }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("dismiss throws NOT_FOUND when the row does not belong to caller", async () => {
    // The router does a select that returns [] when no row matches the
    // (id, webUserId) pair — meaning either the row doesn't exist OR it
    // belongs to a different user. Either way, NOT_FOUND.
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(
      caller.dismiss({ id: "n_other_user" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// PR-D: per-category test fire. The mutation accepts an optional
// `category` input and dispatches `<category>.test` to notifyWebUser.
// Legacy no-arg invocations keep firing `support.test` (always
// delivered, bypasses prefs gate).
describe("notificationsRouter — sendTestNotification per-category (PR-D)", () => {
  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.sendTestNotification()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("defaults to support.test when no category is passed", async () => {
    // notifyWebUser → prefs read returns null (DEFAULT_PREFS), then INSERT.
    const { db, insertCalls } = createDbMock([[{ raw: null }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const out = await caller.sendTestNotification();
    expect(out.kind).toBe("support.test");
    const bellRow = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).kind === "support.test",
    );
    expect(bellRow).toBeDefined();
  });

  it("dispatches the requested category as <category>.test", async () => {
    const { db, insertCalls } = createDbMock([[{ raw: null }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const out = await caller.sendTestNotification({ category: "billing" });
    expect(out.kind).toBe("billing.test");
    const bellRow = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).kind === "billing.test",
    );
    expect(bellRow).toBeDefined();
    // Source slug stays 'self_test' regardless of category — so dedup +
    // dismissal target the right family of synthetic test rows.
    expect((bellRow!.values as Record<string, unknown>).sourceSlug).toBe("self_test");
  });

  it("rejects an unknown category via zod enum", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(
      caller.sendTestNotification({ category: "totally_made_up" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("supports every channel + client category (PR-B)", async () => {
    // Smoke-check that the two new PR-B categories accept the test fire.
    for (const cat of ["channel", "client"] as const) {
      const { db, insertCalls } = createDbMock([[{ raw: null }]]);
      const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
      const out = await caller.sendTestNotification({ category: cat });
      expect(out.kind).toBe(`${cat}.test`);
      expect(
        insertCalls.find(
          (c) => (c.values as Record<string, unknown>).kind === `${cat}.test`,
        ),
      ).toBeDefined();
    }
  });
});

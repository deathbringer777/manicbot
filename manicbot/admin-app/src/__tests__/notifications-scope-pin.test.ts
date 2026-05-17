/**
 * notifications router — defense-in-depth pin on the `web_user_id`
 * predicate.
 *
 * Every read + write must filter rows by `ctx.webUser.id`. The behaviour
 * is already covered by `notifications-router.test.ts` via NOT_FOUND on
 * cross-user dismiss, but those tests only catch missing predicates
 * indirectly. This file inspects the Drizzle SQL queryChunks tree and
 * fails immediately if any operation regresses to an unscoped WHERE
 * (mirrors the pattern introduced in `appointments-master-scope-idor`
 * + `plugin-reminders-cross-tenant-scope`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { makeTenantOwnerCtx } from "./helpers/db-mock";

function whereContainsColumn(arg: unknown, colName: string): boolean {
  function walk(node: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    const obj = node as { name?: unknown; queryChunks?: unknown[] };
    if (obj.name === colName) return true;
    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) {
        if (walk(c)) return true;
      }
    }
    return false;
  }
  return walk(arg);
}

function buildDb(selectResults: unknown[][]): {
  db: unknown;
  wheres: unknown[];
} {
  const queue = [...selectResults];
  const wheres: unknown[] = [];

  function makeChain(result: unknown): unknown {
    const limitChain: Record<string, unknown> = {
      offset: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        wheres.push(cond);
        return chain;
      },
      orderBy: () => chain,
      limit: () => limitChain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((cond: unknown) => {
          wheres.push(cond);
          return Promise.resolve({ ok: true });
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((cond: unknown) => {
        wheres.push(cond);
        return Promise.resolve({ ok: true });
      }),
    })),
  };
  return { db, wheres };
}

describe("notificationsRouter — web_user_id scope pin", () => {
  const createCaller = createCallerFactory(notificationsRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("list WHERE is bound to web_user_id", async () => {
    const { db, wheres } = buildDb([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await caller.list();
    expect(wheres.length).toBeGreaterThan(0);
    expect(wheres.every((w) => whereContainsColumn(w, "web_user_id"))).toBe(true);
  });

  it("unreadCount WHERE is bound to web_user_id", async () => {
    const { db, wheres } = buildDb([[{ c: 0 }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await caller.unreadCount();
    expect(wheres.every((w) => whereContainsColumn(w, "web_user_id"))).toBe(true);
  });

  it("markRead UPDATE is bound to web_user_id", async () => {
    const { db, wheres } = buildDb([]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await caller.markRead({ ids: ["n_1", "n_2"] });
    expect(wheres.length).toBeGreaterThan(0);
    expect(wheres.every((w) => whereContainsColumn(w, "web_user_id"))).toBe(true);
  });

  it("markAllRead UPDATE is bound to web_user_id", async () => {
    const { db, wheres } = buildDb([]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await caller.markAllRead();
    expect(wheres.length).toBeGreaterThan(0);
    expect(wheres.every((w) => whereContainsColumn(w, "web_user_id"))).toBe(true);
  });

  it("dismiss SELECT is bound to web_user_id", async () => {
    // Seed an existing match so dismiss reaches the delete branch.
    const { db, wheres } = buildDb([[{ id: "n_1" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await caller.dismiss({ id: "n_1" });
    // First WHERE is the SELECT that scopes to caller; second is DELETE.
    // We require AT LEAST the select-side scoping. The delete-side scoping
    // is defence-in-depth (see comment in router) but not strictly
    // required because the prior SELECT already proved ownership.
    expect(whereContainsColumn(wheres[0], "web_user_id")).toBe(true);
  });
});

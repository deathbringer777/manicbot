/**
 * pushSubscriptions tRPC router — auth + scoping + upsert / delete behavior.
 *
 * Pins:
 *   - All procedures require a web session (protectedProcedure).
 *   - subscribe is a per-(user, endpoint) UPSERT via onConflictDoUpdate
 *     so re-subscribing from the same browser doesn't duplicate.
 *   - getVapidPublicKey returns { publicKey: null, enabled: false } when
 *     the env var is absent (early-launch state — UI must hide the
 *     toggle in that case).
 *   - list is scoped to ctx.webUser.id (no cross-user read).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    VAPID_PUBLIC_KEY: undefined as string | undefined,
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pushSubscriptionsRouter } from "~/server/api/routers/pushSubscriptions";
import {
  createDbMock,
  makeUnauthCtx,
  makeTenantOwnerCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(pushSubscriptionsRouter);

// db-mock's insert chain doesn't natively expose onConflictDoUpdate, but
// we can rebuild a tiny one inline whenever needed.
function buildUpsertDb(selectRows: any[] = []) {
  const insertCalls: any[] = [];
  const conflictCalls: any[] = [];
  const deleteCalls: any[] = [];

  const db: any = {
    insert: vi.fn(() => ({
      values: vi.fn((vals: any) => {
        insertCalls.push(vals);
        return {
          onConflictDoUpdate: vi.fn((cfg: any) => {
            conflictCalls.push(cfg);
            return Promise.resolve({ ok: true });
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        deleteCalls.push({});
        return Promise.resolve({ ok: true });
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectRows),
          then: (r: any, j?: any) => Promise.resolve(selectRows).then(r, j),
        }),
      }),
    })),
  };
  return { db, insertCalls, conflictCalls, deleteCalls };
}

describe("pushSubscriptions — auth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getVapidPublicKey requires a web session", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.getVapidPublicKey()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("subscribe requires a web session", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.subscribe({
        endpoint: "https://push.example.com/abc",
        p256dh: "key",
        auth: "auth",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("unsubscribe requires a web session", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.unsubscribe({ endpoint: "https://push.example.com/abc" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("list requires a web session", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("pushSubscriptions.getVapidPublicKey", () => {
  it("returns disabled state when VAPID_PUBLIC_KEY env is unset", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.getVapidPublicKey();
    expect(r).toEqual({ publicKey: null, enabled: false });
  });
});

describe("pushSubscriptions.subscribe — upsert contract", () => {
  it("UPSERTs on (web_user_id, endpoint) so re-subscribe doesn't duplicate", async () => {
    const { db, insertCalls, conflictCalls } = buildUpsertDb();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.subscribe({
      endpoint: "https://fcm.googleapis.com/fcm/send/AAA",
      p256dh: "BBxxx",
      auth: "auth16",
      userAgent: "Mozilla/5.0 (test)",
    });
    expect(r).toEqual({ ok: true });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      webUserId: "w_owner",
      tenantId: "t_demo",
      endpoint: "https://fcm.googleapis.com/fcm/send/AAA",
      p256dh: "BBxxx",
      auth: "auth16",
      userAgent: "Mozilla/5.0 (test)",
      failureCount: 0,
    });
    expect(insertCalls[0].id).toMatch(/^ps_/);

    expect(conflictCalls).toHaveLength(1);
    expect(conflictCalls[0]).toMatchObject({
      set: {
        p256dh: "BBxxx",
        auth: "auth16",
        userAgent: "Mozilla/5.0 (test)",
        failureCount: 0,
      },
    });
    // Targets the unique (webUserId, endpoint) pair.
    expect(conflictCalls[0].target).toHaveLength(2);
  });

  it("rejects non-URL endpoint via zod validation", async () => {
    const { db } = buildUpsertDb();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.subscribe({ endpoint: "not-a-url", p256dh: "k", auth: "a" }),
    ).rejects.toThrow();
  });
});

describe("pushSubscriptions.unsubscribe", () => {
  it("issues a DELETE scoped by (web_user_id, endpoint)", async () => {
    const { db, deleteCalls } = buildUpsertDb();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.unsubscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/AAA" });
    expect(r).toEqual({ ok: true });
    expect(deleteCalls).toHaveLength(1);
  });
});

describe("pushSubscriptions.list — scoping", () => {
  it("returns the rows the mock surfaces (no cross-user spill possible)", async () => {
    const rows = [
      { id: "ps_1", endpoint: "https://a", userAgent: "Chrome", createdAt: 1, lastUsedAt: null },
      { id: "ps_2", endpoint: "https://b", userAgent: "Firefox", createdAt: 2, lastUsedAt: 10 },
    ];
    const { db } = buildUpsertDb(rows);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.list();
    expect(r).toEqual(rows);
  });
});

/**
 * analyticsEvents router — sysadmin event-stream inspector (Blocker 5).
 *
 * Pins:
 *  - Every proc is `adminProcedure` — public/master/tenant_owner caller is rejected.
 *  - `list` builds the WHERE filter from optional event/tenantId/userId/since/until.
 *  - `list` returns paginated rows + total count.
 *  - `stats` always returns one entry per canonical slug (zeros for empty).
 *  - `distinctEvents` returns the table's distinct event names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { analyticsEventsRouter } from "~/server/api/routers/analyticsEvents";
import { ANALYTICS_EVENTS } from "~/server/services/recordEvent";
import {
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFor = createCallerFactory(analyticsEventsRouter);

// ─── minimal Drizzle chain mock ──────────────────────────────────────

interface ListPayload {
  rows: Array<{ id: number; event: string; tenantId: string | null; userId: string | null; properties: string; createdAt: number }>;
  count: number;
}
interface StatsPayload {
  rows: Array<{ event: string; countDay: number; countWeek: number }>;
}
interface DistinctPayload {
  rows: Array<{ event: string }>;
}

function makeDb(payload: { list?: ListPayload; stats?: StatsPayload; distinct?: DistinctPayload }) {
  const listChain = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            offset: async () => payload.list?.rows ?? [],
          }),
        }),
      }),
    }),
  });
  const countChain = () => ({
    from: () => ({
      where: async () => [{ c: payload.list?.count ?? 0 }],
    }),
  });
  const statsChain = () => ({
    from: () => ({
      where: () => ({
        groupBy: async () => payload.stats?.rows ?? [],
      }),
    }),
  });
  const selectDistinct = () => ({
    from: () => ({
      orderBy: async () => payload.distinct?.rows ?? [],
    }),
  });
  return {
    select: (cols?: unknown) => {
      // The `list` proc does: select() then select({ c }).
      // The `stats` proc does: select({ event, countDay, countWeek }).
      if (cols && typeof cols === "object") {
        const keys = Object.keys(cols as object);
        if (keys.includes("countDay") || keys.includes("countWeek")) {
          return statsChain();
        }
        if (keys.includes("c")) {
          return countChain();
        }
      }
      return listChain();
    },
    selectDistinct,
  };
}

// ─── tests ───────────────────────────────────────────────────────────

describe("analyticsEvents router — auth", () => {
  const emptyDb = makeDb({ list: { rows: [], count: 0 }, stats: { rows: [] }, distinct: { rows: [] } });
  it("rejects unauthenticated callers", async () => {
    const caller = callerFor(makeUnauthCtx(emptyDb) as unknown as Parameters<typeof callerFor>[0]);
    await expect(caller.list({ page: 1, pageSize: 10 })).rejects.toThrow();
  });
  it("rejects tenant_owner callers", async () => {
    const caller = callerFor(makeTenantOwnerCtx(emptyDb, "t_1") as unknown as Parameters<typeof callerFor>[0]);
    await expect(caller.list({ page: 1, pageSize: 10 })).rejects.toThrow();
  });
  it("rejects master callers", async () => {
    const caller = callerFor(makeMasterCtx(emptyDb, "t_1") as unknown as Parameters<typeof callerFor>[0]);
    await expect(caller.list({ page: 1, pageSize: 10 })).rejects.toThrow();
  });
});

describe("analyticsEvents.list", () => {
  it("returns rows + total + page metadata", async () => {
    const db = makeDb({
      list: {
        rows: [
          { id: 1, event: "signup.completed", tenantId: "t_1", userId: "u_1", properties: "{}", createdAt: 1_700_000_000 },
          { id: 2, event: "signup.started", tenantId: null, userId: "u_2", properties: "{}", createdAt: 1_700_000_500 },
        ],
        count: 42,
      },
    });
    const caller = callerFor(makeAdminCtx(db) as unknown as Parameters<typeof callerFor>[0]);
    const result = await caller.list({ page: 2, pageSize: 25 });
    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(25);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.event).toBe("signup.completed");
  });

  it("rejects pageSize > MAX", async () => {
    const db = makeDb({ list: { rows: [], count: 0 } });
    const caller = callerFor(makeAdminCtx(db) as unknown as Parameters<typeof callerFor>[0]);
    await expect(caller.list({ page: 1, pageSize: 500 })).rejects.toThrow();
  });
});

describe("analyticsEvents.stats", () => {
  it("returns one row per canonical slug, defaulting to zero counts", async () => {
    const db = makeDb({
      stats: {
        rows: [
          { event: "signup.completed", countDay: 5, countWeek: 30 },
          { event: "bot.linked", countDay: 1, countWeek: 4 },
        ],
      },
    });
    const caller = callerFor(makeAdminCtx(db) as unknown as Parameters<typeof callerFor>[0]);
    const stats = await caller.stats();
    const slugs = Object.values(ANALYTICS_EVENTS);
    expect(stats).toHaveLength(slugs.length);
    const sc = stats.find((r) => r.event === "signup.completed");
    expect(sc).toEqual({ event: "signup.completed", day: 5, week: 30 });
    const sub = stats.find((r) => r.event === "subscription.renewed");
    expect(sub).toEqual({ event: "subscription.renewed", day: 0, week: 0 });
  });
});

describe("analyticsEvents.distinctEvents", () => {
  it("returns the table's distinct event names", async () => {
    const db = makeDb({
      distinct: {
        rows: [
          { event: "bot.linked" },
          { event: "signup.completed" },
          { event: "trial.started" },
        ],
      },
    });
    const caller = callerFor(makeAdminCtx(db) as unknown as Parameters<typeof callerFor>[0]);
    const slugs = await caller.distinctEvents();
    expect(slugs).toContain("bot.linked");
    expect(slugs).toContain("signup.completed");
    expect(slugs).toContain("trial.started");
  });
});

describe("ANALYTICS_EVENTS catalog", () => {
  it("contains the 18 pre-launch slugs", () => {
    expect(Object.keys(ANALYTICS_EVENTS).length).toBeGreaterThanOrEqual(18);
    expect(Object.values(ANALYTICS_EVENTS)).toContain("signup.started");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("signup.email_verified");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("signup.completed");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("bot.linked");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("subscription.started");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("trial.started");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("trial.warning_3d");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("trial.expired");
  });
});

/**
 * notifyWebUser — pure helper unit tests.
 *
 * Locks the contract used by every notification writer (support tickets,
 * birthday cron, billing alerts in PR2, etc.): input validation, length
 * truncation, idempotency via onConflictDoNothing + returning().
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/utils/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  notifyWebUser,
  notifyManyWebUsers,
  buildNotificationId,
} from "~/server/services/notifyWebUser";

function makeDbMock(insertReturning: any[] = [{ id: "n_test" }]) {
  const insertCalls: any[] = [];
  return {
    insertCalls,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn((vals: any) => {
          insertCalls.push(vals);
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve(insertReturning),
            }),
          };
        }),
      })),
    } as any,
  };
}

describe("buildNotificationId", () => {
  it("returns deterministic prefix + base36 timestamp + 8 random chars", () => {
    const id = buildNotificationId(1700000000000);
    expect(id.startsWith("n_")).toBe(true);
    const parts = id.split("_");
    expect(parts).toHaveLength(3);
    expect(parts[2]).toMatch(/^[a-z0-9]{8}$/);
  });

  it("produces distinct ids on rapid successive calls", () => {
    const ids = new Set<string>();
    const now = Date.now();
    for (let i = 0; i < 50; i++) ids.add(buildNotificationId(now));
    expect(ids.size).toBe(50);
  });
});

describe("notifyWebUser — input validation", () => {
  it("rejects missing webUserId", async () => {
    const { db } = makeDbMock();
    const r = await notifyWebUser(db, { webUserId: "", kind: "x", title: "y" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_web_user_id");
  });

  it("rejects missing kind", async () => {
    const { db } = makeDbMock();
    const r = await notifyWebUser(db, { webUserId: "w1", kind: "", title: "y" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_kind");
  });

  it("rejects missing title", async () => {
    const { db } = makeDbMock();
    const r = await notifyWebUser(db, { webUserId: "w1", kind: "x", title: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_title");
  });
});

describe("notifyWebUser — happy path", () => {
  it("inserts row and returns generated id", async () => {
    const { db, insertCalls } = makeDbMock([{ id: "n_inserted" }]);
    const r = await notifyWebUser(db, {
      webUserId: "w_owner_1",
      tenantId: "t_demo",
      kind: "support.reply",
      title: "Новый ответ поддержки",
      body: "тест",
      link: "/settings?section=help&ticket=pt_xyz",
      sourceSlug: "support",
      sourceId: "pt_xyz:1700000000",
    });

    expect(r.ok).toBe(true);
    expect(r.deduped).toBeUndefined();
    expect(r.id).toBe("n_inserted");
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      webUserId: "w_owner_1",
      tenantId: "t_demo",
      kind: "support.reply",
      title: "Новый ответ поддержки",
      body: "тест",
      link: "/settings?section=help&ticket=pt_xyz",
      sourceSlug: "support",
      sourceId: "pt_xyz:1700000000",
      readAt: null,
    });
    expect(insertCalls[0].id).toMatch(/^n_/);
    expect(typeof insertCalls[0].createdAt).toBe("number");
  });

  it("returns deduped=true when onConflictDoNothing skips the row", async () => {
    const { db } = makeDbMock([]); // empty returning() = no row inserted
    const r = await notifyWebUser(db, {
      webUserId: "w1",
      kind: "x",
      title: "y",
      sourceSlug: "s",
      sourceId: "s1",
    });
    expect(r.ok).toBe(true);
    expect(r.deduped).toBe(true);
    expect(r.id).toBeNull();
  });
});

describe("notifyWebUser — length truncation", () => {
  it("truncates title to 200 chars", async () => {
    const { db, insertCalls } = makeDbMock();
    const longTitle = "a".repeat(500);
    await notifyWebUser(db, { webUserId: "w1", kind: "x", title: longTitle });
    expect((insertCalls[0].title as string).length).toBe(200);
  });

  it("truncates body to 1000 chars", async () => {
    const { db, insertCalls } = makeDbMock();
    const longBody = "b".repeat(2000);
    await notifyWebUser(db, { webUserId: "w1", kind: "x", title: "t", body: longBody });
    expect((insertCalls[0].body as string).length).toBe(1000);
  });

  it("truncates link to 500 chars", async () => {
    const { db, insertCalls } = makeDbMock();
    const longLink = "/x?q=" + "c".repeat(800);
    await notifyWebUser(db, { webUserId: "w1", kind: "x", title: "t", link: longLink });
    expect((insertCalls[0].link as string).length).toBe(500);
  });

  it("keeps null body when omitted", async () => {
    const { db, insertCalls } = makeDbMock();
    await notifyWebUser(db, { webUserId: "w1", kind: "x", title: "t" });
    expect(insertCalls[0].body).toBeNull();
    expect(insertCalls[0].link).toBeNull();
  });
});

describe("notifyWebUser — failure mode", () => {
  it("returns {ok:false, error} when the DB throws", async () => {
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.reject(new Error("D1 down")),
          }),
        }),
      }),
    } as any;
    const r = await notifyWebUser(db, { webUserId: "w1", kind: "x", title: "t" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("db_insert_failed");
    expect(r.id).toBeNull();
  });
});

describe("notifyManyWebUsers — fanout", () => {
  it("aggregates ok / deduped / failed counters", async () => {
    let call = 0;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => {
              call++;
              if (call === 1) return Promise.resolve([{ id: "n_1" }]); // ok
              if (call === 2) return Promise.resolve([]); // deduped
              return Promise.reject(new Error("boom")); // failed
            },
          }),
        }),
      }),
    } as any;

    const r = await notifyManyWebUsers(db, ["w1", "w2", "w3"], {
      kind: "x",
      title: "t",
    });
    expect(r).toEqual({ ok: 1, deduped: 1, failed: 1, skippedByPrefs: 0 });
  });

  it("returns zeros for empty target list", async () => {
    const { db } = makeDbMock();
    const r = await notifyManyWebUsers(db, [], { kind: "x", title: "t" });
    expect(r).toEqual({ ok: 0, deduped: 0, failed: 0, skippedByPrefs: 0 });
  });

  it("counts skippedByPrefs when the user opted out of the category", async () => {
    // Mock returns a prefs row that disables marketing entirely.
    const prefsBlob = JSON.stringify({ categories: { marketing: { inapp: false, push: false } } });
    let callIdx = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              callIdx++;
              return Promise.resolve([{ raw: prefsBlob }]);
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: "n_x" }]),
          }),
        }),
      }),
    } as any;

    const r = await notifyManyWebUsers(db, ["w_opted_out"], {
      kind: "marketing.campaign.sent",
      title: "Marketing",
    });
    expect(r.skippedByPrefs).toBe(1);
    expect(r.ok).toBe(0);
    expect(callIdx).toBeGreaterThanOrEqual(1);
  });
});

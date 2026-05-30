/**
 * notifyManyWebUsers bulk path (Phase 4 hardening): when the D1 `batch` API is
 * available and there's >1 recipient, fan-out collapses to ONE prefs IN-query +
 * chunked batch inserts (bounded subrequests) instead of 2N sequential ops.
 * The sequential path (no batch / single recipient) is unchanged — covered by
 * the existing messenger-router PR-B tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

import { notifyManyWebUsers } from "~/server/services/notifyWebUser";
import { createDbMock } from "./helpers/db-mock";

function batchDb(selectResults: unknown[]) {
  const mock = createDbMock(selectResults);
  // Make the db "batch-capable" — statements are already recorded in
  // insertCalls when `.values()` is built, so awaiting them is enough.
  (mock.db as unknown as { batch: (b: unknown[]) => Promise<unknown> }).batch = async (
    stmts: unknown[],
  ) => {
    for (const s of stmts) {
      try {
        await (s as Promise<unknown>);
      } catch {
        /* ignore */
      }
    }
    return [];
  };
  return mock;
}

describe("notifyManyWebUsers — bulk path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("batch-inserts a bell row per recipient after one prefs IN-query", async () => {
    // selectResults[0] = the prefs IN-query result (all raw:null → deliver).
    const mock = batchDb([
      [
        { id: "w_a", raw: null },
        { id: "w_b", raw: null },
        { id: "w_c", raw: null },
      ],
    ]);
    const res = await notifyManyWebUsers(mock.db as never, ["w_a", "w_b", "w_c"], {
      kind: "platform.message",
      title: "Объявление",
      body: "Текст",
      sourceSlug: "platform_messenger",
      sourceId: "bc_1",
    });
    const bells = mock.insertCalls.filter(
      (c) => (c.values as Record<string, unknown>).kind === "platform.message",
    );
    expect(bells).toHaveLength(3);
    expect(new Set(bells.map((b) => (b.values as Record<string, unknown>).webUserId))).toEqual(
      new Set(["w_a", "w_b", "w_c"]),
    );
    expect(res.ok).toBe(3);
  });

  it("dedupes recipient ids before fan-out", async () => {
    const mock = batchDb([[{ id: "w_a", raw: null }]]);
    await notifyManyWebUsers(mock.db as never, ["w_a", "w_a", "w_a"], {
      kind: "platform.message",
      title: "T",
    });
    const bells = mock.insertCalls.filter(
      (c) => (c.values as Record<string, unknown>).kind === "platform.message",
    );
    // Single unique id → sequential path (ids.length <= 1) → exactly one insert.
    expect(bells).toHaveLength(1);
  });

  it("empty recipient list is a no-op", async () => {
    const mock = batchDb([]);
    const res = await notifyManyWebUsers(mock.db as never, [], { kind: "x", title: "T" });
    expect(res).toEqual({ ok: 0, deduped: 0, failed: 0, skippedByPrefs: 0 });
    expect(mock.insertCalls).toHaveLength(0);
  });
});

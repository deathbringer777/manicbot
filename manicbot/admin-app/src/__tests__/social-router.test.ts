/**
 * God Mode social-automation router (migration 0127).
 *
 * Pins:
 *   - every procedure is adminProcedure (system_admin only): unauth → UNAUTHORIZED,
 *     tenant_owner → FORBIDDEN.
 *   - inbox/pendingPosts/counts read; approvePost/commentDecision write D1 and
 *     404 when the conditional UPDATE matches no row (status guard).
 *   - commentDecision draft requires replyText.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { socialRouter } from "~/server/api/routers/social";
import { createDbMock, makeAdminCtx, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const callerFactory = createCallerFactory(socialRouter);

describe("social — role gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inbox rejects unauthenticated (UNAUTHORIZED)", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.inbox({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("approvePost rejects tenant_owner (FORBIDDEN)", async () => {
    const { db } = createDbMock([], []);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.approvePost({ id: "sd_plat_1", decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("social — reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inbox returns rows", async () => {
    const rows = [{ id: "sci_1", comment_id: "C1", status: "new" }];
    const { db } = createDbMock([rows]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.inbox({ status: "new", limit: 10 });
    expect(res.rows).toEqual(rows);
  });

  it("pendingPosts parses hashtags", async () => {
    const rows = [{ id: "sd_1", status: "awaiting_approval", hashtagsJson: '["#a","#b"]' }];
    const { db } = createDbMock([rows]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.pendingPosts({});
    expect(res.rows[0]!.hashtags).toEqual(["#a", "#b"]);
  });

  it("counts aggregates comment statuses + pending posts", async () => {
    const byStatus = [{ status: "new", count: 3 }, { status: "drafted", count: 1 }];
    const pending = [{ count: 2 }];
    const { db } = createDbMock([byStatus, pending]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.counts();
    expect(res.comments).toEqual([{ status: "new", n: 3 }, { status: "drafted", n: 1 }]);
    expect(res.pendingPosts).toBe(2);
  });
});

describe("social — mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approvePost approve → ready (stamps approvedAt)", async () => {
    const { db, updateCalls } = createDbMock([], [[{ id: "sd_1", status: "ready" }]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.approvePost({ id: "sd_1", decision: "approve" });
    expect(res).toEqual({ id: "sd_1", status: "ready" });
    expect(updateCalls[0]!.values).toMatchObject({ status: "ready" });
    expect(updateCalls[0]!.values.approvedAt).toBeGreaterThan(0);
  });

  it("approvePost 404 when no awaiting_approval row matches", async () => {
    const { db } = createDbMock([], [[]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    await expect(caller.approvePost({ id: "nope", decision: "approve" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("commentDecision draft sets replyText + drafted", async () => {
    const { db, updateCalls } = createDbMock([], [[{ id: "sci_1", status: "drafted" }]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.commentDecision({ commentId: "C1", action: "draft", replyText: "Dzięki!", classification: "benign" });
    expect(res.status).toBe("drafted");
    expect(updateCalls[0]!.values).toMatchObject({ status: "drafted", replyText: "Dzięki!", classification: "benign" });
  });

  it("commentDecision draft without replyText → BAD_REQUEST", async () => {
    const { db } = createDbMock([], []);
    const caller = callerFactory(makeAdminCtx(db) as never);
    await expect(caller.commentDecision({ commentId: "C1", action: "draft" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("commentDecision escalate → escalated (no replyText needed)", async () => {
    const { db, updateCalls } = createDbMock([], [[{ id: "sci_2", status: "escalated" }]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const res = await caller.commentDecision({ commentId: "C2", action: "escalate", classification: "complaint" });
    expect(res.status).toBe("escalated");
    expect(updateCalls[0]!.values).toMatchObject({ status: "escalated" });
  });
});

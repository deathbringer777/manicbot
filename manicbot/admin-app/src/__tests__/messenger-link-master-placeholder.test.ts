/**
 * Backfill helper — when a master gets a `web_users.id` (invite accepted /
 * Telegram→web paired), every placeholder `thread_members` row tagged with
 * (member_kind='master', member_ref=String(chatId)) must flip to
 * (member_kind='web_user', member_ref=<webUserId>), and the parent thread's
 * `dm_key` must be recomputed so the partial-UNIQUE index stays consistent
 * (otherwise a second owner-initiated DM would create a duplicate).
 *
 * Edge case — duplicate-DM merge: if the salon owner ALSO had a real
 * web-user DM with the master via some other path (e.g. they were already
 * registered as a customer of the salon and got separately invited), the
 * placeholder backfill must NOT crash on dm_key UNIQUE. Strategy: the helper
 * detects an existing dupe and merges (placeholder thread is deleted; its
 * messages re-parented onto the surviving real thread).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createDbMock } from "./helpers/db-mock";
import { linkMasterPlaceholderToWebUser } from "~/server/messenger/linkMasterPlaceholder";

describe("linkMasterPlaceholderToWebUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips member_kind master → web_user and recomputes dm_key (single placeholder)", async () => {
    const dbMock = createDbMock([
      // 1. find placeholder thread_members rows for this master
      [{ threadId: "th_placeholder", role: "member" }],
      // 2. for each thread: SELECT other web_user member to recompute dm_key
      [{ memberRef: "w_owner" }],
      // 3. SELECT existing real DM for the new (caller, master.webUser) pair → none
      [],
    ]);

    await linkMasterPlaceholderToWebUser(dbMock.db as never, {
      tenantId: "t_salon",
      masterChatId: 555_000_111,
      webUserId: "w_iryna",
    });

    // UPDATE thread_members: master → web_user
    const memberFlip = dbMock.updateCalls.find(
      (c) =>
        (c.values as Record<string, unknown>).memberKind === "web_user" &&
        (c.values as Record<string, unknown>).memberRef === "w_iryna",
    );
    expect(memberFlip).toBeDefined();
    // UPDATE threads.dm_key
    const dmKeyUpdate = dbMock.updateCalls.find(
      (c) => "dmKey" in (c.values as Record<string, unknown>),
    );
    expect(dmKeyUpdate).toBeDefined();
    // sorted("w_iryna", "w_owner") = "w_iryna:w_owner"
    expect((dmKeyUpdate!.values as Record<string, unknown>).dmKey).toBe("w_iryna:w_owner");
  });

  it("no-op when no placeholder thread_members exist for the master", async () => {
    const dbMock = createDbMock([
      // 1. placeholder rows lookup → empty
      [],
    ]);
    await linkMasterPlaceholderToWebUser(dbMock.db as never, {
      tenantId: "t_salon",
      masterChatId: 555_000_111,
      webUserId: "w_iryna",
    });
    // No mutations.
    expect(dbMock.updateCalls.length).toBe(0);
    expect(dbMock.deleteCalls.length).toBe(0);
  });

  it("merges into existing real DM thread when one already exists (no UNIQUE crash)", async () => {
    const dbMock = createDbMock([
      // 1. placeholder rows lookup → one row
      [{ threadId: "th_placeholder", role: "member" }],
      // 2. other web_user member of the placeholder thread
      [{ memberRef: "w_owner" }],
      // 3. existing real DM lookup → FOUND
      [{ id: "th_real" }],
    ]);
    await linkMasterPlaceholderToWebUser(dbMock.db as never, {
      tenantId: "t_salon",
      masterChatId: 555_000_111,
      webUserId: "w_iryna",
    });
    // Messages re-parented (UPDATE thread_messages.threadId)
    const msgReparent = dbMock.updateCalls.find(
      (c) => (c.values as Record<string, unknown>).threadId === "th_real",
    );
    expect(msgReparent).toBeDefined();
    // Placeholder thread + members deleted (we expect 2 delete calls: members + thread)
    expect(dbMock.deleteCalls.length).toBeGreaterThanOrEqual(2);
    for (const d of dbMock.deleteCalls) {
      expect(d.whereCalled).toBe(true);
    }
  });
});

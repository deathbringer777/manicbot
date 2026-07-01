/**
 * `messenger.getThread` — booking-request cards must carry the LIVE
 * appointment status (finding C5).
 *
 * The procedure builds an enriched `messagesWithLive` array (each message
 * gets a `liveAppointment` overlay reflecting the current appointments-table
 * status), but historically returned the UN-enriched `messages` array, so
 * `RequestCard.tsx` (which reads `message.liveAppointment`) always fell back
 * to the stale `metaJson` snapshot taken at post time. This test pins the
 * contract: the returned message MUST expose the live status.
 *
 * Harness note: a system_admin caller keeps the select order minimal —
 * `assertTenantMember` short-circuits (0 selects) and `assertThreadMember`
 * returns right after the `threads` lookup (system_admin membership bypass).
 * The order-based db-mock is therefore queued as:
 *   1. threads        (assertThreadMember existence check)
 *   2. threadMessages (the page of messages)
 *   3. appointments   (live status for booking_request refs)
 *   4. threadMembers  (member list — empty ⇒ no web_user/master name lookups)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { createDbMock, makeAdminCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

describe("messenger.getThread — live appointment status overlay (C5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns booking_request messages enriched with the LIVE appointment status", async () => {
    const tenantId = "t_live";
    const threadId = "th_live";
    const aptId = "apt_live_1";

    // A booking-request card whose snapshot said "pending" at post time…
    const messageRow = {
      id: "01J00000000000000000000C5",
      threadId,
      senderKind: "web_user",
      senderRef: "w_client",
      refKind: "booking_request",
      refId: aptId,
      body: "booking request",
      metaJson: JSON.stringify({ status: "pending" }),
      attachmentsJson: null,
      deletedAt: null,
      createdAt: 1_700_000_000,
    };

    const { db } = createDbMock([
      [{ id: threadId, tenantId }], // 1. assertThreadMember → threads
      [messageRow], // 2. threadMessages page
      // 3. appointments live status — the booking was CONFIRMED since post time
      [{ id: aptId, status: "confirmed", masterId: null, cancelled: 0 }],
      [], // 4. threadMembers (none ⇒ no name-resolution selects)
    ]);

    const caller = createCaller(makeAdminCtx(db));
    const res = await caller.getThread({ tenantId, threadId, limit: 50 });

    const msg = res.messages.find(
      (m: { id: string }) => m.id === messageRow.id,
    ) as { liveAppointment?: { status?: string } | null } | undefined;

    // The overlay must be present and reflect the live (confirmed) status —
    // NOT the stale "pending" snapshot in metaJson.
    expect(msg?.liveAppointment).toBeTruthy();
    expect(msg?.liveAppointment?.status).toBe("confirmed");
  });
});

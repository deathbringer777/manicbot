/**
 * messenger.getThread — LIVE appointment overlay on booking-request cards (C5).
 *
 * Bug: getThread built `messagesWithLive = messages.map(m => ({...m,
 * liveAppointment}))` but the `return` mapped over the ORIGINAL `messages`
 * array, so the `liveAppointment` field was silently dropped. Request cards in
 * the UI therefore always rendered the FROZEN-at-send status (still-claimable)
 * even after the appointment had been claimed/confirmed/cancelled elsewhere.
 *
 * Contract: the returned `messages` carry a `liveAppointment` field that
 * reflects the current row state for `booking_request` cards (null when there
 * is no matching live appointment), overlaid on top of the tombstone/reverse
 * transforms.
 */
import { describe, it, expect, vi } from "vitest";

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
import { messengerRouter } from "~/server/api/routers/messenger";
import { createDbMock, makeAdminCtx } from "./helpers/db-mock";

const callerFor = createCallerFactory(messengerRouter);
const TENANT = "t_demo";
const THREAD = "th_1";

function makeThreadRow() {
  return {
    id: THREAD,
    tenantId: TENANT,
    kind: "group",
    title: "General",
    clientConversationId: null,
    dmKey: null,
    createdByWebUserId: null,
    createdAt: 1,
    lastMessageAt: 2,
    lastMessagePreview: null,
    archived: 0,
  };
}

describe("messenger.getThread — live appointment overlay", () => {
  it("attaches liveAppointment to booking_request cards in the returned messages", async () => {
    // Select queue (system_admin bypasses thread-member check):
    //   1. thread lookup (assertThreadMember)
    //   2. messages
    //   3. live appointment overlay rows
    //   4. members (empty → skip name resolution)
    const { db } = createDbMock([
      [makeThreadRow()],
      [
        {
          id: "m1",
          threadId: THREAD,
          refKind: "booking_request",
          refId: "a1",
          body: "wants 11:00",
          attachmentsJson: null,
          deletedAt: null,
        },
      ],
      [{ id: "a1", status: "confirmed", masterId: 7, cancelled: 0 }],
      [],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);

    const res = await caller.getThread({ tenantId: TENANT, threadId: THREAD });

    expect(res.messages).toHaveLength(1);
    const msg = res.messages[0] as { liveAppointment?: unknown };
    expect(msg.liveAppointment).toEqual({
      status: "confirmed",
      masterId: 7,
      cancelled: 0,
    });
  });

  it("sets liveAppointment to null when the referenced appointment is gone", async () => {
    const { db } = createDbMock([
      [makeThreadRow()],
      [
        {
          id: "m1",
          threadId: THREAD,
          refKind: "booking_request",
          refId: "a_missing",
          body: "wants 11:00",
          attachmentsJson: null,
          deletedAt: null,
        },
      ],
      [], // no matching live appointment row
      [],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);

    const res = await caller.getThread({ tenantId: TENANT, threadId: THREAD });

    const msg = res.messages[0] as { liveAppointment?: unknown };
    expect(msg.liveAppointment).toBeNull();
  });
});

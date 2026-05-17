import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

vi.mock("~/server/utils/notifyWorker", () => ({
  notifyWorker: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { notifyWorker } from "~/server/utils/notifyWorker";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeMasterCtx,
} from "./helpers/db-mock";

const TENANT = "t_demo";
const FUTURE_TS = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
const PAST_TS = Math.floor(Date.now() / 1000) - 3600;

function ownerCaller(db: any) {
  return createCallerFactory(masterRouter)(makeTenantOwnerCtx(db, TENANT) as never);
}
function masterCaller(db: any) {
  return createCallerFactory(masterRouter)(makeMasterCtx(db, TENANT) as never);
}

describe("masterRouter status mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notifyWorker).mockResolvedValue(undefined);
  });

  describe("confirmAppointment", () => {
    it("owner can confirm any pending appointment in the tenant", async () => {
      const dbMock = createDbMock([
        [{ status: "pending", cancelled: 0, masterId: 42 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await caller.confirmAppointment({ tenantId: TENANT, id: "apt_1" });

      expect(dbMock.updateCalls[0]?.values).toMatchObject({ status: "confirmed" });
      expect(notifyWorker).toHaveBeenCalledWith("confirm", "apt_1", TENANT, null);
    });

    it("master cannot confirm an unassigned appointment (masterId=null)", async () => {
      const dbMock = createDbMock([
        [{ status: "pending", cancelled: 0, masterId: null }],
      ]);
      const caller = masterCaller(dbMock.db);

      await expect(
        caller.confirmAppointment({ tenantId: TENANT, id: "apt_unassigned" }),
      ).rejects.toThrow(/Unassigned appointment/);
      expect(notifyWorker).not.toHaveBeenCalled();
    });
  });

  describe("markDone", () => {
    it("owner can mark done when start time has passed", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0, ts: PAST_TS, masterId: 42 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await caller.markDone({ tenantId: TENANT, id: "apt_1" });

      expect(dbMock.updateCalls[0]?.values).toMatchObject({ status: "done" });
      expect(notifyWorker).toHaveBeenCalledWith("done", "apt_1", TENANT, null);
    });

    it("rejects when ts is still in the future", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0, ts: FUTURE_TS, masterId: 42 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.markDone({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/cannot_mark_done_before_start/);
      expect(notifyWorker).not.toHaveBeenCalled();
    });

    it("rejects already-cancelled rows", async () => {
      const dbMock = createDbMock([
        [{ status: "cancelled", cancelled: 1, ts: PAST_TS, masterId: 42 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.markDone({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/invalid_status_transition/);
    });
  });

  describe("markNoShow", () => {
    it("fires notifyWorker no_show_client (owner caller)", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.markNoShow({
        tenantId: TENANT,
        id: "apt_1",
        noShowBy: "client",
      });

      expect(notifyWorker).toHaveBeenCalledWith("no_show_client", "apt_1", TENANT, null);
    });
  });
});

/**
 * Salon-level master-schedule policy + in-app approval workflow.
 *
 *   - salon.updateSalonProfile persists `masterSchedulePolicy` into tenants.salon.
 *   - master.getSchedulePolicy reads it back (default master_free).
 *   - master.updateWorkHours enforces the policy for the `master` role:
 *       salon_only      → FORBIDDEN
 *       master_free     → writes masters directly
 *       master_approval → creates/updates a pending tenantActionRequests row,
 *                         does NOT touch masters
 *   - salon.reviewMasterScheduleRequest applies (approve) / rejects (deny).
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
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  },
}));
vi.mock("~/server/audit/auditLog", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => undefined),
}));
// Isolate the unit under test from the notification fan-out (it does its own
// D1 reads/writes); assert it was invoked with the right recipient instead.
const notifyOrCaptureMock = vi.fn(
  (..._args: unknown[]): Promise<{ bellQueued: boolean }> => Promise.resolve({ bellQueued: true }),
);
vi.mock("~/server/services/notifyOrCapture", () => ({
  notifyOrCapture: (...args: unknown[]) => notifyOrCaptureMock(...args),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { salonRouter } from "~/server/api/routers/salon";
import {
  createDbMock,
  makeMasterCtx,
  makeTenantOwnerCtx,
  makeForbiddenWebCtx,
} from "./helpers/db-mock";

const NOW = 1_715_000_000;
const callMaster = createCallerFactory(masterRouter);
const callSalon = createCallerFactory(salonRouter);

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  notifyOrCaptureMock.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("salon.updateSalonProfile — masterSchedulePolicy", () => {
  it("persists the policy into the tenants.salon JSON blob", async () => {
    const { db, updateCalls } = createDbMock([[{ salon: null }]]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = callSalon(ctx as never);
    await caller.updateSalonProfile({ tenantId: "t_alpha", masterSchedulePolicy: "master_approval" });
    const tenantsWrite = updateCalls.find((c) => "salon" in c.values);
    expect(tenantsWrite).toBeTruthy();
    expect(JSON.parse(String(tenantsWrite!.values.salon))).toMatchObject({
      masterSchedulePolicy: "master_approval",
    });
  });

  it("rejects an unknown policy value", async () => {
    const { db } = createDbMock([[{ salon: null }]]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = callSalon(ctx as never);
    await expect(
      // @ts-expect-error — intentionally invalid enum value
      caller.updateSalonProfile({ tenantId: "t_alpha", masterSchedulePolicy: "bogus" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("master.getSchedulePolicy", () => {
  it("returns the configured policy", async () => {
    const { db } = createDbMock([
      [{ chatId: 100 }], // assertCallerIsMaster bound row
      [{ salon: '{"masterSchedulePolicy":"salon_only"}' }],
    ]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    const r = await caller.getSchedulePolicy({ tenantId: "t_alpha", masterId: 100 });
    expect(r).toEqual({ policy: "salon_only" });
  });

  it("defaults to master_free for an unconfigured salon", async () => {
    const { db } = createDbMock([[{ chatId: 100 }], [{ salon: null }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    const r = await caller.getSchedulePolicy({ tenantId: "t_alpha", masterId: 100 });
    expect(r).toEqual({ policy: "master_free" });
  });
});

describe("master.updateWorkHours — policy enforcement (master role)", () => {
  it("salon_only → FORBIDDEN, no write", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([
      [{ chatId: 100 }],
      [{ salon: '{"masterSchedulePolicy":"salon_only"}' }],
    ]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    await expect(
      caller.updateWorkHours({ tenantId: "t_alpha", masterId: 100, workHours: '{"from":10,"to":18}' }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });

  it("master_free → writes masters directly", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([
      [{ chatId: 100 }],
      [{ salon: '{"masterSchedulePolicy":"master_free"}' }],
    ]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    const r = await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      workHours: '{"from":10,"to":18}',
      workDays: "[1,2,3,4,5,6]",
    });
    expect(r).toMatchObject({ success: true });
    expect(updateCalls.at(-1)!.values).toEqual({
      workHours: '{"from":10,"to":18}',
      workDays: "[1,2,3,4,5,6]",
    });
    expect(insertCalls.length).toBe(0);
  });

  it("master_approval → creates a pending request, does NOT touch masters, notifies owner", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([
      [{ chatId: 100 }],
      [{ salon: '{"masterSchedulePolicy":"master_approval"}' }],
      [], // no existing pending request
      [{ id: "w_owner" }], // owner web user
    ]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    const r = await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      workHours: '{"from":11,"to":19}',
      workDays: "[2,4]",
    });
    expect(r).toMatchObject({ pending: true });
    // No masters write.
    expect(updateCalls.length).toBe(0);
    // A tenantActionRequests row was inserted with the normalized payload.
    expect(insertCalls.length).toBe(1);
    const ins = insertCalls[0]!.values;
    expect(ins.action).toBe("master.schedule_change");
    expect(ins.status).toBe("pending");
    expect(JSON.parse(String(ins.payload))).toEqual({
      masterId: 100,
      workHours: '{"from":11,"to":19}',
      workDays: "[2,4]",
    });
    // Owner got a bell notification.
    expect(notifyOrCaptureMock).toHaveBeenCalledTimes(1);
    expect((notifyOrCaptureMock.mock.calls[0]![1] as { webUserId: string }).webUserId).toBe("w_owner");
  });

  it("master_approval re-submit updates the existing pending request (no duplicate)", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([
      [{ chatId: 100 }],
      [{ salon: '{"masterSchedulePolicy":"master_approval"}' }],
      [{ id: "req_existing" }], // existing pending request
      [{ id: "w_owner" }],
    ]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = callMaster(ctx as never);
    await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      workHours: '{"from":9,"to":17}',
      workDays: "[1,2,3,4,5]",
    });
    expect(insertCalls.length).toBe(0); // updated, not inserted
    const reqUpdate = updateCalls.find((c) => "payload" in c.values);
    expect(reqUpdate).toBeTruthy();
    expect(JSON.parse(String(reqUpdate!.values.payload))).toEqual({
      masterId: 100,
      workHours: '{"from":9,"to":17}',
      workDays: "[1,2,3,4,5]",
    });
  });
});

describe("salon.reviewMasterScheduleRequest", () => {
  const PENDING_REQ = {
    id: "req1",
    tenantId: "t_alpha",
    requesterId: "w_master",
    action: "master.schedule_change",
    status: "pending",
    payload: '{"masterId":100,"workHours":"{\\"from\\":10,\\"to\\":18}","workDays":"[1,2,3]"}',
  };

  it("approved → applies the schedule to masters + marks executed + notifies the master", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([[PENDING_REQ]]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = callSalon(ctx as never);
    const r = await caller.reviewMasterScheduleRequest({ requestId: "req1", decision: "approved" });
    expect(r).toMatchObject({ success: true });
    const mastersWrite = updateCalls.find((c) => "workHours" in c.values);
    expect(mastersWrite!.values).toEqual({ workHours: '{"from":10,"to":18}', workDays: "[1,2,3]" });
    const reqWrite = updateCalls.find((c) => "status" in c.values);
    expect(reqWrite!.values).toMatchObject({ status: "executed" });
    // auditLog row written.
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // Master notified.
    expect((notifyOrCaptureMock.mock.calls[0]![1] as { webUserId: string }).webUserId).toBe("w_master");
  });

  it("denied → does NOT write masters, marks denied", async () => {
    const { db, updateCalls } = createDbMock([[PENDING_REQ]]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = callSalon(ctx as never);
    await caller.reviewMasterScheduleRequest({ requestId: "req1", decision: "denied" });
    expect(updateCalls.find((c) => "workHours" in c.values)).toBeUndefined();
    expect(updateCalls.find((c) => "status" in c.values)!.values).toMatchObject({ status: "denied" });
  });

  it("cross-tenant owner cannot review another tenant's request", async () => {
    const { db } = createDbMock([[PENDING_REQ]]);
    const ctx = makeForbiddenWebCtx(db); // owner of t_demo
    const caller = callSalon(ctx as never);
    await expect(
      caller.reviewMasterScheduleRequest({ requestId: "req1", decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

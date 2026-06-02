/**
 * Migration 0060 — master.public_hidden + master.vacation_from / vacation_until.
 *
 * Two distinct concerns covered here:
 *
 *   1. salon.setMasterPublicHidden (Booksy-style "hide from public profile"
 *      toggle). Owner-only mutation; flips the new `public_hidden` column.
 *   2. master.setVacation (date range). Replaces the simple boolean
 *      vacation flag with a closed [from, until] window. Keeps the legacy
 *      `on_vacation` column in sync so Worker booking paths that still
 *      read the bool don't lag the source of truth.
 *
 * Pre-existing `updateWorkHours({ onVacation: 0 })` now also clears the
 * pinned range — a 1→0 flip without that would leave a stale future end
 * date on the row.
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
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { salonRouter } from "~/server/api/routers/salon";
import {
  createDbMock,
  makeMasterCtx,
  makeTenantOwnerCtx,
  makeAdminCtx,
} from "./helpers/db-mock";

const DAY = 86_400;
const NOW = 1_715_000_000; // 2024-05-06 — well before the 2y cap

describe("salon.setMasterPublicHidden (migration 0060)", () => {
  const createCaller = createCallerFactory(salonRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tenant_owner can hide a master from the public profile", async () => {
    const { db, updateCalls } = createDbMock([]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const r = await caller.setMasterPublicHidden({
      tenantId: "t_alpha",
      chatId: 100,
      hidden: 1,
    });
    expect(r).toEqual({ success: true });
    expect(updateCalls.at(-1)!.values).toEqual({ publicHidden: 1 });
  });

  it("tenant_owner can un-hide a previously hidden master", async () => {
    const { db, updateCalls } = createDbMock([]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.setMasterPublicHidden({ tenantId: "t_alpha", chatId: 100, hidden: 0 });
    expect(updateCalls.at(-1)!.values).toEqual({ publicHidden: 0 });
  });

  it("non-owner is rejected", async () => {
    const { db } = createDbMock([]);
    // A master is not a tenant_owner; even on the same tenant they must not
    // be able to flip the public toggle for the salon's roster.
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.setMasterPublicHidden({ tenantId: "t_alpha", chatId: 100, hidden: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("masterRouter.setVacation (migration 0060)", () => {
  const createCaller = createCallerFactory(masterRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("master sets a future range (legacy on_vacation stays 0 until window opens)", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);

    const from = NOW + 7 * DAY;
    const until = NOW + 14 * DAY;
    const r = await caller.setVacation({
      tenantId: "t_alpha",
      masterId: 100,
      vacationFrom: from,
      vacationUntil: until,
    });
    expect(r).toEqual({ success: true, onVacation: false });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: from,
      vacationUntil: until,
      onVacation: 0,
    });
  });

  it("master sets a range that includes NOW — legacy bool flips to 1", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const from = NOW - DAY;
    const until = NOW + 3 * DAY;
    const r = await caller.setVacation({
      tenantId: "t_alpha",
      masterId: 100,
      vacationFrom: from,
      vacationUntil: until,
    });
    expect(r).toEqual({ success: true, onVacation: true });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: from,
      vacationUntil: until,
      onVacation: 1,
    });
  });

  it("master clears vacation by passing both nulls", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.setVacation({
      tenantId: "t_alpha",
      masterId: 100,
      vacationFrom: null,
      vacationUntil: null,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: null,
      vacationUntil: null,
      onVacation: 0,
    });
  });

  it("rejects mixed null + non-null pair (must be both)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.setVacation({
        tenantId: "t_alpha",
        masterId: 100,
        vacationFrom: NOW,
        vacationUntil: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects inverted range (until < from)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.setVacation({
        tenantId: "t_alpha",
        masterId: 100,
        vacationFrom: NOW + 7 * DAY,
        vacationUntil: NOW,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects ranges longer than 2 years", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.setVacation({
        tenantId: "t_alpha",
        masterId: 100,
        vacationFrom: NOW,
        vacationUntil: NOW + 3 * 365 * DAY,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("blocks another master from writing this master's row (IDOR)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.setVacation({
        tenantId: "t_alpha",
        masterId: 999,
        vacationFrom: NOW,
        vacationUntil: NOW + DAY,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin can override (support escalation)", async () => {
    const { db, updateCalls } = createDbMock([]);
    const ctx = makeAdminCtx(db);
    const caller = createCaller(ctx as never);
    await caller.setVacation({
      tenantId: "t_alpha",
      masterId: 100,
      vacationFrom: NOW,
      vacationUntil: NOW + DAY,
    });
    expect(updateCalls.at(-1)!.values).toMatchObject({
      vacationFrom: NOW,
      vacationUntil: NOW + DAY,
      onVacation: 1,
    });
  });

  it("updateWorkHours({ onVacation: 0 }) clears the pinned range too", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      onVacation: 0,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      onVacation: 0,
      vacationFrom: null,
      vacationUntil: null,
    });
  });

  it("updateWorkHours({ onVacation: 1 }) does NOT clobber an existing range", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      onVacation: 1,
    });
    expect(updateCalls.at(-1)!.values).toEqual({ onVacation: 1 });
  });
});

describe("masterRouter.updateWorkHours — schedule (workHours + workDays)", () => {
  const createCaller = createCallerFactory(masterRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("master persists their own {from,to} window + working days (normalized)", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateWorkHours({
      tenantId: "t_alpha",
      masterId: 100,
      workHours: '{"from":11,"to":19}',
      workDays: "[3,1,2]",
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      workHours: '{"from":11,"to":19}',
      workDays: "[1,2,3]",
    });
  });

  it("rejects an inverted workHours window", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateWorkHours({
        tenantId: "t_alpha",
        masterId: 100,
        workHours: '{"from":20,"to":8}',
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("another master cannot write this master's schedule (IDOR)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateWorkHours({
        tenantId: "t_alpha",
        masterId: 999,
        workHours: '{"from":10,"to":18}',
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

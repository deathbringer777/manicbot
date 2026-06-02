/**
 * salon.updateMaster — owner-side edit of a master profile.
 *
 * Owner UX parity with the Clients tab: clicking a row in /dashboard?tab=masters
 * opens a detail modal where the salon owner can edit name / Telegram handle /
 * bio / photo / vacation range for the masters they manage.
 *
 * Origin gating (migration 0063):
 *   - salon_created    → always editable (salon owns the account)
 *   - invited_email    → editable only if masters.allow_delegation = 1
 *   - invited_telegram → editable only if masters.allow_delegation = 1
 *   - self_registered  → never editable by owner (the master owns their profile)
 *
 * Vacation rules mirror master.setVacation: both-or-neither, range no longer
 * than 2 years, on_vacation derived from "now ∈ [from, until]".
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
  sendMasterInviteExistingUserEmail: vi.fn(async () => undefined),
  sendMasterInviteNewUserEmail: vi.fn(async () => undefined),
  sendMasterPasswordResetCredentialsToOwnerEmail: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import {
  createDbMock,
  makeMasterCtx,
  makeTenantOwnerCtx,
  makeForbiddenWebCtx,
} from "./helpers/db-mock";

const DAY = 86_400;
const NOW = 1_715_000_000;

const createCaller = createCallerFactory(salonRouter);

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("salon.updateMaster — origin gating", () => {
  it("tenant_owner can update a salon_created master's name and bio", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const r = await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      name: "Olga",
      bio: "Top-tier nail tech",
    });
    expect(r).toEqual({ success: true });
    expect(updateCalls.at(-1)!.values).toEqual({
      name: "Olga",
      bio: "Top-tier nail tech",
    });
  });

  it("invited_email master with allowDelegation=1 IS editable", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "invited_email", allowDelegation: 1 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 555,
      bio: "Bio set by owner",
    });
    expect(updateCalls.at(-1)!.values).toEqual({ bio: "Bio set by owner" });
  });

  it("invited_email master without delegation is rejected", async () => {
    const { db } = createDbMock([
      [{ origin: "invited_email", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 555, bio: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("invited_telegram master without delegation is rejected", async () => {
    const { db } = createDbMock([
      [{ origin: "invited_telegram", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 555, name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("self_registered master is NEVER editable by owner", async () => {
    const { db } = createDbMock([
      [{ origin: "self_registered", allowDelegation: 1 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 555, bio: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("missing master row → NOT_FOUND", async () => {
    const { db } = createDbMock([[]]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 999, bio: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("salon.updateMaster — authorization", () => {
  it("plain master role (not owner) is rejected", async () => {
    const { db } = createDbMock([]);
    const ctx = makeMasterCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 100, bio: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cross-tenant attack: owner of t_other cannot edit master in t_alpha", async () => {
    const { db } = createDbMock([]);
    // makeForbiddenWebCtx is owner of t_demo
    const ctx = makeForbiddenWebCtx(db);
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({ tenantId: "t_alpha", chatId: 100, bio: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("salon.updateMaster — vacation handling", () => {
  it("sets a future range, on_vacation stays 0 until window opens", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const from = NOW + 7 * DAY;
    const until = NOW + 14 * DAY;
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      vacationFrom: from,
      vacationUntil: until,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: from,
      vacationUntil: until,
      onVacation: 0,
    });
  });

  it("sets a range covering NOW — on_vacation flips to 1", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const from = NOW - DAY;
    const until = NOW + 3 * DAY;
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      vacationFrom: from,
      vacationUntil: until,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: from,
      vacationUntil: until,
      onVacation: 1,
    });
  });

  it("clears vacation when both dates are null", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      vacationFrom: null,
      vacationUntil: null,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      vacationFrom: null,
      vacationUntil: null,
      onVacation: 0,
    });
  });

  it("rejects mixed null/non-null vacation pair", async () => {
    const { db } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 10_000_000_001,
        vacationFrom: NOW,
        vacationUntil: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects inverted range (until < from)", async () => {
    const { db } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 10_000_000_001,
        vacationFrom: NOW + 7 * DAY,
        vacationUntil: NOW,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects ranges longer than 2 years", async () => {
    const { db } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const TWO_YEARS_PLUS_ONE = 2 * 365 * DAY + DAY;
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 10_000_000_001,
        vacationFrom: NOW,
        vacationUntil: NOW + TWO_YEARS_PLUS_ONE,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("onVacation=0 toggle clears any pinned range", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      onVacation: 0,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      onVacation: 0,
      vacationFrom: null,
      vacationUntil: null,
    });
  });
});

describe("salon.updateMaster — sanitization + no-op", () => {
  it("nullable text fields are written as NULL when empty", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      bio: "",
      photo: "",
      tgUsername: null,
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      bio: null,
      photo: null,
      tgUsername: null,
    });
  });

  it("no fields provided → no UPDATE call (still success:true)", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    const r = await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
    });
    expect(r).toEqual({ success: true });
    expect(updateCalls.length).toBe(0);
  });
});

describe("salon.updateMaster — schedule (workHours + workDays)", () => {
  it("persists a {from,to} window + working days for a salon_created master", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      workHours: '{"from":10,"to":18}',
      workDays: "[1,2,3,4,5,6]",
    });
    expect(updateCalls.at(-1)!.values).toEqual({
      workHours: '{"from":10,"to":18}',
      workDays: "[1,2,3,4,5,6]",
    });
  });

  it("normalizes a messy workDays payload (sort + de-dupe + clamp to 0..6)", async () => {
    const { db, updateCalls } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await caller.updateMaster({
      tenantId: "t_alpha",
      chatId: 10_000_000_001,
      workDays: "[3,1,1,9,2]",
    });
    expect(updateCalls.at(-1)!.values).toEqual({ workDays: "[1,2,3]" });
  });

  it("rejects an inverted workHours window", async () => {
    const { db } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 10_000_000_001,
        workHours: '{"from":18,"to":10}',
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a non-array workDays payload", async () => {
    const { db } = createDbMock([
      [{ origin: "salon_created", allowDelegation: 0 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 10_000_000_001,
        workDays: '{"mon":true}',
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a self_registered master's schedule is NOT writable by the owner", async () => {
    const { db } = createDbMock([
      [{ origin: "self_registered", allowDelegation: 1 }],
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alpha");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateMaster({
        tenantId: "t_alpha",
        chatId: 555,
        workHours: '{"from":10,"to":18}',
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

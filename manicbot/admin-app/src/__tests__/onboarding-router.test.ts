/**
 * onboarding router — integration tests for the `getStatus` procedure.
 *
 * 2026-05-27 rework: the legacy 10-id checklist became a 4 + 4 split.
 *
 * Essentials (block the booking flow): connect_bot / add_master /
 *   set_master_schedule / add_service.
 * Optional (public-page polish): fill_salon_info / add_branding /
 *   activate_public / share_link.
 *
 * Dropped ids (no longer reported): add_logo + add_cover (merged into
 * add_branding which is AND of both), first_booking (vanity, not a gate).
 *
 * `assertTenantOwner` fast-paths for system_admin sessions without
 * touching the db, so `makeAdminCtx` produces a ctx with exactly the
 * SELECTs `getStatus` needs.
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
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { onboardingRouter } from "~/server/api/routers/onboarding";
import { createDbMock, makeAdminCtx } from "./helpers/db-mock";

// SELECT order in onboardingRouter.getStatus (Promise.all + trailing
// schedule query). Slots:
//   [0] services count
//   [1] bots count
//   [2] masters count
//   [3] tenant_onboarding row (manual steps JSON)
//   [4] tenants row (description / logo / cover_photo / public_active)
//   [5] masters-with-workHours count
function seedSelects(opts: {
  services?: number;
  bots?: number;
  masters?: number;
  manualSteps?: string[];
  readyDismissedAt?: number | null;
  description?: string | null;
  logo?: string | null;
  coverPhoto?: string | null;
  publicActive?: number;
  schedule?: number;
}) {
  return [
    [{ n: opts.services ?? 0 }],
    [{ n: opts.bots ?? 0 }],
    [{ n: opts.masters ?? 0 }],
    // The tenant_onboarding row carries BOTH the manual-steps JSON and the
    // server-persisted ready-dismiss marker, so emit it when either is set.
    (opts.manualSteps || opts.readyDismissedAt !== undefined)
      ? [{
          completedSteps: JSON.stringify(opts.manualSteps ?? []),
          readyDismissedAt: opts.readyDismissedAt ?? null,
        }]
      : [],
    [{
      description: opts.description ?? null,
      logo: opts.logo ?? null,
      coverPhoto: opts.coverPhoto ?? null,
      publicActive: opts.publicActive ?? 0,
    }],
    [{ n: opts.schedule ?? 0 }],
  ];
}

describe("onboardingRouter.getStatus", () => {
  const createCaller = createCallerFactory(onboardingRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns zero completed steps and totalSteps=8 on a freshly-provisioned tenant", async () => {
    const { db } = createDbMock(seedSelects({}));
    const caller = createCaller(makeAdminCtx(db) as never);
    const res = await caller.getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toEqual([]);
    expect(res.totalSteps).toBe(8);
    expect(res.allCompletedAt).toBeNull();
  });

  it("marks add_service / connect_bot / add_master / set_master_schedule independently when the underlying counts flip", async () => {
    const { db } = createDbMock(
      seedSelects({ services: 1, bots: 1, masters: 1, schedule: 1 }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toEqual(
      expect.arrayContaining([
        "add_service",
        "connect_bot",
        "add_master",
        "set_master_schedule",
      ]),
    );
    expect(res.completedSteps).toHaveLength(4);
  });

  it("marks fill_salon_info when tenants.description is non-empty", async () => {
    const { db } = createDbMock(
      seedSelects({ description: "Профессиональный салон в центре Варшавы" }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("fill_salon_info");
  });

  it("does NOT mark fill_salon_info for whitespace-only descriptions (defensive trim)", async () => {
    const { db } = createDbMock(seedSelects({ description: "   \n  " }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).not.toContain("fill_salon_info");
  });

  it("add_branding requires BOTH logo and coverPhoto — logo alone is not enough", async () => {
    const { db } = createDbMock(
      seedSelects({ logo: "https://r2.example/logo.png", coverPhoto: null }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).not.toContain("add_branding");
  });

  it("add_branding requires BOTH logo and coverPhoto — cover alone is not enough", async () => {
    const { db } = createDbMock(
      seedSelects({ logo: null, coverPhoto: "https://r2.example/cover.jpg" }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).not.toContain("add_branding");
  });

  it("add_branding flips ON when logo AND coverPhoto are both non-empty", async () => {
    const { db } = createDbMock(
      seedSelects({
        logo: "https://r2.example/logo.png",
        coverPhoto: "https://r2.example/cover.jpg",
      }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("add_branding");
  });

  it("marks activate_public ONLY when tenants.public_active === 1 (treats 0 / null as off)", async () => {
    for (const v of [0, null] as const) {
      const { db } = createDbMock(seedSelects({ publicActive: v as number }));
      const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
      expect(res.completedSteps).not.toContain("activate_public");
    }
    const { db } = createDbMock(seedSelects({ publicActive: 1 }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("activate_public");
  });

  it("share_link honors the persisted tenant_onboarding manualSteps flag", async () => {
    const { db } = createDbMock(seedSelects({ manualSteps: ["share_link"] }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("share_link");
  });

  it("never reports the dropped legacy ids (add_logo / add_cover / first_booking / invite_master / set_schedule / fill_description)", async () => {
    const { db } = createDbMock(
      seedSelects({
        services: 1,
        bots: 1,
        masters: 1,
        manualSteps: ["share_link"],
        description: "x",
        logo: "logo.png",
        coverPhoto: "cover.jpg",
        publicActive: 1,
        schedule: 1,
      }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    const ids = res.completedSteps as readonly string[];
    expect(ids).not.toContain("add_logo");
    expect(ids).not.toContain("add_cover");
    expect(ids).not.toContain("first_booking");
    expect(ids).not.toContain("invite_master");
    expect(ids).not.toContain("set_schedule");
    expect(ids).not.toContain("fill_description");
  });

  it("marks every step in concert on a fully-set-up tenant — 8 / 8", async () => {
    const { db } = createDbMock(
      seedSelects({
        services: 3,
        bots: 1,
        masters: 2,
        manualSteps: ["share_link"],
        description: "Описание",
        logo: "logo.png",
        coverPhoto: "cover.jpg",
        publicActive: 1,
        schedule: 1,
      }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toEqual(
      expect.arrayContaining([
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
        "fill_salon_info",
        "add_branding",
        "activate_public",
        "share_link",
      ]),
    );
    expect(res.completedSteps).toHaveLength(8);
    expect(res.totalSteps).toBe(8);
  });

  it("returns 4 essentials done when only operational signals are set — public-polish ids stay off", async () => {
    const { db } = createDbMock(
      seedSelects({
        services: 1,
        bots: 1,
        masters: 1,
        schedule: 1,
        // No description / logo / cover / public_active / share.
      }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toHaveLength(4);
    expect(res.completedSteps).toEqual(
      expect.arrayContaining([
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
      ]),
    );
    expect(res.totalSteps).toBe(8);
    expect(res.allCompletedAt).toBeNull();
  });
});

describe("onboardingRouter.getStatus — ready-dismiss persistence", () => {
  const createCaller = createCallerFactory(onboardingRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("readyDismissed defaults to false when no tenant_onboarding row exists", async () => {
    const { db } = createDbMock(seedSelects({ services: 1, bots: 1, masters: 1, schedule: 1 }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.readyDismissed).toBe(false);
  });

  it("readyDismissed is true when essentials are 4/4 AND ready_dismissed_at is set", async () => {
    const { db } = createDbMock(
      seedSelects({ services: 1, bots: 1, masters: 1, schedule: 1, readyDismissedAt: 1700000000 }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.readyDismissed).toBe(true);
  });

  it("readyDismissed RESURFACES (false) when an essential regresses even though ready_dismissed_at is still set", async () => {
    // 3/4 essentials (schedule lost) but the owner had dismissed the bar earlier.
    const { db } = createDbMock(
      seedSelects({ services: 1, bots: 1, masters: 1, schedule: 0, readyDismissedAt: 1700000000 }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.readyDismissed).toBe(false);
  });
});

describe("onboardingRouter.setReadyDismissed", () => {
  const createCaller = createCallerFactory(onboardingRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("inserts a ready_dismissed_at timestamp when dismissing a tenant with no onboarding row yet", async () => {
    // [0] = "find existing row" SELECT → empty → insert path.
    const { db, insertCalls } = createDbMock([[]]);
    const res = await createCaller(makeAdminCtx(db) as never).setReadyDismissed({
      tenantId: "t_demo",
      dismissed: true,
    });
    expect(res.ok).toBe(true);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.values.readyDismissedAt).toBeTypeOf("number");
  });

  it("updates ready_dismissed_at when a row already exists", async () => {
    const { db, updateCalls } = createDbMock([[{ completedSteps: "[]", readyDismissedAt: null }]]);
    const res = await createCaller(makeAdminCtx(db) as never).setReadyDismissed({
      tenantId: "t_demo",
      dismissed: true,
    });
    expect(res.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values.readyDismissedAt).toBeTypeOf("number");
  });

  it("clears ready_dismissed_at (null) when dismissed=false", async () => {
    const { db, updateCalls } = createDbMock([[{ completedSteps: "[]", readyDismissedAt: 1700000000 }]]);
    const res = await createCaller(makeAdminCtx(db) as never).setReadyDismissed({
      tenantId: "t_demo",
      dismissed: false,
    });
    expect(res.ok).toBe(true);
    expect(updateCalls[0]!.values.readyDismissedAt).toBeNull();
  });
});

/**
 * onboarding router — integration tests for the `getStatus` procedure.
 *
 * The 2026-05-16 dashboard cleanup merged the legacy `ProfileCompletenessCard`
 * gamification widget into the operational onboarding checklist. `STEP_IDS`
 * went from 6 to 10 — the four new ids (`fill_description`, `add_logo`,
 * `add_cover`, `activate_public`) are derived from the `tenants` table.
 *
 * These tests pin the derivation so a future tenants-schema refactor (a
 * column rename, an `active` flag change, the description being moved into
 * a JSON blob) can't silently break the visible checklist completeness
 * without surfacing a red CI build.
 *
 * The router calls `assertTenantOwner` which fast-paths for system_admin
 * sessions without hitting the db — that's what `makeAdminCtx` produces,
 * so the seven SELECTs the router runs are exactly the ones our mock
 * needs to seed (in FIFO order).
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

// Order matches the Promise.all + the trailing scheduleRows query in
// onboardingRouter.getStatus. Slots:
//   [0] services count
//   [1] bots count
//   [2] masters count
//   [3] appointments count
//   [4] tenant_onboarding row (manual steps JSON)
//   [5] tenants row (description / logo / cover_photo / public_active)
//   [6] masters-with-workHours count
function seedSelects(opts: {
  services?: number;
  bots?: number;
  masters?: number;
  appointments?: number;
  manualSteps?: string[];
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
    [{ n: opts.appointments ?? 0 }],
    opts.manualSteps
      ? [{ completedSteps: JSON.stringify(opts.manualSteps) }]
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

  it("returns zero completed steps and totalSteps=10 on a freshly-provisioned tenant", async () => {
    const { db } = createDbMock(seedSelects({}));
    const caller = createCaller(makeAdminCtx(db) as never);
    const res = await caller.getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toEqual([]);
    expect(res.totalSteps).toBe(10);
    expect(res.allCompletedAt).toBeNull();
  });

  it("marks fill_description when tenants.description is non-empty", async () => {
    const { db } = createDbMock(
      seedSelects({ description: "Профессиональный салон в центре Варшавы" }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("fill_description");
  });

  it("does NOT mark fill_description for whitespace-only descriptions (defensive trim)", async () => {
    const { db } = createDbMock(seedSelects({ description: "   \n  " }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).not.toContain("fill_description");
  });

  it("marks add_logo when tenants.logo is non-empty", async () => {
    const { db } = createDbMock(seedSelects({ logo: "https://r2.example/logo.png" }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("add_logo");
  });

  it("marks add_cover when tenants.cover_photo is non-empty", async () => {
    const { db } = createDbMock(seedSelects({ coverPhoto: "https://r2.example/cover.jpg" }));
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toContain("add_cover");
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

  it("marks every operational step in concert with the new profile signals on a fully-set-up tenant", async () => {
    const { db } = createDbMock(
      seedSelects({
        services: 3,
        bots: 1,
        masters: 2,
        appointments: 1,
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
        "add_service",
        "connect_bot",
        "invite_master",
        "set_schedule",
        "share_link",
        "first_booking",
        "fill_description",
        "add_logo",
        "add_cover",
        "activate_public",
      ]),
    );
    expect(res.completedSteps).toHaveLength(10);
  });

  it("returns an empty allCompletedAt when only profile signals are missing — totalSteps still 10", async () => {
    const { db } = createDbMock(
      seedSelects({
        services: 1,
        bots: 1,
        masters: 1,
        appointments: 1,
        manualSteps: ["share_link"],
        schedule: 1,
        // No description / logo / cover / public_active.
      }),
    );
    const res = await createCaller(makeAdminCtx(db) as never).getStatus({ tenantId: "t_demo" });
    expect(res.completedSteps).toHaveLength(6);
    expect(res.totalSteps).toBe(10);
    expect(res.allCompletedAt).toBeNull();
  });
});

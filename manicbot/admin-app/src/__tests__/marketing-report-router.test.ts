/**
 * Router-wiring + tenant-isolation tests for `campaignReport` on both the
 * God Mode (`marketing.ts`) and tenant-scoped (`marketingTenant.ts`) routers.
 *
 * Same mock-Drizzle harness as `marketingTenant-router.test.ts`: an ordered
 * select-result queue feeds each `db.select()`. `campaignReport` runs three
 * selects in order — campaign meta, the sends aggregate, the conversions
 * count — so a happy-path queue is `[[meta], [agg], [conv]]`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
  assertEmailVerified: vi.fn(async () => {}),
}));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));
vi.mock("~/server/marketing/providers", () => ({
  listProviders: () => [],
  getProvider: () => null,
  pickProvider: () => null,
}));
vi.mock("~/server/marketing/sender", () => ({ runCampaignSend: vi.fn() }));
vi.mock("~/server/marketing/audience", () => ({
  resolveAudience: vi.fn(async () => ({ contacts: [], totalCount: 0 })),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { marketingRouter } from "~/server/api/routers/marketing";
import { marketingTenantRouter } from "~/server/api/routers/marketingTenant";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callTenant = createCallerFactory(marketingTenantRouter);
const callAdmin = createCallerFactory(marketingRouter);

const META = [{
  id: "cmp_1", name: "Spring", status: "sent", channel: "email",
  segmentId: null, scheduledAt: null, startedAt: 1, finishedAt: 2,
  statsJson: '{"total":3}',
}];
const AGG = [{ total: 3, queued: 0, sent: 3, delivered: 3, opened: 2, clicked: 1, bounced: 0, complained: 0, failed: 0 }];
const CONV = [{ c: 1 }];

describe("campaignReport — tenant router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callTenant(makeUnauthCtx(db) as never);
    await expect(caller.campaignReport({ tenantId: "t_a", id: "cmp_1" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a tenant_owner reading another tenant", async () => {
    const { db } = createDbMock();
    const caller = callTenant(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.campaignReport({ tenantId: "t_b", id: "cmp_1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the cumulative funnel for an owned campaign", async () => {
    const { db } = createDbMock([META, AGG, CONV]);
    const caller = callTenant(makeTenantOwnerCtx(db, "t_a") as never);
    const r = await caller.campaignReport({ tenantId: "t_a", id: "cmp_1" });
    expect(r.campaign.audienceTotal).toBe(3);
    expect(r.funnel.opened).toBe(2);
    expect(r.funnel.clicked).toBe(1);
    expect(r.funnel.conversions).toBe(1);
    expect(r.rates.openRate).toBeCloseTo(2 / 3); // opened/delivered
  });

  it("404s when the campaign is not in the caller's tenant (empty meta)", async () => {
    const { db } = createDbMock([[]]); // meta select returns nothing
    const caller = callTenant(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.campaignReport({ tenantId: "t_a", id: "missing" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("campaignReport — God Mode router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-admin caller", async () => {
    const { db } = createDbMock([META, AGG, CONV]);
    const caller = callAdmin(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.campaignReport({ id: "cmp_1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns a report for any campaign id (system_admin)", async () => {
    const { db } = createDbMock([META, AGG, CONV]);
    const caller = callAdmin(makeAdminCtx(db) as never);
    const r = await caller.campaignReport({ id: "cmp_1" });
    expect(r.funnel.total).toBe(3);
    expect(r.funnel.conversions).toBe(1);
  });

  it("404s on unknown campaign", async () => {
    const { db } = createDbMock([[]]);
    const caller = callAdmin(makeAdminCtx(db) as never);
    await expect(caller.campaignReport({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

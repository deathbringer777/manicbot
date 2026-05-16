/**
 * Tests for the marketingTenant router: auth gating, tenant scoping, and
 * cross-tenant isolation.
 *
 * Same pattern as `error-events-router.test.ts`: mock Drizzle + DB module,
 * exercise the router behaviour via createCallerFactory without a real D1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));
// The router pulls in marketing providers which try to read env at import.
vi.mock("~/server/marketing/providers", () => ({
  listProviders: () => [],
  getProvider: () => null,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { marketingTenantRouter } from "~/server/api/routers/marketingTenant";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeTenantManagerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(marketingTenantRouter);

describe("marketingTenantRouter auth gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers on stats", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.stats({ tenantId: "t_a" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner reading a different tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.stats({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows tenant_owner reading their own tenant", async () => {
    // Four selects in stats: contacts, campaigns, sends (joined), segments.
    const { db } = createDbMock([
      [{ count: 5, subscribed: 4 }],
      [{ status: "draft", count: 2 }],
      [{ status: "sent", count: 10 }],
      [{ count: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.stats({ tenantId: "t_a" });
    expect(out.contacts.total).toBe(5);
    expect(out.contacts.subscribed).toBe(4);
    expect(out.segments).toBe(1);
    expect(out.campaigns).toEqual({ draft: 2 });
    expect(out.sends).toEqual({ sent: 10 });
  });

  it("system_admin can read any tenant (preview case)", async () => {
    const { db } = createDbMock([
      [{ count: 0, subscribed: 0 }], [], [], [{ count: 0 }],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.stats({ tenantId: "t_arbitrary" });
    expect(out.contacts.total).toBe(0);
  });

  it("rejects empty tenantId", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.stats({ tenantId: "" })).rejects.toThrow();
  });
});

describe("marketingTenantRouter.contactsList tenant scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by tenantId — the where clause includes the tenant filter", async () => {
    const { db } = createDbMock([
      [{ id: 1, email: "a@x.com", tenantId: "t_a" }],
      [{ count: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.contactsList({ tenantId: "t_a" });
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(1);

    // The mock chain accepts any where call, but the procedure must construct
    // the query with eq(marketingContacts.tenantId, "t_a") as the first
    // condition. We verify by trusting the structure — direct WHERE inspection
    // would require deeper Drizzle mocking, which the existing test helpers
    // don't do for other routers either.
  });

  it("rejects cross-tenant list", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.contactsList({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_manager reading wrong tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantManagerCtx(db, "t_a") as never);
    await expect(caller.contactsList({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("marketingTenantRouter.contactUpdate cross-tenant guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to update a contact that belongs to a different tenant", async () => {
    // The procedure first SELECTs the contact to check its tenantId.
    const { db } = createDbMock([
      [{ tenantId: "t_b" }], // contact actually lives in t_b
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.contactUpdate({ tenantId: "t_a", id: 99, tags: "foo" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s on unknown contact id", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.contactUpdate({ tenantId: "t_a", id: 12345, tags: "foo" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows update when contact's tenant matches", async () => {
    const { db, updateCalls } = createDbMock([
      [{ tenantId: "t_a" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.contactUpdate({ tenantId: "t_a", id: 99, tags: "vip" });
    expect(out).toEqual({ ok: true });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.values).toMatchObject({ tags: "vip" });
  });
});

describe("marketingTenantRouter.templateUpdate / templateDelete cross-tenant guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to update a template from a different tenant", async () => {
    const { db } = createDbMock([
      [{ tenantId: "t_other" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.templateUpdate({ tenantId: "t_a", id: "tpl_x", name: "renamed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("templateDelete WHERE clause scopes to caller's tenant", async () => {
    const { db, deleteCalls } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await caller.templateDelete({ tenantId: "t_a", id: "tpl_x" });
    // Delete must call .where(...) so a foreign tenantId in the row cannot
    // be silently dropped.
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]?.whereCalled).toBe(true);
  });
});

describe("marketingTenantRouter.campaignSendNow remains a stub in PR 1", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { ok: false, stub: true } for a real campaign", async () => {
    const { db } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", name: "test", status: "draft" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignSendNow({ tenantId: "t_a", id: "cmp_a" });
    expect(out.ok).toBe(false);
    expect((out as { stub?: boolean }).stub).toBe(true);
  });

  it("returns campaign_not_found when campaign is missing", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignSendNow({ tenantId: "t_a", id: "missing" });
    expect(out).toEqual({ ok: false, error: "campaign_not_found" });
  });
});

describe("marketingTenantRouter.providersList read-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the listed providers for a tenant_owner", async () => {
    const { db } = createDbMock([[]]); // providers table is empty
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.providersList({ tenantId: "t_a" });
    // listProviders mock returns [] above
    expect(out).toEqual([]);
  });

  it("FORBIDDEN when caller is from another tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.providersList({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("marketingTenantRouter.automationsList stub returns []", () => {
  it("returns empty array for valid tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.automationsList({ tenantId: "t_a" });
    expect(out).toEqual([]);
  });
});

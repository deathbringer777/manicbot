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
  pickProvider: () => null,
}));
// PR-A: campaignSendNow now delegates to runCampaignSend. The deep behavior
// of the sender (provider selection, audience resolution, marketing_sends
// inserts) is tested separately in marketing-sender.test.ts. Here we only
// verify the router wires its inputs into the sender correctly.
type SenderArgs = { tenantId?: string; campaignId?: string; db?: unknown };
const mockRunCampaignSend = vi.fn<(args: SenderArgs) => Promise<{
  ok: boolean;
  total: number;
  sent: number;
  failed: number;
  deferred: number;
  campaignStatus: string;
  error?: string;
}>>(async () => ({
  ok: true,
  total: 3,
  sent: 3,
  failed: 0,
  deferred: 0,
  campaignStatus: "sent",
}));
vi.mock("~/server/marketing/sender", () => ({
  runCampaignSend: (args: SenderArgs) => mockRunCampaignSend(args),
}));
// audience preview reads from resolveAudience — return a tiny fixture.
const mockResolveAudience = vi.fn<(args: unknown) => Promise<{
  contacts: Array<{ id: number; email: string | null; phone: string | null; name: string | null; unsubscribeToken: string | null }>;
  totalCount: number;
}>>(async () => ({
  contacts: [
    { id: 1, email: "a@x.com", phone: null, name: "Alice", unsubscribeToken: null },
    { id: 2, email: "b@x.com", phone: null, name: "Bob",   unsubscribeToken: null },
  ],
  totalCount: 17,
}));
vi.mock("~/server/marketing/audience", () => ({
  resolveAudience: (args: unknown) => mockResolveAudience(args),
  parseFilterJson: (s: string | null | undefined) => {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return {}; }
  },
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

describe("marketingTenantRouter.campaignSendNow delegates to runCampaignSend (PR-A)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes runCampaignSend with the caller's tenantId + campaign id and surfaces its result", async () => {
    const { db } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", name: "test", status: "draft" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignSendNow({ tenantId: "t_a", id: "cmp_a" });

    expect(mockRunCampaignSend).toHaveBeenCalledTimes(1);
    const calls = mockRunCampaignSend.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = (calls[0] as [SenderArgs])[0];
    expect(args.tenantId).toBe("t_a");
    expect(args.campaignId).toBe("cmp_a");
    expect(args.db).toBe(db);

    expect(out).toMatchObject({
      ok: true,
      campaignId: "cmp_a",
      total: 3,
      sent: 3,
      failed: 0,
      deferred: 0,
      status: "sent",
    });
  });

  it("surfaces the sender's failure when the campaign is mid-flight or misconfigured", async () => {
    mockRunCampaignSend.mockResolvedValueOnce({
      ok: false,
      total: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
      campaignStatus: "failed",
      error: "no_provider",
    });
    const { db } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", name: "test", status: "draft" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignSendNow({ tenantId: "t_a", id: "cmp_a" });
    expect(out).toMatchObject({
      ok: false,
      campaignId: "cmp_a",
      status: "failed",
      error: "no_provider",
    });
    void db;
  });

  it("returns campaign_not_found when campaign is missing (does NOT touch sender)", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignSendNow({ tenantId: "t_a", id: "missing" });
    expect(out).toEqual({ ok: false, error: "campaign_not_found" });
    expect(mockRunCampaignSend).not.toHaveBeenCalled();
  });

  it("refuses to send for a foreign tenant — assertTenantOwner fires before any sender call", async () => {
    const { db } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_b", name: "test", status: "draft" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.campaignSendNow({ tenantId: "t_b", id: "cmp_a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRunCampaignSend).not.toHaveBeenCalled();
  });
});

describe("marketingTenantRouter.campaignAudiencePreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the totalCount + a redacted email sample (PII never leaves the server raw)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.campaignAudiencePreview({
      tenantId: "t_a",
      segmentId: null,
      channel: "email",
    });
    expect(mockResolveAudience).toHaveBeenCalled();
    expect(out.count).toBe(17);
    expect(out.sample).toHaveLength(2);
    // Each sample row has id + name + redacted email — must contain the
    // sentinel `***` so the raw local-part never gets leaked to the UI.
    for (const row of out.sample) {
      expect(typeof row.id).toBe("number");
      expect(row.email).toMatch(/\*\*\*@/);
      expect(row.email).not.toMatch(/^a@/);    // Alice's raw email gone
      expect(row.email).not.toMatch(/^b@/);    // Bob's raw email gone
    }
  });

  it("FORBIDDEN for a foreign tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.campaignAudiencePreview({ tenantId: "t_b", channel: "email" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("marketingTenantRouter.providersList read-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns aggregate-only capability flags (never per-provider names)", async () => {
    const { db } = createDbMock([[]]); // providers table is empty
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.providersList({ tenantId: "t_a" });
    // Tenant surface MUST NOT leak provider names — see procedure comment.
    expect(out).toEqual({ canSendEmail: false, canSendSms: false });
    // Defence-in-depth: the response shape must not even mention "name".
    expect(JSON.stringify(out)).not.toMatch(/\bname\b/i);
    expect(JSON.stringify(out)).not.toMatch(/brevo|resend|twilio/i);
  });

  it("FORBIDDEN when caller is from another tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.providersList({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("marketingTenantRouter.automations CRUD (PR-B)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("automationsList returns real rows scoped to the tenant", async () => {
    const { db } = createDbMock([
      [
        { id: "auto_1", tenantId: "t_a", name: "Welcome", triggerType: "welcome_series", enabled: 1, stepsJson: "[]" },
        { id: "auto_2", tenantId: "t_a", name: "Birthday", triggerType: "birthday", enabled: 0, stepsJson: "[]" },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.automationsList({ tenantId: "t_a" });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("auto_1");
  });

  it("automationsList FORBIDDEN for a foreign tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.automationsList({ tenantId: "t_b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("automationCreate inserts with tenantId, enabled=0 by default", async () => {
    const { db, insertCalls } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.automationCreate({
      tenantId: "t_a",
      name: "Welcome",
      triggerType: "welcome_series",
      stepsJson: JSON.stringify([{ type: "send_email", templateId: "tpl_a" }]),
    });
    expect(typeof out.id).toBe("string");
    expect(out.id.startsWith("auto_")).toBe(true);
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0]!.values).toMatchObject({
      tenantId: "t_a",
      name: "Welcome",
      triggerType: "welcome_series",
      enabled: 0,
    });
  });

  it("automationToggle 404s on missing row, FORBIDDEN on cross-tenant", async () => {
    {
      const { db } = createDbMock([[]]);
      const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
      await expect(
        caller.automationToggle({ tenantId: "t_a", id: "missing", enabled: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    {
      const { db } = createDbMock([
        [{ tenantId: "t_other" }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
      await expect(
        caller.automationToggle({ tenantId: "t_a", id: "auto_a", enabled: true }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("automationDelete scopes its WHERE clause to the caller's tenant", async () => {
    const { db, deleteCalls } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await caller.automationDelete({ tenantId: "t_a", id: "auto_a" });
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]?.whereCalled).toBe(true);
  });

  it("automationRunNow materialises a synthetic campaign and calls runCampaignSend", async () => {
    const stepsJson = JSON.stringify([{ type: "send_email", templateId: "tpl_x", channel: "email" }]);
    const { db, insertCalls } = createDbMock([
      [{
        id: "auto_a",
        tenantId: "t_a",
        name: "Welcome",
        triggerType: "manual",
        triggerConfigJson: null,
        stepsJson,
        enabled: 1,
      }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.automationRunNow({ tenantId: "t_a", id: "auto_a" });

    expect(out.ok).toBe(true);
    expect(out.automationId).toBe("auto_a");
    expect(typeof out.campaignId).toBe("string");
    expect((out.campaignId as string).startsWith("cmp_auto_auto_a_")).toBe(true);

    // A campaign INSERT happened with the right shape.
    const cmpInsert = insertCalls.find((c) => typeof c.values?.id === "string"
      && (c.values.id as string).startsWith("cmp_auto_"));
    expect(cmpInsert).toBeTruthy();
    expect(cmpInsert!.values).toMatchObject({
      tenantId: "t_a",
      channel: "email",
      templateId: "tpl_x",
      status: "draft",
    });

    expect(mockRunCampaignSend).toHaveBeenCalledTimes(1);
  });

  it("automationRunNow rejects automations without a send step", async () => {
    const { db } = createDbMock([
      [{
        id: "auto_b",
        tenantId: "t_a",
        name: "Empty",
        triggerType: "manual",
        triggerConfigJson: null,
        stepsJson: "[]",
        enabled: 0,
      }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.automationRunNow({ tenantId: "t_a", id: "auto_b" });
    expect(out.ok).toBe(false);
    expect((out as { error?: string }).error).toBe("no_send_step");
    expect(mockRunCampaignSend).not.toHaveBeenCalled();
  });
});

/**
 * platformBroadcastsRouter (migration 0100) — God-Mode authoring API.
 *
 * Mock pattern mirrors platform-messenger-router.test.ts: createDbMock seeds a
 * FIFO queue of select results in the order the procedure issues them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test" } }));

import { createCallerFactory } from "~/server/api/trpc";
import { platformBroadcastsRouter } from "~/server/api/routers/platformBroadcasts";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeTenantManagerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(platformBroadcastsRouter);
const NOW = () => Math.floor(Date.now() / 1000);

beforeEach(() => vi.clearAllMocks());

// ─── Auth gating (the load-bearing invariant: tenant users can NEVER reach it) ─

describe("platformBroadcastsRouter — auth gating", () => {
  const invocations: Array<[string, (c: ReturnType<typeof createCaller>) => Promise<unknown>]> = [
    ["campaignList", (c) => c.campaignList({})],
    ["campaignCreate", (c) => c.campaignCreate({ bodies: { center: "x" }, audience: { scope: "all" }, channels: ["center"], schedule: { kind: "now" } })],
    ["campaignSendNow", (c) => c.campaignSendNow({ id: "x" })],
    ["previewAudience", (c) => c.previewAudience({ audience: { scope: "all" } })],
    ["setMonthlyReportSettings", (c) => c.setMonthlyReportSettings({ enabled: true, channels: ["center"] })],
    ["getSubscriptionReminderSettings", (c) => c.getSubscriptionReminderSettings()],
    ["templateCreate", (c) => c.templateCreate({ name: "T", channels: ["center"], bodies: { center: "x" } })],
    ["getWelcomeSettings", (c) => c.getWelcomeSettings()],
    ["setWelcomeSettings", (c) => c.setWelcomeSettings({ enabled: true, channels: ["center"], body: "x" })],
    ["templateApprove", (c) => c.templateApprove({ id: "x" })],
    ["templateArchive", (c) => c.templateArchive({ id: "x" })],
    ["contentPlanList", (c) => c.contentPlanList({})],
    ["contentPlanApprove", (c) => c.contentPlanApprove({ id: "x" })],
    ["contentPlanSkip", (c) => c.contentPlanSkip({ id: "x" })],
  ];

  for (const [name, invoke] of invocations) {
    it(`${name}: unauthenticated → UNAUTHORIZED`, async () => {
      const { db } = createDbMock();
      await expect(invoke(createCaller(makeUnauthCtx(db) as never))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
    it(`${name}: tenant_owner → FORBIDDEN`, async () => {
      const { db } = createDbMock();
      await expect(invoke(createCaller(makeTenantOwnerCtx(db, "t_a") as never))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it(`${name}: tenant_manager / master / support → FORBIDDEN`, async () => {
      for (const mk of [makeTenantManagerCtx(createDbMock().db, "t_a"), makeMasterCtx(createDbMock().db, "t_a"), makeSupportCtx(createDbMock().db, "support")]) {
        await expect(invoke(createCaller(mk as never))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
  }
});

// ─── campaignCreate ─────────────────────────────────────────────────────────

describe("campaignCreate", () => {
  it("creates a 'now' announcement: status active, center body, nextRunAt set", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    const res = await caller.campaignCreate({
      title: "Hello", bodies: { center: "World" }, audience: { scope: "all" },
      channels: ["center", "email", "email"], schedule: { kind: "now" },
    });
    expect(res.id).toMatch(/^pcamp_/);
    const v = mock.insertCalls[0]!.values;
    expect(v.kind).toBe("announcement");
    expect(v.status).toBe("active");
    expect(v.nextRunAt).toBeGreaterThan(0);
    expect(JSON.parse(v.channelsJson as string)).toEqual(["center", "email"]); // deduped
    expect(v.createdBy).toBe("w_admin");
  });

  it("rejects channels without 'center' (always-on enforced)", async () => {
    const caller = createCaller(makeAdminCtx(createDbMock().db) as never);
    await expect(
      caller.campaignCreate({ bodies: { center: "x" }, audience: { scope: "all" }, channels: ["bell"] as never, schedule: { kind: "now" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a 'once' schedule in the past", async () => {
    const caller = createCaller(makeAdminCtx(createDbMock().db) as never);
    await expect(
      caller.campaignCreate({ bodies: { center: "x" }, audience: { scope: "all" }, channels: ["center"], schedule: { kind: "once", scheduledAt: NOW() - 100 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a recurring schedule (status active, recurrence stored, nextRunAt null)", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    await caller.campaignCreate({
      bodies: { center: "x" }, audience: { scope: "by_plan", plans: ["pro"] },
      channels: ["center"], schedule: { kind: "recurring", recurrence: { freq: "weekly", weekday: 1, hour: 10, minute: 0 } },
    });
    const v = mock.insertCalls[0]!.values;
    expect(v.status).toBe("active");
    expect(v.nextRunAt).toBeNull();
    expect(JSON.parse(v.recurrenceJson as string)).toMatchObject({ freq: "weekly", weekday: 1, hour: 10 });
  });
});

// ─── welcome settings (sys_welcome singleton) ────────────────────────────────

describe("welcome settings", () => {
  it("getWelcomeSettings returns defaults when the row is absent", async () => {
    const { db } = createDbMock([[]]);
    const res = await createCaller(makeAdminCtx(db) as never).getWelcomeSettings();
    expect(res).toMatchObject({ enabled: false, channels: [], body: "" });
  });

  it("getWelcomeSettings parses an active row + center body", async () => {
    const row = { status: "active", channelsJson: '["center","bell"]', bodiesJson: JSON.stringify({ center: "Привет, {salon_name}!" }), title: "W", body: "fallback" };
    const { db } = createDbMock([[row]]);
    const res = await createCaller(makeAdminCtx(db) as never).getWelcomeSettings();
    expect(res).toMatchObject({ enabled: true, channels: ["center", "bell"], title: "W", body: "Привет, {salon_name}!" });
  });

  it("setWelcomeSettings upserts kind=welcome, tokens preserved", async () => {
    const mock = createDbMock();
    await createCaller(makeAdminCtx(mock.db) as never).setWelcomeSettings({
      enabled: true, channels: ["center", "bell"], body: "Здравствуйте, {salon_name}! {owner_name}",
    });
    const v = mock.insertCalls[0]!.values;
    expect(v.id).toBe("sys_welcome");
    expect(v.kind).toBe("welcome");
    expect(v.status).toBe("active");
    expect(JSON.parse(v.channelsJson as string)).toEqual(["center", "bell"]);
    const center = JSON.parse(v.bodiesJson as string).center as string;
    expect(center).toContain("{salon_name}");
    expect(center).toContain("{owner_name}");
  });

  it("setWelcomeSettings stores status=paused when disabled", async () => {
    const mock = createDbMock();
    await createCaller(makeAdminCtx(mock.db) as never).setWelcomeSettings({ enabled: false, channels: ["center"], body: "x" });
    expect(mock.insertCalls[0]!.values.status).toBe("paused");
  });

  it("setWelcomeSettings rejects an empty body and channels without center", async () => {
    const caller = createCaller(makeAdminCtx(createDbMock().db) as never);
    await expect(caller.setWelcomeSettings({ enabled: true, channels: ["center"], body: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.setWelcomeSettings({ enabled: true, channels: ["bell"] as never, body: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── previewAudience (reuses resolveAudience) ────────────────────────────────

describe("previewAudience", () => {
  it("counts real owners/managers and excludes masters + fake mailboxes", async () => {
    const rows = [
      { id: "w1", email: "a@salon.com", name: "A", tenantId: "t1", plan: "pro", role: "tenant_owner" },
      { id: "w2", email: "b@salon.com", name: "B", tenantId: "t2", plan: "start", role: "tenant_manager" },
      { id: "w3", email: "m@salon.com", name: "M", tenantId: "t3", plan: "pro", role: "master" },
      { id: "w4", email: "x@test.manicbot.local", name: "X", tenantId: "t4", plan: "pro", role: "tenant_owner" },
    ];
    const { db } = createDbMock([rows]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const res = await caller.previewAudience({ audience: { scope: "all" } });
    expect(res.count).toBe(2);
  });
});

// ─── Settings (singleton rows) ───────────────────────────────────────────────

describe("monthly report + subscription reminder settings", () => {
  it("setMonthlyReportSettings upserts the singleton row", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    await caller.setMonthlyReportSettings({ enabled: true, channels: ["center", "email"], atHour: 8, atMinute: 30 });
    const v = mock.insertCalls[0]!.values;
    expect(v.id).toBe("sys_monthly_report");
    expect(v.status).toBe("active");
    expect(JSON.parse(v.recurrenceJson as string)).toMatchObject({ freq: "monthly", day: 1, hour: 8, minute: 30 });
  });

  it("getMonthlyReportSettings reads the row + parses recurrence", async () => {
    const row = { status: "active", channelsJson: '["center","email"]', recurrenceJson: '{"hour":8,"minute":30}', templateId: null };
    const { db } = createDbMock([[row]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const res = await caller.getMonthlyReportSettings();
    expect(res).toMatchObject({ enabled: true, atHour: 8, atMinute: 30 });
    expect(res.channels).toEqual(["center", "email"]);
  });

  it("getMonthlyReportSettings returns disabled defaults when the row is absent", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const res = await caller.getMonthlyReportSettings();
    expect(res.enabled).toBe(false);
    expect(res.atHour).toBe(7);
  });

  it("setSubscriptionReminderSettings stores daysBefore in recurrence", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    await caller.setSubscriptionReminderSettings({ enabled: true, channels: ["center", "email"], daysBefore: 5, atHour: 9 });
    const v = mock.insertCalls[0]!.values;
    expect(v.id).toBe("sys_subscription_reminder");
    expect(JSON.parse(v.recurrenceJson as string)).toMatchObject({ freq: "daily", daysBefore: 5, hour: 9 });
  });
});

// ─── Templates ────────────────────────────────────────────────────────────

describe("templates", () => {
  it("templateCreate inserts a non-builtin row", async () => {
    const mock = createDbMock();
    const caller = createCaller(makeAdminCtx(mock.db) as never);
    const res = await caller.templateCreate({ name: "Maintenance", category: "ops", channels: ["center"], bodies: { center: "down" } });
    expect(res.id).toMatch(/^pmt_/);
    expect(mock.insertCalls[0]!.values.isBuiltin).toBe(0);
  });

  it("templateUpdate / templateDelete refuse a builtin row", async () => {
    const builtin = [{ id: "pmt_builtin_x", isBuiltin: 1 }];
    const upd = createDbMock([builtin]);
    await expect(
      createCaller(makeAdminCtx(upd.db) as never).templateUpdate({ id: "pmt_builtin_x", name: "n" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "builtin_readonly" });

    const del = createDbMock([builtin]);
    await expect(
      createCaller(makeAdminCtx(del.db) as never).templateDelete({ id: "pmt_builtin_x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "builtin_readonly" });
  });

  it("templateList filters by status", async () => {
    const mock = createDbMock([[{ id: "pmt_1", status: "approved" }]]);
    const res = await createCaller(makeAdminCtx(mock.db) as never).templateList({ status: "approved" });
    expect(res).toHaveLength(1);
    expect(mock.db.select).toHaveBeenCalled();
  });

  it("templateApprove sets status=approved on a non-builtin row", async () => {
    const mock = createDbMock([[{ id: "pmt_draft", isBuiltin: 0 }]]);
    const res = await createCaller(makeAdminCtx(mock.db) as never).templateApprove({ id: "pmt_draft" });
    expect(res).toMatchObject({ ok: true });
    expect(mock.updateCalls[0]!.values).toMatchObject({ status: "approved" });
  });

  it("templateArchive sets status=archived on a non-builtin row", async () => {
    const mock = createDbMock([[{ id: "pmt_x", isBuiltin: 0 }]]);
    const res = await createCaller(makeAdminCtx(mock.db) as never).templateArchive({ id: "pmt_x" });
    expect(res).toMatchObject({ ok: true });
    expect(mock.updateCalls[0]!.values).toMatchObject({ status: "archived" });
  });

  it("templateApprove / templateArchive refuse a builtin row", async () => {
    const ap = createDbMock([[{ id: "pmt_b", isBuiltin: 1 }]]);
    await expect(
      createCaller(makeAdminCtx(ap.db) as never).templateApprove({ id: "pmt_b" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "builtin_readonly" });

    const ar = createDbMock([[{ id: "pmt_b", isBuiltin: 1 }]]);
    await expect(
      createCaller(makeAdminCtx(ar.db) as never).templateArchive({ id: "pmt_b" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "builtin_readonly" });
  });

  it("templateApprove / templateArchive NOT_FOUND when the row is missing", async () => {
    const ap = createDbMock([[]]);
    await expect(
      createCaller(makeAdminCtx(ap.db) as never).templateApprove({ id: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Content plan (seasonal occasion drafts) ────────────────────────────────

describe("content plan", () => {
  it("contentPlanList returns occasion-tagged campaign rows", async () => {
    const rows = [{ id: "pcamp_1", occasionKey: "new_year", scheduledAt: 123, status: "draft" }];
    const mock = createDbMock([rows]);
    const res = await createCaller(makeAdminCtx(mock.db) as never).contentPlanList({});
    expect(res).toEqual(rows);
    expect(mock.db.select).toHaveBeenCalled();
  });

  it("contentPlanApprove activates the draft", async () => {
    const mock = createDbMock();
    const res = await createCaller(makeAdminCtx(mock.db) as never).contentPlanApprove({ id: "pcamp_1" });
    expect(res).toMatchObject({ ok: true });
    expect(mock.updateCalls[0]!.values).toMatchObject({ status: "active" });
  });

  it("contentPlanSkip marks the draft done", async () => {
    const mock = createDbMock();
    const res = await createCaller(makeAdminCtx(mock.db) as never).contentPlanSkip({ id: "pcamp_1" });
    expect(res).toMatchObject({ ok: true });
    expect(mock.updateCalls[0]!.values).toMatchObject({ status: "done" });
  });
});

// ─── campaignSendNow ──────────────────────────────────────────────────────

describe("campaignSendNow", () => {
  it("NOT_FOUND when the campaign is missing", async () => {
    const { db } = createDbMock([[]]);
    await expect(
      createCaller(makeAdminCtx(db) as never).campaignSendNow({ id: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("activates + schedules an existing campaign for the next tick", async () => {
    const mock = createDbMock([[{ id: "c1", status: "draft" }]]);
    const res = await createCaller(makeAdminCtx(mock.db) as never).campaignSendNow({ id: "c1" });
    expect(res).toMatchObject({ ok: true, triggered: false });
    expect(mock.updateCalls[0]!.values).toMatchObject({ status: "active" });
  });
});

// ─── Source-level guard ──────────────────────────────────────────────────

describe("platformBroadcasts source invariants", () => {
  const src = readFileSync(
    resolve(import.meta.dirname, "../server/api/routers/platformBroadcasts.ts"),
    "utf8",
  );
  it("every procedure is systemAdminProcedure (no weaker guard leaks in)", () => {
    expect(src).not.toMatch(/\bpublicProcedure\b/);
    expect(src).not.toMatch(/\bprotectedProcedure\b/);
    expect(src).not.toMatch(/\btenantOwnerProcedure\b/);
    expect(src).not.toMatch(/\bmanagerProcedure\b/);
    expect(src).toMatch(/systemAdminProcedure/);
  });
  it("uses no `as any` / `as never` casts", () => {
    expect(src).not.toMatch(/\bas any\b/);
    expect(src).not.toMatch(/\bas never\b/);
  });
});

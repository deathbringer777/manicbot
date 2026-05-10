import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    UPLOAD_TOKEN_SECRET: undefined,
    META_VERIFY_TOKEN_WA: undefined,
    META_VERIFY_TOKEN_IG: undefined,
  },
}));

vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(),
  telegramSetWebhook: vi.fn(),
  telegramDeleteWebhook: vi.fn(),
}));

vi.mock("~/server/lib/stripe", () => ({
  getOrCreateCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

vi.mock("~/server/lib/uploadToken", () => ({
  signUploadToken: vi.fn().mockResolvedValue("tok.signed"),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_demo";

function ownerCaller(db: any) {
  return createCallerFactory(salonRouter)(makeTenantOwnerCtx(db, TENANT) as never);
}

describe("salonRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTenantOwner).mockResolvedValue(undefined);
  });

  // ── assertTenantOwner is called ───────────────────────────────────────────
  describe("assertTenantOwner guard", () => {
    it("calls assertTenantOwner with the correct tenantId for getOverview", async () => {
      const dbMock = createDbMock([[], [], [], []]);
      const caller = ownerCaller(dbMock.db);

      await caller.getOverview({ tenantId: TENANT });

      expect(assertTenantOwner).toHaveBeenCalledWith(expect.anything(), TENANT);
    });

    it("calls assertTenantOwner with the correct tenantId for getMasters", async () => {
      const dbMock = createDbMock([[]]);
      const caller = ownerCaller(dbMock.db);

      await caller.getMasters({ tenantId: TENANT });

      expect(assertTenantOwner).toHaveBeenCalledWith(expect.anything(), TENANT);
    });
  });

  // ── getOverview ───────────────────────────────────────────────────────────
  describe("getOverview", () => {
    it("returns aggregated today appointments (excluding cancelled), masters, tickets, plan", async () => {
      const apts = [
        { cancelled: 0, date: "2026-04-08" },
        { cancelled: 1, date: "2026-04-08" }, // cancelled — excluded
      ];
      const masters = [
        { id: "m1", active: 1 },
        { id: "m2", active: 1 },
      ];
      const tickets = [{ id: "tkt_1", open: 1 }];
      const tenant = [{ plan: "pro", billingStatus: "active", name: "Test" }];
      const servicesRows: unknown[] = [];

      // getOverview: Promise.all([apts, masters, tickets, tenant, services])
      const dbMock = createDbMock([apts, masters, tickets, tenant, servicesRows]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getOverview({ tenantId: TENANT });

      expect(result.todayAppointments).toBe(1); // only non-cancelled
      expect(result.activeMasters).toBe(2);
      expect(result.openTickets).toBe(1);
      expect(result.plan).toBe("pro");
      expect(result.billingStatus).toBe("active");
    });

    it("returns plan=start and billingStatus=trialing when tenant row is missing", async () => {
      const dbMock = createDbMock([[], [], [], [], []]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getOverview({ tenantId: TENANT });

      expect(result.plan).toBe("start");
      expect(result.billingStatus).toBe("trialing");
    });

    it("returns profileCompleteness signals from tenant + counts", async () => {
      const apts: unknown[] = [];
      const masters = [{ id: "m1", active: 1 }];
      const tickets: unknown[] = [];
      const tenant = [{
        plan: "pro",
        billingStatus: "active",
        name: "Salon",
        description: "Best salon",
        city: "Warsaw",
        logo: "logo.png",
        coverPhoto: null,
        publicActive: 1,
      }];
      const servicesRows = [
        { svcId: "s1", active: 1 },
        { svcId: "s2", active: 1 },
        { svcId: "s3", active: 0 }, // hidden — should not count
      ];

      const dbMock = createDbMock([apts, masters, tickets, tenant, servicesRows]);
      const caller = ownerCaller(dbMock.db);
      const result = await caller.getOverview({ tenantId: TENANT });

      expect(result.profileCompleteness.hasName).toBe(true);
      expect(result.profileCompleteness.hasDescription).toBe(true);
      expect(result.profileCompleteness.hasCity).toBe(true);
      expect(result.profileCompleteness.hasLogo).toBe(true);
      expect(result.profileCompleteness.hasCoverPhoto).toBe(false);
      expect(result.profileCompleteness.publicActive).toBe(true);
      expect(result.profileCompleteness.servicesCount).toBe(2); // active=1 only
      expect(result.profileCompleteness.mastersCount).toBe(1);
    });
  });

  // ── getAppointments ───────────────────────────────────────────────────────
  describe("getAppointments", () => {
    it("returns rows for the tenant without extra filters", async () => {
      const rows = [{ id: "apt_1" }, { id: "apt_2" }];
      const dbMock = createDbMock([rows]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAppointments({ tenantId: TENANT });

      expect(result).toEqual(rows);
    });

    it("returns empty array when DB has no matching rows", async () => {
      const dbMock = createDbMock([[]]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAppointments({ tenantId: TENANT, date: "2026-04-08" });

      expect(result).toEqual([]);
    });
  });

  // ── getMasters ────────────────────────────────────────────────────────────
  describe("getMasters", () => {
    it("returns masters for the tenant", async () => {
      const masters = [{ id: "m1", name: "Anna" }, { id: "m2", name: "Olga" }];
      const dbMock = createDbMock([masters]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getMasters({ tenantId: TENANT });

      expect(result).toEqual(masters);
    });
  });

  // ── getServices ───────────────────────────────────────────────────────────
  describe("getServices", () => {
    it("returns services for the tenant", async () => {
      const svcs = [{ svcId: "svc_1", names: "Manicure" }];
      const dbMock = createDbMock([svcs]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getServices({ tenantId: TENANT });

      expect(result).toEqual(svcs);
    });
  });

  // ── getClients ────────────────────────────────────────────────────────────
  describe("getClients", () => {
    it("returns clients without search filter", async () => {
      const clients = [{ id: "u1", name: "Anna" }];
      const dbMock = createDbMock([clients]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getClients({ tenantId: TENANT });

      expect(result).toEqual(clients);
    });

    it("uses a different DB path (with OR clause) when search is provided", async () => {
      const clients = [{ id: "u1", name: "Anna" }];
      const dbMock = createDbMock([clients]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getClients({ tenantId: TENANT, search: "anna" });

      expect(result).toEqual(clients);
      expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    });
  });

  // ── createService ─────────────────────────────────────────────────────────
  describe("createService", () => {
    it("inserts service and returns a svcId starting with svc_", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      const result = await caller.createService({
        tenantId: TENANT,
        names: "Pedicure",
        duration: 60,
        price: 120,
      });

      expect(result.svcId).toMatch(/^svc_/);
    });

    it("inserts with correct names, duration, price", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.createService({
        tenantId: TENANT,
        names: "Gel Polish",
        duration: 90,
        price: 150,
        emoji: "💅",
      });

      expect(dbMock.insertCalls[0]?.values).toMatchObject({
        tenantId: TENANT,
        names: "Gel Polish",
        duration: 90,
        price: 150,
        emoji: "💅",
      });
    });

    it("inserts with null emoji when not provided", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.createService({ tenantId: TENANT, names: "Trim", duration: 30, price: 50 });

      expect(dbMock.insertCalls[0]?.values.emoji).toBeNull();
    });
  });

  // ── updateService ─────────────────────────────────────────────────────────
  describe("updateService", () => {
    it("updates only the provided fields", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.updateService({ tenantId: TENANT, svcId: "svc_1", price: 200 });

      expect(dbMock.updateCalls[0]?.values).toEqual({ price: 200 });
    });

    it("throws BAD_REQUEST when no fields to update are provided", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.updateService({ tenantId: TENANT, svcId: "svc_1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("does not update when called with empty set", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.updateService({ tenantId: TENANT, svcId: "svc_1" }),
      ).rejects.toThrow();

      expect(dbMock.updateCalls).toHaveLength(0);
    });
  });

  // ── deleteService ─────────────────────────────────────────────────────────
  describe("deleteService", () => {
    it("soft-deletes: sets active=0 and hidden=1 instead of hard deleting", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      const result = await caller.deleteService({ tenantId: TENANT, svcId: "svc_1" });

      expect(result).toEqual({ success: true });
      expect(dbMock.updateCalls[0]?.values).toEqual({ active: 0, hidden: 1 });
      expect(dbMock.deleteCalls).toHaveLength(0);
    });
  });

  // ── updateSalonProfile ────────────────────────────────────────────────────
  describe("updateSalonProfile", () => {
    it("upserts tenant_config rows for provided fields (name, address, phone)", async () => {
      const tenantRow = [{ id: TENANT, name: "Old Name", salon: "{}", plan: "start" }];
      const dbMock = createDbMock([tenantRow]);
      const caller = ownerCaller(dbMock.db);

      await caller.updateSalonProfile({
        tenantId: TENANT,
        name: "New Salon",
        address: "ul. Kwiatowa 1",
        phone: "+48999000111",
      });

      // 1 update (tenants) + 3 inserts (salon_name, address, phone)
      expect(dbMock.updateCalls).toHaveLength(1);
      expect(dbMock.insertCalls).toHaveLength(3);

      const keys = dbMock.insertCalls.map((c) => c.values.key);
      expect(keys).toContain("salon_name");
      expect(keys).toContain("address");
      expect(keys).toContain("phone");
    });

    it("updates tenants.name when name field is provided", async () => {
      const tenantRow = [{ id: TENANT, name: "Old", salon: null }];
      const dbMock = createDbMock([tenantRow]);
      const caller = ownerCaller(dbMock.db);

      await caller.updateSalonProfile({ tenantId: TENANT, name: "New Name" });

      expect(dbMock.updateCalls[0]?.values).toMatchObject({ name: "New Name" });
    });

    it("throws NOT_FOUND when tenant row does not exist", async () => {
      const dbMock = createDbMock([[]]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.updateSalonProfile({ tenantId: TENANT, name: "X" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("does not insert config rows for undefined fields", async () => {
      const tenantRow = [{ id: TENANT, salon: null }];
      const dbMock = createDbMock([tenantRow]);
      const caller = ownerCaller(dbMock.db);

      // Only workHours provided → only work_hours config upserted
      await caller.updateSalonProfile({ tenantId: TENANT, workHours: "9-18" });

      const keys = dbMock.insertCalls.map((c) => c.values.key);
      expect(keys).not.toContain("salon_name");
      expect(keys).not.toContain("address");
      expect(keys).not.toContain("phone");
      expect(keys).toContain("work_hours");
    });
  });

  // ── getAutoConfirmSettings ────────────────────────────────────────────────
  describe("getAutoConfirmSettings", () => {
    it("returns defaults when no config rows exist", async () => {
      const dbMock = createDbMock([[]]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAutoConfirmSettings({ tenantId: TENANT });

      expect(result).toEqual({
        web: true,      // default ON
        telegram: false, // default OFF
        whatsapp: false,
        instagram: false,
      });
    });

    it("parses string 'true' values correctly", async () => {
      const rows = [
        { key: "auto_confirm_web", value: "true" },
        { key: "auto_confirm_telegram", value: "true" },
      ];
      const dbMock = createDbMock([rows]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAutoConfirmSettings({ tenantId: TENANT });

      expect(result.web).toBe(true);
      expect(result.telegram).toBe(true);
    });

    it("parses string 'false' as false", async () => {
      const rows = [{ key: "auto_confirm_web", value: "false" }];
      const dbMock = createDbMock([rows]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAutoConfirmSettings({ tenantId: TENANT });

      expect(result.web).toBe(false);
    });

    it("parses string '1' as true", async () => {
      const rows = [{ key: "auto_confirm_instagram", value: "1" }];
      const dbMock = createDbMock([rows]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.getAutoConfirmSettings({ tenantId: TENANT });

      expect(result.instagram).toBe(true);
    });
  });

  // ── setAutoConfirm ────────────────────────────────────────────────────────
  describe("setAutoConfirm", () => {
    it("upserts auto_confirm_{channel} key with JSON.stringify value", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      const result = await caller.setAutoConfirm({
        tenantId: TENANT,
        channel: "telegram",
        enabled: true,
      });

      expect(result).toEqual({ success: true });
      expect(dbMock.insertCalls[0]?.values).toMatchObject({
        tenantId: TENANT,
        key: "auto_confirm_telegram",
        value: "true",
      });
    });

    it("stores 'false' string when enabled=false", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.setAutoConfirm({ tenantId: TENANT, channel: "whatsapp", enabled: false });

      expect(dbMock.insertCalls[0]?.values.value).toBe("false");
    });
  });

  // ── markNoShow (salon variant) ────────────────────────────────────────────
  describe("markNoShow", () => {
    it("sets noShow=1, status=no_show, noShowBy, cancelReason", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      const result = await caller.markNoShow({
        tenantId: TENANT,
        id: "apt_1",
        noShowBy: "client",
        comment: "did not show",
      });

      expect(result).toEqual({ success: true });
      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        noShow: 1,
        status: "no_show",
        noShowBy: "client",
        cancelReason: "did not show",
      });
    });
  });

  // ── cancelAppointment ─────────────────────────────────────────────────────
  describe("cancelAppointment", () => {
    it("sets cancelled=1, status=cancelled, cancelledBy, cancelReason", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.cancelAppointment({
        tenantId: TENANT,
        id: "apt_1",
        cancelledBy: "admin",
        comment: "double-booked",
      });

      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.cancelled).toBe(1);
      expect(vals.status).toBe("cancelled");
      expect(vals.cancelledBy).toBe("admin");
      expect(vals.cancelReason).toBe("double-booked");
      expect(Number(vals.cancelledAt)).toBeGreaterThanOrEqual(before);
    });
  });
});

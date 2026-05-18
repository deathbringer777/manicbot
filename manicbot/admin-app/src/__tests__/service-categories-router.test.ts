/**
 * salon.serviceCategoriesList / createServiceCategory / renameServiceCategory
 * / deleteServiceCategory / reorderServiceCategories.
 *
 * Covers happy paths + the safety guards that aren't obvious from the
 * router source: duplicate-name CONFLICT, rename collision, reassign-into-
 * self BAD_REQUEST, and the unknown-id guard on reorder (defense against an
 * attacker shuffling another tenant's order via a forged id).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));
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
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_salon_test";

function makeCaller(db: any) {
  const factory = createCallerFactory(salonRouter);
  return factory(makeTenantOwnerCtx(db, TENANT) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("salon.serviceCategoriesList", () => {
  it("returns categories with usage counts joined from services", async () => {
    const cats = [
      { id: "sc_1", name: "Маникюр", sortOrder: 0, createdAt: 1000 },
      { id: "sc_2", name: "Педикюр", sortOrder: 1, createdAt: 1000 },
    ];
    const counts = [
      { category: "Маникюр", n: 3 },
      { category: "Педикюр", n: 1 },
    ];
    const mock = createDbMock([cats, counts]);
    const caller = makeCaller(mock.db);

    const result = await caller.serviceCategoriesList({ tenantId: TENANT });

    expect(result).toEqual([
      { id: "sc_1", name: "Маникюр", sortOrder: 0, usageCount: 3 },
      { id: "sc_2", name: "Педикюр", sortOrder: 1, usageCount: 1 },
    ]);
  });

  it("returns usageCount=0 for categories with no assigned services", async () => {
    const cats = [{ id: "sc_1", name: "Empty", sortOrder: 0, createdAt: 1000 }];
    const counts: any[] = []; // no row in the GROUP BY result
    const mock = createDbMock([cats, counts]);
    const caller = makeCaller(mock.db);

    const result = await caller.serviceCategoriesList({ tenantId: TENANT });
    expect(result[0]?.usageCount).toBe(0);
  });
});

describe("salon.createServiceCategory", () => {
  it("inserts at the end of sort order (max + 1)", async () => {
    const mock = createDbMock([
      [],                        // duplicate-name check → none
      [{ max: 2 }],              // current max sortOrder
    ]);
    const caller = makeCaller(mock.db);

    await caller.createServiceCategory({ tenantId: TENANT, name: "Покрытие" });

    expect(mock.insertCalls).toHaveLength(1);
    expect(mock.insertCalls[0]!.values.name).toBe("Покрытие");
    expect(mock.insertCalls[0]!.values.sortOrder).toBe(3); // max + 1
  });

  it("starts at 0 for an empty category list", async () => {
    const mock = createDbMock([
      [],                        // duplicate check → none
      [{ max: -1 }],             // COALESCE(MAX(sort_order), -1) when empty
    ]);
    const caller = makeCaller(mock.db);
    await caller.createServiceCategory({ tenantId: TENANT, name: "First" });
    expect(mock.insertCalls[0]!.values.sortOrder).toBe(0);
  });

  it("rejects duplicate name with CONFLICT", async () => {
    const mock = createDbMock([
      [{ id: "sc_existing" }],   // duplicate check → row exists
    ]);
    const caller = makeCaller(mock.db);

    await expect(
      caller.createServiceCategory({ tenantId: TENANT, name: "Маникюр" }),
    ).rejects.toThrowError(/уже существует/);
    expect(mock.insertCalls).toHaveLength(0);
  });

  it("trims input before validation (silently)", async () => {
    const mock = createDbMock([[], [{ max: -1 }]]);
    const caller = makeCaller(mock.db);
    await caller.createServiceCategory({ tenantId: TENANT, name: "  Маникюр  " });
    expect(mock.insertCalls[0]!.values.name).toBe("Маникюр");
  });
});

describe("salon.renameServiceCategory", () => {
  it("updates BOTH service_categories AND services rows (services first → catalog last)", async () => {
    const mock = createDbMock([
      [{ name: "Маникюр" }],     // lookup current name
      [],                         // collision check → none
    ]);
    const caller = makeCaller(mock.db);
    await caller.renameServiceCategory({
      tenantId: TENANT, id: "sc_1", newName: "Маникюр Pro",
    });

    // Two updates: services first, then service_categories.
    expect(mock.updateCalls).toHaveLength(2);
    expect(mock.updateCalls[0]!.values.category).toBe("Маникюр Pro");
    expect(mock.updateCalls[1]!.values.name).toBe("Маникюр Pro");
  });

  it("no-ops when the new name equals the old name", async () => {
    const mock = createDbMock([[{ name: "Маникюр" }]]);
    const caller = makeCaller(mock.db);
    const result = await caller.renameServiceCategory({
      tenantId: TENANT, id: "sc_1", newName: "Маникюр",
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(mock.updateCalls).toHaveLength(0);
  });

  it("rejects NOT_FOUND when the row does not exist", async () => {
    const mock = createDbMock([[]]); // lookup → empty
    const caller = makeCaller(mock.db);
    await expect(
      caller.renameServiceCategory({ tenantId: TENANT, id: "sc_missing", newName: "X" }),
    ).rejects.toThrowError(/не найдена/);
  });

  it("rejects CONFLICT when newName collides with a different category", async () => {
    const mock = createDbMock([
      [{ name: "Маникюр" }],       // lookup
      [{ id: "sc_other" }],        // collision check → name taken
    ]);
    const caller = makeCaller(mock.db);
    await expect(
      caller.renameServiceCategory({ tenantId: TENANT, id: "sc_1", newName: "Педикюр" }),
    ).rejects.toThrowError(/уже существует/);
    expect(mock.updateCalls).toHaveLength(0);
  });
});

describe("salon.deleteServiceCategory", () => {
  it("happy path with reassign — UPDATE services to new name, DELETE category", async () => {
    const mock = createDbMock([
      [{ name: "Маникюр" }],     // lookup source
      [{ name: "Покрытие" }],    // lookup target
    ]);
    const caller = makeCaller(mock.db);
    await caller.deleteServiceCategory({
      tenantId: TENANT, id: "sc_1", reassignToId: "sc_2",
    });

    expect(mock.updateCalls).toHaveLength(1);
    expect(mock.updateCalls[0]!.values.category).toBe("Покрытие");
    expect(mock.deleteCalls).toHaveLength(1);
    expect(mock.deleteCalls[0]!.whereCalled).toBe(true);
  });

  it("happy path without reassign — UPDATE services to NULL, DELETE category", async () => {
    const mock = createDbMock([
      [{ name: "Маникюр" }],     // lookup source
    ]);
    const caller = makeCaller(mock.db);
    await caller.deleteServiceCategory({
      tenantId: TENANT, id: "sc_1",
    });

    expect(mock.updateCalls).toHaveLength(1);
    expect(mock.updateCalls[0]!.values.category).toBeNull();
    expect(mock.deleteCalls).toHaveLength(1);
  });

  it("rejects BAD_REQUEST when reassignToId === id", async () => {
    const mock = createDbMock([[{ name: "Маникюр" }]]);
    const caller = makeCaller(mock.db);
    await expect(
      caller.deleteServiceCategory({ tenantId: TENANT, id: "sc_1", reassignToId: "sc_1" }),
    ).rejects.toThrowError(/удаляемую категорию/);
  });

  it("rejects NOT_FOUND when the target reassign id does not exist", async () => {
    const mock = createDbMock([
      [{ name: "Маникюр" }],     // source exists
      [],                         // target lookup → empty
    ]);
    const caller = makeCaller(mock.db);
    await expect(
      caller.deleteServiceCategory({ tenantId: TENANT, id: "sc_1", reassignToId: "sc_missing" }),
    ).rejects.toThrowError(/Целевая категория/);
  });
});

describe("salon.reorderServiceCategories", () => {
  it("renumbers each id with its position in the input array", async () => {
    const mock = createDbMock([
      [{ id: "sc_1" }, { id: "sc_2" }, { id: "sc_3" }], // known-ids check
    ]);
    const caller = makeCaller(mock.db);
    await caller.reorderServiceCategories({
      tenantId: TENANT, ids: ["sc_3", "sc_1", "sc_2"],
    });

    // One UPDATE per id, in order.
    expect(mock.updateCalls).toHaveLength(3);
    expect(mock.updateCalls[0]!.values.sortOrder).toBe(0);
    expect(mock.updateCalls[1]!.values.sortOrder).toBe(1);
    expect(mock.updateCalls[2]!.values.sortOrder).toBe(2);
  });

  it("rejects BAD_REQUEST when an id is not in this tenant (cross-tenant defense)", async () => {
    const mock = createDbMock([
      [{ id: "sc_1" }], // forged "sc_other_tenant" not in the result set
    ]);
    const caller = makeCaller(mock.db);
    await expect(
      caller.reorderServiceCategories({
        tenantId: TENANT, ids: ["sc_1", "sc_other_tenant"],
      }),
    ).rejects.toThrowError(/sc_other_tenant/);
    expect(mock.updateCalls).toHaveLength(0);
  });
});

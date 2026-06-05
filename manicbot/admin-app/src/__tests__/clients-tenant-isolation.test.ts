/**
 * clients router — tenant isolation invariant (0062).
 *
 * The Salon Clients overhaul exposes a new tRPC surface that handles
 * PII (phone / email / TG / Instagram / notes / dob). The #1 risk
 * surface in ManicBot is tenant isolation; this test pins that:
 *
 *   * Every public procedure (list / get / create / update / delete /
 *     setGlobalBlock / exportCsv / importCsv / csvTemplate /
 *     tagSuggestions) calls assertTenantOwner with the input tenantId.
 *   * A tenant_owner of tenant A cannot pass tenant B's id and get a
 *     response — FORBIDDEN must surface.
 *   * system_admin (cross-tenant by definition) IS allowed through.
 *
 * Per `manicbot-coding-standards`: this is the foundational invariant
 * for any new router that touches tenant data. Every regression PR
 * must keep this file green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
  },
}));

// syncMarketingContact is heavy and not under test here — stub it.
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: vi.fn().mockResolvedValue(99),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { clientsRouter } from "~/server/api/routers/clients";
import { makeTenantOwnerCtx, makeAdminCtx } from "./helpers/db-mock";

const OWNER_TENANT = "t_owner";
const FOREIGN_TENANT = "t_other";

function chainable(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(selectResults: unknown[][] = []) {
  const queue = [...selectResults];
  const db: any = {
    select: vi.fn(() => chainable(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        then: (r: any) => Promise.resolve({ ok: true }).then(r),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ ok: true }) })),
    })),
  };
  return db;
}

describe("clients router — cross-tenant isolation", () => {
  const createCaller = createCallerFactory(clientsRouter);

  beforeEach(() => vi.clearAllMocks());

  // Procedures under test. We don't enumerate every input shape — only
  // the invariant that the procedure refuses when ctx.webUser.tenantId
  // ≠ input.tenantId for tenant_owner role.
  const procedures: Array<{ name: keyof ReturnType<typeof createCaller>; input: any }> = [
    { name: "list", input: { tenantId: FOREIGN_TENANT } },
    { name: "listMatchingIds", input: { tenantId: FOREIGN_TENANT } },
    { name: "get", input: { tenantId: FOREIGN_TENANT, chatId: 1 } },
    { name: "bulkDelete", input: { tenantId: FOREIGN_TENANT, chatIds: [1] } },
    { name: "bulkSetGlobalBlock", input: { tenantId: FOREIGN_TENANT, chatIds: [1], blocked: true } },
    { name: "create", input: { tenantId: FOREIGN_TENANT, name: "X", contacts: { phone: "+48000" } } },
    { name: "update", input: { tenantId: FOREIGN_TENANT, chatId: 1, patch: { name: "Y" } } },
    { name: "delete", input: { tenantId: FOREIGN_TENANT, chatId: 1 } },
    { name: "setGlobalBlock", input: { tenantId: FOREIGN_TENANT, chatId: 1, blocked: true } },
    { name: "exportCsv", input: { tenantId: FOREIGN_TENANT } },
    { name: "importCsv", input: { tenantId: FOREIGN_TENANT, csv: "name,phone\nA,+48000\n" } },
    { name: "csvTemplate", input: { tenantId: FOREIGN_TENANT } },
    { name: "tagSuggestions", input: { tenantId: FOREIGN_TENANT } },
  ];

  describe.each(procedures)("$name", ({ name, input }) => {
    it("refuses tenant_owner querying another tenant's id with FORBIDDEN", async () => {
      const db = buildDb();
      const caller = createCaller(makeTenantOwnerCtx(db, OWNER_TENANT) as never);
      // Use any-cast — the test enumerates dozens of procedures with
      // heterogeneous input shapes that don't unify under a single type.
      await expect((caller as any)[name](input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe.each(procedures)("$name", ({ name, input }) => {
    it("allows system_admin to pass any tenant id (cross-tenant by design)", async () => {
      // system_admin doesn't need its tenantId to match. We provide
      // enough mock data for each procedure to either succeed or fail
      // with a non-isolation error (NOT_FOUND, BAD_REQUEST, etc).
      const db = buildDb([
        [{ isBlockedGlobal: 0 }],
        [{}],
        [{}],
        [{}],
        [{}],
      ]);
      const caller = createCaller(makeAdminCtx(db) as never);
      // We just assert that the call doesn't throw FORBIDDEN. Other
      // errors (NOT_FOUND, BAD_REQUEST from missing rows) are fine —
      // those don't come from the tenant gate.
      try {
        await (caller as any)[name](input);
      } catch (e: any) {
        expect(e.code).not.toBe("FORBIDDEN");
      }
    });
  });
});

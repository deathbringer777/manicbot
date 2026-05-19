/**
 * L-F (audit 2026-05-20) — role-scoped procedure builders MUST distinguish
 * between "no session" (UNAUTHORIZED / 401) and "wrong role" (FORBIDDEN /
 * 403). The pre-fix middlewares short-circuited both cases to FORBIDDEN,
 * so an unauthenticated tRPC call returned the wrong status code and the
 * client-side error handler couldn't decide whether to redirect to /login
 * (401) or render a "no access" page (403).
 *
 * Pins parity with `adminProcedure`, which already had the right shape.
 */
import { describe, it, expect, vi } from "vitest";

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

import { TRPCError } from "@trpc/server";
import {
  createCallerFactory,
  createTRPCRouter,
  tenantOwnerProcedure,
  managerProcedure,
  masterProcedure,
  systemAdminProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import { makeUnauthCtx, makeMasterCtx, makeTenantOwnerCtx } from "./helpers/db-mock";

const probeRouter = createTRPCRouter({
  ownerOnly: tenantOwnerProcedure.query(() => "ok"),
  managerOk: managerProcedure.query(() => "ok"),
  masterOk: masterProcedure.query(() => "ok"),
  sysadminOk: systemAdminProcedure.query(() => "ok"),
  adminOk: adminProcedure.query(() => "ok"),
});

const createCaller = createCallerFactory(probeRouter);

function expectTRPCCode(err: unknown, code: string) {
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe(code);
}

describe("L-F — role middleware error codes", () => {
  describe("tenantOwnerProcedure", () => {
    it("throws UNAUTHORIZED when there is no web session", async () => {
      const caller = createCaller(makeUnauthCtx(null) as never);
      try {
        await caller.ownerOnly();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "UNAUTHORIZED");
      }
    });

    it("throws FORBIDDEN when the role is wrong but session exists", async () => {
      const caller = createCaller(makeMasterCtx(null, "t_x") as never);
      try {
        await caller.ownerOnly();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "FORBIDDEN");
      }
    });

    it("allows tenant_owner through", async () => {
      const caller = createCaller(makeTenantOwnerCtx(null, "t_x") as never);
      const r = await caller.ownerOnly();
      expect(r).toBe("ok");
    });
  });

  describe("managerProcedure", () => {
    it("throws UNAUTHORIZED when there is no web session", async () => {
      const caller = createCaller(makeUnauthCtx(null) as never);
      try {
        await caller.managerOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "UNAUTHORIZED");
      }
    });

    it("throws FORBIDDEN when role is not in the allowlist", async () => {
      const ctx = {
        db: null,
        webUser: { id: "x", email: "x@x", tenantId: null, webRole: "stranger" },
        headers: new Headers(),
      };
      const caller = createCaller(ctx as never);
      try {
        await caller.managerOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "FORBIDDEN");
      }
    });
  });

  describe("masterProcedure", () => {
    it("throws UNAUTHORIZED when there is no web session", async () => {
      const caller = createCaller(makeUnauthCtx(null) as never);
      try {
        await caller.masterOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "UNAUTHORIZED");
      }
    });

    it("throws FORBIDDEN for wrong role", async () => {
      const ctx = {
        db: null,
        webUser: { id: "x", email: "x@x", tenantId: null, webRole: "stranger" },
        headers: new Headers(),
      };
      const caller = createCaller(ctx as never);
      try {
        await caller.masterOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "FORBIDDEN");
      }
    });

    it("allows master through", async () => {
      const caller = createCaller(makeMasterCtx(null, "t_x") as never);
      const r = await caller.masterOk();
      expect(r).toBe("ok");
    });
  });

  describe("systemAdminProcedure", () => {
    it("throws UNAUTHORIZED when there is no web session", async () => {
      const caller = createCaller(makeUnauthCtx(null) as never);
      try {
        await caller.sysadminOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "UNAUTHORIZED");
      }
    });

    it("throws FORBIDDEN for tenant_owner (not sysadmin)", async () => {
      const caller = createCaller(makeTenantOwnerCtx(null, "t_x") as never);
      try {
        await caller.sysadminOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "FORBIDDEN");
      }
    });
  });

  describe("adminProcedure (regression — existing behaviour preserved)", () => {
    it("throws UNAUTHORIZED when there is no web session", async () => {
      const caller = createCaller(makeUnauthCtx(null) as never);
      try {
        await caller.adminOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "UNAUTHORIZED");
      }
    });

    it("throws FORBIDDEN when role is not system_admin", async () => {
      const caller = createCaller(makeTenantOwnerCtx(null, "t_x") as never);
      try {
        await caller.adminOk();
        throw new Error("did not throw");
      } catch (e) {
        expectTRPCCode(e, "FORBIDDEN");
      }
    });
  });
});

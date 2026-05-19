/**
 * hasPassword field — direct authRouter test.
 *
 * Phase 2 cleanup: replaced the previous "MockWebUser + mirror" approach
 * with a real `createCaller(authRouter)` exercise covering every shape of
 * the `web_users.password_hash` column we care about (set / null / empty
 * string / DB error path). The previous mirror file re-implemented the
 * `!!rows[0]?.passwordHash` derivation and asserted on the copy, which
 * could pass even if the real router stopped reading the column.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { authRouter } from "~/server/api/routers/auth";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeSupportCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(authRouter);

describe("authRouter.getMyRole.hasPassword — real router contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tenant_owner with passwordHash set → hasPassword=true", async () => {
    const { db } = createDbMock([
      [
        {
          createdAt: 1700000000,
          emailVerified: 1,
          passwordHash: "pbkdf2:sha256:100000:salt:hash",
        },
      ],
      [
        {
          name: "Salon",
          displayName: null,
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: "cus_x",
        },
      ],
    ]);
    const result = await callerFactory(makeTenantOwnerCtx(db, "t_abc") as never).getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("tenant_owner");
    expect(result.email).toBe("owner@test.com");
  });

  it("tenant_owner with passwordHash=null (Google reg) → hasPassword=false", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: null }],
      [
        {
          name: "Salon",
          displayName: null,
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: null,
        },
      ],
    ]);
    const result = await callerFactory(makeTenantOwnerCtx(db, "t_xyz") as never).getMyRole();
    expect(result.hasPassword).toBe(false);
  });

  it("tenant_owner with passwordHash='' → hasPassword=false (empty hash treated as absent)", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: "" }],
      [
        {
          name: "Salon",
          displayName: null,
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: null,
        },
      ],
    ]);
    const result = await callerFactory(makeTenantOwnerCtx(db, "t_empty") as never).getMyRole();
    expect(result.hasPassword).toBe(false);
  });

  it("master with passwordHash → hasPassword=true", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: "hash" }],
      [
        {
          name: "Salon",
          displayName: null,
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: null,
        },
      ],
      [{ chatId: 100, avatarUrl: null, avatarEmoji: null }],
    ]);
    const result = await callerFactory(makeMasterCtx(db, "t_m") as never).getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("master");
  });

  it("master without passwordHash (Google reg) → hasPassword=false", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: null }],
      [
        {
          name: "Salon",
          displayName: null,
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: null,
        },
      ],
      [{ chatId: 100, avatarUrl: null, avatarEmoji: null }],
    ]);
    const result = await callerFactory(makeMasterCtx(db, "t_m") as never).getMyRole();
    expect(result.hasPassword).toBe(false);
  });

  it("support with passwordHash → hasPassword=true", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: "hash" }],
    ]);
    const result = await callerFactory(makeSupportCtx(db) as never).getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("support");
  });

  it("system_admin with passwordHash → hasPassword=true", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: "admin-hash" }],
    ]);
    const result = await callerFactory(makeAdminCtx(db) as never).getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("system_admin");
  });

  // ─── EMPTY-default contract (unauthenticated context) ───
  it("unauthenticated → hasPassword=true (defensive default in EMPTY)", async () => {
    const { db } = createDbMock();
    const result = await callerFactory(makeUnauthCtx(db) as never).getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBeNull();
    expect(result.email).toBeNull();
    expect(result.emailVerified).toBe(true);
  });
});

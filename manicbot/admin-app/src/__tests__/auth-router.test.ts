/**
 * authRouter.getMyRole — direct router test.
 *
 * Phase 2 cleanup: replaced the previous "getMyRoleLogic" mirror-function
 * with a real `createCaller(authRouter)` exercise. The previous file
 * tested decision-tree logic that was already gone from the production
 * router (Telegram-user codepath was removed during the web-auth
 * migration), so deleting the mirror revealed zero coverage gap.
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
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(authRouter);

describe("authRouter.getMyRole — unauthenticated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns EMPTY (role=null) for an unauthenticated context", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.role).toBeNull();
    expect(result.tenantId).toBeNull();
    expect(result.email).toBeNull();
    expect(result.webUserId).toBeNull();
    expect(result.permissions).toEqual([]);
  });

  it("EMPTY defaults: hasPassword=true, emailVerified=true, isTrialExpired=false", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.hasPassword).toBe(true);
    expect(result.emailVerified).toBe(true);
    expect(result.isTrialExpired).toBe(false);
  });
});

describe("authRouter.getMyRole — system_admin web user", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role=system_admin with no tenantId for an admin web user", async () => {
    // First select: webUsers row (createdAt, emailVerified, passwordHash)
    // No tenantId so tenant-row select is skipped.
    const { db } = createDbMock([
      [
        {
          createdAt: 1700000000,
          emailVerified: 1,
          passwordHash: "pbkdf2:sha256:100000:salt:hash",
        },
      ],
    ]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.role).toBe("system_admin");
    expect(result.tenantId).toBeNull();
    expect(result.email).toBe("admin@test.com");
    expect(result.hasPassword).toBe(true);
    expect(result.emailVerified).toBe(true);
  });
});

describe("authRouter.getMyRole — tenant_owner web user", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role=tenant_owner + tenantId enrichment", async () => {
    // 1. webUsers row, 2. tenants row
    const { db } = createDbMock([
      [
        {
          createdAt: 1700000000,
          emailVerified: 1,
          passwordHash: "hash",
        },
      ],
      [
        {
          name: "Salon Test",
          displayName: "Salon Test",
          logo: null,
          isPersonal: 0,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: "cus_X",
        },
      ],
    ]);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_abc") as never);
    const result = await caller.getMyRole();
    expect(result.role).toBe("tenant_owner");
    expect(result.tenantId).toBe("t_abc");
    expect(result.tenantName).toBe("Salon Test");
    expect(result.isPersonalTenant).toBe(false);
    expect(result.isTest).toBe(false);
  });

  it("flags isPersonalTenant when tenants.is_personal=1", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: "hash" }],
      [
        {
          name: "Personal",
          displayName: null,
          logo: null,
          isPersonal: 1,
          isTest: 0,
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          stripeCustomerId: null,
        },
      ],
    ]);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_personal") as never);
    const result = await caller.getMyRole();
    expect(result.isPersonalTenant).toBe(true);
  });
});

describe("authRouter.getMyRole — master web user", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role=master + master enrichment (masterId, avatar fields)", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: "hash" }],
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
      [{ chatId: 4242, avatarUrl: null, avatarEmoji: null }],
    ]);
    const caller = callerFactory(makeMasterCtx(db, "t_salon") as never);
    const result = await caller.getMyRole();
    expect(result.role).toBe("master");
    expect(result.tenantId).toBe("t_salon");
    expect(result.masterId).toBe(4242);
  });
});

describe("authRouter.getMyRole — support web user", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role=support without tenant enrichment", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: "hash" }],
    ]);
    const caller = callerFactory(makeSupportCtx(db, "support") as never);
    const result = await caller.getMyRole();
    expect(result.role).toBe("support");
    expect(result.tenantId).toBeNull();
  });

  it("returns role=technical_support without tenant enrichment", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1700000000, emailVerified: 1, passwordHash: "hash" }],
    ]);
    const caller = callerFactory(makeSupportCtx(db, "technical_support") as never);
    const result = await caller.getMyRole();
    expect(result.role).toBe("technical_support");
    expect(result.tenantId).toBeNull();
  });
});

describe("authRouter.getMyRole — hasPassword field", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hasPassword=true when DB row has a non-empty passwordHash", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: "pbkdf2:hash" }],
    ]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.hasPassword).toBe(true);
  });

  it("hasPassword=false when DB row has passwordHash=null (Google-only registration)", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: null }],
    ]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.hasPassword).toBe(false);
  });

  it("hasPassword=false when DB row has passwordHash=''", async () => {
    const { db } = createDbMock([
      [{ createdAt: 1, emailVerified: 1, passwordHash: "" }],
    ]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getMyRole();
    expect(result.hasPassword).toBe(false);
  });
});

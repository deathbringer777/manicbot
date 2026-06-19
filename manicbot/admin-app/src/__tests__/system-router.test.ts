/**
 * Phase 2 cleanup: orphan-router pin for `systemRouter`.
 *
 * The system router is system-admin-only (every procedure is
 * `adminProcedure`). Pins:
 *   - role gates: unauth → UNAUTHORIZED, non-admin → FORBIDDEN
 *   - getHealth happy path (returns ok+latency shape)
 *   - getTableStats returns the expected aggregated shape
 *   - getEnvStatus reads env booleans without crashing on missing keys
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
import { systemRouter } from "~/server/api/routers/system";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(systemRouter);

describe("system.getHealth — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getHealth()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner (system_admin-only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.getHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects master", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, "t") as never);
    await expect(caller.getHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("system.getHealth — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin gets ok status + dbConnected:true on a successful SELECT", async () => {
    const { db } = createDbMock([[{ count: 0 }]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getHealth();
    expect(result.status).toBe("ok");
    expect(result.dbConnected).toBe(true);
    expect(typeof result.dbLatencyMs).toBe("number");
  });
});

describe("system.getTableStats — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getTableStats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns a tables array + totalRows for admin (zero rows on empty DB)", async () => {
    // The router runs Promise.all over 14 tables; each select returns either
    // a count row or throws. We supply enough zero-count rows for all calls;
    // the mock recycles to [] (count: 0).
    const zeros = Array.from({ length: 16 }, () => [{ count: 0 }]);
    const { db } = createDbMock(zeros);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getTableStats();
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.tables.length).toBeGreaterThan(0);
    expect(typeof result.totalRows).toBe("number");
  });
});

describe("system.getEnvStatus — adminProcedure gate + env booleans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin (FORBIDDEN)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.getEnvStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin sees env booleans + channel counts shape", async () => {
    // Pre-stack DB results: channel_configs select, bots count, web_users count, support_agents count.
    const { db } = createDbMock([[], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getEnvStatus();
    expect(typeof result.hasWorkerUrl).toBe("boolean");
    expect(typeof result.hasAdminKey).toBe("boolean");
    expect(typeof result.hasAdminChatId).toBe("boolean");
    expect(typeof result.hasResendKey).toBe("boolean");
    expect(typeof result.hasTelegramToken).toBe("boolean");
    expect(result.channelCounts).toMatchObject({
      telegram: expect.any(Number),
      whatsapp: expect.any(Number),
      instagram: expect.any(Number),
    });
  });
});

describe("system.getConsentLog — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getConsentLog()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("admin gets a list (empty when no tos_accepted rows)", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getConsentLog();
    expect(Array.isArray(result)).toBe(true);
  });
});

// PR-A: Resend transport self-test for the silent-fail invite path.
describe("system.testResendTransport — adminProcedure gate + transport probe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.testResendTransport()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner (system_admin-only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.testResendTransport()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when ctx.webUser has no email (PRECONDITION_FAILED)", async () => {
    const { db } = createDbMock();
    const ctx = makeAdminCtx(db) as any;
    ctx.webUser.email = ""; // edge case: admin row created without email
    const caller = callerFactory(ctx);
    await expect(caller.testResendTransport()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "no_sysadmin_email_on_record",
    });
  });
});

describe("system.getArchitectureDiagram — adminProcedure gate + payload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.getArchitectureDiagram()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner (system_admin-only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.getArchitectureDiagram()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects master", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, "t") as never);
    await expect(caller.getArchitectureDiagram()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin receives a mermaid erd payload", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.getArchitectureDiagram();
    expect(result.format).toBe("mermaid");
    expect(result.mermaid).toContain("erDiagram");
    expect(typeof result.tableCount).toBe("number");
  });
});

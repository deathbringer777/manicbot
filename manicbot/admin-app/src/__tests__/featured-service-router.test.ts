/**
 * salon.getFeaturedService / setFeaturedService — the web-chat "featured
 * service" pin, stored in tenant_config under `featured_service_id`. The Worker
 * (`resolveFeaturedServiceId`) reads the same key; `'auto'` means auto-select.
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
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  },
}));
vi.mock("~/server/audit/auditLog", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx, makeForbiddenWebCtx } from "./helpers/db-mock";

const callSalon = createCallerFactory(salonRouter);

describe("salon.getFeaturedService", () => {
  it("defaults to 'auto' when no pin is stored", async () => {
    const { db } = createDbMock([[]]);
    const caller = callSalon(makeTenantOwnerCtx(db, "t_alpha") as never);
    expect(await caller.getFeaturedService({ tenantId: "t_alpha" })).toEqual({ svcId: "auto" });
  });

  it("reads back a pinned service id (JSON-decoded)", async () => {
    const { db } = createDbMock([[{ value: JSON.stringify("gel") }]]);
    const caller = callSalon(makeTenantOwnerCtx(db, "t_alpha") as never);
    expect(await caller.getFeaturedService({ tenantId: "t_alpha" })).toEqual({ svcId: "gel" });
  });

  it("cross-tenant owner is forbidden", async () => {
    const { db } = createDbMock([[]]);
    const caller = callSalon(makeForbiddenWebCtx(db) as never);
    await expect(caller.getFeaturedService({ tenantId: "t_alpha" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("salon.setFeaturedService", () => {
  it("upserts the JSON-encoded service id under featured_service_id", async () => {
    const { db, insertCalls } = createDbMock([]);
    const caller = callSalon(makeTenantOwnerCtx(db, "t_alpha") as never);
    const r = await caller.setFeaturedService({ tenantId: "t_alpha", svcId: "gel" });
    expect(r).toMatchObject({ success: true });
    expect(insertCalls.at(-1)!.values).toMatchObject({
      tenantId: "t_alpha",
      key: "featured_service_id",
      value: JSON.stringify("gel"),
    });
  });

  it("'auto' clears the pin (stored as JSON \"auto\")", async () => {
    const { db, insertCalls } = createDbMock([]);
    const caller = callSalon(makeTenantOwnerCtx(db, "t_alpha") as never);
    await caller.setFeaturedService({ tenantId: "t_alpha", svcId: "auto" });
    expect(insertCalls.at(-1)!.values.value).toBe(JSON.stringify("auto"));
  });

  it("cross-tenant owner cannot set another tenant's featured service", async () => {
    const { db } = createDbMock([]);
    const caller = callSalon(makeForbiddenWebCtx(db) as never);
    await expect(
      caller.setFeaturedService({ tenantId: "t_alpha", svcId: "gel" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

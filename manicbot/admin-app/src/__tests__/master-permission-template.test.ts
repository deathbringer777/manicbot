/**
 * Migration 0063 — permission system unification.
 *
 * salon.createMasterAccount now accepts an optional `permissionTemplate`
 * that auto-grants a permission set to the salon-invited master so they
 * fall through assertPermission()'s new non-personal master branch.
 *
 *   - default      → MASTER_DEFAULT (5 own-scope keys)
 *   - stylist_plus → MASTER_DEFAULT + appointments.view_peers + clients.view_peers
 *   - read_only    → broad *.view set, no *.manage
 *   - custom       → no rows inserted (owner configures via Staff tab)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import {
  MASTER_DEFAULT,
  PERMISSION_TEMPLATES,
  type PermissionKey,
} from "~/server/api/permissions";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const NOW = 1_715_000_000;
const TENANT = "t_salon_alpha";

function permissionRowsFrom(insertCalls: Array<{ values: any }>): PermissionKey[] {
  // tenantMemberPermissions inserts have the `.permission` column.
  return insertCalls
    .map((c) => c.values)
    .filter((v) => typeof v?.permission === "string" && typeof v?.webUserId === "string")
    .map((v) => v.permission as PermissionKey);
}

describe("salon.createMasterAccount permission templates (migration 0063)", () => {
  const createCaller = createCallerFactory(salonRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("default template inserts the 5 MASTER_DEFAULT permissions", async () => {
    // selects: assertTenantOwner check (tenants row), email-existence check (empty), tenants name lookup (empty)
    // assertTenantOwner short-circuits for tenant_owner (no DB call). The
    // only select in createMasterAccount when no email is passed is the
    // webUsers email-existence check — return [] to signal "no conflict".
    const mock = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Anna",
      permissionTemplate: "default",
    });

    const granted = permissionRowsFrom(mock.insertCalls).sort();
    expect(granted).toEqual([...MASTER_DEFAULT].sort());
  });

  it("stylist_plus template inserts the cross-master view perms on top of MASTER_DEFAULT", async () => {
    const mock = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Boris",
      permissionTemplate: "stylist_plus",
    });

    const granted = new Set(permissionRowsFrom(mock.insertCalls));
    for (const p of PERMISSION_TEMPLATES.stylist_plus) {
      expect(granted.has(p)).toBe(true);
    }
    expect(granted.has("appointments.view_peers" as PermissionKey)).toBe(true);
    expect(granted.has("clients.view_peers" as PermissionKey)).toBe(true);
  });

  it("read_only template inserts no *.manage permissions", async () => {
    const mock = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Cara",
      permissionTemplate: "read_only",
    });

    const granted = permissionRowsFrom(mock.insertCalls);
    expect(granted.length).toBeGreaterThan(0);
    for (const p of granted) {
      expect(p.endsWith(".manage")).toBe(false);
    }
  });

  it("custom template inserts no permission rows (owner configures later)", async () => {
    const mock = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Dasha",
      permissionTemplate: "custom",
    });

    const granted = permissionRowsFrom(mock.insertCalls);
    expect(granted).toEqual([]);
  });

  it("omitting permissionTemplate falls back to 'default'", async () => {
    const mock = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Eva",
    });

    const granted = permissionRowsFrom(mock.insertCalls).sort();
    expect(granted).toEqual([...MASTER_DEFAULT].sort());
  });
});

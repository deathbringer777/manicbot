import { describe, it, expect } from "vitest";
import {
  TENANT_PERMISSION_KEYS,
  TENANT_MANAGER_DEFAULT,
  SENSITIVE_PERMISSIONS,
  isSensitive,
  assertPermission,
  type PermissionKey,
} from "~/server/api/permissions";

describe("permission constants", () => {
  it("default set is fully included in TENANT_PERMISSION_KEYS", () => {
    for (const p of TENANT_MANAGER_DEFAULT) {
      expect(TENANT_PERMISSION_KEYS).toContain(p);
    }
  });

  it("sensitive set is fully included in TENANT_PERMISSION_KEYS", () => {
    for (const p of SENSITIVE_PERMISSIONS) {
      expect(TENANT_PERMISSION_KEYS).toContain(p);
    }
  });

  it("default and sensitive sets are disjoint", () => {
    for (const p of TENANT_MANAGER_DEFAULT) {
      expect(SENSITIVE_PERMISSIONS).not.toContain(p);
    }
  });

  it("isSensitive matches SENSITIVE_PERMISSIONS", () => {
    for (const p of SENSITIVE_PERMISSIONS) expect(isSensitive(p)).toBe(true);
    for (const p of TENANT_MANAGER_DEFAULT) expect(isSensitive(p)).toBe(false);
  });
});

describe("assertPermission", () => {
  const db = {} as never;

  it("rejects unauthenticated", async () => {
    await expect(
      assertPermission({ webUser: null, db }, "t_demo", "appointments.view"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects empty tenantId (null===null bypass)", async () => {
    await expect(
      assertPermission({ webUser: { id: "w", email: "x@y.z", tenantId: null, webRole: "tenant_owner" }, db }, "", "chat.inbox"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows system_admin for any tenant/permission", async () => {
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "a@b.c", tenantId: null, webRole: "system_admin" }, db },
        "t_any",
        "billing.manage",
      ),
    ).resolves.toBeUndefined();
  });

  it("allows tenant_owner on matching tenant", async () => {
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "a@b.c", tenantId: "t_mine", webRole: "tenant_owner" }, db },
        "t_mine",
        "services.manage",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects tenant_owner on wrong tenant", async () => {
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "a@b.c", tenantId: "t_other", webRole: "tenant_owner" }, db },
        "t_mine",
        "services.manage",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_manager with no permission row", async () => {
    const emptyDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    } as never;
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_mine", webRole: "tenant_manager" }, db: emptyDb },
        "t_mine",
        "billing.manage",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows tenant_manager with matching permission row", async () => {
    const dbWithRow = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ permission: "chat.inbox" as PermissionKey }]),
          }),
        }),
      }),
    } as never;
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_mine", webRole: "tenant_manager" }, db: dbWithRow },
        "t_mine",
        "chat.inbox",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects tenant_manager on wrong tenant scope", async () => {
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_other", webRole: "tenant_manager" }, db },
        "t_mine",
        "chat.inbox",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

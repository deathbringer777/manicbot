import { describe, it, expect } from "vitest";
import {
  TENANT_PERMISSION_KEYS,
  TENANT_MANAGER_DEFAULT,
  MASTER_DEFAULT,
  SENSITIVE_PERMISSIONS,
  PERMISSION_TEMPLATES,
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

  it("master default set is fully included in TENANT_PERMISSION_KEYS", () => {
    for (const p of MASTER_DEFAULT) {
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

  it("master default and sensitive sets are disjoint", () => {
    for (const p of MASTER_DEFAULT) {
      expect(SENSITIVE_PERMISSIONS).not.toContain(p);
    }
  });

  it("isSensitive matches SENSITIVE_PERMISSIONS", () => {
    for (const p of SENSITIVE_PERMISSIONS) expect(isSensitive(p)).toBe(true);
    for (const p of TENANT_MANAGER_DEFAULT) expect(isSensitive(p)).toBe(false);
    for (const p of MASTER_DEFAULT) expect(isSensitive(p)).toBe(false);
  });

  it("new master scope keys are present", () => {
    const expected: PermissionKey[] = [
      "appointments.view_own",
      "appointments.manage_own",
      "clients.view_own",
      "earnings.view_own",
      "appointments.view_peers",
      "appointments.create_for_peer",
      "clients.view_peers",
      "earnings.view_peers",
    ];
    for (const p of expected) expect(TENANT_PERMISSION_KEYS).toContain(p);
  });

  it("new tenant_manager extension keys are present", () => {
    const expected: PermissionKey[] = [
      "analytics.view",
      "reviews.manage",
      "plugins.view",
      "plugins.manage",
      "referrals.view_tenant",
    ];
    for (const p of expected) expect(TENANT_PERMISSION_KEYS).toContain(p);
  });

  it("earnings.view_peers / plugins.manage / referrals.view_tenant are sensitive", () => {
    expect(SENSITIVE_PERMISSIONS).toContain("earnings.view_peers");
    expect(SENSITIVE_PERMISSIONS).toContain("plugins.manage");
    expect(SENSITIVE_PERMISSIONS).toContain("referrals.view_tenant");
  });

  it("PERMISSION_TEMPLATES expose the four named templates", () => {
    expect(Object.keys(PERMISSION_TEMPLATES).sort()).toEqual(
      ["front_desk", "manager", "read_only", "stylist_plus"].sort(),
    );
    // Read-only must not contain any *.manage permissions.
    for (const p of PERMISSION_TEMPLATES.read_only) {
      expect(p.endsWith(".manage")).toBe(false);
    }
    // stylist_plus must include own-scope master perms.
    expect(PERMISSION_TEMPLATES.stylist_plus).toContain("appointments.view_own");
    expect(PERMISSION_TEMPLATES.stylist_plus).toContain("appointments.view_peers");
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

  it("master on PERSONAL tenant bypasses (own-scope key)", async () => {
    // First select() returns tenants row with isPersonal=1 → bypass.
    let firstCall = true;
    const dbPersonal = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              const result = firstCall ? [{ isPersonal: 1 }] : [];
              firstCall = false;
              return Promise.resolve(result);
            },
          }),
        }),
      }),
    } as never;
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_personal", webRole: "master" }, db: dbPersonal },
        "t_personal",
        "appointments.view_own",
      ),
    ).resolves.toBeUndefined();
  });

  it("master on NON-personal tenant with matching perm row → allowed", async () => {
    // First select(): tenants row with isPersonal=0 (not personal).
    // Second select(): tenant_member_permissions returns a matching row.
    let call = 0;
    const dbNonPersonal = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              call += 1;
              if (call === 1) return Promise.resolve([{ isPersonal: 0 }]);
              return Promise.resolve([{ permission: "appointments.view_peers" as PermissionKey }]);
            },
          }),
        }),
      }),
    } as never;
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_salon", webRole: "master" }, db: dbNonPersonal },
        "t_salon",
        "appointments.view_peers",
      ),
    ).resolves.toBeUndefined();
  });

  it("master on NON-personal tenant WITHOUT perm row → FORBIDDEN", async () => {
    let call = 0;
    const dbNoRow = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              call += 1;
              if (call === 1) return Promise.resolve([{ isPersonal: 0 }]);
              return Promise.resolve([]);
            },
          }),
        }),
      }),
    } as never;
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_salon", webRole: "master" }, db: dbNoRow },
        "t_salon",
        "earnings.view_peers",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects master on wrong tenant scope (tenantId mismatch)", async () => {
    await expect(
      assertPermission(
        { webUser: { id: "w", email: "m@x.z", tenantId: "t_other", webRole: "master" }, db },
        "t_salon",
        "appointments.view_own",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

import { describe, it, expect } from "vitest";
import { assertTenantOwner } from "~/server/api/tenantAccess";

describe("assertTenantOwner (salon / channels API gate)", () => {
  it("rejects unauthenticated callers before any DB access", async () => {
    await expect(
      assertTenantOwner({ webUser: null, db: {} as never }, "t_any"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects undefined webUser", async () => {
    await expect(
      assertTenantOwner({ webUser: undefined, db: {} as never }, "t_any"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows web user with system_admin role", async () => {
    await expect(
      assertTenantOwner(
        { webUser: { id: "w1", email: "a@b.com", tenantId: null, webRole: "system_admin" }, db: {} as never },
        "t_any",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects web tenant_owner for wrong tenant", async () => {
    await expect(
      assertTenantOwner(
        { webUser: { id: "w2", email: "b@c.com", tenantId: "t_other", webRole: "tenant_owner" }, db: {} as never },
        "t_target",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects web support for any tenant", async () => {
    await expect(
      assertTenantOwner(
        { webUser: { id: "w3", email: "s@b.com", tenantId: null, webRole: "support" }, db: {} as never },
        "t_any",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects empty tenantId (null===null bypass)", async () => {
    await expect(
      assertTenantOwner(
        { webUser: { id: "w", email: "x@y.z", tenantId: null, webRole: "tenant_owner" }, db: {} as never },
        "",
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

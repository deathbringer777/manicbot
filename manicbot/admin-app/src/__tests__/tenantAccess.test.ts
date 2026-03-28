import { describe, it, expect } from "vitest";
import { assertTenantOwner } from "~/server/api/tenantAccess";

describe("assertTenantOwner (salon / channels API gate)", () => {
  it("rejects unauthenticated callers before any DB access", async () => {
    await expect(
      assertTenantOwner({ user: null, db: {} as never }, "t_any"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects undefined user", async () => {
    await expect(
      assertTenantOwner({ user: undefined, db: {} as never }, "t_any"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

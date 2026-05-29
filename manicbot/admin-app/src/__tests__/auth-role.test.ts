import { describe, it, expect } from "vitest";
import type { AppRole } from "~/server/api/routers/auth";
import {
  isAssignablePlatformStaffRole,
  ASSIGNABLE_PLATFORM_STAFF_ROLES,
} from "~/server/api/platformRoles";

describe("AppRole type contract", () => {
  const validRoles: AppRole[] = [
    "system_admin",
    "support",
    "technical_support",
    "tenant_owner",
    "master",
    null,
  ];

  it("all expected roles exist", () => {
    const nonNull = validRoles.filter(r => r !== null) as string[];
    expect(nonNull).toContain("system_admin");
    expect(nonNull).toContain("support");
    expect(nonNull).toContain("technical_support");
    expect(nonNull).toContain("tenant_owner");
    expect(nonNull).toContain("master");
  });

  it("null is a valid role (unauthenticated / client)", () => {
    const r: AppRole = null;
    expect(r).toBeNull();
  });
});

describe("assignable platform staff roles", () => {
  it("support and technical_support match", () => {
    expect(isAssignablePlatformStaffRole("technical_support")).toBe(true);
    expect(isAssignablePlatformStaffRole("support")).toBe(true);
    expect(isAssignablePlatformStaffRole("system_admin")).toBe(false);
  });

  it("tenant and unrelated strings do not match", () => {
    expect(isAssignablePlatformStaffRole("tenant_owner")).toBe(false);
    expect(isAssignablePlatformStaffRole("master")).toBe(false);
    expect(isAssignablePlatformStaffRole(null)).toBe(false);
    expect(isAssignablePlatformStaffRole(undefined)).toBe(false);
  });

  it("ASSIGNABLE_PLATFORM_STAFF_ROLES lists support staff only", () => {
    expect(ASSIGNABLE_PLATFORM_STAFF_ROLES).toEqual(["support", "technical_support"]);
  });
});

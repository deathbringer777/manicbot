/**
 * Tenant-isolation contract for `webUsers.getMyUiPrefs` / `setMyUiPrefs`.
 *
 * Both procedures take `tenantId` from input (so a single user can keep
 * different sidebar layouts in different salons). The membership guard
 * (`assertTenantMember`) MUST reject calls where the caller is not part of
 * the tenant being addressed — otherwise any logged-in user could spam the
 * `tenant_config` table in any other tenant.
 *
 * The audit done in PR #92 against `manicbot-coding-standards` (Tenant
 * Isolation section) added this guard. These tests lock that contract.
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertTenantMember } from "~/server/api/tenantAccess";

function makeCtx(role: string, tenantId: string | null) {
  return {
    db: { select: () => ({ from: () => ({ where: () => ({ limit: () => [{ isPersonal: 0 }] }) }) }) } as any,
    webUser: { id: "u1", email: "user@example.com", tenantId, webRole: role },
  };
}

describe("webUsers.getMyUiPrefs / setMyUiPrefs — tenant membership guard", () => {
  it("tenant_owner of tenant A can access their own tenant", async () => {
    const ctx = makeCtx("tenant_owner", "tenant_a");
    await expect(assertTenantMember(ctx, "tenant_a")).resolves.toBeUndefined();
  });

  it("tenant_owner of tenant A cannot access tenant B", async () => {
    const ctx = makeCtx("tenant_owner", "tenant_a");
    await expect(assertTenantMember(ctx, "tenant_b")).rejects.toBeInstanceOf(TRPCError);
  });

  it("tenant_manager of tenant A can access their own tenant", async () => {
    const ctx = makeCtx("tenant_manager", "tenant_a");
    await expect(assertTenantMember(ctx, "tenant_a")).resolves.toBeUndefined();
  });

  it("system_admin can access any tenant", async () => {
    const ctx = makeCtx("system_admin", null);
    await expect(assertTenantMember(ctx, "tenant_a")).resolves.toBeUndefined();
  });

  it("master from tenant A cannot access tenant B", async () => {
    const ctx = makeCtx("master", "tenant_a");
    await expect(assertTenantMember(ctx, "tenant_b")).rejects.toBeInstanceOf(TRPCError);
  });

  it("unauthenticated caller cannot access any tenant", async () => {
    const ctx = { db: {} as any, webUser: null };
    await expect(assertTenantMember(ctx, "tenant_a")).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects empty tenant id", async () => {
    const ctx = makeCtx("tenant_owner", "tenant_a");
    await expect(assertTenantMember(ctx, "")).rejects.toBeInstanceOf(TRPCError);
  });
});

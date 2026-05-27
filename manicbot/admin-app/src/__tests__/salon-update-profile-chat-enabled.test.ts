/**
 * `salon.updateSalonProfile` — `chatEnabled` flag (migration 0091).
 *
 * Decouples the salon web-chat surface from public-profile publication.
 * Before 0091 the only knob was `publicActive`: turning it on listed the
 * salon in the catalog AND made the chat URL resolve, conflating two
 * decisions. After 0091, `chatEnabled` is independent — owners can keep
 * their public card hidden while still running a working chat link they
 * share manually (business card / Instagram bio / printed QR).
 *
 * This file pins:
 *   • The new zod field accepts 0 and 1 (no other values).
 *   • Persistence: the value lands on `tenants.chatEnabled` via the same
 *     UPDATE statement as the other column patches.
 *   • The existing publish-guard (slug + name + services) ONLY fires
 *     when `publicActive` is being set to 1. Toggling `chatEnabled`
 *     alone never triggers the readiness check — chat works fine with
 *     no services or no name (the AI handles the conversation).
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
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(salonRouter);

function makeCaller(tenantRow: Record<string, unknown>, extraSelects: unknown[] = []) {
  const { db, updateCalls } = createDbMock([[tenantRow], ...extraSelects]);
  const caller = createCaller(makeTenantOwnerCtx(db, tenantRow.id as string) as never);
  return { caller, updateCalls };
}

describe("salon.updateSalonProfile — chatEnabled (0091)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("persists chatEnabled=1 to the tenants update payload", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Crystal",
      salon: "{}",
      slug: "crystal",
      publicActive: 0,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      chatEnabled: 1,
    } as never);

    expect(updateCalls.length).toBeGreaterThan(0);
    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate.chatEnabled).toBe(1);
  });

  it("persists chatEnabled=0 to the tenants update payload (pause chat)", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Crystal",
      salon: "{}",
      slug: "crystal",
      publicActive: 1,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      chatEnabled: 0,
    } as never);

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate.chatEnabled).toBe(0);
  });

  it("rejects out-of-range values via zod (only 0 or 1 accepted)", async () => {
    const { caller } = makeCaller({
      id: "t_owner",
      name: "Crystal",
      salon: "{}",
      slug: "crystal",
      publicActive: 0,
    });

    await expect(
      caller.updateSalonProfile({
        tenantId: "t_owner",
        chatEnabled: 2 as 0 | 1,
      } as never),
    ).rejects.toThrow();

    await expect(
      caller.updateSalonProfile({
        tenantId: "t_owner",
        chatEnabled: -1 as 0 | 1,
      } as never),
    ).rejects.toThrow();
  });

  it("does NOT trigger the publish-guard (slug+name+services) when only chatEnabled is set", async () => {
    // Tenant with no slug, no name, and zero services would normally fail
    // the publish-guard if `publicActive=1` were set. With only
    // `chatEnabled=1` the guard must not fire — chat is independent of
    // catalog readiness.
    const { caller, updateCalls } = makeCaller({
      id: "t_blank",
      name: "",
      salon: "{}",
      slug: null,
      publicActive: 0,
    });

    await expect(
      caller.updateSalonProfile({
        tenantId: "t_blank",
        chatEnabled: 1,
      } as never),
    ).resolves.toBeDefined();

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate.chatEnabled).toBe(1);
  });

  it("leaves chatEnabled column alone when the field is omitted", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Crystal",
      salon: "{}",
      slug: "crystal",
      publicActive: 1,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      phone: "+48 123",
    } as never);

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate).not.toHaveProperty("chatEnabled");
  });
});

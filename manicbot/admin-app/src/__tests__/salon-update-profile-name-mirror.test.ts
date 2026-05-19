/**
 * `salon.updateSalonProfile` — name mirror to `tenants.salon` JSON.
 *
 * Before this fix the procedure wrote `input.name` ONLY to the
 * `tenants.name` column. The Worker's `showAdminSettings`
 * ([src/ui/admin.js:184](../../src/ui/admin.js)) reads from `ctx.tenant.salon.name`
 * first; when the JSON has no `name` key the bot rendered "—" even
 * though the dashboard happily showed the salon name from the
 * separate column. That divergence broke "why doesn't my salon info
 * sync to the bot" for any tenant whose `salon` JSON did not yet
 * carry an explicit `name`.
 *
 * The fix mirrors `input.name` into the parsed `salon` JSON during
 * the same write, so the bot's primary read path is always populated.
 *
 * Tests:
 *   • `name` alone → updates set `salon` JSON containing `name` AND
 *     `tenants.name` column.
 *   • `name` together with other salon fields → JSON keeps the
 *     existing keys and adds/overwrites `name` without dropping the
 *     other fields.
 *   • Empty/whitespace `name` is rejected by `sanitizeText` but does
 *     not corrupt the JSON for callers that omit `name` entirely.
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

function makeCaller(tenantRow: Record<string, unknown>) {
  const { db, updateCalls } = createDbMock([[tenantRow]]);
  const caller = createCaller(makeTenantOwnerCtx(db, tenantRow.id as string) as never);
  return { caller, updateCalls };
}

describe("salon.updateSalonProfile — mirrors name into salon JSON", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("writes name to both tenants.name and tenants.salon.name when salon JSON was empty", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Old",
      salon: "{}",
      slug: null,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      name: "Crystal Nails",
    } as never);

    expect(updateCalls.length).toBeGreaterThan(0);
    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate.name).toBe("Crystal Nails");
    expect(typeof lastUpdate.salon).toBe("string");
    const salonJson = JSON.parse(lastUpdate.salon as string);
    expect(salonJson.name).toBe("Crystal Nails");
  });

  it("preserves existing salon fields when adding name", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Old",
      salon: JSON.stringify({ phone: "+48 123", address: "Nowy Świat 1" }),
      slug: null,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      name: "Crystal Nails",
    } as never);

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    const salonJson = JSON.parse(lastUpdate.salon as string);
    expect(salonJson.name).toBe("Crystal Nails");
    expect(salonJson.phone).toBe("+48 123");
    expect(salonJson.address).toBe("Nowy Świat 1");
  });

  it("trims/sanitizes the mirrored name the same way as tenants.name", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Old",
      salon: "{}",
      slug: null,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      name: "  Crystal Nails  ",
    } as never);

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    expect(lastUpdate.name).toBe("Crystal Nails");
    const salonJson = JSON.parse(lastUpdate.salon as string);
    expect(salonJson.name).toBe("Crystal Nails");
  });

  it("does not touch salon.name when input.name is omitted", async () => {
    const { caller, updateCalls } = makeCaller({
      id: "t_owner",
      name: "Existing",
      salon: JSON.stringify({ name: "Salon X", phone: "+48 999" }),
      slug: null,
    });

    await caller.updateSalonProfile({
      tenantId: "t_owner",
      phone: "+48 100",
    } as never);

    const lastUpdate = updateCalls[updateCalls.length - 1]!.values;
    const salonJson = JSON.parse(lastUpdate.salon as string);
    // name in JSON stays as it was — we don't blow it away on phone-only update
    expect(salonJson.name).toBe("Salon X");
    expect(salonJson.phone).toBe("+48 100");
  });
});

/**
 * Integration walkthrough: install → disable → enable → uninstall on a live
 * fixture plugin. Exercises the audit trail path end-to-end via the mock db.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginsRouter } from "~/server/api/routers/plugins";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(pluginsRouter);

describe("Plugin lifecycle end-to-end", () => {
  it("install → disable → enable → uninstall, each step writes an event", async () => {
    // Sequence of select results per call:
    // install: [plan lookup, dup check]
    // disable: [load install]
    // enable: [load install]
    // uninstall: [load install]
    //
    // Each mutation returns {ok:true} and increments insertCalls/updateCalls/deleteCalls.

    const { db, insertCalls, updateCalls, deleteCalls } = createDbMock([
      [{ plan: "pro" }], // install — plan lookup
      [],                // install — dup check
      [{
        id: "pi_1", tenantId: "t_pro", pluginSlug: "live-test",
        enabled: 1, version: "1.0.0", installedBy: "w_owner",
        installedAt: 1000, updatedAt: 1000, settingsJson: null,
        billingState: "not_applicable",
        stripeSubscriptionItemId: null, stripePaymentIntentId: null,
      }], // disable — load install
      [{
        id: "pi_1", tenantId: "t_pro", pluginSlug: "live-test",
        enabled: 0, version: "1.0.0", installedBy: "w_owner",
        installedAt: 1000, updatedAt: 1000, settingsJson: null,
        billingState: "not_applicable",
        stripeSubscriptionItemId: null, stripePaymentIntentId: null,
      }], // enable — load install
      [{
        id: "pi_1", tenantId: "t_pro", pluginSlug: "live-test",
        enabled: 1, version: "1.0.0", installedBy: "w_owner",
        installedAt: 1000, updatedAt: 1000, settingsJson: null,
        billingState: "not_applicable",
        stripeSubscriptionItemId: null, stripePaymentIntentId: null,
      }], // uninstall — load install
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);

    const installRes = await caller.install({ slug: "live-test", tenantId: "t_pro" });
    expect(installRes.id).toMatch(/.+/);

    // After install: 2 inserts (install row + installed event)
    expect(insertCalls.length).toBe(2);
    expect(insertCalls[1]!.values.event).toBe("installed");

    await caller.disable({ installationId: "pi_1" });
    // 1 update + 1 disabled event
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]!.values.enabled).toBe(0);
    expect(insertCalls.length).toBe(3);
    expect(insertCalls[2]!.values.event).toBe("disabled");

    await caller.enable({ installationId: "pi_1" });
    expect(updateCalls.length).toBe(2);
    expect(updateCalls[1]!.values.enabled).toBe(1);
    expect(insertCalls.length).toBe(4);
    expect(insertCalls[3]!.values.event).toBe("enabled");

    await caller.uninstall({ installationId: "pi_1" });
    expect(deleteCalls.length).toBe(1);
    // 1 more event (uninstalled)
    expect(insertCalls.length).toBe(5);
    expect(insertCalls[4]!.values.event).toBe("uninstalled");
  });
});

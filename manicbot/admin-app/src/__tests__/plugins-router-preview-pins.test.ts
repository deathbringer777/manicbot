/**
 * Server-side guards for «view as master» preview-pins on the plugins
 * router. These exercise the new `effectiveWebUserId` input shape and
 * confirm that the caller cannot read or write someone else's pins
 * outside the narrowly-defined preview path.
 *
 * Strategy: mock the DB so `select(...).from(masters).where(...).limit(1)`
 * returns a master row when (and only when) the test wants the
 * tenant-membership check to succeed.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginsRouter } from "~/server/api/routers/plugins";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(pluginsRouter);
const SLUG = "message-templates";

describe("plugins.listPinned — preview-as-master guards", () => {
  it("owner viewing own profile (no effectiveWebUserId) returns own pins", async () => {
    // Two select chains: (1) caller-own pins lookup
    const { db } = createDbMock([
      [{ slug: SLUG }], // own pins
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const out = await caller.listPinned();
    expect(out).toEqual([SLUG]);
  });

  it("owner viewing real master in same tenant returns master's pins", async () => {
    // Two select chains: (1) masters lookup confirming membership,
    // (2) master's pin list.
    const { db } = createDbMock([
      [{ id: 1234 }], // masters lookup succeeds
      [{ slug: SLUG }], // master's pins
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const out = await caller.listPinned({ effectiveWebUserId: "master-uid" });
    expect(out).toEqual([SLUG]);
  });

  it("owner cannot view pins of a uid that is not a master in their tenant", async () => {
    // masters lookup returns empty → FORBIDDEN before pin query runs
    const { db } = createDbMock([
      [], // masters lookup empty
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(
      caller.listPinned({ effectiveWebUserId: "outsider-uid" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "cannot_view_other_users_pins",
    });
  });

  it("master role cannot view another master's pins via effectiveWebUserId", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeMasterCtx(db, "t_1") as never);
    await expect(
      caller.listPinned({ effectiveWebUserId: "another-master-uid" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "cannot_view_other_users_pins",
    });
  });

  it("system_admin may view any master's pins (support escalation path)", async () => {
    const { db } = createDbMock([
      [{ id: 99 }], // masters lookup succeeds
      [{ slug: SLUG }], // master's pins
    ]);
    // system_admin context with an explicit tenantId routes through the
    // staff-with-tenant branch.
    const ctx = {
      ...makeAdminCtx(db),
      webUser: { ...makeAdminCtx(db).webUser, tenantId: "t_1" },
    };
    const caller = createCaller(ctx as never);
    const out = await caller.listPinned({ effectiveWebUserId: "master-uid" });
    expect(out).toEqual([SLUG]);
  });

  it("passing own uid as effectiveWebUserId is treated as no-op (own pins)", async () => {
    // Only one select: own pins (the resolver short-circuits when
    // requested == caller).
    const { db } = createDbMock([
      [{ slug: SLUG }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const out = await caller.listPinned({ effectiveWebUserId: "w_owner" });
    expect(out).toEqual([SLUG]);
  });
});

describe("plugins.togglePin — preview-as-master write guard", () => {
  it("rejects when effectiveWebUserId differs from caller (owner can't modify master's pins)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(
      caller.togglePin({ slug: SLUG, effectiveWebUserId: "master-uid" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "cannot_modify_other_users_pins",
    });
  });

  it("accepts when effectiveWebUserId echoes the caller (no-op symmetry for cache)", async () => {
    // Mutation path: existing-row lookup empty → count select → insert.
    const { db } = createDbMock([
      [], // existing row lookup
      [{ c: 0 }], // pin count
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const res = await caller.togglePin({ slug: SLUG, effectiveWebUserId: "w_owner" });
    expect(res).toEqual({ pinned: true });
  });

  it("accepts when effectiveWebUserId is omitted (legacy / regular call)", async () => {
    const { db } = createDbMock([
      [], // existing row lookup
      [{ c: 0 }], // pin count
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const res = await caller.togglePin({ slug: SLUG });
    expect(res).toEqual({ pinned: true });
  });
});

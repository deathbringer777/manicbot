/**
 * salon.updateMasterAvatar — avatarUrl host pin (audit 2026-06-12, V-2
 * follow-up). The avatar is picked via MasterAvatarPicker, which mints a
 * `master_avatar` CDN URL — it is never a pasted external URL. The field used
 * to be `z.string().max(2000).nullable()` with NO validation, so a tenant
 * owner could store any string (incl. an external tracking pixel) that renders
 * as `<img src>` in the masters tab. It is now pinned to the host-locked CDN
 * shape; emoji-only and reset (null) still pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
const TENANT = "t_av";
const base = { tenantId: TENANT, chatId: 42, avatarEmoji: null, avatarR2Key: null };

describe("salon.updateMasterAvatar — avatarUrl host pin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a host-pinned master_avatar CDN URL", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const r = await caller.updateMasterAvatar({
      ...base,
      avatarUrl: "https://worker.test/cdn/t/" + TENANT + "/master_avatar-deadbeef0123.png",
    });
    expect(r.success).toBe(true);
  });

  it("accepts emoji-only and null reset", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.updateMasterAvatar({ ...base, avatarEmoji: "💅", avatarUrl: null }),
    ).resolves.toMatchObject({ success: true });
  });

  it("rejects an external tracking-pixel host (V-2 class)", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.updateMasterAvatar({
        ...base,
        avatarUrl: "https://evil.example/cdn/t/" + TENANT + "/master_avatar-deadbeef0123.png",
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects an arbitrary non-CDN string", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.updateMasterAvatar({ ...base, avatarUrl: "https://evil.example/track.png" }),
    ).rejects.toBeTruthy();
  });
});

/**
 * SEC-003 — masterRouter.updateProfile URL hardening.
 *
 * `photo` was `z.string().url()` (accepts `javascript:` / `data:`) and
 * `portfolio` was `z.array(z.string())` (no per-element validation at all).
 * Both render into `<img src>` in the dashboard today (where `javascript:` is
 * inert), but this is the one master-facing surface the U1/U2 https-only
 * normalization missed — a latent stored-XSS the moment either value is moved
 * into an `<a href>` or a looser-CSP context. Pin both to https-only.
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
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { createDbMock, makeMasterCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(masterRouter);

describe("masterRouter.updateProfile — URL hardening (SEC-003)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "http://cdn.example.com/p.png", // bare http
    "vbscript:msgbox(1)",
  ])("rejects photo = %j", async (badUrl) => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const caller = createCaller(makeMasterCtx(db, "t_alice") as never);
    await expect(
      caller.updateProfile({ tenantId: "t_alice", masterId: 100, photo: badUrl } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a portfolio containing a non-https entry", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const caller = createCaller(makeMasterCtx(db, "t_alice") as never);
    await expect(
      caller.updateProfile({
        tenantId: "t_alice",
        masterId: 100,
        portfolio: ["https://cdn.example.com/ok.png", "javascript:alert(1)"],
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts an https photo", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const caller = createCaller(makeMasterCtx(db, "t_alice") as never);
    const r = await caller.updateProfile({
      tenantId: "t_alice",
      masterId: 100,
      photo: "https://cdn.example.com/me.png",
    } as never);
    expect(r).toEqual({ success: true });
  });

  it("accepts an all-https portfolio (and empty)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const caller = createCaller(makeMasterCtx(db, "t_alice") as never);
    const r = await caller.updateProfile({
      tenantId: "t_alice",
      masterId: 100,
      portfolio: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    } as never);
    expect(r).toEqual({ success: true });
  });
});

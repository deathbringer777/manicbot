/**
 * Marketing SMS tab — tenant-vendor-leak pin.
 *
 * Salon owners (mode === "tenant" in `useMarketingScope`) must NEVER see
 * the Brevo/Resend/Twilio plumbing strings on the SMS tab. When SMS is
 * not yet wired at the platform level it's a "coming soon" facade from
 * their POV. System admins (mode === "admin") are the ones operating
 * the providers and still see the ENV gate so they know what's missing.
 *
 * This file pins the contract. A future regression that pipes the
 * vendor name back through to the tenant surface — or removes the
 * greyed-out + non-interactive treatment — fails these asserts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SMS_CLIENT = path.join(
  ROOT,
  "app/(dashboard)/marketing/sms/SmsClient.tsx",
);

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function readSmsClient(): string {
  return readFileSync(SMS_CLIENT, "utf8");
}

/**
 * Slice the body of the `if (showTenantComingSoon) { return (…); }` early
 * return so vendor-name asserts only check what the tenant actually sees,
 * not the sysadmin gate that lives in the same file.
 */
function tenantBranchSource(src: string): string {
  const anchor = src.indexOf("if (showTenantComingSoon)");
  expect(anchor).toBeGreaterThan(0);
  // Take a generous window — the early return is < 2 KB.
  const end = src.indexOf("\n  return (", anchor);
  expect(end).toBeGreaterThan(anchor);
  return src.slice(anchor, end);
}

describe("marketing SMS — tenant vendor-leak contract", () => {
  it("tenant branch renders no vendor names or ENV variable strings", () => {
    const tenantSrc = tenantBranchSource(readSmsClient());
    // Brevo plumbing must not appear on the tenant facade.
    expect(tenantSrc).not.toMatch(/Brevo/i);
    expect(tenantSrc).not.toMatch(/BREVO_API_KEY/);
    expect(tenantSrc).not.toMatch(/BREVO_SMS_SENDER/);
    expect(tenantSrc).not.toMatch(/xkeysib/i);
    // The Brevo/ENV gate copy lives behind these keys. Pin both — the
    // facade uses `comingSoon.*` and must NOT use `notConfigured.*`.
    expect(tenantSrc).not.toMatch(/marketing\.sms\.notConfigured\./);
    expect(tenantSrc).toMatch(/marketing\.sms\.comingSoon\.title/);
    expect(tenantSrc).toMatch(/marketing\.sms\.comingSoon\.description/);
  });

  it("tenant work area is greyed out + non-interactive + cursor-not-allowed", () => {
    const tenantSrc = tenantBranchSource(readSmsClient());
    // The disabled-feel pattern: greyed (opacity-60), non-interactive
    // (pointer-events-none), un-clickable cursor.
    expect(tenantSrc).toMatch(/opacity-60/);
    expect(tenantSrc).toMatch(/pointer-events-none/);
    expect(tenantSrc).toMatch(/cursor-not-allowed/);
    // The container exposes a stable hook so other tests / e2e can
    // assert on the facade existing.
    expect(tenantSrc).toMatch(/data-testid="sms-coming-soon"/);
    // The Create button is also explicitly disabled — defense in depth
    // beyond the parent's pointer-events-none.
    expect(tenantSrc).toMatch(/disabled\b[^>]*aria-disabled="true"/s);
  });

  it("tenant providersList router returns only sanitized capability flags", () => {
    // The router contract is the second line of defence. Even if the UI
    // regressed, the tenant procedure must not ship vendor names.
    const src = read("server/api/routers/marketingTenant.ts");
    const idx = src.indexOf("providersList: protectedProcedure");
    expect(idx).toBeGreaterThan(0);
    // Grab the procedure body (next 2 KB is enough — it's short).
    const body = src.slice(idx, idx + 2000);
    // Return shape is `{ canSendEmail, canSendSms }` — no provider names.
    // (Internal lookups like `enabledNames.has(p.name)` are fine; the
    // contract is about the return value, not the implementation.)
    expect(body).toMatch(/return\s*\{\s*canSendEmail,\s*canSendSms\s*\}/);
    // Pinpoint: the return statement itself must not name a provider.
    const returnMatch = body.match(/return\s*\{[^}]+\}/);
    expect(returnMatch).toBeTruthy();
    const returned = returnMatch![0];
    expect(returned).not.toMatch(/name/i);
    expect(returned).not.toMatch(/brevo/i);
    expect(returned).not.toMatch(/resend/i);
    expect(returned).not.toMatch(/twilio/i);
  });

  it("admin branch still keeps the Brevo ENV gate (sysadmin needs to know)", () => {
    const src = readSmsClient();
    // The admin path is the SECOND return block. It still references the
    // Brevo plumbing so the sysadmin can see what's missing.
    const adminBranchStart = src.indexOf("showAdminBrevoGate");
    expect(adminBranchStart).toBeGreaterThan(0);
    expect(src).toMatch(/BREVO_API_KEY/);
    expect(src).toMatch(/BREVO_SMS_SENDER/);
    // Pinned i18n keys — sysadmin still gets the technical strings.
    expect(src).toMatch(/marketing\.sms\.notConfigured\.title/);
    expect(src).toMatch(/marketing\.sms\.notConfigured\.description/);
  });

  it("i18n keys for the coming-soon facade exist in all four languages", () => {
    const src = read("lib/i18n.ts");
    // Anchor by key, then assert ru/ua/en/pl appear in the same row.
    for (const key of [
      '"marketing.sms.comingSoon.title"',
      '"marketing.sms.comingSoon.description"',
      '"marketing.sms.comingSoon.cta"',
    ]) {
      const idx = src.indexOf(key);
      expect(idx, `missing i18n key ${key}`).toBeGreaterThan(0);
      const row = src.slice(idx, idx + 800);
      expect(row).toMatch(/\bru:/);
      expect(row).toMatch(/\bua:/);
      expect(row).toMatch(/\ben:/);
      expect(row).toMatch(/\bpl:/);
    }
  });
});

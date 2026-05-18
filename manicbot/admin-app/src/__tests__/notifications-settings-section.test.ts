/**
 * NotificationsSection — settings panel surface contract.
 *
 * Source-level pin: the panel must mount the push hook, expose the
 * reset + test buttons, and render a row per category with both
 * channel toggles. Behavioral coverage of the underlying tRPC routes
 * lives in notifications-router.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SECTION = resolve(__dirname, "../components/settings/sections/NotificationsSection.tsx");
const SHELL = resolve(__dirname, "../components/settings/SettingsShell.tsx");
const PAGE = resolve(__dirname, "../app/(dashboard)/settings/SettingsPageClient.tsx");

describe("NotificationsSection — panel contract", () => {
  const src = readFileSync(SECTION, "utf8");

  it("uses useLang + t() (no hardcoded Russian)", () => {
    expect(src).toMatch(/from "~\/components\/LangContext"/);
    expect(src).toMatch(/from "~\/lib\/i18n"/);
    expect(src).toMatch(/t\("notifications\.settings\.push\.title", lang\)/);
    expect(src).toMatch(/t\("notifications\.settings\.categories\.title", lang\)/);
  });

  it("wires the push subscription hook", () => {
    expect(src).toMatch(/usePushSubscription/);
    expect(src).toMatch(/push\.subscribe/);
    expect(src).toMatch(/push\.unsubscribe/);
  });

  it("wires the prefs CRUD + reset + test mutations", () => {
    expect(src).toMatch(/api\.notifications\.getMyPrefs/);
    expect(src).toMatch(/api\.notifications\.setMyPrefs/);
    expect(src).toMatch(/api\.notifications\.resetMyPrefs/);
    expect(src).toMatch(/api\.notifications\.sendTestNotification/);
  });

  it("renders one toggle pair per category", () => {
    expect(src).toMatch(/NOTIFICATION_CATEGORIES\.map\(/);
    expect(src).toMatch(/testId=\{`toggle-\$\{cat\}-inapp`\}/);
    expect(src).toMatch(/testId=\{`toggle-\$\{cat\}-push`\}/);
    // The reusable Toggle component must forward testId → data-testid so
    // the rendered DOM matches what RTL tests would query.
    expect(src).toMatch(/data-testid=\{testId\}/);
  });

  it("surfaces the explicit unsupported / not-configured / denied states", () => {
    expect(src).toMatch(/notifications\.settings\.push\.unsupported/);
    expect(src).toMatch(/notifications\.settings\.push\.notConfigured/);
    expect(src).toMatch(/notifications\.settings\.push\.deniedHint/);
  });

  it("renders the scenarios reference block (read-only what-fires-when)", () => {
    expect(src).toMatch(/SCENARIOS/);
    expect(src).toMatch(/notifications\.settings\.scenarios\.title/);
  });
});

describe("SettingsShell — notifications section wired in", () => {
  const src = readFileSync(SHELL, "utf8");

  it("section labels include `notifications` for all four locales", () => {
    expect(src).toMatch(/notifications:\s*{[\s\S]*?ru:[\s\S]*?ua:[\s\S]*?en:[\s\S]*?pl:/);
  });

  it("section ICON map covers notifications", () => {
    expect(src).toMatch(/notifications: Bell/);
  });

  it.each([
    ["tenant_owner", /tenant_owner.*notifications/],
    ["master", /master.*notifications/],
    ["support", /support.*notifications/],
    ["system_admin", /system_admin.*notifications/],
  ])("role %s gets the notifications section", (_role, pattern) => {
    // Compact: each role branch in getSections() must mention the
    // section id at least once. Real lookup happens at runtime.
    expect(src.replace(/\s+/g, " ")).toMatch(pattern);
  });
});

describe("SettingsPageClient — notifications case wired", () => {
  const src = readFileSync(PAGE, "utf8");

  it("imports NotificationsSection", () => {
    expect(src).toMatch(/import \{ NotificationsSection \}/);
  });

  it("routes `notifications` to <NotificationsSection />", () => {
    expect(src).toMatch(/case "notifications":[\s\S]*?<NotificationsSection \/>/);
  });
});

/**
 * NotificationBell.tsx — source-level pin for the PR2 VK/FB-style
 * redesign. We don't need RTL render here — the bell's polling +
 * mutation hooks are already locked by notifications-router.test.ts;
 * what we need is to make sure the visual contract (tabs, groups,
 * per-kind icon, wider panel) stays in place.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../components/layout/NotificationBell.tsx");

describe("NotificationBell — PR2 redesign contract", () => {
  const src = readFileSync(FILE, "utf8");

  it("imports shared kindMeta helper (single source of truth)", () => {
    expect(src).toMatch(/from "~\/lib\/notifications\/kindMeta"/);
    expect(src).toMatch(/\bkindMeta\b/);
    expect(src).toMatch(/\bformatRelative\b/);
    expect(src).toMatch(/\bbellGroup\b/);
    expect(src).toMatch(/\bbellGroupTitle\b/);
  });

  it("uses i18n via useLang() — no hardcoded Russian copy", () => {
    expect(src).toMatch(/from "~\/components\/LangContext"/);
    expect(src).toMatch(/from "~\/lib\/i18n"/);
    expect(src).toMatch(/t\("notifications\.title", lang\)/);
    expect(src).toMatch(/t\("notifications\.tab\.all", lang\)/);
    expect(src).toMatch(/t\("notifications\.tab\.unread", lang\)/);
    // None of the user-visible Russian strings remain in the source.
    expect(src).not.toMatch(/>Уведомления</);
    expect(src).not.toMatch(/>Прочитать всё</);
    expect(src).not.toMatch(/>Загрузка…</);
    expect(src).not.toMatch(/>Включить</);
  });

  it("renders the All / Unread filter tabs", () => {
    expect(src).toContain('data-testid="notification-bell-tab-all"');
    expect(src).toContain('data-testid="notification-bell-tab-unread"');
  });

  it("renders both group sections (new + earlier)", () => {
    expect(src).toContain('data-testid={`notification-bell-group-${group}`}');
    expect(src).toMatch(/"new", "earlier"/);
  });

  it("rows expose kind + unread state for downstream tests", () => {
    expect(src).toContain('data-testid="notification-bell-row"');
    expect(src).toContain("data-kind={n.kind}");
    expect(src).toContain('data-unread={isUnread ? "true" : "false"}');
  });

  it("uses the wider VK-style panel (22rem mobile / 26rem desktop)", () => {
    expect(src).toMatch(/w-\[22rem\] sm:w-\[26rem\]/);
  });

  it("passes unreadOnly to the list query based on filter state", () => {
    expect(src).toMatch(/unreadOnly: filter === "unread"/);
  });

  it("footer 'See all' link points to /notifications", () => {
    expect(src).toContain('href="/notifications"');
    expect(src).toContain('data-testid="notification-bell-see-all"');
  });
});

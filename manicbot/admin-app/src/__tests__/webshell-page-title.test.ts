/**
 * WebShell.getPageTitle — top-bar title resolver.
 *
 * Pins the contract so the title in the top bar reflects the active tab
 * (Clients / Services / Billing / etc.) instead of always reading
 * "Dashboard" — the user reported this as confusing across every role.
 *
 * Coverage:
 *   - tenant_owner: ?tab= hrefs resolve to the right localized label.
 *   - master:       same, with master-only labels.
 *   - system_admin: real-path navs (e.g. /appointments, /tenants) keep
 *                   working; bare /dashboard still falls back to
 *                   "Dashboard".
 *   - support:      single nav, falls back to "Dashboard" on /dashboard.
 *   - /settings:    always "Settings" regardless of role.
 *
 * The function is locale-aware via tNav; we cover ru + en for spot-check.
 */
import { describe, it, expect } from "vitest";
import { getPageTitle } from "~/components/layout/WebShell";
import { NAV_ITEMS, type NavItemDef } from "~/lib/nav/navConfig";
import type { AppRole } from "~/server/api/routers/auth";
import type { NavItem } from "~/lib/nav/useNavItems";
import { tNav } from "~/lib/nav/useNavItems";

function flatNavForRole(role: AppRole, lang: "ru" | "en" = "ru"): NavItem[] {
  // Mirror useNavItems flattening, minus the dashboard-prefs filtering
  // (test fixtures don't have access to that hook). We just want every
  // item the role would see.
  return NAV_ITEMS.filter((it: NavItemDef) => it.roles.includes(role)).map(
    (it: NavItemDef) => ({
      href: it.href,
      label: tNav(it.labelKey, lang),
      icon: it.icon,
      group: it.group,
      requiresPersonalTenant: it.requiresPersonalTenant,
      hideable: it.hideable,
    }),
  );
}

describe("WebShell.getPageTitle — top-bar resolves to the active tab/page", () => {
  describe("tenant_owner — ?tab= hrefs must beat the bare /dashboard", () => {
    const flat = flatNavForRole("tenant_owner", "ru");

    it.each([
      ["?tab=clients", "Клиенты"],
      ["?tab=services", "Услуги"],
      ["?tab=masters", "Мастера"],
      ["?tab=analytics", "Аналитика"],
      ["?tab=reviews", "Отзывы"],
      ["?tab=appointments", "Записи"],
    ])("/dashboard%s → %s", (search, expected) => {
      expect(getPageTitle("/dashboard", search, flat, "ru")).toBe(expected);
    });

    it("bare /dashboard with no tab still resolves to 'Домой'", () => {
      expect(getPageTitle("/dashboard", "", flat, "ru")).toBe("Домой");
    });

    it("non-tab paths still resolve via prefix (e.g. /marketing → Маркетинг)", () => {
      expect(getPageTitle("/marketing", "", flat, "ru")).toBe("Маркетинг");
    });
  });

  describe("master — ?tab= hrefs work too", () => {
    const flat = flatNavForRole("master", "en");

    it.each([
      ["?tab=schedule", "Schedule"],
      ["?tab=clients", "Clients"],
      ["?tab=earnings", "Earnings"],
      ["?tab=reviews", "Reviews"],
      ["?tab=profile", "Profile"],
    ])("/dashboard%s → %s", (search, expected) => {
      expect(getPageTitle("/dashboard", search, flat, "en")).toBe(expected);
    });

    it("bare /dashboard for master resolves to 'Today'", () => {
      // master's /dashboard nav is "Today" not "Dashboard".
      expect(getPageTitle("/dashboard", "", flat, "en")).toBe("Today");
    });
  });

  describe("system_admin — real path navs keep working", () => {
    const flat = flatNavForRole("system_admin", "en");

    it.each([
      ["/appointments", "Appointments"],
      ["/tenants", "Salons"],
      ["/users", "Users"],
      ["/billing", "Billing"],
    ])("%s → %s", (pathname, expected) => {
      expect(getPageTitle(pathname, "", flat, "en")).toBe(expected);
    });

    it("/dashboard → Home (system_admin home)", () => {
      expect(getPageTitle("/dashboard", "", flat, "en")).toBe("Home");
    });

    it("/dashboard?tab=role-requests → Role Requests", () => {
      expect(getPageTitle("/dashboard", "?tab=role-requests", flat, "en")).toBe("Role Requests");
    });
  });

  describe("support — single nav at /dashboard", () => {
    const flat = flatNavForRole("support", "en");

    it("/dashboard → Tickets (support's single nav label)", () => {
      expect(getPageTitle("/dashboard", "", flat, "en")).toBe("Tickets");
    });
  });

  describe("/settings is hardcoded across every role", () => {
    it.each(["tenant_owner", "master", "system_admin", "support"] as const)(
      "%s on /settings → 'Settings'",
      (role) => {
        const flat = flatNavForRole(role, "en");
        expect(getPageTitle("/settings", "", flat, "en")).toBe("Settings");
      },
    );

    it("/settings/billing (nested) still resolves to 'Settings'", () => {
      const flat = flatNavForRole("system_admin", "en");
      expect(getPageTitle("/settings/billing", "", flat, "en")).toBe("Settings");
    });
  });

  describe("regression — never returns the bare 'Dashboard' for tab-driven roles", () => {
    it.each(["tenant_owner", "master"] as const)(
      "%s on /dashboard?tab=clients does NOT collapse to 'Dashboard'",
      (role) => {
        const flat = flatNavForRole(role, "ru");
        const title = getPageTitle("/dashboard", "?tab=clients", flat, "ru");
        expect(title).toBe("Клиенты");
        expect(title).not.toBe("Домой");
      },
    );
  });
});

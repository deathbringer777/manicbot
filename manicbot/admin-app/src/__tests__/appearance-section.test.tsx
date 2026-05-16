// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";

import { AppearanceSection } from "~/components/settings/sections/AppearanceSection";
import { RoleContext } from "~/components/RoleContext";
import type { RoleContextValue } from "~/components/RoleContext";
import { LangContext } from "~/components/LangContext";
import { loadDashboardPrefs, dashboardPrefsKey } from "~/lib/useDashboardPrefs";

// ── localStorage stub (happy-dom's native impl is incomplete) ──
const _lsStore: Record<string, string> = {};
const _mockLocalStorage = {
  getItem: (key: string) => _lsStore[key] ?? null,
  setItem: (key: string, value: string) => { _lsStore[key] = String(value); },
  removeItem: (key: string) => { delete _lsStore[key]; },
  clear: () => { Object.keys(_lsStore).forEach((k) => delete _lsStore[k]); },
  get length() { return Object.keys(_lsStore).length; },
  key: (n: number) => Object.keys(_lsStore)[n] ?? null,
};
beforeAll(() => { vi.stubGlobal("localStorage", _mockLocalStorage); });
beforeEach(() => { _mockLocalStorage.clear(); });
afterEach(() => cleanup());

function renderWith(tenantId: string | null = "t_test", lang: "ru" | "en" = "ru") {
  const roleValue: RoleContextValue = {
    role: "tenant_owner",
    tenantId,
    tenantName: null,
    userId: null,
    createdAt: null,
    hasPassword: true,
    emailVerified: true,
    isPersonalTenant: false,
    permissions: [],
    billingStatus: "active",
    isTrialExpired: false,
    previewRole: null,
    previewTenantId: null,
    setPreviewRole: () => {},
    previewMasterId: null,
    setPreviewMaster: () => {},
  };
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <RoleContext.Provider value={roleValue}>
        <AppearanceSection />
      </RoleContext.Provider>
    </LangContext.Provider>
  );
}

describe("AppearanceSection — collapsible sections", () => {
  it("renders all three sections collapsed by default", () => {
    const { container } = renderWith();
    const triggers = container.querySelectorAll("button[aria-expanded]");
    expect(triggers.length).toBe(3);
    triggers.forEach((t) => expect(t.getAttribute("aria-expanded")).toBe("false"));
    // Bodies are not in the DOM when collapsed (conditional render).
    expect(screen.queryByText("Боковая панель")).toBeTruthy();
    expect(screen.queryByText(/Всегда видим/)).toBeNull();
    expect(container.querySelector("select")).toBeNull();
  });

  it("clicking a section header expands it (aria-expanded=true, body rendered)", () => {
    renderWith();
    const trigger = screen.getByRole("button", { name: /Боковая панель/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Body now shows the "Всегда видим" badge (Dashboard row in the sidebar list).
    expect(screen.getByText(/Всегда видим/)).toBeTruthy();
  });

  it("clicking an expanded header collapses it again", () => {
    renderWith();
    const trigger = screen.getByRole("button", { name: /Боковая панель/ });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Всегда видим/)).toBeNull();
  });

  it("each section toggles independently", () => {
    renderWith();
    const sidebar = screen.getByRole("button", { name: /Боковая панель/ });
    const widgets = screen.getByRole("button", { name: /Виджеты обзора/ });
    const defaultTab = screen.getByRole("button", { name: /Какая вкладка открывается при входе/ });

    fireEvent.click(widgets);
    expect(sidebar.getAttribute("aria-expanded")).toBe("false");
    expect(widgets.getAttribute("aria-expanded")).toBe("true");
    expect(defaultTab.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(defaultTab);
    expect(widgets.getAttribute("aria-expanded")).toBe("true");
    expect(defaultTab.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("AppearanceSection — default-tab dropdown", () => {
  it("expanding the default-tab section reveals a <select> with 'Не выбрано' as the first option", () => {
    renderWith("t_test", "ru");
    fireEvent.click(screen.getByRole("button", { name: /Какая вкладка открывается при входе/ }));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeTruthy();
    // First option should be "Не выбрано" (value="")
    const firstOption = select.options[0]!;
    expect(firstOption.value).toBe("");
    expect(firstOption.textContent).toBe("Не выбрано");
    // Default selected value is "" (matches the new DEFAULTS.defaultTab).
    expect(select.value).toBe("");
  });

  it("uses the locale-correct label for 'Not selected' across languages", () => {
    const { unmount } = renderWith("t_test", "en");
    fireEvent.click(screen.getByRole("button", { name: /Which tab opens when you sign in/ }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).options[0]!.textContent).toBe("Not selected");
    unmount();
  });

  it("selecting a tab persists defaultTab in localStorage", () => {
    renderWith("t_test", "ru");
    fireEvent.click(screen.getByRole("button", { name: /Какая вкладка открывается при входе/ }));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // Pick a real tab option (the "appointments" tab by value).
    fireEvent.change(select, { target: { value: "appointments" } });

    const stored = loadDashboardPrefs("t_test");
    expect(stored.defaultTab).toBe("appointments");
  });

  it("selecting 'Не выбрано' resets defaultTab to empty string", () => {
    // Seed localStorage with a non-empty defaultTab so we can confirm the reset.
    _mockLocalStorage.setItem(
      dashboardPrefsKey("t_test"),
      JSON.stringify({ hiddenTabs: [], hiddenStatCards: [], showTodayApts: true, defaultTab: "billing" })
    );
    renderWith("t_test", "ru");
    fireEvent.click(screen.getByRole("button", { name: /Какая вкладка открывается при входе/ }));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("billing");
    fireEvent.change(select, { target: { value: "" } });
    expect(loadDashboardPrefs("t_test").defaultTab).toBe("");
  });

  it("default-tab dropdown lists only currently-visible (non-hidden) tabs", () => {
    _mockLocalStorage.setItem(
      dashboardPrefsKey("t_test"),
      JSON.stringify({ hiddenTabs: ["billing", "analytics"], hiddenStatCards: [], showTodayApts: true, defaultTab: "" })
    );
    renderWith("t_test", "ru");
    fireEvent.click(screen.getByRole("button", { name: /Какая вкладка открывается при входе/ }));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("");           // "Не выбрано"
    expect(values).toContain("overview");   // always present
    expect(values).toContain("appointments");
    expect(values).not.toContain("billing");
    expect(values).not.toContain("analytics");
  });

  it("hiding the currently-selected default tab resets defaultTab to ''", () => {
    _mockLocalStorage.setItem(
      dashboardPrefsKey("t_test"),
      JSON.stringify({ hiddenTabs: [], hiddenStatCards: [], showTodayApts: true, defaultTab: "billing" })
    );
    renderWith("t_test", "ru");

    // Expand the sidebar section and toggle billing OFF.
    fireEvent.click(screen.getByRole("button", { name: /Боковая панель/ }));

    // The sidebar list renders one row per togglable tab; locate the billing row
    // by its label text and click its toggle (the rightmost button in the row).
    const billingRow = screen.getByText("Биллинг").closest("div");
    expect(billingRow).toBeTruthy();
    const toggle = within(billingRow as HTMLElement).getByRole("button");
    fireEvent.click(toggle);

    // defaultTab in storage should reset to "" (the new "not selected" default).
    expect(loadDashboardPrefs("t_test").defaultTab).toBe("");
  });
});

// @vitest-environment happy-dom
/**
 * Render + behaviour lock for Settings → Виджеты (WidgetsSection).
 *
 * The section edits the SAME `prefs.homeWidgets` blob the board mutates, so we
 * assert through the persisted layout (localStorage, via `loadDashboardPrefs`):
 *   - first-run shows DEFAULT_HOME_LAYOUT widgets as "on",
 *   - toggling a widget OFF removes it from the layout,
 *   - changing an option `Select` persists that opt on the widget item,
 *   - "Сбросить раскладку" clears the layout back to empty (⇒ defaults).
 *
 * Mirrors the provider/localStorage/tRPC-mock setup of appearance-section.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

// No tRPC provider in happy-dom — stub the two ui-prefs calls the hook uses.
vi.mock("~/trpc/react", () => ({
  api: {
    webUsers: {
      getMyUiPrefs: { useQuery: () => ({ data: undefined, isLoading: false }) },
      setMyUiPrefs: { useMutation: () => ({ mutate: () => undefined }) },
    },
  },
}));

// `sonner` mounts a portal toaster that happy-dom can't render — stub it.
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m) } }));

import { WidgetsSection } from "~/components/settings/sections/WidgetsSection";
import { RoleContext, type RoleContextValue } from "~/components/RoleContext";
import { LangContext } from "~/components/LangContext";
import { loadDashboardPrefs, dashboardPrefsKey } from "~/lib/useDashboardPrefs";
import { DEFAULT_HOME_LAYOUT } from "~/components/dashboards/home-widgets/registry";

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
beforeEach(() => { _mockLocalStorage.clear(); toastSuccess.mockClear(); });
afterEach(() => cleanup());

const PROFILE_KEY = "uowner-uid";

function renderWith(lang: "ru" | "en" = "ru") {
  const roleValue: RoleContextValue = {
    role: "tenant_owner",
    tenantId: "t_test",
    tenantName: null,
    tenantLogo: null,
    masterAvatarUrl: null,
    masterAvatarEmoji: null,
    userId: null,
    webUserId: "owner-uid",
    createdAt: null,
    hasPassword: true,
    emailVerified: true,
    isPersonalTenant: false,
    permissions: [],
    billingStatus: "active",
    isTrialExpired: false,
  };
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <RoleContext.Provider value={roleValue}>
        <WidgetsSection />
      </RoleContext.Provider>
    </LangContext.Provider>,
  );
}

function storedWidgets() {
  return loadDashboardPrefs("t_test", PROFILE_KEY).homeWidgets;
}

describe("WidgetsSection — first-run defaults", () => {
  it("renders one row per catalog widget with the default layout shown as 'on'", () => {
    renderWith();
    // Every DEFAULT_HOME_LAYOUT widget has a checked toggle (switch=checked).
    const todayToggle = screen.getByTestId("widget-toggle-today_appointments");
    expect(todayToggle.getAttribute("aria-checked")).toBe("true");
    const topSvc = screen.getByTestId("widget-toggle-top_services");
    expect(topSvc.getAttribute("aria-checked")).toBe("true");
  });
});

describe("WidgetsSection — toggle add/remove", () => {
  it("toggling a widget OFF removes it from the persisted layout", () => {
    renderWith();
    // First-run prefs are empty; removing materializes the default layout minus
    // the toggled widget.
    expect(storedWidgets().length).toBe(0);

    fireEvent.click(screen.getByTestId("widget-toggle-top_services"));

    const items = storedWidgets();
    expect(items.length).toBe(DEFAULT_HOME_LAYOUT.length - 1);
    expect(items.some((w) => w.type === "top_services")).toBe(false);
    // Other widgets remain.
    expect(items.some((w) => w.type === "today_appointments")).toBe(true);
  });

  it("toggling a removed widget back ON re-adds it (singleton, i === type)", () => {
    renderWith();
    const toggle = screen.getByTestId("widget-toggle-top_masters");

    fireEvent.click(toggle); // OFF
    expect(storedWidgets().some((w) => w.type === "top_masters")).toBe(false);

    fireEvent.click(toggle); // ON
    const items = storedWidgets();
    const readded = items.filter((w) => w.type === "top_masters");
    expect(readded.length).toBe(1);
    expect(readded[0]!.i).toBe("top_masters");
  });
});

describe("WidgetsSection — option dropdowns", () => {
  it("changing a widget's period Select persists the opt on its layout item", () => {
    renderWith("en");
    // top_services exposes a `period` option (default 30d). Open + pick 7d.
    fireEvent.click(screen.getByTestId("widget-opt-top_services-period-trigger"));
    const opt7d = screen
      .getAllByTestId("widget-opt-top_services-period-option")
      .find((b) => b.getAttribute("data-value") === "7d");
    expect(opt7d).toBeTruthy();
    fireEvent.click(opt7d!);

    const item = storedWidgets().find((w) => w.type === "top_services");
    expect(item?.opts?.period).toBe("7d");
  });

  it("disables a widget's option Selects when it is toggled OFF", () => {
    renderWith("en");
    // Turn top_services OFF, then its period trigger must be disabled.
    fireEvent.click(screen.getByTestId("widget-toggle-top_services"));
    const trigger = screen.getByTestId("widget-opt-top_services-period-trigger") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});

describe("WidgetsSection — reset", () => {
  it("'reset layout' clears homeWidgets back to empty and toasts", () => {
    // Seed a non-default layout so the reset is observable.
    _mockLocalStorage.setItem(
      dashboardPrefsKey("t_test", PROFILE_KEY),
      JSON.stringify({ homeWidgets: [{ i: "quick_actions", type: "quick_actions", x: 0, y: 0, w: 3, h: 4 }] }),
    );
    renderWith();
    expect(storedWidgets().length).toBe(1);

    fireEvent.click(screen.getByTestId("widgets-reset"));

    expect(storedWidgets().length).toBe(0);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});

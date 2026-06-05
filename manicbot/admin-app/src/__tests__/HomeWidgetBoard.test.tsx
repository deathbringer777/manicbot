// @vitest-environment happy-dom
/**
 * HomeWidgetBoard — render smoke-test.
 *
 * Verifies the board mounts the DEFAULT_HOME_LAYOUT (every catalog-v1 widget is
 * a singleton, so the default board contains one of each) and that toggling
 * edit mode flips the toolbar between "Customize" and "Done" and reveals the
 * add-widget control + reset. tRPC is stubbed (no provider in happy-dom); the
 * salonMetrics calls return loading-ish empty data so widgets render their
 * skeleton/empty states without throwing.
 *
 * react-grid-layout's WidthProvider measures `offsetWidth`, which is 0 in
 * happy-dom — that's fine: it renders the children at full width and never
 * throws, which is exactly what this test pins (the RGL × React 19 import path
 * also exercised at runtime, complementing the typecheck gate).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("~/trpc/react", () => {
  const emptyQuery = () => ({ data: undefined, isLoading: false, isError: false });
  return {
    api: {
      webUsers: {
        getMyUiPrefs: { useQuery: () => ({ data: undefined, isLoading: false }) },
        setMyUiPrefs: { useMutation: () => ({ mutate: () => undefined }) },
      },
      salonMetrics: {
        getKpiSummary: { useQuery: emptyQuery },
        getDailyCounts: { useQuery: emptyQuery },
        getTopServices: { useQuery: emptyQuery },
        getTopMasters: { useQuery: emptyQuery },
        getRecentActivity: { useQuery: emptyQuery },
      },
    },
  };
});

import { HomeWidgetBoard } from "~/components/dashboards/home-widgets/HomeWidgetBoard";
import { RoleContext, type RoleContextValue } from "~/components/RoleContext";
import { DEFAULT_HOME_LAYOUT } from "~/components/dashboards/home-widgets/registry";

// happy-dom's localStorage impl is incomplete — stub it (mirrors the
// appearance-section test).
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

function renderBoard() {
  return render(
    <RoleContext.Provider value={roleValue}>
      <HomeWidgetBoard tenantId="t_test" lang="ru" />
    </RoleContext.Provider>,
  );
}

describe("HomeWidgetBoard", () => {
  it("renders the default layout (one grid cell per default widget)", () => {
    const { container } = renderBoard();
    const cells = container.querySelectorAll("[data-widget-type]");
    expect(cells.length).toBe(DEFAULT_HOME_LAYOUT.length);
    // The today_appointments widget title (from the frame header) is present.
    expect(screen.getAllByText("Записи на сегодня").length).toBeGreaterThan(0);
  });

  it("starts in static mode and toggles into edit mode", () => {
    renderBoard();
    const toggle = screen.getByTestId("home-edit-toggle");
    expect(toggle.getAttribute("data-edit")).toBe("0");
    expect(toggle.textContent).toContain("Настроить");
    // Add-widget control hidden while static.
    expect(screen.queryByTestId("home-add-widget")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("data-edit")).toBe("1");
    expect(toggle.textContent).toContain("Готово");
    // Edit mode reveals the add-widget Select and the reset button.
    expect(screen.getByTestId("home-add-widget")).toBeTruthy();
    expect(screen.getByText("Сбросить раскладку")).toBeTruthy();
  });

  it("shows 'all added' in the add-widget control for a full default board", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("home-edit-toggle"));
    // Default board already contains every singleton widget → nothing to add.
    expect(screen.getByText("Все виджеты добавлены")).toBeTruthy();
  });
});

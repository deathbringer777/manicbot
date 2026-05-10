// @vitest-environment happy-dom
/**
 * Platform-level /appointments page contract.
 *
 * Pins the post-refactor shape of `AppointmentsPageClient`:
 *   - Renders the 5-button view-mode switcher (day/week/calendar/agenda/list).
 *   - Defaults to Day view.
 *   - Renders the CalendarLeftRail with tenant-derived "My calendars" rows.
 *   - Switching to Week / Calendar / Agenda / List replaces the body view.
 *   - The CSV export button is always visible in the header.
 *
 * The point of this test is to lock the contract: future refactors of the
 * old God-Mode page (month grid + simple list) must not regress back to
 * dropping Day/Week views — those views are the whole reason this page
 * was rewritten in the first place.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";

const FIXED_NOW = new Date("2026-05-10T13:30:00");

// ── tRPC mocks ────────────────────────────────────────────────────────────

const tenantsData = [
  { id: "t_salon_a", name: "Salon A" },
  { id: "t_salon_b", name: "Salon B" },
];

const aptsData = [
  {
    id: "apt1",
    tenantId: "t_salon_a",
    chatId: 123,
    date: "2026-05-10",
    time: "10:00",
    status: "confirmed",
    masterId: null, // intentionally null — page should override with hash(tenantId)
    svcId: "manicure",
    userName: "Анна",
  },
];

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      appointments: { getAll: { invalidate: vi.fn() } },
    }),
    tenants: {
      getAll: {
        useQuery: () => ({ data: tenantsData, isLoading: false, isFetching: false }),
      },
    },
    appointments: {
      getAll: {
        useQuery: () => ({
          data: { appointments: aptsData, total: aptsData.length },
          isLoading: false,
          isFetching: false,
        }),
      },
      updateStatus: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    export: {
      appointments: {
        useQuery: () => ({ refetch: vi.fn().mockResolvedValue({ data: null }) }),
      },
    },
  },
}));

// Minimal Shell mock — avoids pulling in NextAuth / RoleContext at unit-test time.
vi.mock("~/components/layout/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell-mock">{children}</div>
  ),
}));

// Avoid loading the real appointments lib (it pulls in i18n hardening that
// isn't needed for this contract test).
vi.mock("~/lib/appointments", () => ({
  APT_BORDER: {
    confirmed: "border-l-emerald-500",
    pending: "border-l-amber-500",
    cancelled: "border-l-red-500",
    no_show: "border-l-orange-500",
    done: "border-l-brand-500",
  },
  STATUS_LABELS: {
    confirmed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
    no_show: "No-show",
    done: "Done",
  },
  NAIL_EMOJIS: ["💅"],
  relativeTime: () => "now",
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

import AppointmentsPageClient from "~/app/(dashboard)/appointments/AppointmentsPageClient";
import { renderWithLang } from "./helpers/renderWithLang";

describe("Platform AppointmentsPageClient", () => {
  it("renders the 5-button view-mode switcher", () => {
    renderWithLang(<AppointmentsPageClient />);
    const switcher = screen.getByTestId("apt-view-mode-switcher");
    expect(switcher).toBeTruthy();
    expect(screen.getByTestId("apt-view-mode-day")).toBeTruthy();
    expect(screen.getByTestId("apt-view-mode-week")).toBeTruthy();
    expect(screen.getByTestId("apt-view-mode-calendar")).toBeTruthy();
    expect(screen.getByTestId("apt-view-mode-agenda")).toBeTruthy();
    expect(screen.getByTestId("apt-view-mode-list")).toBeTruthy();
  });

  it("defaults to Day view", () => {
    renderWithLang(<AppointmentsPageClient />);
    expect(screen.getByTestId("apt-view-mode-day").getAttribute("data-active")).toBe("1");
    expect(screen.getByTestId("salon-day-view")).toBeTruthy();
  });

  it("switching to Week / Calendar swaps the body view", () => {
    renderWithLang(<AppointmentsPageClient />);
    fireEvent.click(screen.getByTestId("apt-view-mode-week"));
    expect(screen.getByTestId("apt-view-mode-week").getAttribute("data-active")).toBe("1");
    expect(screen.queryByTestId("salon-day-view")).toBeNull();

    fireEvent.click(screen.getByTestId("apt-view-mode-calendar"));
    expect(screen.getByTestId("apt-view-mode-calendar").getAttribute("data-active")).toBe("1");
  });

  it("renders tenant names as left-rail calendar columns", () => {
    renderWithLang(<AppointmentsPageClient />);
    // Salon A may appear both in the left-rail "My calendars" list AND as a
    // SalonDayView master column header — assert there is at least one match
    // for each tenant.
    expect(screen.getAllByText("Salon A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Salon B").length).toBeGreaterThan(0);
  });

  it("always shows the CSV export button", () => {
    renderWithLang(<AppointmentsPageClient />);
    expect(screen.getByTestId("apt-export-csv")).toBeTruthy();
  });
});

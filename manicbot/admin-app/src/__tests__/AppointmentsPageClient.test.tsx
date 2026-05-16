// @vitest-environment happy-dom
/**
 * Platform-level /appointments page contract.
 *
 * Pins the post-refactor shape of `AppointmentsPageClient` after the
 * 2026-05-16 calendar overhaul:
 *   - Renders the Google-Calendar-style dropdown view-switcher
 *     (`apt-view-switcher-trigger`) with 4 options (day/week/calendar/list).
 *     The legacy 5-pill bar + the «Агенда» mode are gone.
 *   - Defaults to Week view (was Day before the overhaul).
 *   - Renders the CalendarLeftRail with tenant-derived "My calendars" rows.
 *   - Picking a different option from the dropdown swaps the body view.
 *   - The CSV export button is always visible in the header.
 *
 * The point of this test is to lock the contract: future refactors of the
 * God-Mode page must not regress back to the Day-default + 5-pill bar.
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
      appointmentBlocks: { listByRange: { invalidate: vi.fn() } },
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
    appointmentBlocks: {
      listByRange: {
        useQuery: () => ({ data: { blocks: [] }, isLoading: false, isFetching: false, refetch: vi.fn() }),
      },
      delete: {
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
  it("renders the dropdown view-switcher with 4 options (no Агенда)", () => {
    renderWithLang(<AppointmentsPageClient />);
    const trigger = screen.getByTestId("apt-view-switcher-trigger");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByTestId("apt-view-switcher-option-day")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-week")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-calendar")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-list")).toBeTruthy();
    // Calendar overhaul (2026-05-16): «Агенда» mode dropped.
    expect(screen.queryByTestId("apt-view-switcher-option-agenda")).toBeNull();
  });

  it("defaults to Week view", () => {
    renderWithLang(<AppointmentsPageClient />);
    expect(screen.getByTestId("apt-view-switcher-trigger").getAttribute("data-current")).toBe("week");
    expect(screen.getByTestId("salon-week-view")).toBeTruthy();
  });

  it("switching to Day / Calendar via the dropdown swaps the body view", () => {
    renderWithLang(<AppointmentsPageClient />);
    fireEvent.click(screen.getByTestId("apt-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("apt-view-switcher-option-day"));
    expect(screen.getByTestId("apt-view-switcher-trigger").getAttribute("data-current")).toBe("day");
    expect(screen.queryByTestId("salon-week-view")).toBeNull();
    expect(screen.getByTestId("salon-day-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("apt-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("apt-view-switcher-option-calendar"));
    expect(screen.getByTestId("apt-view-switcher-trigger").getAttribute("data-current")).toBe("calendar");
  });

  it("renders tenant names as left-rail calendar columns", () => {
    renderWithLang(<AppointmentsPageClient />);
    expect(screen.getAllByText("Salon A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Salon B").length).toBeGreaterThan(0);
  });

  it("always shows the CSV export button", () => {
    renderWithLang(<AppointmentsPageClient />);
    expect(screen.getByTestId("apt-export-csv")).toBeTruthy();
  });
});

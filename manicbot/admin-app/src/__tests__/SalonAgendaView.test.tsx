// @vitest-environment happy-dom
/**
 * SalonAgendaView — text-list view of upcoming and past appointments.
 *
 * Pins:
 *   - groupByDay groups + sorts entries by HH:MM within a day.
 *   - upcoming/past split is based on today's ISO date.
 *   - smart day labels (Today / Tomorrow / weekday) per locale.
 *   - empty state when both sections are empty.
 *   - loading state shows spinner before data.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";

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
}));

import { SalonAgendaView } from "~/components/dashboards/SalonAgendaView";
import { renderWithLang } from "./helpers/renderWithLang";

const FIXED_NOW = new Date("2026-05-10T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function apt(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    date: "2026-05-10",
    time: "10:00",
    status: "confirmed",
    cancelled: 0,
    noShow: 0,
    userName: "Anna",
    chatId: 100,
    svcId: "manicure",
    ...overrides,
  };
}

describe("SalonAgendaView", () => {
  it("shows loading spinner when isLoading=true", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[]}
        isLoading={true}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("agenda-loading")).toBeTruthy();
  });

  it("shows empty state when no apts", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(screen.queryByTestId("agenda-loading")).toBeNull();
    expect(screen.queryByTestId("agenda-view")).toBeNull();
    // Empty state title contains the localized "No upcoming" label
    expect(document.body.textContent).toContain("No upcoming appointments");
  });

  it("splits upcoming vs past based on today's date", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[
          apt({ id: 1, date: "2026-05-10", time: "10:00" }), // today → upcoming
          apt({ id: 2, date: "2026-05-12", time: "11:00" }), // future → upcoming
          apt({ id: 3, date: "2026-05-08", time: "09:00" }), // past
          apt({ id: 4, date: "2026-05-09", time: "14:00" }), // past
        ]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("agenda-upcoming")).toBeTruthy();
    expect(screen.getByTestId("agenda-past")).toBeTruthy();
  });

  it("labels today's group as 'Today' (en)", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 1, date: "2026-05-10", time: "10:00" })]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const upcoming = screen.getByTestId("agenda-upcoming");
    expect(upcoming.textContent).toContain("Today");
  });

  it("labels tomorrow's group as 'Tomorrow' (en)", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 2, date: "2026-05-11", time: "10:00" })]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const upcoming = screen.getByTestId("agenda-upcoming");
    expect(upcoming.textContent).toContain("Tomorrow");
  });

  it("labels today's group as 'Сегодня' in Russian", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ date: "2026-05-10" })]}
        isLoading={false}
        lang="ru"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "ru",
    );
    const upcoming = screen.getByTestId("agenda-upcoming");
    expect(upcoming.textContent).toContain("Сегодня");
  });

  it("renders multiple appointments grouped under their day", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[
          apt({ id: 1, date: "2026-05-10", time: "10:00", userName: "Anna" }),
          apt({ id: 2, date: "2026-05-10", time: "14:00", userName: "Bob" }),
          apt({ id: 3, date: "2026-05-12", time: "09:00", userName: "Cleo" }),
        ]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const upcoming = screen.getByTestId("agenda-upcoming");
    const days = upcoming.querySelectorAll("[data-day]");
    expect(days.length).toBe(2);
    // Day blocks rendered in chronological order (today then later)
    expect(days[0]?.getAttribute("data-day")).toBe("2026-05-10");
    expect(days[1]?.getAttribute("data-day")).toBe("2026-05-12");
  });

  it("past section is reversed (most recent past first)", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[
          apt({ id: 1, date: "2026-05-08", time: "09:00" }),
          apt({ id: 2, date: "2026-05-09", time: "14:00" }),
        ]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const past = screen.getByTestId("agenda-past");
    const days = past.querySelectorAll("[data-day]");
    expect(days[0]?.getAttribute("data-day")).toBe("2026-05-09");
    expect(days[1]?.getAttribute("data-day")).toBe("2026-05-08");
  });

  // ── GCal-style row layout ─────────────────────────────────────────
  it("renders one compact row per appointment with status data attribute", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[
          apt({ id: 1, status: "confirmed" }),
          apt({ id: 2, status: "pending", time: "11:00" }),
          apt({ id: 3, cancelled: 1, status: "cancelled", time: "12:00" }),
        ]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const rows = screen.getAllByTestId("agenda-row");
    expect(rows.length).toBe(3);
    const byId: Record<string, string | null> = {};
    for (const r of rows) byId[r.getAttribute("data-apt-id")!] = r.getAttribute("data-status");
    expect(byId["1"]).toBe("confirmed");
    expect(byId["2"]).toBe("pending");
    expect(byId["3"]).toBe("cancelled");
  });

  it("pending rows expose Confirm + Reject inline buttons", () => {
    const onAction = vi.fn();
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 7, status: "pending" })]}
        isLoading={false}
        lang="en"
        onAction={onAction}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const confirmBtn = screen.getByTestId("agenda-row-confirm");
    const rejectBtn = screen.getByTestId("agenda-row-reject");
    fireEvent.click(confirmBtn);
    expect(onAction).toHaveBeenCalledWith(7, "confirmed");
    fireEvent.click(rejectBtn);
    expect(onAction).toHaveBeenCalledWith(7, "rejected");
  });

  it("confirmed rows hide inline Confirm + Reject buttons", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 1, status: "confirmed" })]}
        isLoading={false}
        lang="en"
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(screen.queryByTestId("agenda-row-confirm")).toBeNull();
    expect(screen.queryByTestId("agenda-row-reject")).toBeNull();
    expect(screen.getByTestId("agenda-row-menu")).toBeTruthy();
  });

  it("confirmed row menu opens popover with Cancel / no-show actions", () => {
    const onAction = vi.fn();
    const onNoShow = vi.fn();
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 5, status: "confirmed" })]}
        isLoading={false}
        lang="en"
        onAction={onAction}
        onNoShow={onNoShow}
      />,
      "en",
    );
    expect(screen.queryByTestId("agenda-row-menu-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("agenda-row-menu"));
    const popover = screen.getByTestId("agenda-row-menu-popover");
    const buttons = popover.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    // Cancel triggers onAction with "cancelled"
    fireEvent.click(buttons[0]!);
    expect(onAction).toHaveBeenCalledWith(5, "cancelled");
  });

  it("uses the master color for the row leading border + dot when masterId resolves", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 1, masterId: 200, status: "confirmed" })]}
        isLoading={false}
        lang="en"
        masters={[
          { chatId: 100, name: "Anna" }, // index 0 → purple
          { chatId: 200, name: "Olga" }, // index 1 → green
        ]}
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    const row = screen.getByTestId("agenda-row");
    // Olga is index 1 in the palette → "#0b9b6b". CSSStyle reports
    // it normalized so just check the inline style mentions the hue.
    expect(row.getAttribute("style") ?? "").toMatch(/0b9b6b|11.*155.*107/);
  });

  it("looks up service display names via serviceNames map", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[apt({ id: 1, svcId: "gel_polish" })]}
        isLoading={false}
        lang="en"
        serviceNames={{ gel_polish: "Pretty gel polish" }}
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("agenda-row").textContent).toContain("Pretty gel polish");
  });

  it("shows 'filtered out' empty state when filtersActive + apts is empty", () => {
    renderWithLang(
      <SalonAgendaView
        apts={[]}
        isLoading={false}
        lang="en"
        filtersActive={true}
        onAction={() => undefined}
        onNoShow={() => undefined}
      />,
      "en",
    );
    expect(document.body.textContent).toContain("All bookings filtered out");
  });
});


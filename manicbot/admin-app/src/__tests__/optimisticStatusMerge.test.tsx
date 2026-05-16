// @vitest-environment happy-dom
/**
 * Optimistic status merge — the layer that makes the AptCard status
 * dropdown feel instant on Салон → Записи (Calendar / Day / Week / List
 * / Overview today's-list).
 *
 * Bug being pinned: pre-2026-05-16 the `salon.updateAppointmentStatus`
 * and `salon.markNoShow` mutations on the SalonDashboard had only
 * `onSuccess: invalidate + refetch`. Clicking «Отменить» on the status
 * pill fired the mutation, but the 300–800 ms refetch round-trip left
 * the card visually unchanged, so the user read it as "click did
 * nothing". After the fix, an optimistic patch flips the row's status
 * fields locally; `AptCard` re-reads them on the same render tick and
 * the pill goes terminal immediately.
 *
 * This test pins TWO contracts:
 *   1. The patch builders emit the exact field set AptCard reads to
 *      compute `statusKey` and the cancelled/no-show pill labels.
 *      AptCard.tsx:28 — `a.noShow ? "no_show" : a.cancelled ? "cancelled" : a.status`
 *      AptCard.tsx:36-41 — labels keyed off `a.noShowBy` / `a.cancelledBy`.
 *      If anyone changes either side without the other, this test fails.
 *   2. `applyPendingStatusChanges` is a pure no-op when there are no
 *      patches (so calling it at every `*Filtered` site in SalonDashboard
 *      has zero perf cost on the steady-state path).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  applyPendingStatusChanges,
  buildCancelPatch,
  buildStatusChangePatch,
  buildNoShowPatch,
  type PendingStatusPatches,
} from "~/lib/optimisticStatusMerge";
import { AptCard } from "~/components/dashboard-ui/AptCard";

const baseRow = {
  id: "apt_1",
  userName: "Анна Иванова",
  chatId: 12345,
  svcId: "manicure",
  time: "19:30",
  duration: 60,
  status: "confirmed",
  cancelled: 0,
  noShow: 0,
  date: "2026-05-16",
};

describe("optimisticStatusMerge — patch builders", () => {
  it("buildCancelPatch flips cancelled + admin author + status", () => {
    expect(buildCancelPatch()).toEqual({
      status: "cancelled",
      cancelled: 1,
      cancelledBy: "admin",
    });
  });

  it("buildStatusChangePatch(confirmed) clears cancelled fields defensively", () => {
    // Defensive clear matters for the undo case: cancelled → confirmed
    // must wipe the cancelled flag so the AptCard re-reads as confirmed
    // even before the refetch lands.
    expect(buildStatusChangePatch("confirmed")).toEqual({
      status: "confirmed",
      cancelled: 0,
      cancelledBy: null,
    });
  });

  it("buildStatusChangePatch(rejected) carries rejected as the new status", () => {
    expect(buildStatusChangePatch("rejected")).toEqual({
      status: "rejected",
      cancelled: 0,
      cancelledBy: null,
    });
  });

  it("buildNoShowPatch sets noShow flag + author + no_show status", () => {
    expect(buildNoShowPatch("client")).toEqual({
      status: "no_show",
      noShow: 1,
      noShowBy: "client",
    });
    expect(buildNoShowPatch("master")).toEqual({
      status: "no_show",
      noShow: 1,
      noShowBy: "master",
    });
  });
});

describe("optimisticStatusMerge — applyPendingStatusChanges", () => {
  it("returns rows unchanged when there are no patches (steady-state fast path)", () => {
    const rows = [baseRow, { ...baseRow, id: "apt_2" }];
    const out = applyPendingStatusChanges(rows, {});
    // Same reference: zero-cost wrapper at filter sites.
    expect(out).toBe(rows);
  });

  it("returns empty array when rows is undefined", () => {
    expect(applyPendingStatusChanges(undefined, {})).toEqual([]);
  });

  it("merges patch onto the matching row by stringified id", () => {
    const patches: PendingStatusPatches = { apt_1: buildCancelPatch() };
    const [merged] = applyPendingStatusChanges([baseRow], patches);
    expect(merged).toMatchObject({
      id: "apt_1",
      status: "cancelled",
      cancelled: 1,
      cancelledBy: "admin",
      // Other fields preserved
      userName: "Анна Иванова",
      time: "19:30",
    });
  });

  it("leaves untouched rows alone when patch keys don't match", () => {
    const patches: PendingStatusPatches = { apt_other: buildCancelPatch() };
    const out = applyPendingStatusChanges([baseRow], patches);
    expect(out[0]).toEqual(baseRow);
  });

  it("handles numeric ids stringified to match the patch key", () => {
    const numericRow = { ...baseRow, id: 42 };
    const patches: PendingStatusPatches = { "42": buildNoShowPatch("master") };
    const [merged] = applyPendingStatusChanges([numericRow], patches);
    expect(merged).toMatchObject({ noShow: 1, noShowBy: "master", status: "no_show" });
  });
});

describe("AptCard reads the merged patch — end-to-end contract", () => {
  afterEach(cleanup);

  it("a row patched with buildCancelPatch renders as terminal + dimmed", () => {
    // Mirrors what happens in SalonDashboard when the user clicks
    // «Отменить»: the inflight patch lands in pendingStatusChanges,
    // applyPendingStatusChanges merges it onto the row before the row
    // reaches AptCard, and AptCard reads `cancelled: 1` → statusKey
    // = "cancelled" → opacity-50 + read-only pill.
    const [merged] = applyPendingStatusChanges([baseRow], {
      apt_1: buildCancelPatch(),
    });
    render(<AptCard a={merged!} lang="ru" onAction={() => {}} onNoShow={() => {}} />);
    const card = screen.getByTestId("apt-card");
    expect(card.getAttribute("data-status")).toBe("cancelled");
    expect(card.getAttribute("data-terminal")).toBe("1");
    expect(card.className).toMatch(/opacity-50/);
    // Terminal rows expose a read-only pill (no actionable dropdown).
    expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
    expect(screen.queryByTestId("status-pill-readonly")).toBeTruthy();
  });

  it("a row patched with buildNoShowPatch('client') renders the client-no-show pill", () => {
    const [merged] = applyPendingStatusChanges([baseRow], {
      apt_1: buildNoShowPatch("client"),
    });
    render(<AptCard a={merged!} lang="ru" onAction={() => {}} onNoShow={() => {}} />);
    const card = screen.getByTestId("apt-card");
    expect(card.getAttribute("data-status")).toBe("no_show");
    expect(card.getAttribute("data-terminal")).toBe("1");
    // Pill copy is the localized "Client didn't show" string — pin it
    // so a future i18n shuffle doesn't break the optimistic UX.
    expect(screen.getByText("Клиент не пришёл")).toBeTruthy();
  });

  it("a row patched with buildNoShowPatch('master') renders the master-no-show pill", () => {
    const [merged] = applyPendingStatusChanges([baseRow], {
      apt_1: buildNoShowPatch("master"),
    });
    render(<AptCard a={merged!} lang="ru" onAction={() => {}} onNoShow={() => {}} />);
    expect(screen.getByText("Мастер не пришёл")).toBeTruthy();
  });

  it("a confirmed row with NO patch keeps the actionable status dropdown", () => {
    // Sanity: empty patches table must NOT regress the steady-state
    // render (the 99.9% case where nothing is in flight).
    const out = applyPendingStatusChanges([baseRow], {});
    render(<AptCard a={out[0]!} lang="ru" onAction={() => {}} onNoShow={() => {}} />);
    const card = screen.getByTestId("apt-card");
    expect(card.getAttribute("data-status")).toBe("confirmed");
    expect(card.getAttribute("data-terminal")).toBe("0");
    expect(screen.queryByTestId("status-pill-trigger")).toBeTruthy();
  });
});

/**
 * Calendar refresh regression — a manual booking must appear immediately.
 *
 * The user reported: from the week view, create a booking with a new client,
 * everything looks fine, click "Utwórz" — but the appointment never appears in
 * the calendar (it only showed up after a manual page reload). The console also
 * showed `appointments.createManual` errors.
 *
 * Root cause: the dashboard renders the day / week / month calendars from
 * SEPARATE getAppointments queries (`dayApts` / `weekApts` / `calApts`), but the
 * ManualBookingModal's `onCreated` only refetched `apts` — the LIST-mode query,
 * which is `enabled` only when `aptViewMode === "list"` — plus `todayApts`. So a
 * booking created from the week view succeeded server-side but left the week
 * query stale → invisible until a reload. (The createManual errors were retries:
 * re-clicking Create hit the now-occupied slot → `slot_conflict`.)
 *
 * Fix: `onCreated` invalidates the shared `salon.getAppointments` query key,
 * which refreshes EVERY variant (list / today / day / week / month) regardless
 * of input — the canonical pattern already used for status changes + onUpdated.
 *
 * This test pins that contract: if the booking `onCreated` ever reverts to a
 * narrow `apts.refetch()` that skips the calendar views, it fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = readFileSync(
  join(ROOT, "src/components/dashboards/SalonDashboard.tsx"),
  "utf8",
);

/** Extract the `onCreated={...}` handler attached to <ManualBookingModal>. */
function manualBookingOnCreated(src: string): string {
  const mount = src.indexOf("<ManualBookingModal");
  expect(mount, "SalonDashboard must mount <ManualBookingModal>").toBeGreaterThan(-1);
  const region = src.slice(mount, mount + 1500);
  const m = region.match(/onCreated=\{[\s\S]*?\n\s*\}\}/);
  expect(m, "<ManualBookingModal> must have an onCreated handler").toBeTruthy();
  return m![0];
}

describe("SalonDashboard — manual booking refreshes every calendar view", () => {
  it("ManualBookingModal.onCreated invalidates salon.getAppointments", () => {
    const handler = manualBookingOnCreated(SRC);
    // Invalidating the shared key refreshes list / today / day / week / month
    // at once — the only way a booking created off the week view shows up
    // without a page reload.
    expect(handler).toContain("utils.salon.getAppointments.invalidate()");
  });

  it("does not refresh the booking via the list-only apts.refetch() alone", () => {
    const handler = manualBookingOnCreated(SRC);
    // `apts` is `enabled` only in list mode; refetching it alone left the
    // day / week / month calendars stale (the reported bug).
    expect(handler).not.toMatch(/\bapts\.refetch\(\)/);
  });
});

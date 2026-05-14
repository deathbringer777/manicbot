/**
 * Migration 0060 + publicSalon.getProfile.
 *
 * Three guarantees this test pins:
 *   1. Masters with `public_hidden = 1` MUST NOT appear in the response
 *      (Booksy-style hide-from-public toggle).
 *   2. `onVacation` MUST be derived from the live `[vacation_from,
 *      vacation_until]` window — the legacy boolean alone is no longer
 *      authoritative.
 *   3. `tgUsername` MUST NOT appear in the public master payload (privacy
 *      — neither owner nor masters' Telegram handles are public).
 *
 * The procedure runs against D1 bindings that aren't available under
 * vitest, so we exercise the row → payload transformation directly.
 * This mirrors the structure of `public-salon-privacy.test.ts`.
 */
import { describe, it, expect } from "vitest";

type MasterRow = {
  chatId: number;
  name: string | null;
  tgUsername: string | null;
  active: number;
  publicHidden: number;
  onVacation: number;
  vacationFrom: number | null;
  vacationUntil: number | null;
  services: string | null;
  workHours: string | null;
  workDays: string | null;
};

/** Mirrors the where-clause + projection in publicSalon.getProfile. */
function projectPublicMasters(rows: MasterRow[], nowSec: number) {
  return rows
    .filter((m) => m.active === 1 && m.publicHidden === 0)
    .map((m) => {
      const inRange =
        typeof m.vacationFrom === "number" &&
        typeof m.vacationUntil === "number" &&
        m.vacationFrom <= nowSec &&
        nowSec <= m.vacationUntil;
      const onVacation = !!m.onVacation || inRange;
      return {
        chatId: m.chatId,
        name: m.name,
        onVacation,
        vacationUntil: onVacation && typeof m.vacationUntil === "number" ? m.vacationUntil : null,
        services: m.services ? JSON.parse(m.services) : [],
        workHours: m.workHours ? JSON.parse(m.workHours) : null,
        workDays: m.workDays ? JSON.parse(m.workDays) : null,
      };
    });
}

const NOW = 1_715_000_000;
const DAY = 86_400;

function makeRow(overrides: Partial<MasterRow>): MasterRow {
  return {
    chatId: 100,
    name: "Anna",
    tgUsername: "anna_tg",
    active: 1,
    publicHidden: 0,
    onVacation: 0,
    vacationFrom: null,
    vacationUntil: null,
    services: null,
    workHours: null,
    workDays: null,
    ...overrides,
  };
}

describe("publicSalon.getProfile — masters projection (migration 0060)", () => {
  it("filters out masters with publicHidden=1", () => {
    const visible = projectPublicMasters(
      [
        makeRow({ chatId: 100, name: "Anna", publicHidden: 0 }),
        makeRow({ chatId: 101, name: "Beata", publicHidden: 1 }),
      ],
      NOW,
    );
    expect(visible.map((m) => m.chatId)).toEqual([100]);
  });

  it("still filters out inactive masters (active=0)", () => {
    const visible = projectPublicMasters(
      [
        makeRow({ chatId: 100, active: 1 }),
        makeRow({ chatId: 101, active: 0 }),
      ],
      NOW,
    );
    expect(visible.map((m) => m.chatId)).toEqual([100]);
  });

  it("derives onVacation=true from a current date range, even if legacy bool is 0", () => {
    const visible = projectPublicMasters(
      [
        makeRow({
          chatId: 100,
          onVacation: 0,
          vacationFrom: NOW - DAY,
          vacationUntil: NOW + 3 * DAY,
        }),
      ],
      NOW,
    );
    expect(visible[0]!.onVacation).toBe(true);
    expect(visible[0]!.vacationUntil).toBe(NOW + 3 * DAY);
  });

  it("derives onVacation=false from a future-only range (not yet started)", () => {
    const visible = projectPublicMasters(
      [
        makeRow({
          chatId: 100,
          onVacation: 0,
          vacationFrom: NOW + 2 * DAY,
          vacationUntil: NOW + 5 * DAY,
        }),
      ],
      NOW,
    );
    expect(visible[0]!.onVacation).toBe(false);
    expect(visible[0]!.vacationUntil).toBeNull();
  });

  it("derives onVacation=false from a past-ended range", () => {
    const visible = projectPublicMasters(
      [
        makeRow({
          chatId: 100,
          onVacation: 0,
          vacationFrom: NOW - 10 * DAY,
          vacationUntil: NOW - 5 * DAY,
        }),
      ],
      NOW,
    );
    expect(visible[0]!.onVacation).toBe(false);
  });

  it("honours the legacy on_vacation boolean when no range is set", () => {
    const visible = projectPublicMasters(
      [
        makeRow({
          chatId: 100,
          onVacation: 1,
          vacationFrom: null,
          vacationUntil: null,
        }),
      ],
      NOW,
    );
    expect(visible[0]!.onVacation).toBe(true);
    // No range pinned → no end date surfaced.
    expect(visible[0]!.vacationUntil).toBeNull();
  });

  it("does NOT expose tgUsername in the public payload", () => {
    const visible = projectPublicMasters(
      [makeRow({ chatId: 100, name: "Anna", tgUsername: "anna_tg" })],
      NOW,
    );
    expect(visible[0]).not.toHaveProperty("tgUsername");
    // Sanity — only the safe fields are surfaced.
    expect(Object.keys(visible[0]!).sort()).toEqual(
      ["chatId", "name", "onVacation", "services", "vacationUntil", "workDays", "workHours"].sort(),
    );
  });
});

import { describe, it, expect } from "vitest";

/**
 * Onboarding checklist logic tests. Pure functions only — tRPC integration
 * with D1 is covered by the smoke flow in staging.
 *
 * The checklist merged with the legacy ProfileCompletenessCard widget on
 * 2026-05-16, so this set now mirrors the 10 step IDs that the
 * onboarding.getStatus router resolves (6 operational + 4 profile signals
 * derived from the tenants table).
 */

const STEP_IDS = [
  "add_service",
  "connect_bot",
  "invite_master",
  "set_schedule",
  "share_link",
  "first_booking",
  "fill_description",
  "add_logo",
  "add_cover",
  "activate_public",
] as const;
type StepId = (typeof STEP_IDS)[number];

function computeProgress(completed: StepId[]): number {
  const done = new Set(completed);
  return done.size / STEP_IDS.length;
}

function markStep(existing: StepId[], step: StepId): StepId[] {
  if (existing.includes(step)) return existing;
  return [...existing, step];
}

function isAllDone(completed: StepId[]): boolean {
  const done = new Set(completed);
  return STEP_IDS.every((s) => done.has(s));
}

describe("onboarding checklist logic", () => {
  it("empty progress is 0", () => {
    expect(computeProgress([])).toBe(0);
  });

  it("half progress is 0.5 (5/10)", () => {
    expect(
      computeProgress([
        "add_service",
        "connect_bot",
        "invite_master",
        "set_schedule",
        "share_link",
      ]),
    ).toBeCloseTo(0.5);
  });

  it("all ten steps → progress = 1.0", () => {
    expect(computeProgress([...STEP_IDS])).toBe(1);
  });

  it("markStep is idempotent — marking the same step twice doesn't duplicate", () => {
    const once = markStep([], "add_service");
    const twice = markStep(once, "add_service");
    expect(twice).toEqual(["add_service"]);
  });

  it("markStep appends to existing list", () => {
    const after = markStep(["add_service"], "connect_bot");
    expect(after).toEqual(["add_service", "connect_bot"]);
  });

  it("isAllDone is true only when all ten are marked", () => {
    expect(isAllDone([])).toBe(false);
    expect(
      isAllDone([
        "add_service",
        "connect_bot",
        "invite_master",
        "set_schedule",
        "share_link",
        "first_booking",
        "fill_description",
        "add_logo",
        "add_cover",
      ]),
    ).toBe(false);
    expect(isAllDone([...STEP_IDS])).toBe(true);
  });

  it("ordering doesn't affect isAllDone", () => {
    const reversed = [...STEP_IDS].reverse() as StepId[];
    expect(isAllDone(reversed)).toBe(true);
  });
});

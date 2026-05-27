import { describe, it, expect } from "vitest";

/**
 * Onboarding checklist logic tests. Pure functions only — tRPC integration
 * with D1 is covered by `onboarding-router.test.ts` + the smoke flow in
 * staging.
 *
 * 2026-05-27 rework: the previous 10-id checklist mixed "blocking" (no bot,
 * no master, no service) with "polish" (logo, cover, public activation).
 * The contract is now 4 essentials (must do or the booking flow returns no
 * slots) + 4 optional (public-page polish). Total 8 ids. See the plan at
 * /Users/vdovin/.claude/plans/fancy-wiggling-perlis.md.
 */

const ESSENTIAL_STEP_IDS = [
  "connect_bot",
  "add_master",
  "set_master_schedule",
  "add_service",
] as const;

const OPTIONAL_STEP_IDS = [
  "fill_salon_info",
  "add_branding",
  "activate_public",
  "share_link",
] as const;

const STEP_IDS = [...ESSENTIAL_STEP_IDS, ...OPTIONAL_STEP_IDS] as const;
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

function essentialsDone(completed: StepId[]): boolean {
  const done = new Set(completed);
  return ESSENTIAL_STEP_IDS.every((s) => done.has(s));
}

describe("onboarding checklist logic", () => {
  it("STEP_IDS is exactly 8 (4 essential + 4 optional)", () => {
    expect(STEP_IDS).toHaveLength(8);
    expect(ESSENTIAL_STEP_IDS).toHaveLength(4);
    expect(OPTIONAL_STEP_IDS).toHaveLength(4);
  });

  it("removed legacy ids are gone (add_logo, add_cover, first_booking, invite_master, set_schedule, fill_description)", () => {
    const ids = STEP_IDS as readonly string[];
    expect(ids).not.toContain("add_logo");
    expect(ids).not.toContain("add_cover");
    expect(ids).not.toContain("first_booking");
    expect(ids).not.toContain("invite_master");
    expect(ids).not.toContain("set_schedule");
    expect(ids).not.toContain("fill_description");
  });

  it("empty progress is 0", () => {
    expect(computeProgress([])).toBe(0);
  });

  it("half progress is 0.5 (4/8 — essentials done)", () => {
    expect(computeProgress([...ESSENTIAL_STEP_IDS])).toBeCloseTo(0.5);
  });

  it("all eight steps → progress = 1.0", () => {
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

  it("isAllDone is true only when all eight are marked", () => {
    expect(isAllDone([])).toBe(false);
    expect(isAllDone([...ESSENTIAL_STEP_IDS])).toBe(false);
    expect(isAllDone([...STEP_IDS])).toBe(true);
  });

  it("ordering doesn't affect isAllDone", () => {
    const reversed = [...STEP_IDS].reverse() as StepId[];
    expect(isAllDone(reversed)).toBe(true);
  });

  it("essentialsDone flips on the 4 must-have ids regardless of optional state", () => {
    expect(essentialsDone([])).toBe(false);
    expect(essentialsDone(["connect_bot", "add_master", "set_master_schedule"])).toBe(false);
    expect(essentialsDone([...ESSENTIAL_STEP_IDS])).toBe(true);
    // Adding optional items after essentials are done doesn't flip it back.
    expect(essentialsDone([...ESSENTIAL_STEP_IDS, "add_branding"])).toBe(true);
  });
});

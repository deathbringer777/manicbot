import { describe, it, expect } from "vitest";

/**
 * Stamp card reward-eligibility logic.
 * When enabled, every Nth visit triggers a reward. The config lives in
 * `stamp_card_configs` and per-client counter in `stamp_card_progress`.
 */

interface StampCardConfig {
  enabled: 0 | 1;
  visitsRequired: number;
  rewardType: "free_service" | "percent_off" | "fixed_off";
  rewardValue: number | null;
}

interface StampCardProgress {
  visitsCompleted: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
}

/** True when the current visit should earn a new reward stamp. */
function shouldEarnReward(cfg: StampCardConfig, progress: StampCardProgress): boolean {
  if (cfg.enabled !== 1) return false;
  if (cfg.visitsRequired < 2) return false;
  const nextVisit = progress.visitsCompleted + 1;
  return nextVisit > 0 && nextVisit % cfg.visitsRequired === 0;
}

/** How many rewards are outstanding (earned but not redeemed). */
function outstandingRewards(progress: StampCardProgress): number {
  return Math.max(0, progress.rewardsEarned - progress.rewardsRedeemed);
}

const cfg5: StampCardConfig = { enabled: 1, visitsRequired: 5, rewardType: "free_service", rewardValue: null };
const cfgOff: StampCardConfig = { ...cfg5, enabled: 0 };

describe("stamp card reward eligibility", () => {
  it("disabled config never earns", () => {
    expect(shouldEarnReward(cfgOff, { visitsCompleted: 4, rewardsEarned: 0, rewardsRedeemed: 0 })).toBe(false);
  });

  it("4 visits done → 5th earns the first reward", () => {
    expect(shouldEarnReward(cfg5, { visitsCompleted: 4, rewardsEarned: 0, rewardsRedeemed: 0 })).toBe(true);
  });

  it("3 visits done → 4th does NOT earn", () => {
    expect(shouldEarnReward(cfg5, { visitsCompleted: 3, rewardsEarned: 0, rewardsRedeemed: 0 })).toBe(false);
  });

  it("9 visits done → 10th earns another reward (multi-cycle)", () => {
    expect(shouldEarnReward(cfg5, { visitsCompleted: 9, rewardsEarned: 1, rewardsRedeemed: 1 })).toBe(true);
  });

  it("visitsRequired=1 would be a degenerate config — rejected", () => {
    expect(shouldEarnReward({ ...cfg5, visitsRequired: 1 }, { visitsCompleted: 0, rewardsEarned: 0, rewardsRedeemed: 0 })).toBe(false);
  });
});

describe("stamp card outstanding rewards", () => {
  it("returns 0 when all earned are redeemed", () => {
    expect(outstandingRewards({ visitsCompleted: 10, rewardsEarned: 2, rewardsRedeemed: 2 })).toBe(0);
  });

  it("returns diff when some are pending", () => {
    expect(outstandingRewards({ visitsCompleted: 10, rewardsEarned: 2, rewardsRedeemed: 0 })).toBe(2);
  });

  it("clamps to 0 on inconsistent state (more redeemed than earned)", () => {
    expect(outstandingRewards({ visitsCompleted: 10, rewardsEarned: 1, rewardsRedeemed: 5 })).toBe(0);
  });
});

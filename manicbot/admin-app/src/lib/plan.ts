/**
 * Plan capability helpers (admin-app side).
 *
 * Mirrors the Worker's PLAN_LIMITS (`manicbot/src/billing/config.js`) for the
 * multi-salon feature. Multi-salon ownership is a MAX-plan capability: a MAX
 * account may own up to MAX_OWNED_SALONS salons (its home salon + secondaries).
 * Keep this in sync with the Worker config if the gating rule changes.
 */

/** Max salons a single MAX-plan account may own (home + secondaries). */
export const MAX_OWNED_SALONS = 10;

/** True if the plan may own more than one salon (MAX only). */
export function canOwnMultipleSalons(plan: string | null | undefined): boolean {
  return plan === "max";
}

/**
 * Salon-level policy governing WHO may change a master's working hours.
 *
 * Stored as a string key inside the `tenants.salon` JSON blob
 * (`masterSchedulePolicy`) — no dedicated column / migration. Read by the
 * master dashboard (gate the editor), the owner settings dropdown, and the
 * `master.updateWorkHours` enforcement path.
 *
 *   - salon_only      → only the salon owner edits master schedules. The
 *                       master's own editor is shown but disabled.
 *   - master_free     → the master edits their own hours freely (the #312
 *                       default; preserves behaviour for existing salons).
 *   - master_approval → the master proposes a change; it is held as a pending
 *                       request until the owner approves it in-app.
 *
 * The owner editing a master via `salon.updateMaster` is NEVER gated — the
 * policy only constrains the `master` role.
 */
export const MASTER_SCHEDULE_POLICIES = [
  "salon_only",
  "master_free",
  "master_approval",
] as const;

export type MasterSchedulePolicy = (typeof MASTER_SCHEDULE_POLICIES)[number];

/** Default for any salon that never set the policy — matches pre-policy behaviour. */
export const DEFAULT_MASTER_SCHEDULE_POLICY: MasterSchedulePolicy = "master_free";

export function isMasterSchedulePolicy(v: unknown): v is MasterSchedulePolicy {
  return typeof v === "string"
    && (MASTER_SCHEDULE_POLICIES as readonly string[]).includes(v);
}

/**
 * Extract the policy from a raw `tenants.salon` JSON string. Falls back to the
 * default for null / malformed JSON / missing-or-invalid key, so callers never
 * have to guard — an unconfigured salon behaves exactly as before.
 */
export function readMasterSchedulePolicy(
  salonJsonRaw: string | null | undefined,
): MasterSchedulePolicy {
  if (!salonJsonRaw) return DEFAULT_MASTER_SCHEDULE_POLICY;
  try {
    const obj = JSON.parse(salonJsonRaw) as { masterSchedulePolicy?: unknown };
    return isMasterSchedulePolicy(obj?.masterSchedulePolicy)
      ? obj.masterSchedulePolicy
      : DEFAULT_MASTER_SCHEDULE_POLICY;
  } catch {
    return DEFAULT_MASTER_SCHEDULE_POLICY;
  }
}

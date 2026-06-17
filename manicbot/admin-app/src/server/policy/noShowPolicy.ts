/**
 * No-show & lateness policy — admin-app (TypeScript) twin of the Worker module
 * `manicbot/src/services/policy/noShowPolicy.js`. Keep the two in sync: same
 * field names, defaults, and evaluation precedence. The split mirrors the
 * existing pickLocaleBody Worker+admin twin.
 *
 * Stored as one JSON value in `tenant_config` under key `no_show_policy`. The
 * admin side uses this for the Settings get/set router, the markNoShow grace
 * gate, and the rebooking-warning decision.
 */

export const NO_SHOW_POLICY_KEY = "no_show_policy";

export type NotifyTone = "neutral" | "firm" | "off";
export type Prepayment = "none" | "deposit50" | "deposit100" | "cash";
export type AutoAction = "none" | "require_confirm" | "auto_block";
export type Preset = "none" | "neutral" | "strict";

export interface NoShowPolicy {
  graceMinutes: number;
  notifyClient: boolean;
  notifyTone: NotifyTone;
  afterCount: number;
  prepayment: Prepayment;
  penaltyAmount: number;
  autoAction: AutoAction;
  lateness: Preset;
  lateGraceMinutes: number;
  refund: Preset;
}

export const DEFAULT_NO_SHOW_POLICY: NoShowPolicy = {
  graceMinutes: 15,
  notifyClient: true,
  notifyTone: "neutral",
  afterCount: 0,
  prepayment: "none",
  penaltyAmount: 0,
  autoAction: "none",
  lateness: "none",
  lateGraceMinutes: 15,
  refund: "none",
};

const TONES = new Set<NotifyTone>(["neutral", "firm", "off"]);
const PREPAY = new Set<Prepayment>(["none", "deposit50", "deposit100", "cash"]);
const AUTO = new Set<AutoAction>(["none", "require_confirm", "auto_block"]);
const PRESET = new Set<Preset>(["none", "neutral", "strict"]);

function clampInt(value: unknown, min: number, max: number, dflt: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce arbitrary stored/user JSON into a complete, valid policy. Never throws. */
export function normalizeNoShowPolicy(raw: unknown): NoShowPolicy {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    graceMinutes: clampInt(p.graceMinutes, 0, 240, DEFAULT_NO_SHOW_POLICY.graceMinutes),
    notifyClient: p.notifyClient !== false,
    notifyTone: TONES.has(p.notifyTone as NotifyTone) ? (p.notifyTone as NotifyTone) : "neutral",
    afterCount: clampInt(p.afterCount, 0, 50, 0),
    prepayment: PREPAY.has(p.prepayment as Prepayment) ? (p.prepayment as Prepayment) : "none",
    penaltyAmount: clampInt(p.penaltyAmount, 0, 1_000_000, 0),
    autoAction: AUTO.has(p.autoAction as AutoAction) ? (p.autoAction as AutoAction) : "none",
    lateness: PRESET.has(p.lateness as Preset) ? (p.lateness as Preset) : "none",
    lateGraceMinutes: clampInt(p.lateGraceMinutes, 0, 240, DEFAULT_NO_SHOW_POLICY.lateGraceMinutes),
    refund: PRESET.has(p.refund as Preset) ? (p.refund as Preset) : "none",
  };
}

export type NoShowDecision =
  | "allow"
  | "warn"
  | "require_confirm"
  | "require_prepayment"
  | "blocked";

export interface NoShowEvaluation {
  decision: NoShowDecision;
  noShowCount: number;
  triggered: boolean;
  prepayment: Prepayment;
  penaltyAmount: number;
  reasons: string[];
}

/**
 * Pure booking-time decision for a client with a known no-show count.
 * Precedence once `afterCount` is reached: auto_block > require_prepayment >
 * require_confirm. Any prior no-show yields at least a soft `warn`.
 */
export function evaluateNoShowPolicy(
  rawPolicy: unknown,
  client: { noShowCount?: number | null },
): NoShowEvaluation {
  const policy = normalizeNoShowPolicy(rawPolicy);
  const count = Math.max(0, Number(client?.noShowCount) || 0);
  const result: NoShowEvaluation = {
    decision: "allow",
    noShowCount: count,
    triggered: false,
    prepayment: "none",
    penaltyAmount: 0,
    reasons: [],
  };
  if (count <= 0) return result;

  result.decision = "warn";
  result.reasons.push("has_no_shows");

  const threshold = policy.afterCount;
  if (threshold > 0 && count >= threshold) {
    result.triggered = true;
    if (policy.autoAction === "auto_block") {
      result.decision = "blocked";
      result.reasons.push("auto_block");
    } else if (policy.prepayment !== "none") {
      result.decision = "require_prepayment";
      result.prepayment = policy.prepayment;
      result.reasons.push("require_prepayment");
    } else if (policy.autoAction === "require_confirm") {
      result.decision = "require_confirm";
      result.reasons.push("require_confirm");
    }
    if (policy.penaltyAmount > 0) {
      result.penaltyAmount = policy.penaltyAmount;
      result.reasons.push("penalty");
    }
  }
  return result;
}

/**
 * No-show & lateness policy — the per-tenant rule set a salon owner configures
 * in Settings to decide what happens when a client repeatedly fails to show.
 *
 * Stored as a single JSON value in `tenant_config` under key `no_show_policy`.
 * Neutral defaults (flag + warning, notify the client, no auto-enforcement) so
 * an unconfigured tenant behaves sanely. Money collection (a real deposit/penalty
 * charge) is NOT implemented here — `prepayment`/`penaltyAmount` are surfaced as
 * staff instruction + client message until a booking-payment integration exists.
 *
 * This is the Worker (JS) side. An admin-app TypeScript twin lives at
 * `admin-app/src/server/policy/noShowPolicy.ts` — keep the two in sync (same
 * field names, defaults, and evaluation precedence). The split mirrors the
 * existing pickLocaleBody Worker+admin twin.
 */
import { dbGet } from '../../utils/db.js';

export const NO_SHOW_POLICY_KEY = 'no_show_policy';

/**
 * Whether a `prepayment` requirement (deposit50 / deposit100) is actually
 * COLLECTED from the client. This is `false` until a booking-payment integration
 * (Stripe) exists — today `prepayment`/`penaltyAmount` are surfaced as staff
 * instruction + client message only, never auto-charged.
 *
 * Single source of truth for the "deferred" status (AUDIT YELLOW #4). When real
 * charging lands, flip this to `true` in BOTH twins, wire the charge path, and
 * drop the "shown as instruction" disclaimer (`salon.noShowPolicy.prepayNote`).
 * A tripwire test asserts this is `false` so the flip can't pass unnoticed.
 */
export const DEPOSIT_CHARGING_ENABLED = false;

/** Neutral, safe-by-default policy used when a tenant hasn't configured one. */
export const DEFAULT_NO_SHOW_POLICY = Object.freeze({
  // Minutes after the appointment START before "client no-show" can be marked.
  // Avoids flagging a client who is merely a few minutes late.
  graceMinutes: 15,
  // Whether to message the client when their no-show is recorded.
  notifyClient: true,
  // Copy register for that message: gentle | matter-of-fact | (off → no send).
  notifyTone: 'neutral', // 'neutral' | 'firm' | 'off'
  // No-show count at which the escalations below kick in. 0 = disabled.
  afterCount: 0,
  // Prepayment requirement once `afterCount` is reached (surfaced, not charged).
  prepayment: 'none', // 'none' | 'deposit50' | 'deposit100' | 'cash'
  // Optional penalty/fine amount to surface (in the tenant's currency). 0 = off.
  penaltyAmount: 0,
  // Automatic action once `afterCount` is reached.
  autoAction: 'none', // 'none' | 'require_confirm' | 'auto_block'
  // Lateness handling preset + its own grace window.
  lateness: 'none', // 'none' | 'neutral' | 'strict'
  lateGraceMinutes: 15,
  // Refund handling preset.
  refund: 'none', // 'none' | 'neutral' | 'strict'
});

const TONES = new Set(['neutral', 'firm', 'off']);
const PREPAY = new Set(['none', 'deposit50', 'deposit100', 'cash']);
const AUTO = new Set(['none', 'require_confirm', 'auto_block']);
const PRESET = new Set(['none', 'neutral', 'strict']);

function clampInt(value, min, max, dflt) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Coerce arbitrary stored/user JSON into a complete, valid policy object.
 * Never throws; unknown/garbage fields fall back to the neutral default.
 * @param {unknown} raw
 * @returns {typeof DEFAULT_NO_SHOW_POLICY}
 */
export function normalizeNoShowPolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    graceMinutes: clampInt(p.graceMinutes, 0, 240, DEFAULT_NO_SHOW_POLICY.graceMinutes),
    notifyClient: p.notifyClient !== false,
    notifyTone: TONES.has(p.notifyTone) ? p.notifyTone : 'neutral',
    afterCount: clampInt(p.afterCount, 0, 50, 0),
    prepayment: PREPAY.has(p.prepayment) ? p.prepayment : 'none',
    penaltyAmount: clampInt(p.penaltyAmount, 0, 1_000_000, 0),
    autoAction: AUTO.has(p.autoAction) ? p.autoAction : 'none',
    lateness: PRESET.has(p.lateness) ? p.lateness : 'none',
    lateGraceMinutes: clampInt(p.lateGraceMinutes, 0, 240, DEFAULT_NO_SHOW_POLICY.lateGraceMinutes),
    refund: PRESET.has(p.refund) ? p.refund : 'none',
  };
}

/**
 * Pure booking-time decision for a client with a known no-show count.
 * Used by the rebooking surfaces (admin twin) and any future booking gate.
 *
 * Decision precedence once `afterCount` is reached: auto_block >
 * require_prepayment > require_confirm. Any prior no-show (count > 0) yields at
 * least a soft `warn`. `penaltyAmount` is additive context, not a decision.
 *
 * `prepaymentEnforceable` reflects {@link DEPOSIT_CHARGING_ENABLED}: when a
 * `require_prepayment` decision is returned the requirement is advisory only
 * (shown to staff + client) and NOT auto-collected until online payments exist.
 *
 * @param {unknown} rawPolicy
 * @param {{ noShowCount?: number }} client
 * @returns {{ decision: 'allow'|'warn'|'require_confirm'|'require_prepayment'|'blocked', noShowCount: number, triggered: boolean, prepayment: string, prepaymentEnforceable: boolean, penaltyAmount: number, reasons: string[] }}
 */
export function evaluateNoShowPolicy(rawPolicy, client) {
  const policy = normalizeNoShowPolicy(rawPolicy);
  const count = Math.max(0, Number(client?.noShowCount) || 0);
  const result = {
    decision: 'allow',
    noShowCount: count,
    triggered: false,
    prepayment: 'none',
    // Advisory-only until DEPOSIT_CHARGING_ENABLED flips (no charge integration).
    prepaymentEnforceable: DEPOSIT_CHARGING_ENABLED,
    penaltyAmount: 0,
    reasons: [],
  };
  if (count <= 0) return result;

  // Any history of no-shows warrants at least a heads-up to the staff.
  result.decision = 'warn';
  result.reasons.push('has_no_shows');

  const threshold = policy.afterCount;
  if (threshold > 0 && count >= threshold) {
    result.triggered = true;
    if (policy.autoAction === 'auto_block') {
      result.decision = 'blocked';
      result.reasons.push('auto_block');
    } else if (policy.prepayment !== 'none') {
      result.decision = 'require_prepayment';
      result.prepayment = policy.prepayment;
      result.reasons.push('require_prepayment');
    } else if (policy.autoAction === 'require_confirm') {
      result.decision = 'require_confirm';
      result.reasons.push('require_confirm');
    }
    if (policy.penaltyAmount > 0) {
      result.penaltyAmount = policy.penaltyAmount;
      result.reasons.push('penalty');
    }
  }
  return result;
}

/**
 * Read + normalize the tenant's no-show policy from `tenant_config`.
 * Returns the neutral default on any miss/parse error (never throws).
 * @param {{ db?: unknown, tenantId?: string }} ctx
 * @returns {Promise<typeof DEFAULT_NO_SHOW_POLICY>}
 */
export async function getNoShowPolicy(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return normalizeNoShowPolicy(null);
  const row = await dbGet(
    ctx,
    'SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?',
    ctx.tenantId,
    NO_SHOW_POLICY_KEY,
  );
  if (!row || row.value == null) return normalizeNoShowPolicy(null);
  try {
    return normalizeNoShowPolicy(JSON.parse(row.value));
  } catch {
    return normalizeNoShowPolicy(null);
  }
}

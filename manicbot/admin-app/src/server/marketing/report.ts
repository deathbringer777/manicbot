/**
 * Pure builder for the campaign results / funnel report.
 *
 * Kept DB-free (like `processResendEvent`) so the funnel + rate math is
 * unit-testable in isolation. Both routers run the same two aggregate queries
 * (a per-status-timestamp roll-up over `marketing_sends` and a conversions
 * count) and hand the raw rows here.
 *
 * Why a CUMULATIVE roll-up and not the status-bucket counts in `campaignStats`:
 * `marketing_sends.status` is promoted monotonically (queued → sent → delivered
 * → opened → clicked; bounced/complained/failed terminal), so a recipient who
 * opened THEN clicked sits in the `clicked` bucket only and is missing from the
 * `opened` bucket. Counting the set-once timestamp columns
 * (`SUM(opened_at IS NOT NULL)`, …) instead preserves the funnel invariant
 * Delivered ≥ Opened ≥ Clicked. Bounced/complained/failed come from their own
 * columns/status so they overlap the positive funnel rather than subtract from it.
 */

/** Campaign metadata row (the subset the report surfaces). */
export interface CampaignMeta {
  id: string;
  name: string;
  status: string;
  channel: string;
  segmentId: string | null;
  scheduledAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Campaign `stats_json` blob — parsed for the at-send-time audience size. */
  statsJson: string | null;
}

/**
 * Raw aggregate row over `marketing_sends` for one campaign. Values may arrive
 * as strings or null from D1 (`SUM` over an empty set is null) — the builder
 * coerces with `Number()`.
 */
export interface CampaignAgg {
  total: number | string | null;
  queued: number | string | null;
  sent: number | string | null;
  delivered: number | string | null;
  opened: number | string | null;
  clicked: number | string | null;
  bounced: number | string | null;
  complained: number | string | null;
  failed: number | string | null;
}

export interface CampaignReport {
  campaign: {
    id: string;
    name: string;
    status: string;
    channel: string;
    segmentId: string | null;
    scheduledAt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
    /** Audience size captured in `stats_json` at send time, or null. */
    audienceTotal: number | null;
  };
  funnel: {
    total: number;
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    failed: number;
    conversions: number;
  };
  rates: {
    deliveredRate: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    bounceRate: number;
    conversionRate: number;
  };
}

/** Ratio that returns 0 (never NaN/Infinity) when the denominator is ≤ 0. */
function rate(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function n(v: number | string | null | undefined): number {
  const num = Number(v ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/** Parse the at-send-time audience size out of `stats_json` (best-effort). */
function audienceTotalFromStats(statsJson: string | null): number | null {
  if (!statsJson) return null;
  try {
    const s = JSON.parse(statsJson);
    if (s && typeof s === "object" && typeof s.total === "number") return s.total;
  } catch {
    /* malformed stats_json → no audience figure */
  }
  return null;
}

/**
 * Assemble the funnel + derived rates from the raw aggregate row, the campaign
 * meta, and the (separately counted) conversions total.
 */
export function buildCampaignReport(
  meta: CampaignMeta,
  agg: CampaignAgg,
  conversions = 0,
): CampaignReport {
  const total = n(agg.total);
  const sent = n(agg.sent);
  const delivered = n(agg.delivered);
  const opened = n(agg.opened);
  const clicked = n(agg.clicked);
  const bounced = n(agg.bounced);
  const conv = n(conversions);

  return {
    campaign: {
      id: meta.id,
      name: meta.name,
      status: meta.status,
      channel: meta.channel,
      segmentId: meta.segmentId,
      scheduledAt: meta.scheduledAt,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
      audienceTotal: audienceTotalFromStats(meta.statsJson),
    },
    funnel: {
      total,
      queued: n(agg.queued),
      sent,
      delivered,
      opened,
      clicked,
      bounced,
      complained: n(agg.complained),
      failed: n(agg.failed),
      conversions: conv,
    },
    rates: {
      deliveredRate: rate(delivered, sent),
      openRate: rate(opened, delivered),
      clickRate: rate(clicked, delivered),
      clickToOpenRate: rate(clicked, opened),
      bounceRate: rate(bounced, sent),
      conversionRate: rate(conv, clicked),
    },
  };
}

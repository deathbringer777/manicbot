/**
 * Pure-function tests for the campaign report builder.
 *
 * The headline case is the funnel-correctness regression: a recipient who
 * opened AND clicked must count toward BOTH stages (the bug the old
 * status-bucket `campaignStats` exhibits, where the clicked row leaves the
 * opened bucket). See `~/server/marketing/report.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  buildCampaignReport,
  type CampaignMeta,
  type CampaignAgg,
} from "~/server/marketing/report";

function meta(over: Partial<CampaignMeta> = {}): CampaignMeta {
  return {
    id: "cmp_1",
    name: "Spring promo",
    status: "sent",
    channel: "email",
    segmentId: null,
    scheduledAt: null,
    startedAt: 1_700_000_000,
    finishedAt: 1_700_000_100,
    statsJson: null,
    ...over,
  };
}

function agg(over: Partial<CampaignAgg> = {}): CampaignAgg {
  return {
    total: 0, queued: 0, sent: 0, delivered: 0, opened: 0,
    clicked: 0, bounced: 0, complained: 0, failed: 0,
    ...over,
  };
}

describe("buildCampaignReport — funnel correctness", () => {
  it("counts an opened-AND-clicked recipient in BOTH opened and clicked", () => {
    // One recipient: delivered, opened, then clicked. The timestamp columns
    // are all set, so cumulative counts put it in every stage it reached.
    const r = buildCampaignReport(
      meta(),
      agg({ total: 1, sent: 1, delivered: 1, opened: 1, clicked: 1 }),
    );
    expect(r.funnel.opened).toBe(1);
    expect(r.funnel.clicked).toBe(1);
    // Invariant must hold: delivered ≥ opened ≥ clicked.
    expect(r.funnel.delivered).toBeGreaterThanOrEqual(r.funnel.opened);
    expect(r.funnel.opened).toBeGreaterThanOrEqual(r.funnel.clicked);
  });

  it("computes rates on a mixed cohort", () => {
    const r = buildCampaignReport(
      meta(),
      agg({ total: 10, sent: 10, delivered: 8, opened: 5, clicked: 3, bounced: 2 }),
    );
    expect(r.funnel.delivered).toBe(8);
    expect(r.rates.deliveredRate).toBeCloseTo(0.8);
    expect(r.rates.openRate).toBeCloseTo(0.625); // 5/8
    expect(r.rates.clickRate).toBeCloseTo(0.375); // 3/8
    expect(r.rates.clickToOpenRate).toBeCloseTo(0.6); // 3/5
    expect(r.rates.bounceRate).toBeCloseTo(0.2); // 2/10
  });

  it("conversions count + conversionRate (clicked-gated)", () => {
    const r = buildCampaignReport(
      meta(),
      agg({ total: 10, sent: 10, delivered: 9, opened: 6, clicked: 4 }),
      2,
    );
    expect(r.funnel.conversions).toBe(2);
    expect(r.rates.conversionRate).toBeCloseTo(0.5); // 2/4
  });
});

describe("buildCampaignReport — edge cases", () => {
  it("zero sends → all rates 0, no NaN/Infinity", () => {
    const r = buildCampaignReport(meta({ status: "draft" }), agg());
    for (const v of Object.values(r.rates)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
    expect(r.funnel.total).toBe(0);
  });

  it("SMS-style campaign (no open/click tracking) collapses cleanly", () => {
    const r = buildCampaignReport(
      meta({ channel: "sms" }),
      agg({ total: 5, sent: 5, delivered: 4, opened: 0, clicked: 0 }),
    );
    expect(r.rates.openRate).toBe(0);
    expect(r.rates.clickRate).toBe(0);
    expect(r.rates.deliveredRate).toBeCloseTo(0.8);
  });

  it("parses audienceTotal from stats_json and tolerates malformed json", () => {
    expect(
      buildCampaignReport(meta({ statsJson: '{"total":42,"sent":40}' }), agg())
        .campaign.audienceTotal,
    ).toBe(42);
    expect(
      buildCampaignReport(meta({ statsJson: "not json" }), agg()).campaign.audienceTotal,
    ).toBeNull();
    expect(
      buildCampaignReport(meta({ statsJson: null }), agg()).campaign.audienceTotal,
    ).toBeNull();
  });

  it("coerces string/null aggregate values from D1", () => {
    const r = buildCampaignReport(
      meta(),
      // D1 returns SUM() as null on empty sets and sometimes numeric strings.
      agg({ total: "7" as never, sent: "7" as never, delivered: null, opened: "3" as never }),
    );
    expect(r.funnel.total).toBe(7);
    expect(r.funnel.delivered).toBe(0);
    expect(r.funnel.opened).toBe(3);
    expect(Number.isFinite(r.rates.openRate)).toBe(true);
  });
});

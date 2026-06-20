/**
 * resolveAudience cross-tick dedup (reliability fix, 2026-06-20) — admin-app twin.
 *
 * Mirrors the Worker `marketing-sender-dedup.test.js`. The sender passes
 * `excludeSentForCampaignId` so a >INLINE_CAP audience advances to the next
 * un-sent batch each cron tick instead of re-sending the first `limit` rows.
 *
 * The chainable Drizzle mock in `helpers/db-mock` cannot evaluate a WHERE
 * clause, so we instead CAPTURE the `where` SQL that resolveAudience builds and
 * compile it with Drizzle's `SQLiteSyncDialect` (no DB needed) to assert the
 * correlated `NOT EXISTS (... marketing_sends ... campaign_id = ? ... contact_id = ...)`
 * subquery is emitted — and the campaign id is bound — only when the dedup arg
 * is set. Preview callers (which omit it) must NOT get the exclusion.
 */
import { describe, it, expect } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { resolveAudience } from "~/server/marketing/audience";

const dialect = new SQLiteSyncDialect();

/**
 * Minimal Drizzle-select mock that records the SQL passed to `.where()` and
 * returns an empty rowset. Only the `.from().where().limit()` and
 * `.from().where()` (count) shapes resolveAudience uses are supported.
 */
function makeCapturingDb() {
  const whereClauses: SQL[] = [];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    innerJoin: () => chain,
    where: (c: SQL) => {
      whereClauses.push(c);
      const limitChain = {
        // rows query: .where(...).limit(n) resolves to []
        then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
      };
      // count query awaits .where(...) directly → [{ count: 0 }]
      return Object.assign(
        {
          limit: () => limitChain,
          then: (res: (v: unknown) => unknown) => Promise.resolve([{ count: 0 }]).then(res),
        },
        {},
      );
    },
  });
  const db = { select: () => chain };
  return { db, whereClauses };
}

function compiledWheres(whereClauses: SQL[]): string[] {
  return whereClauses.map((c) => dialect.sqlToQuery(c).sql);
}

describe("resolveAudience — cross-tick dedup exclusion", () => {
  it("emits a correlated NOT EXISTS over marketing_sends when excludeSentForCampaignId is set", async () => {
    const { db, whereClauses } = makeCapturingDb();
    await resolveAudience({
      db: db as never,
      tenantId: "t_a",
      segmentId: null,
      channel: "email",
      limit: 500,
      excludeSentForCampaignId: "cmp_x",
    });

    // Both the rows query and the COUNT query must carry the exclusion.
    expect(whereClauses.length).toBeGreaterThanOrEqual(2);
    const sqls = compiledWheres(whereClauses);
    for (const s of sqls) {
      expect(s).toMatch(/not\s+exists/i);
      expect(s).toMatch(/marketing_sends/i);
      expect(s).toMatch(/campaign_id"?\s*=\s*\?/i);
      expect(s).toMatch(/contact_id/i);
    }

    // The campaign id is bound as a parameter (not string-interpolated).
    const params = whereClauses.map((c) => dialect.sqlToQuery(c).params);
    for (const p of params) {
      expect(p).toContain("cmp_x");
    }
  });

  it("does NOT emit the exclusion for a preview caller (no campaign id)", async () => {
    const { db, whereClauses } = makeCapturingDb();
    await resolveAudience({
      db: db as never,
      tenantId: "t_a",
      segmentId: null,
      channel: "email",
      limit: 3,
    });

    const sqls = compiledWheres(whereClauses);
    for (const s of sqls) {
      expect(s).not.toMatch(/marketing_sends/i);
      expect(s).not.toMatch(/not\s+exists/i);
    }
  });

  it("keeps the tenant scope alongside the dedup exclusion", async () => {
    const { db, whereClauses } = makeCapturingDb();
    await resolveAudience({
      db: db as never,
      tenantId: "t_scoped",
      segmentId: null,
      channel: "email",
      limit: 500,
      excludeSentForCampaignId: "cmp_y",
    });

    const rowsWhere = dialect.sqlToQuery(whereClauses[0]!);
    // tenant_id = ? is still the first bound condition; dedup never replaces it.
    expect(rowsWhere.sql).toMatch(/tenant_id"?\s*=\s*\?/i);
    expect(rowsWhere.params).toContain("t_scoped");
    expect(rowsWhere.params).toContain("cmp_y");
  });
});

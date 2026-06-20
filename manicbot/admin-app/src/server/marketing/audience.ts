/**
 * Resolve a marketing audience for a campaign send.
 *
 * `segmentId === null` → all contacts of the tenant with consent on the
 * requested channel. Otherwise we read `marketingSegments.filter_json` and
 * apply v1 filter rules.
 *
 * v1 filter_json schema:
 *   {
 *     "consentChannel": "email" | "sms" | "any",   // override per-segment
 *     "lifecycleStages": ["lead", "customer"],
 *     "tagsAny": ["vip"],
 *     "tagsAll": ["onboarded", "verified"],
 *     "lastSeenWithinDays": 90,
 *     "excludeUnsubscribed": true
 *   }
 *
 * Hard cap: 5000 rows. The campaign sender enforces a stricter inline cap
 * (500) and defers the tail to the worker cron phase.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { marketingContacts, marketingSegments, marketingSegmentMembers, marketingSends } from "~/server/db/schema";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

export interface ResolvedContact {
  id: number;
  email: string | null;
  phone: string | null;
  name: string | null;
  unsubscribeToken: string | null;
}

export interface AudienceFilter {
  consentChannel?: "email" | "sms" | "any";
  lifecycleStages?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  lastSeenWithinDays?: number;
  excludeUnsubscribed?: boolean;
}

export interface ResolveAudienceArgs {
  db: DbInstance;
  tenantId: string;
  segmentId: string | null;
  channel: "email" | "sms" | "whatsapp";
  /** Hard cap on returned rows. Default 5000. */
  limit?: number;
  /** UNIX seconds. Used by `lastSeenWithinDays`. Defaults to now(). */
  nowSec?: number;
  /**
   * When set, exclude contacts already recorded in `marketing_sends` for this
   * campaign (cross-tick dedup). The sender passes its campaign id so a
   * >INLINE_CAP audience advances to the next un-sent batch on every cron pass
   * instead of re-sending the first `limit` rows forever. Audience PREVIEW
   * callers omit it — a preview must show the full segment size, not the
   * remaining tail.
   */
  excludeSentForCampaignId?: string | null;
}

const DEFAULT_LIMIT = 5000;

export function parseFilterJson(raw: string | null | undefined): AudienceFilter {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v as AudienceFilter;
  } catch {
    /* fall through */
  }
  return {};
}

export async function resolveAudience(args: ResolveAudienceArgs): Promise<{
  contacts: ResolvedContact[];
  totalCount: number;
}> {
  const { db, tenantId, segmentId, channel } = args;
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT));
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);

  // Resolve the per-segment override filter, if any. Manual lists (0072)
  // short-circuit the WHERE-builder and JOIN through the explicit member
  // table — `filter_json` is intentionally ignored for kind='manual' so
  // user expectations match the UI (the list shows what gets sent).
  let filter: AudienceFilter = {};
  let manualSegment = false;
  if (segmentId) {
    const seg = await db
      .select({
        filterJson: marketingSegments.filterJson,
        tenantId: marketingSegments.tenantId,
        kind: marketingSegments.kind,
      })
      .from(marketingSegments)
      .where(eq(marketingSegments.id, segmentId))
      .limit(1);
    if (!seg[0]) {
      // Unknown segment id → audience is empty rather than throwing — the
      // sender treats this as "no recipients" and marks the campaign sent.
      return { contacts: [], totalCount: 0 };
    }
    if (seg[0].tenantId && seg[0].tenantId !== tenantId) {
      // Defense in depth — segment belongs to another tenant.
      return { contacts: [], totalCount: 0 };
    }
    manualSegment = seg[0].kind === "manual";
    if (!manualSegment) filter = parseFilterJson(seg[0].filterJson);
  }

  const conds: SQL[] = [eq(marketingContacts.tenantId, tenantId)];

  // excludeUnsubscribed defaults to true; never include unsubscribed rows
  // unless filter explicitly opts out (which is rare/admin-only).
  if (filter.excludeUnsubscribed !== false) {
    conds.push(eq(marketingContacts.unsubscribed, 0));
  }

  // Channel consent gate. `filter.consentChannel` may override but only to
  // tighten or pick a specific channel — falls back to the campaign channel.
  const consentCh = filter.consentChannel === "any" ? null : (filter.consentChannel ?? channel);
  if (consentCh === "email") {
    conds.push(eq(marketingContacts.consentEmail, 1));
    // For email, the contact must actually have an email address.
    conds.push(sql`coalesce(${marketingContacts.email}, '') <> ''`);
  } else if (consentCh === "sms") {
    conds.push(eq(marketingContacts.consentSms, 1));
    conds.push(sql`coalesce(${marketingContacts.phone}, '') <> ''`);
  }

  if (filter.lifecycleStages && filter.lifecycleStages.length > 0) {
    const inList = filter.lifecycleStages.map((s) => sanitizeShort(s));
    conds.push(sql`${marketingContacts.lifecycleStage} IN (${sql.join(
      inList.map((s) => sql`${s}`),
      sql.raw(", "),
    )})`);
  }

  if (filter.tagsAny && filter.tagsAny.length > 0) {
    const ors = filter.tagsAny.map((tag) => {
      const t = sanitizeShort(tag);
      return sql`(',' || coalesce(${marketingContacts.tags}, '') || ',') LIKE ${"%," + t + ",%"}`;
    });
    conds.push(sql`(${sql.join(ors, sql.raw(" OR "))})`);
  }

  if (filter.tagsAll && filter.tagsAll.length > 0) {
    for (const tag of filter.tagsAll) {
      const t = sanitizeShort(tag);
      conds.push(sql`(',' || coalesce(${marketingContacts.tags}, '') || ',') LIKE ${"%," + t + ",%"}`);
    }
  }

  if (filter.lastSeenWithinDays && filter.lastSeenWithinDays > 0) {
    const cutoff = nowSec - filter.lastSeenWithinDays * 86400;
    conds.push(sql`${marketingContacts.lastSeenAt} >= ${cutoff}`);
  }

  // Cross-tick dedup (>INLINE_CAP re-send-loop fix): skip contacts already
  // sent for this campaign. Correlated NOT EXISTS keyed by campaign_id (the
  // campaign was already tenant-verified by the sender) + contact_id — applied
  // to both the rows and the COUNT query (and the manual-list JOIN path) so
  // `totalCount` counts only the remaining tail and the sender's
  // `deferred = totalCount - contacts.length` reaches 0 on the final tick.
  if (args.excludeSentForCampaignId) {
    conds.push(
      sql`NOT EXISTS (SELECT 1 FROM ${marketingSends} WHERE ${marketingSends.campaignId} = ${args.excludeSentForCampaignId} AND ${marketingSends.contactId} = ${marketingContacts.id})`,
    );
  }

  const where = conds.length === 1 ? conds[0] : and(...conds);

  if (manualSegment && segmentId) {
    // Manual list: JOIN through marketing_segment_members. The same WHERE
    // (channel consent + unsubscribe gate) still applies so bouncing /
    // unsubscribed contacts never get a send even if the operator added
    // them to a list by hand.
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: marketingContacts.id,
          email: marketingContacts.email,
          phone: marketingContacts.phone,
          name: marketingContacts.name,
          unsubscribeToken: marketingContacts.unsubscribeToken,
        })
        .from(marketingSegmentMembers)
        .innerJoin(marketingContacts, eq(marketingContacts.id, marketingSegmentMembers.contactId))
        .where(and(eq(marketingSegmentMembers.segmentId, segmentId), where as SQL))
        .limit(limit),
      db
        .select({ count: sql<number>`count(*)` })
        .from(marketingSegmentMembers)
        .innerJoin(marketingContacts, eq(marketingContacts.id, marketingSegmentMembers.contactId))
        .where(and(eq(marketingSegmentMembers.segmentId, segmentId), where as SQL)),
    ]);
    return { contacts: rows, totalCount: Number(totalRow[0]?.count ?? rows.length) };
  }

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: marketingContacts.id,
        email: marketingContacts.email,
        phone: marketingContacts.phone,
        name: marketingContacts.name,
        unsubscribeToken: marketingContacts.unsubscribeToken,
      })
      .from(marketingContacts)
      .where(where as SQL)
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)` })
      .from(marketingContacts)
      .where(where as SQL),
  ]);

  return {
    contacts: rows,
    totalCount: Number(totalRow[0]?.count ?? rows.length),
  };
}

function sanitizeShort(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-.]/g, "").slice(0, 64);
}

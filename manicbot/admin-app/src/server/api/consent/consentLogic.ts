/**
 * Pure helpers for the consent router. Extracted so they can be unit-tested
 * without a real D1 binding.
 *
 * Treat the consent log as APPEND-ONLY. The mutation never updates or deletes
 * rows. If a user changes their mind, a new row is appended; readers walk back
 * the timeline and pick the most recent decision per `anonymous_id`.
 */
import { z } from "zod";

export const CONSENT_CATEGORIES_SCHEMA = z
  .object({
    necessary: z.literal(true),
    analytics: z.boolean(),
    marketing: z.boolean(),
    ux: z.boolean(),
  })
  .strict();

export const CONSENT_RECORD_INPUT_SCHEMA = z.object({
  anonymousId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[0-9a-fA-F-]+$/, "anonymousId must be hex/uuid"),
  categories: CONSENT_CATEGORIES_SCHEMA,
  policyVersion: z.string().min(1).max(48),
  source: z.enum(["banner", "settings", "api", "accept_all", "reject_all"]),
});

export type ConsentRecordInput = z.infer<typeof CONSENT_RECORD_INPUT_SCHEMA>;

export function parseClientIp(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.slice(0, 64);
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim() ?? "";
    if (first.length > 0) return first.slice(0, 64);
  }
  return null;
}

export function truncateUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  return ua.slice(0, 500);
}

export interface ConsentInsertContext {
  webUserId: string | null;
  ip: string | null;
  userAgent: string | null;
  nowSec: number;
}

export interface ConsentInsertRow {
  anonymousId: string;
  webUserId: string | null;
  categories: string;
  policyVersion: string;
  source: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

export function buildConsentInsertRow(
  input: ConsentRecordInput,
  ctx: ConsentInsertContext,
): ConsentInsertRow {
  return {
    anonymousId: input.anonymousId,
    webUserId: ctx.webUserId,
    categories: JSON.stringify(input.categories),
    policyVersion: input.policyVersion,
    source: input.source,
    ip: ctx.ip ? ctx.ip.slice(0, 64) : null,
    userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 500) : null,
    createdAt: ctx.nowSec,
  };
}

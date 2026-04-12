/**
 * D1-based rate limiter — durable across Cloudflare edge isolates.
 *
 * Uses a single `rate_limits` table with compound PK (key, action).
 * Old windows are lazily cleaned up on each check.
 */
import { eq, and, lt, sql } from "drizzle-orm";
import { rateLimits } from "~/server/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix epoch seconds
}

/**
 * Check and increment a rate limit counter in D1.
 *
 * @param db       Drizzle D1 database instance
 * @param key      Rate limit key (e.g. IP address, email)
 * @param action   Action name (e.g. "register", "verify", "login")
 * @param maxCount Maximum allowed attempts within the window
 * @param windowMs Window duration in milliseconds
 */
export async function checkRateLimit(
  db: DrizzleD1Database<Record<string, unknown>>,
  key: string,
  action: string,
  maxCount: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = Math.floor(windowMs / 1000);
  const windowStart = nowSec - windowSec;

  // Lazy cleanup: delete expired entries (fire-and-forget, ignore errors)
  // Only run ~10% of the time to reduce write load
  if (Math.random() < 0.1) {
    db.delete(rateLimits)
      .where(lt(rateLimits.windowStart, windowStart - windowSec))
      .run()
      .catch(() => {});
  }

  // Fetch current state
  const rows = await db
    .select({ count: rateLimits.count, windowStart: rateLimits.windowStart })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), eq(rateLimits.action, action)))
    .limit(1);

  const existing = rows[0];

  // No existing record or window expired → create/reset
  if (!existing || existing.windowStart < windowStart) {
    await db
      .insert(rateLimits)
      .values({ key, action, count: 1, windowStart: nowSec })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.action],
        set: { count: 1, windowStart: nowSec },
      })
      .run();
    return { allowed: true, remaining: maxCount - 1, resetAt: nowSec + windowSec };
  }

  // Within window — check limit
  if (existing.count >= maxCount) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.windowStart + windowSec,
    };
  }

  // Increment
  await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} + 1` })
    .where(and(eq(rateLimits.key, key), eq(rateLimits.action, action)))
    .run();

  return {
    allowed: true,
    remaining: maxCount - (existing.count + 1),
    resetAt: existing.windowStart + windowSec,
  };
}

/**
 * Error sink for client-side React error boundaries.
 *
 * Called from app/global-error.tsx and app/(dashboard)/error.tsx via fetch
 * with keepalive (or navigator.sendBeacon as fallback). Persists into the D1
 * `error_log` table so ops can see crashes that previously lived only in the
 * user's browser console.
 *
 * Anti-abuse: rate-limited per IP; payload size capped; messages truncated.
 * Auth: best-effort attaches user_id/tenant_id from the NextAuth session if
 * present, but the endpoint is open to anonymous reports too — we'd rather
 * log the crash of an unauthenticated visitor than miss it.
 */

import { NextResponse } from "next/server";
import { getDb } from "~/server/db";
import { errorLog } from "~/server/db/schema";
import { auth } from "~/server/auth/auth";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { log } from "~/server/utils/logger";

export const runtime = "edge";

const MAX_MESSAGE_LEN = 2000;
const MAX_URL_LEN = 1000;
const MAX_DIGEST_LEN = 200;
const MAX_DETAIL_LEN = 4000;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const ALLOWED_SOURCES = new Set([
  "global-error",
  "dashboard-error",
  "auth-error",
  "public-error",
  "trpc-client",
]);

function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function trunc(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function POST(req: Request) {
  // Hard cap on payload size — defends against a runaway client looping
  // sendBeacon with megabytes of stack data.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength && contentLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source : "";
  if (!ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ ok: false, error: "unknown_source" }, { status: 400 });
  }

  const message = trunc(body.message, MAX_MESSAGE_LEN);
  if (!message) {
    return NextResponse.json({ ok: false, error: "missing_message" }, { status: 400 });
  }

  const db = getDb();
  const ip = clientIp(req.headers);

  // 30 reports per IP per 10 minutes — generous enough to not lose bursts
  // when a UI page crashes and remounts but tight enough to deny abuse.
  try {
    const rl = await checkRateLimit(db, ip, "error_report", 30, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
  } catch (e) {
    log.warn("error-report.rate_limit", { error: (e as Error).message });
    // Fall through — never block error reporting on the rate limiter itself.
  }

  // Best-effort session attribution.
  let userId: string | null = null;
  let tenantId: string | null = null;
  try {
    const session = await auth();
    if (session?.user) {
      userId = session.user.id ?? null;
      tenantId = session.user.tenantId ?? null;
    }
  } catch {
    // Anonymous fires are valid — keep going.
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    await db.insert(errorLog).values({
      id,
      createdAt: now,
      source,
      message,
      digest: trunc(body.digest, MAX_DIGEST_LEN),
      url: trunc(body.url, MAX_URL_LEN),
      userAgent: trunc(req.headers.get("user-agent"), 500),
      userId,
      tenantId,
      detailJson: body.detail !== undefined ? trunc(JSON.stringify(body.detail), MAX_DETAIL_LEN) : null,
    });
  } catch (e) {
    log.error("error-report.insert", e instanceof Error ? e : new Error(String(e)));
    // Don't surface the DB error to the client — it would just create an
    // error-about-the-error feedback loop.
    return NextResponse.json({ ok: false, error: "store_failed" }, { status: 500 });
  }

  // Mirror to the structured logger so logs aggregator picks it up too.
  log.warn(`error-report.${source}`, { id, message: message.slice(0, 200), userId, url: body.url });

  return NextResponse.json({ ok: true, id });
}

/**
 * welcomeOnRegister — synchronous, idempotent welcome message for the
 * "ManicBot — News & Announcements" channel, fired fire-and-forget when a new
 * salon owner registers (webUsers.register).
 *
 * It mirrors the Worker's `deliverCenter` (src/services/platformCampaigns.js):
 * find/create the owner's platform_thread, insert one platform_thread_message,
 * bump the thread. Crucially it claims the SAME delivery ledger row
 * (`sys_welcome` / occurrence `once` / channel `center`) so the Phase-2 cron
 * `welcome` backfill can never double-send — the unique index idx_pcd_claim is
 * the idempotency boundary.
 *
 * The welcome text + enable toggle live on the `sys_welcome` singleton
 * platform_campaigns row (migration 0110), editable from the Рассылки hub. The
 * body is personalized via the token layer below.
 *
 * NOTE: `renderTemplateVars` / `buildCampaignVars` are a byte-identical TS twin
 * of `src/services/platformCampaignVars.js` (separate build, no shared package).
 * Keep the two in lockstep — same discipline as the dual `ulid` implementations.
 */

import { eq } from "drizzle-orm";
import {
  platformCampaigns,
  platformCampaignDeliveries,
  platformThreads,
  platformThreadMessages,
  tenants,
  webUsers,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { notifyWebUser } from "~/server/services/notifyWebUser";
import { log } from "~/server/utils/logger";

const WELCOME_CAMPAIGN_ID = "sys_welcome";
const WELCOME_OCCURRENCE = "once";
const PREVIEW_MAX = 200;

// ─── Personalization (TS twin of platformCampaignVars.js — keep in lockstep) ──

// One alternation, scanned left-to-right: `{{`/`}}` are matched BEFORE the
// `{token}` pattern, so escaped braces de-escape to literals and can never be
// mistaken for a placeholder (e.g. `{{salon_name}}` → `{salon_name}`).
const TOKEN_RE = /\{\{|\}\}|\{([a-z0-9_]+)\}/g;

export function renderTemplateVars(
  text: unknown,
  vars: Record<string, unknown> | null | undefined,
): string {
  if (typeof text !== "string") return "";
  const v = vars && typeof vars === "object" ? vars : {};
  return text.replace(TOKEN_RE, (match, name: string) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    if (Object.prototype.hasOwnProperty.call(v, name)) {
      const value = (v as Record<string, unknown>)[name];
      return value == null ? "" : String(value);
    }
    return match; // unknown token — leave verbatim
  });
}

function firstWord(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0] ?? "";
}

export function buildCampaignVars(
  tenant: { name?: string | null; plan?: string | null } | null,
  recipient: { name?: string | null } | null,
): { salon_name: string; plan: string; owner_name: string; first_name: string } {
  const t = tenant ?? {};
  const r = recipient ?? {};
  return {
    salon_name: t.name == null ? "" : String(t.name),
    plan: t.plan == null ? "start" : String(t.plan),
    owner_name: r.name == null ? "" : String(r.name),
    first_name: firstWord(r.name),
  };
}

// ─── Delivery ────────────────────────────────────────────────────────────────

// Loose Db type at this boundary — matches the codebase's `db: any` convention
// in platformMessenger.ensureThread (the real type is the Drizzle libsql client).
type Db = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function makePreview(body: string): string {
  const oneLine = String(body || "").replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_MAX ? oneLine.slice(0, PREVIEW_MAX) : oneLine;
}

/** Find or create the owner's platform thread. Never throws — returns null on failure. */
async function ensureThread(db: Db, recipientWebUserId: string, recipientTenantId: string | null, now: number): Promise<string | null> {
  const existing = await db
    .select({ id: platformThreads.id })
    .from(platformThreads)
    .where(eq(platformThreads.recipientWebUserId, recipientWebUserId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const id = `pt_${ulid()}`;
  try {
    await db.insert(platformThreads).values({
      id,
      recipientWebUserId,
      recipientTenantId,
      lastMessageAt: null,
      lastMessagePreview: null,
      lastSenderKind: null,
      recipientLastReadAt: null,
      platformLastReadAt: null,
      archived: 0,
      createdAt: now,
    });
    return id;
  } catch {
    const raced = await db
      .select({ id: platformThreads.id })
      .from(platformThreads)
      .where(eq(platformThreads.recipientWebUserId, recipientWebUserId))
      .limit(1);
    return raced[0]?.id ?? null;
  }
}

/**
 * Claim a (sys_welcome, once, recipient, channel) delivery via INSERT … ON
 * CONFLICT DO NOTHING RETURNING id. Returns the new claim id, or null when the
 * row already exists (another tick/path owns it) — the idempotency gate.
 */
async function claimDelivery(db: Db, channel: string, recipientWebUserId: string, tenantId: string, now: number): Promise<string | null> {
  const id = `pcd_${ulid()}`;
  const rows = await db
    .insert(platformCampaignDeliveries)
    .values({
      id,
      campaignId: WELCOME_CAMPAIGN_ID,
      occurrenceKey: WELCOME_OCCURRENCE,
      recipientWebUserId,
      tenantId,
      channel,
      status: "pending",
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: platformCampaignDeliveries.id });
  return rows[0]?.id ?? null;
}

async function markDelivery(db: Db, id: string, status: "sent" | "failed" | "skipped", now: number): Promise<void> {
  await db
    .update(platformCampaignDeliveries)
    .set({ status, sentAt: status === "sent" ? now : null })
    .where(eq(platformCampaignDeliveries.id, id));
}

export interface WelcomeInput {
  webUserId: string;
  tenantId: string;
}

export interface WelcomeResult {
  delivered: boolean;
  reason?: string;
}

/**
 * Deliver the welcome message to a freshly-registered owner. Idempotent (claims
 * the delivery ledger first) and never throws — any failure is logged and
 * swallowed so it can never reject the registration flow. Call as:
 *   void deliverWelcomeFireAndForget(ctx.db, { webUserId, tenantId }).catch(...)
 */
export async function deliverWelcomeFireAndForget(db: Db, input: WelcomeInput): Promise<WelcomeResult> {
  const { webUserId, tenantId } = input;
  if (!webUserId || !tenantId) return { delivered: false, reason: "missing_input" };

  try {
    const now = Math.floor(Date.now() / 1000);

    // 1. Welcome singleton — skip unless the operator has it enabled.
    const camp = (await db.select().from(platformCampaigns).where(eq(platformCampaigns.id, WELCOME_CAMPAIGN_ID)).limit(1))[0];
    if (!camp || camp.status !== "active") return { delivered: false, reason: "inactive" };

    let channels: string[] = [];
    try {
      const arr = JSON.parse(camp.channelsJson ?? "[]");
      if (Array.isArray(arr)) channels = arr.filter((c) => typeof c === "string");
    } catch { /* malformed channels — treat as none */ }
    if (!channels.includes("center")) return { delivered: false, reason: "no_center_channel" };

    // 2. Claim the center delivery — the idempotency gate (once per owner ever).
    const centerClaim = await claimDelivery(db, "center", webUserId, tenantId, now);
    if (!centerClaim) return { delivered: false, reason: "already_welcomed" };

    // 3. Personalize from the tenant + owner rows.
    const tenant = (await db.select({ id: tenants.id, name: tenants.name, plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0] ?? null;
    const recipient = (await db.select({ id: webUsers.id, name: webUsers.name }).from(webUsers).where(eq(webUsers.id, webUserId)).limit(1))[0] ?? null;
    const vars = buildCampaignVars(tenant, recipient);

    let centerTemplate = "";
    try {
      const bj = camp.bodiesJson ? JSON.parse(camp.bodiesJson) : {};
      centerTemplate = (bj && typeof bj === "object" && typeof bj.center === "string" ? bj.center : "") || camp.body || "";
    } catch {
      centerTemplate = camp.body || "";
    }
    const body = renderTemplateVars(centerTemplate, vars);
    if (!body.trim()) {
      await markDelivery(db, centerClaim, "skipped", now);
      return { delivered: false, reason: "empty_body" };
    }

    // 4. Thread + message (mirror deliverCenter).
    const threadId = await ensureThread(db, webUserId, tenantId, now);
    if (!threadId) {
      await markDelivery(db, centerClaim, "failed", now);
      return { delivered: false, reason: "thread_unavailable" };
    }
    const preview = makePreview(body);
    await db.insert(platformThreadMessages).values({
      id: ulid(),
      threadId,
      senderKind: "platform",
      senderWebUserId: "system",
      body,
      attachmentsJson: null,
      broadcastId: `${WELCOME_CAMPAIGN_ID}:${WELCOME_OCCURRENCE}`,
      createdAt: now,
    });
    await db
      .update(platformThreads)
      .set({ lastMessageAt: now, lastMessagePreview: preview, lastSenderKind: "platform", platformLastReadAt: now })
      .where(eq(platformThreads.id, threadId));
    await markDelivery(db, centerClaim, "sent", now);

    // 5. Bell (best-effort) — mirrors the message into the notification center.
    if (channels.includes("bell")) {
      const bellClaim = await claimDelivery(db, "bell", webUserId, tenantId, now);
      if (bellClaim) {
        const r = await notifyWebUser(db, {
          webUserId,
          kind: "platform.campaign",
          title: renderTemplateVars(camp.title || "ManicBot", vars) || "ManicBot",
          body: preview,
          link: "/messages?platform=1",
          tenantId,
          sourceSlug: "platform_campaign",
          sourceId: `${WELCOME_CAMPAIGN_ID}:${WELCOME_OCCURRENCE}`,
        });
        await markDelivery(db, bellClaim, r.ok ? "sent" : "skipped", now);
      }
    }

    return { delivered: true };
  } catch (err) {
    log.error("welcomeOnRegister: delivery failed", err instanceof Error ? err : new Error(String(err)));
    return { delivered: false, reason: "error" };
  }
}

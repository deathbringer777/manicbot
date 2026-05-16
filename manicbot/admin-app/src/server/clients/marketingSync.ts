/**
 * marketingSync — keep `marketing_contacts` deduped & linked to `users`.
 *
 * Every time the salon dashboard creates or updates a client (Clients tab,
 * manual booking, CSV import), we mirror the contact into the shared
 * `marketing_contacts` directory so the marketing module has a single,
 * deduped lead per real person. This is a *contact directory* sync —
 * NOT a marketing opt-in: `consent_email` and `consent_sms` default to
 * 0 on insert. Sends are gated on real opt-in events (booking widget,
 * landing form), tracked separately in `marketing_consent_log`.
 *
 * Lookup priority (within the tenant): email > phone > tg_username > ig_username.
 * The first match wins; we never link to a contact from a different tenant
 * (the new per-tenant UNIQUE in 0062 makes cross-tenant collisions impossible).
 *
 * Storage strategy:
 *   * `email` / `phone` are first-class columns on `marketing_contacts`.
 *   * `tg_username` / `ig_username` are stored in the `custom_fields` JSON
 *     blob — we never grew dedicated columns because the marketing module
 *     itself doesn't send on those channels yet. The blob is updated
 *     additively (existing keys preserved).
 *
 * Returns the resolved `marketing_contacts.id`, or `null` if the user has
 * no usable contact (no email/phone/tg/ig). Callers should write the
 * returned id back to `users.marketing_contact_id`.
 */

import { and, eq, sql } from "drizzle-orm";
import { marketingContacts } from "~/server/db/schema";

export type SyncSource =
  | "salon_clients_manual"
  | "salon_clients_import"
  | "booking_manual"
  | "public_booking";

export interface SyncableClient {
  chatId: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  tgUsername?: string | null;
  igUsername?: string | null;
  tags?: string | null;
  locale?: string | null;
}

// Drizzle DB type intentionally widened to `any` — we only call
// .select/.insert/.update on it, but Drizzle's generic Database type
// is too narrow to feed in directly from the tRPC ctx without leaking
// schema generics into every helper signature. Tests use a structural
// stub that satisfies the same call pattern.
type Db = any;

function normEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  // Keep digits and a leading "+". Marketing dedup matches on the normalized
  // form so "+48 500 152 948" and "+48500152948" collapse to one contact.
  const trimmed = v.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/[^\d+]/g, "");
  return stripped.length >= 4 ? stripped : null;
}

function normHandle(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim().toLowerCase().replace(/^@+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function parseCustomFields(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildCustomFields(
  existing: Record<string, unknown>,
  tg: string | null,
  ig: string | null,
): string | null {
  const next: Record<string, unknown> = { ...existing };
  if (tg) next.tg_username = tg;
  if (ig) next.ig_username = ig;
  if (Object.keys(next).length === 0) return null;
  return JSON.stringify(next);
}

interface ExistingRow {
  id: number;
  email: string | null;
  phone: string | null;
  name: string | null;
  customFields: string | null;
  linkedUserChatId: number | null;
  leadCount: number;
}

async function lookupExisting(
  db: Db,
  tenantId: string,
  email: string | null,
  phone: string | null,
  tg: string | null,
  ig: string | null,
): Promise<ExistingRow | null> {
  const baseTenant = eq(marketingContacts.tenantId, tenantId);

  // 1. email — most authoritative.
  if (email) {
    const rows = await db
      .select({
        id: marketingContacts.id,
        email: marketingContacts.email,
        phone: marketingContacts.phone,
        name: marketingContacts.name,
        customFields: marketingContacts.customFields,
        linkedUserChatId: marketingContacts.linkedUserChatId,
        leadCount: marketingContacts.leadCount,
      })
      .from(marketingContacts)
      .where(and(baseTenant, sql`lower(${marketingContacts.email}) = ${email}`))
      .limit(1);
    if (rows[0]) return rows[0] as ExistingRow;
  }

  // 2. phone — next; we normalized both sides so equality is reliable.
  if (phone) {
    const rows = await db
      .select({
        id: marketingContacts.id,
        email: marketingContacts.email,
        phone: marketingContacts.phone,
        name: marketingContacts.name,
        customFields: marketingContacts.customFields,
        linkedUserChatId: marketingContacts.linkedUserChatId,
        leadCount: marketingContacts.leadCount,
      })
      .from(marketingContacts)
      .where(and(baseTenant, eq(marketingContacts.phone, phone)))
      .limit(1);
    if (rows[0]) return rows[0] as ExistingRow;
  }

  // 3. tg / ig — stored inside custom_fields JSON. We accept a best-effort
  // LIKE match because there's no dedicated column. Keys are lower-cased
  // on write so the substring match is stable.
  if (tg) {
    const needle = `%"tg_username":"${tg}"%`;
    const rows = await db
      .select({
        id: marketingContacts.id,
        email: marketingContacts.email,
        phone: marketingContacts.phone,
        name: marketingContacts.name,
        customFields: marketingContacts.customFields,
        linkedUserChatId: marketingContacts.linkedUserChatId,
        leadCount: marketingContacts.leadCount,
      })
      .from(marketingContacts)
      .where(and(baseTenant, sql`${marketingContacts.customFields} LIKE ${needle}`))
      .limit(1);
    if (rows[0]) return rows[0] as ExistingRow;
  }

  if (ig) {
    const needle = `%"ig_username":"${ig}"%`;
    const rows = await db
      .select({
        id: marketingContacts.id,
        email: marketingContacts.email,
        phone: marketingContacts.phone,
        name: marketingContacts.name,
        customFields: marketingContacts.customFields,
        linkedUserChatId: marketingContacts.linkedUserChatId,
        leadCount: marketingContacts.leadCount,
      })
      .from(marketingContacts)
      .where(and(baseTenant, sql`${marketingContacts.customFields} LIKE ${needle}`))
      .limit(1);
    if (rows[0]) return rows[0] as ExistingRow;
  }

  return null;
}

/**
 * Sync a salon-side client into `marketing_contacts`. Idempotent — safe
 * to call on every create or update. See module docblock for semantics.
 *
 * @returns the resolved `marketing_contacts.id`, or `null` if the client
 *   has no usable contact channel.
 */
export async function syncMarketingContact(
  db: Db,
  tenantId: string,
  client: SyncableClient,
  source: SyncSource,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  const email = normEmail(client.email);
  const phone = normPhone(client.phone);
  const tg = normHandle(client.tgUsername);
  const ig = normHandle(client.igUsername);

  if (!email && !phone && !tg && !ig) return null;

  const existing = await lookupExisting(db, tenantId, email, phone, tg, ig);

  if (existing) {
    // Merge: copy user-side values into the marketing row only when the
    // marketing row is missing that field. Never overwrite an existing
    // marketing value with a user-side one — operators may have curated
    // the marketing row separately.
    const updates: Record<string, unknown> = {
      lastSeenAt: nowSec,
      leadCount: existing.leadCount + 1,
      linkedUserChatId: existing.linkedUserChatId ?? client.chatId,
    };

    if (!existing.email && email) updates.email = email;
    if (!existing.phone && phone) updates.phone = phone;
    if (!existing.name && client.name) updates.name = client.name;

    const newCustom = buildCustomFields(parseCustomFields(existing.customFields), tg, ig);
    if (newCustom !== existing.customFields) updates.customFields = newCustom;

    await db
      .update(marketingContacts)
      .set(updates)
      .where(and(eq(marketingContacts.tenantId, tenantId), eq(marketingContacts.id, existing.id)));

    return existing.id;
  }

  // Insert a fresh contact. Consent defaults to 0/0 — we're just unifying
  // the contact directory, not opting the lead in to marketing sends.
  // The marketing module's `marketing_consent_log` is the authoritative
  // opt-in record; nothing in this helper writes there.
  const customFields = buildCustomFields({}, tg, ig);

  const inserted = await db
    .insert(marketingContacts)
    .values({
      email,
      phone,
      name: client.name ?? null,
      source,
      firstSeenAt: nowSec,
      lastSeenAt: nowSec,
      leadCount: 1,
      unsubscribed: 0,
      tenantId,
      tags: client.tags ?? null,
      customFields,
      consentEmail: 0,
      consentSms: 0,
      locale: client.locale ?? null,
      linkedUserChatId: client.chatId,
    })
    .returning({ id: marketingContacts.id });

  const row = Array.isArray(inserted) ? inserted[0] : null;
  return row?.id ?? null;
}

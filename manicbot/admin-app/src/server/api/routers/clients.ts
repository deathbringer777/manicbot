/**
 * clients router — production CRM surface for the Salon Clients tab.
 *
 * Every procedure is tenantOwnerProcedure-gated and re-asserts ownership
 * via `assertTenantOwner` (defence in depth — the middleware already
 * filters, but a stale ctx would otherwise leak across tenants).
 *
 * Companion modules:
 *   * `~/server/clients/marketingSync.ts` — keeps `marketing_contacts`
 *     deduped and back-linked to every salon client.
 *   * `~/server/clients/csv.ts` — tolerant CSV parser + canonical exporter
 *     for the Import / Export buttons in the tab header.
 *
 * Search:
 *   When `search` is set, the query joins `users_fts` (migration 0062 FTS5
 *   virtual table). Search tokens are lower-cased, non-alphanumeric chars
 *   stripped, and each token suffixed with `*` for prefix-match.
 *
 * Soft delete:
 *   `delete` scrubs PII (name/phone/email/tg/ig/notes/dob → NULL) and
 *   stamps `deleted_at`. The row stays so existing appointment FKs are
 *   preserved; the FTS triggers automatically drop the soft-deleted row
 *   from `users_fts` on the UPDATE that sets `deleted_at`.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and, eq, sql, desc, asc, inArray, isNotNull, isNull, or, gte,
  type SQL,
} from "drizzle-orm";
import {
  createTRPCRouter,
  tenantOwnerProcedure,
} from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  users,
  appointments,
  masters,
  masterClientBlocks,
  marketingContacts,
  marketingSegments,
  marketingSegmentMembers,
} from "~/server/db/schema";
import {
  syncMarketingContact,
  type SyncSource,
} from "~/server/clients/marketingSync";
import { writeAudit, ctxIp } from "~/server/security/audit";
import {
  addContactsToSegment,
  removeContactsFromSegment,
} from "~/server/marketing/segments";
import {
  parseClientsCsv,
  clientsToFormat,
  CLIENT_CSV_TEMPLATE,
  type ParsedClientRow,
  type ExportFormat,
} from "~/server/clients/csv";
import { sanitizeText } from "~/server/security/sanitize";
import { log } from "~/server/utils/logger";

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_IMPORT_ROWS = 5000;
const MAX_CSV_BYTES = 1_000_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
// "Select all matching" upper bound — `listMatchingIds` returns at most this
// many chat_ids for a bulk selection; the UI then chunks mutations into ≤500
// batches. Mirrors the 5000 marketing-audience ceiling so the platform's
// big-operation limit stays consistent.
const MAX_SELECT_ALL = 5000;

// ─── Input schemas ───────────────────────────────────────────────────────────
const dobSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const contactsSchema = z.object({
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(256).email().nullable().optional().or(z.literal("")),
  tgUsername: z.string().max(64).nullable().optional(),
  igUsername: z.string().max(64).nullable().optional(),
});

// 0072 avatar fields. Emoji is short (we cap at 20 to leave room for ZWJ
// sequences like 👩‍🎤); avatarUrl must be an https URL pointing at our own
// `/cdn/t/<tenantId>/client_avatar-<hash>.<ext>` path (minted via
// salon.mintUploadToken + uploadHttp.buildAssetKey). The path shape is
// deterministic across envs; the hostname is not, so we lock the path and
// reject anything that smells like an external/tracking URL.
const AVATAR_URL_PATH_RE =
  /^https:\/\/[^/]+\/cdn\/t\/[A-Za-z0-9_-]+\/client_avatar-[a-f0-9]{6,64}\.(?:webp|jpg|jpeg|png)$/i;
const avatarEmojiSchema = z.string().min(1).max(20).nullable().optional();
const avatarUrlSchema = z
  .string()
  .max(2048)
  .refine((v) => AVATAR_URL_PATH_RE.test(v), {
    message:
      "avatarUrl must be an https URL minted by salon.mintUploadToken (path: /cdn/t/<tenantId>/client_avatar-<hash>.<ext>)",
  })
  .nullable()
  .optional();

// 0074: nullable pointer to a master's chat_id. We DO NOT pin the FK to
// `masters.chatId` at the SQL level — masters get archived (origin
// 'salon_created' → archived_at) without us forcing a NULL cascade on
// every client that picked them. Stale pointers are filtered at read
// time in `getFavoriteMasterSuggestion`.
const favoriteMasterIdSchema = z.number().int().nullable().optional();

const filterSchema = z.object({
  hasPhone: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  hasTg: z.boolean().optional(),
  hasIg: z.boolean().optional(),
  blocked: z.boolean().optional(),
  tagsAny: z.array(z.string()).max(20).optional(),
});

const sortSchema = z.enum(["recent", "name", "visits"]).optional();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Make a synthetic negative chat_id for manually-created clients. */
function syntheticChatId(): number {
  // Match the legacy convention used by `appointments.createManual`. The
  // negative range avoids collision with real Telegram chat IDs (always
  // positive in private chats).
  return -Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 1000);
}

/**
 * Translate user search input into an FTS5 MATCH expression.
 * Strips special FTS5 chars, lowercases, and adds prefix-* to each token.
 */
function buildFtsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s]+/gu, " ")
    .replace(/[@.]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}

/**
 * Shared filter conditions for the client list — tenant scope + soft-delete
 * exclusion + FTS search + channel/blocked filters + tag LIKEs. Used by
 * `list`, `listMatchingIds`, and the filtered `exportCsv` path so the three
 * cannot drift. The `listId` membership restriction is layered on by the
 * caller (it needs an ownership verify + a DB read — see `assertSegmentOwned`).
 */
function buildClientFilterConditions(
  tenantId: string,
  opts: { search?: string; filters?: z.infer<typeof filterSchema> },
): SQL[] {
  const conditions: SQL[] = [
    eq(users.tenantId, tenantId),
    isNull(users.deletedAt),
  ];

  // Search via FTS5 — joinless EXISTS so we don't bloat the SELECT shape.
  const ftsQuery = opts.search ? buildFtsQuery(opts.search) : "";
  if (ftsQuery) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM users_fts
      WHERE users_fts.tenant_id = ${tenantId}
        AND users_fts.chat_id = ${users.chatId}
        AND users_fts MATCH ${ftsQuery}
    )`);
  }

  const f = opts.filters ?? {};
  if (f.hasPhone) conditions.push(isNotNull(users.phone));
  if (f.hasEmail) conditions.push(isNotNull(users.email));
  if (f.hasTg)    conditions.push(isNotNull(users.tgUsername));
  if (f.hasIg)    conditions.push(isNotNull(users.igUsername));
  if (f.blocked === true)  conditions.push(eq(users.isBlockedGlobal, 1));
  if (f.blocked === false) conditions.push(eq(users.isBlockedGlobal, 0));
  if (f.tagsAny && f.tagsAny.length > 0) {
    // Best-effort LIKE per tag. Tags are stored as a CSV string in
    // `users.tags`; we wrap with separators on both sides via a virtual
    // ','||tags||',' search so "vip" doesn't match "vipless".
    const padded = sql`',' || coalesce(${users.tags},'') || ','`;
    const tagOr = f.tagsAny.map((tag) => {
      const needle = `%,${tag.toLowerCase().trim()},%`;
      return sql`lower(${padded}) LIKE ${needle}`;
    });
    conditions.push(or(...tagOr)!);
  }

  return conditions;
}

/**
 * Verify a manual segment (list) belongs to `tenantId`. Throws NOT_FOUND when
 * the segment doesn't exist and FORBIDDEN when it belongs to another tenant —
 * the contract shared by every list-scoped read (`list`, `listMatchingIds`).
 */
async function assertSegmentOwned(
  ctx: any,
  tenantId: string,
  listId: string,
): Promise<void> {
  const seg = await ctx.db
    .select({ tenantId: marketingSegments.tenantId })
    // tenant-scan-ignore: ownership IS the check — fetch by id, then throw FORBIDDEN on tenant mismatch below.
    .from(marketingSegments)
    .where(eq(marketingSegments.id, listId))
    .limit(1);
  if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
  if (seg[0].tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "List belongs to a different tenant" });
  }
}

interface ClientRow {
  tenantId: string;
  chatId: number;
  name: string | null;
  tgUsername: string | null;
  phone: string | null;
  email: string | null;
  igUsername: string | null;
  tags: string | null;
  notes: string | null;
  dob: string | null;
  isBlockedGlobal: number;
  blockedGlobalReason: string | null;
  marketingContactId: number | null;
  // 0114: chat email-capture opt-in state (NULL=unasked, 1=subscribed, 0=opted out).
  // Lets the clients UI flag who joined the list via chat. select() already
  // returns it; this types it for consumers.
  emailOptIn: number | null;
  lifetimeVisits: number;
  lastVisitAt: number | null;
  registeredAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  avatarR2Key: string | null;
  favoriteMasterId: number | null;
}

// ─── Router ──────────────────────────────────────────────────────────────────
export const clientsRouter = createTRPCRouter({
  /**
   * Paginated, searchable, filterable client list.
   * Returns `{ rows, nextOffset, total }`.
   */
  list: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      search: z.string().max(120).optional(),
      filters: filterSchema.optional(),
      sort: sortSchema,
      // Shared "Lists": when set, restrict to clients whose linked marketing
      // contact is a member of this manual segment (marketing_segments).
      listId: z.string().optional(),
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      const offset = input.offset ?? 0;
      const sort = input.sort ?? "recent";

      const conditions = buildClientFilterConditions(input.tenantId, {
        search: input.search,
        filters: input.filters,
      });

      // Shared "Lists" filter — only clients whose linked marketing contact
      // is a member of this manual segment. Verify ownership first (FORBIDDEN
      // on a crafted foreign id), then correlate on users.marketing_contact_id.
      // Clients with no linked contact are naturally excluded (id is NULL).
      if (input.listId) {
        await assertSegmentOwned(ctx, input.tenantId, input.listId);
        conditions.push(sql`EXISTS (
          SELECT 1 FROM marketing_segment_members msm
          WHERE msm.segment_id = ${input.listId}
            AND msm.contact_id = ${users.marketingContactId}
        )`);
      }

      const whereClause = and(...conditions);

      // Sort selector. NULLS-last on lastVisitAt DESC is automatic in SQLite
      // (NULL ranks below non-null in DESC order).
      const orderBy =
        sort === "name"
          ? asc(sql`lower(coalesce(${users.name},''))`)
          : sort === "visits"
            ? desc(users.lifetimeVisits)
            : desc(users.lastVisitAt);

      const [rows, countRow] = await Promise.all([
        ctx.db
          .select()
          .from(users)
          // tenant-scoped: whereClause always leads with eq(users.tenantId, input.tenantId)
          .where(whereClause)
          .orderBy(orderBy, desc(users.chatId))
          .limit(limit)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          // tenant-scoped: whereClause always leads with eq(users.tenantId, input.tenantId)
          .where(whereClause),
      ]);

      const total = countRow[0]?.count ?? 0;
      const nextOffset = offset + rows.length < total ? offset + rows.length : null;

      return { rows: rows as ClientRow[], nextOffset, total };
    }),

  /**
   * Return the chat_ids of EVERY client matching the current filter/search/
   * list scope — powers the Clients-tab "select all N matching" affordance,
   * which spans the whole result set rather than the loaded page. Shares the
   * exact filter builder with `list` so the selected set matches the visible
   * set. Capped at MAX_SELECT_ALL; `capped` flags when the true match set is
   * larger so the UI can warn the owner.
   */
  listMatchingIds: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      search: z.string().max(120).optional(),
      filters: filterSchema.optional(),
      listId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const conditions = buildClientFilterConditions(input.tenantId, {
        search: input.search,
        filters: input.filters,
      });
      if (input.listId) {
        await assertSegmentOwned(ctx, input.tenantId, input.listId);
        conditions.push(sql`EXISTS (
          SELECT 1 FROM marketing_segment_members msm
          WHERE msm.segment_id = ${input.listId}
            AND msm.contact_id = ${users.marketingContactId}
        )`);
      }

      const rows = await ctx.db
        .select({ chatId: users.chatId })
        .from(users)
        // tenant-scoped: buildClientFilterConditions always leads with eq(users.tenantId, input.tenantId)
        .where(and(...conditions))
        .limit(MAX_SELECT_ALL);

      return {
        chatIds: (rows as Array<{ chatId: number }>).map((r) => r.chatId),
        capped: rows.length === MAX_SELECT_ALL,
      };
    }),

  /**
   * Add salon clients to a shared manual list (marketing_segments kind='manual').
   *
   * Lists are the SAME entity used by the Marketing module — this is the
   * Clients-tab entry point. Each client is bridged to the shared contact
   * directory: we resolve `users.marketing_contact_id`, lazily creating the
   * contact via `syncMarketingContact` when missing (and writing the id back).
   * A client with no usable channel (email/phone/tg/ig) can't be represented
   * as a contact, so it's skipped — surfaced via the `skipped` count.
   * Membership insert + dedup + denormalized recount are delegated to the
   * shared `addContactsToSegment` helper.
   */
  addToList: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatIds: z.array(z.number().int()).min(1).max(500),
      listId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Verify the list belongs to the caller's tenant before any write.
      const seg = await ctx.db
        .select({ tenantId: marketingSegments.tenantId })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.listId))
        .limit(1);
      if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (seg[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "List belongs to a different tenant" });
      }

      const chatIds = Array.from(new Set(input.chatIds));
      const rows = await ctx.db
        .select({
          chatId: users.chatId,
          name: users.name,
          phone: users.phone,
          email: users.email,
          tgUsername: users.tgUsername,
          igUsername: users.igUsername,
          tags: users.tags,
          marketingContactId: users.marketingContactId,
        })
        .from(users)
        .where(and(
          eq(users.tenantId, input.tenantId),
          inArray(users.chatId, chatIds),
          isNull(users.deletedAt),
        ));

      const now = nowSec();
      const contactIds: number[] = [];
      let synced = 0;
      for (const r of rows) {
        let contactId = r.marketingContactId;
        if (contactId == null) {
          // Lazily mirror the client into the shared marketing directory.
          const newId = await syncMarketingContact(
            ctx.db,
            input.tenantId,
            {
              chatId: r.chatId,
              name: r.name,
              phone: r.phone,
              email: r.email,
              tgUsername: r.tgUsername,
              igUsername: r.igUsername,
              tags: r.tags,
            },
            "salon_clients_manual",
            now,
          );
          if (newId == null) continue; // no usable channel — cannot be listed
          await ctx.db
            .update(users)
            .set({ marketingContactId: newId, updatedAt: now })
            .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, r.chatId)));
          contactId = newId;
          synced++;
        }
        contactIds.push(contactId);
      }

      const added = contactIds.length
        ? (await addContactsToSegment(ctx.db, input.tenantId, input.listId, contactIds, now)).added
        : 0;

      return { added, synced, skipped: chatIds.length - added };
    }),

  /**
   * Remove salon clients from a shared manual list. Resolves each client's
   * `marketing_contact_id` (unlinked clients can't be members, so they're
   * dropped) and delegates the delete + recount to the shared helper.
   */
  removeFromList: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatIds: z.array(z.number().int()).min(1).max(500),
      listId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const seg = await ctx.db
        .select({ tenantId: marketingSegments.tenantId })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.listId))
        .limit(1);
      if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (seg[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "List belongs to a different tenant" });
      }

      const chatIds = Array.from(new Set(input.chatIds));
      const rows = await ctx.db
        .select({ marketingContactId: users.marketingContactId })
        .from(users)
        .where(and(
          eq(users.tenantId, input.tenantId),
          inArray(users.chatId, chatIds),
        ));
      const contactIds = rows
        .map((r) => r.marketingContactId)
        .filter((id): id is number => id != null);

      if (contactIds.length === 0) return { ok: true };
      return removeContactsFromSegment(ctx.db, input.tenantId, input.listId, contactIds, nowSec());
    }),

  /**
   * Full client detail: profile + recent appointments + per-master blocks.
   */
  get: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [clientRow] = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)))
        .limit(1);
      if (!clientRow) throw new TRPCError({ code: "NOT_FOUND" });

      const [history, blocks] = await Promise.all([
        ctx.db
          .select({
            id: appointments.id,
            date: appointments.date,
            time: appointments.time,
            ts: appointments.ts,
            status: appointments.status,
            cancelled: appointments.cancelled,
            noShow: appointments.noShow,
            masterId: appointments.masterId,
            svcId: appointments.svcId,
          })
          .from(appointments)
          .where(and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.chatId, input.chatId),
          ))
          .orderBy(desc(appointments.ts))
          .limit(50),
        ctx.db
          .select({
            id: masterClientBlocks.id,
            masterChatId: masterClientBlocks.masterChatId,
            reason: masterClientBlocks.reason,
            blockedAt: masterClientBlocks.blockedAt,
            masterName: masters.name,
          })
          .from(masterClientBlocks)
          .leftJoin(masters, and(
            eq(masters.tenantId, masterClientBlocks.tenantId),
            eq(masters.chatId, masterClientBlocks.masterChatId),
          ))
          .where(and(
            eq(masterClientBlocks.tenantId, input.tenantId),
            eq(masterClientBlocks.clientChatId, input.chatId),
          )),
      ]);

      return { client: clientRow as ClientRow, history, blocks };
    }),

  /**
   * Create a manual client + sync to marketing_contacts.
   */
  create: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().min(1).max(200),
      contacts: contactsSchema,
      tags: z.string().max(500).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      dob: dobSchema,
      avatarEmoji: avatarEmojiSchema,
      avatarUrl: avatarUrlSchema,
      favoriteMasterId: favoriteMasterIdSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const c = input.contacts;
      const hasContact = !!(c.phone || c.email || c.tgUsername || c.igUsername);
      if (!hasContact) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "at_least_one_contact_required" });
      }

      const now = nowSec();
      const chatId = syntheticChatId();

      // Sanitize free-text fields.
      const safeName = sanitizeText(input.name, 200);
      const safeNotes = input.notes ? sanitizeText(input.notes, 2000) : null;
      const safeTags = input.tags ? sanitizeText(input.tags, 500) : null;

      // Validate favoriteMasterId belongs to this tenant (skip on null /
      // missing). The check costs one indexed lookup and gives us a clean
      // 400 instead of letting a typo'd id silently land in the DB and
      // surface as a dead suggestion later.
      const favoriteMasterId = await resolveFavoriteMasterId(
        ctx.db, input.tenantId, input.favoriteMasterId ?? null,
      );

      await ctx.db.insert(users).values({
        tenantId: input.tenantId,
        chatId,
        name: safeName,
        phone: c.phone || null,
        email: c.email && c.email !== "" ? c.email.toLowerCase() : null,
        tgUsername: c.tgUsername ? c.tgUsername.replace(/^@+/, "") : null,
        igUsername: c.igUsername ? c.igUsername.replace(/^@+/, "") : null,
        tags: safeTags,
        notes: safeNotes,
        dob: input.dob ?? null,
        avatarEmoji: input.avatarEmoji ?? null,
        avatarUrl: input.avatarUrl ?? null,
        favoriteMasterId,
        registeredAt: now,
        updatedAt: now,
        firstSource: "salon_dashboard_manual",
      });

      const marketingContactId = await syncMarketingContact(
        ctx.db,
        input.tenantId,
        {
          chatId,
          name: safeName,
          phone: c.phone || null,
          email: c.email && c.email !== "" ? c.email.toLowerCase() : null,
          tgUsername: c.tgUsername ? c.tgUsername.replace(/^@+/, "") : null,
          igUsername: c.igUsername ? c.igUsername.replace(/^@+/, "") : null,
          tags: safeTags,
        },
        "salon_clients_manual",
        now,
      );

      if (marketingContactId) {
        await ctx.db
          .update(users)
          .set({ marketingContactId })
          .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, chatId)));
      }

      return { chatId, marketingContactId };
    }),

  /**
   * Partial update — any subset of {name, contacts, tags, notes, dob}.
   * Re-syncs marketing on every change so the directory stays current.
   */
  update: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number().int(),
      patch: z.object({
        name: z.string().min(1).max(200).optional(),
        phone: z.string().max(64).nullable().optional(),
        email: z.union([z.string().email(), z.literal("")]).nullable().optional(),
        tgUsername: z.string().max(64).nullable().optional(),
        igUsername: z.string().max(64).nullable().optional(),
        tags: z.string().max(500).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        dob: dobSchema,
        avatarEmoji: avatarEmojiSchema,
        avatarUrl: avatarUrlSchema,
        favoriteMasterId: favoriteMasterIdSchema,
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [existing] = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const now = nowSec();
      const p = input.patch;

      const updates: Record<string, unknown> = { updatedAt: now };
      if (p.name !== undefined) updates.name = sanitizeText(p.name, 200);
      if (p.phone !== undefined) updates.phone = p.phone || null;
      if (p.email !== undefined) {
        updates.email = p.email && p.email !== "" ? p.email.toLowerCase() : null;
      }
      if (p.tgUsername !== undefined) {
        updates.tgUsername = p.tgUsername ? p.tgUsername.replace(/^@+/, "") : null;
      }
      if (p.igUsername !== undefined) {
        updates.igUsername = p.igUsername ? p.igUsername.replace(/^@+/, "") : null;
      }
      if (p.tags !== undefined) updates.tags = p.tags ? sanitizeText(p.tags, 500) : null;
      if (p.notes !== undefined) updates.notes = p.notes ? sanitizeText(p.notes, 2000) : null;
      if (p.dob !== undefined) updates.dob = p.dob ?? null;
      // Avatar: picking either field clears the other (the picker enforces
      // this on the client too; we re-enforce here so direct API callers
      // can't store both at once).
      if (p.avatarEmoji !== undefined) {
        updates.avatarEmoji = p.avatarEmoji;
        if (p.avatarEmoji) updates.avatarUrl = null;
      }
      if (p.avatarUrl !== undefined) {
        updates.avatarUrl = p.avatarUrl;
        if (p.avatarUrl) updates.avatarEmoji = null;
      }
      // 0074: validate before assigning so a stale id can't silently
      // overwrite a valid pin with NULL on the live PATCH.
      if (p.favoriteMasterId !== undefined) {
        updates.favoriteMasterId = await resolveFavoriteMasterId(
          ctx.db, input.tenantId, p.favoriteMasterId,
        );
      }

      await ctx.db
        .update(users)
        .set(updates)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)));

      // Re-sync marketing — merge updated fields into the linked row.
      const merged = { ...existing, ...updates };
      const marketingContactId = await syncMarketingContact(
        ctx.db,
        input.tenantId,
        {
          chatId: input.chatId,
          name: (merged.name as string) ?? null,
          phone: (merged.phone as string) ?? null,
          email: (merged.email as string) ?? null,
          tgUsername: (merged.tgUsername as string) ?? null,
          igUsername: (merged.igUsername as string) ?? null,
          tags: (merged.tags as string) ?? null,
        },
        "salon_clients_manual",
        now,
      );

      if (marketingContactId && marketingContactId !== existing.marketingContactId) {
        await ctx.db
          .update(users)
          .set({ marketingContactId })
          .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)));
      }

      return { ok: true };
    }),

  /**
   * Soft-delete + PII scrub. Keeps the row to preserve appointment FKs.
   * FTS triggers automatically drop the soft-deleted row from `users_fts`.
   */
  delete: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      await ctx.db
        .update(users)
        .set({
          name: null,
          phone: null,
          email: null,
          tgUsername: null,
          igUsername: null,
          notes: null,
          tags: null,
          dob: null,
          deletedAt: now,
          updatedAt: now,
        })
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)));
      // #D-2 — GDPR erasure must also scrub the PII copy held in the linked
      // marketing_contacts row (otherwise name/email/phone stay queryable in
      // marketing audiences + CSV exports). Tenant-scoped via
      // (tenantId, linkedUserChatId); keep the row for lead stats but null the
      // PII and unsubscribe (a deleted client must not be contacted).
      await ctx.db
        .update(marketingContacts)
        .set({ name: null, email: null, phone: null, unsubscribed: 1 })
        .where(and(
          eq(marketingContacts.tenantId, input.tenantId),
          eq(marketingContacts.linkedUserChatId, input.chatId),
        ));
      // #D-3 — audit the destructive PII operation.
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "clients.delete",
        tenantId: input.tenantId,
        detail: JSON.stringify({ chatId: input.chatId }),
        ip: ctxIp(ctx),
      });
      return { ok: true };
    }),

  /**
   * Toggle tenant-wide block (owner / system_admin authority).
   * Hides the client from every master's booking flow and from the
   * public widget — enforced downstream in `appointments.createManual`
   * and `publicSalon.book*` procedures.
   */
  setGlobalBlock: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number().int(),
      blocked: z.boolean(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      await ctx.db
        .update(users)
        .set({
          isBlockedGlobal: input.blocked ? 1 : 0,
          blockedGlobalReason: input.blocked ? (input.reason ? sanitizeText(input.reason, 500) : null) : null,
          blockedGlobalAt: input.blocked ? now : null,
          updatedAt: now,
        })
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)));
      // #D-3 — audit the tenant-wide block toggle.
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: input.blocked ? "clients.block" : "clients.unblock",
        tenantId: input.tenantId,
        detail: JSON.stringify({ chatId: input.chatId, blocked: input.blocked }),
        ip: ctxIp(ctx),
      });
      return { ok: true };
    }),

  /**
   * Bulk soft-delete + PII scrub for the Clients-tab selection. Set-based
   * (single UPDATE via inArray) mirror of `delete`: scrubs users PII + stamps
   * deleted_at, scrubs the linked marketing_contacts PII + unsubscribes, and
   * writes ONE summary audit row for the whole batch (not one per client).
   * Capped at 500 ids/call — the UI chunks larger selections.
   */
  bulkDelete: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatIds: z.array(z.number().int()).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      const chatIds = Array.from(new Set(input.chatIds));

      await ctx.db
        .update(users)
        .set({
          name: null, phone: null, email: null, tgUsername: null,
          igUsername: null, notes: null, tags: null, dob: null,
          deletedAt: now, updatedAt: now,
        })
        .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, chatIds)));

      // #D-2 — GDPR erasure also scrubs the PII copy in linked marketing_contacts.
      await ctx.db
        .update(marketingContacts)
        .set({ name: null, email: null, phone: null, unsubscribed: 1 })
        .where(and(
          eq(marketingContacts.tenantId, input.tenantId),
          inArray(marketingContacts.linkedUserChatId, chatIds),
        ));

      // #D-3 — one summary audit row for the batch (cap the id list in detail).
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "clients.bulkDelete",
        tenantId: input.tenantId,
        detail: JSON.stringify({ count: chatIds.length, chatIds: chatIds.slice(0, 100) }),
        ip: ctxIp(ctx),
      });
      return { ok: true, deleted: chatIds.length };
    }),

  /**
   * Bulk tenant-wide block / unblock for the Clients-tab selection. Set-based
   * mirror of `setGlobalBlock` with ONE summary audit row. Capped at 500.
   */
  bulkSetGlobalBlock: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatIds: z.array(z.number().int()).min(1).max(500),
      blocked: z.boolean(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      const chatIds = Array.from(new Set(input.chatIds));

      await ctx.db
        .update(users)
        .set({
          isBlockedGlobal: input.blocked ? 1 : 0,
          blockedGlobalReason: input.blocked ? (input.reason ? sanitizeText(input.reason, 500) : null) : null,
          blockedGlobalAt: input.blocked ? now : null,
          updatedAt: now,
        })
        .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, chatIds)));

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: input.blocked ? "clients.bulkBlock" : "clients.bulkUnblock",
        tenantId: input.tenantId,
        detail: JSON.stringify({ count: chatIds.length, blocked: input.blocked }),
        ip: ctxIp(ctx),
      });
      return { ok: true, updated: chatIds.length };
    }),

  /**
   * Export the (filtered) client list as CSV. Re-uses the canonical
   * header from `~/server/clients/csv.ts` so import and export stay in
   * lockstep.
   */
  exportCsv: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      filters: filterSchema.optional(),
      // "Export selected": exact ticked set from the bulk toolbar. When present,
      // overrides `filters` (we export precisely these rows). Capped to match
      // the select-all ceiling.
      chatIds: z.array(z.number().int()).max(MAX_SELECT_ALL).optional(),
      // 0072: format dispatch. Default "manicbot" preserves the legacy
      // contract (existing callers don't pass `format` and still get our
      // canonical CSV). "google" emits Google Contacts CSV, "apple" emits
      // a multi-card vCard 3.0 file with `.vcf` extension.
      format: z.enum(["manicbot", "google", "apple"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // "Export selected" passes explicit chatIds (the exact ticked set);
      // otherwise export the current filtered set. Both lead with the tenant
      // predicate (conditions[0]) so tenant isolation holds either way.
      const conditions = input.chatIds && input.chatIds.length > 0
        ? [
            eq(users.tenantId, input.tenantId),
            isNull(users.deletedAt),
            inArray(users.chatId, Array.from(new Set(input.chatIds))),
          ]
        : buildClientFilterConditions(input.tenantId, { filters: input.filters });

      const rows = await ctx.db
        .select()
        .from(users)
        // tenant-isolation: conditions[0] pins eq(users.tenantId, input.tenantId).
        .where(and(...conditions))
        .orderBy(desc(users.lastVisitAt))
        .limit(10_000);

      const format: ExportFormat = input.format ?? "manicbot";
      const artifact = clientsToFormat(
        (rows as ClientRow[]).map((r) => ({
          name: r.name,
          phone: r.phone,
          email: r.email,
          tgUsername: r.tgUsername,
          igUsername: r.igUsername,
          tags: r.tags,
          notes: r.notes,
          dob: r.dob,
          lifetimeVisits: r.lifetimeVisits,
          lastVisitAt: r.lastVisitAt,
        })),
        format,
      );

      const stamp = new Date().toISOString().slice(0, 10);
      const suffix =
        format === "google" ? "_google" : format === "apple" ? "_apple" : "";
      return {
        data: artifact.data,
        mime: artifact.mime,
        filename: `clients_${input.tenantId}_${stamp}${suffix}.${artifact.extension}`,
      };
    }),

  /**
   * Import a CSV blob. Upserts by priority (email > phone > tg > ig) and
   * syncs each row to marketing. Returns a per-row summary.
   *
   * `dryRun=true` only parses and validates — no writes. Used by the
   * import modal preview.
   */
  importCsv: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      csv: z.string().max(MAX_CSV_BYTES),
      dryRun: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const parsed = parseClientsCsv(input.csv);
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `too_many_rows (max ${MAX_IMPORT_ROWS})`,
        });
      }

      const skipped: Array<{ row: number; reason: string }> = [...parsed.errors];

      if (input.dryRun) {
        return {
          created: 0,
          updated: 0,
          skipped,
          preview: parsed.rows.slice(0, 10),
          total: parsed.rows.length,
        };
      }

      let created = 0;
      let updated = 0;
      const now = nowSec();

      // ── Batch pre-lookup (fix #4 P1) ──────────────────────────────────────
      // Old: findClientByPriority called per row → up to 4 SELECTs × N rows.
      // Fix: collect all unique emails/phones/tg/ig across the whole batch,
      //      issue 4 IN-queries once, build an in-memory lookup map, then
      //      match each row in O(1). Total SELECTs: 4 regardless of batch size.
      const allEmails = [...new Set(parsed.rows.map((r) => r.email).filter(Boolean) as string[])];
      const allPhones = [...new Set(parsed.rows.map((r) => r.phone).filter(Boolean) as string[])];
      const allTg = [...new Set(parsed.rows.map((r) => r.tgUsername).filter(Boolean) as string[])];
      const allIg = [...new Set(parsed.rows.map((r) => r.igUsername).filter(Boolean) as string[])];
      const notDeleted = isNull(users.deletedAt);

      // Four IN-queries — one per priority channel. We always issue all four so
      // the SELECT count is deterministic (tests rely on this).
      const [byEmail, byPhone, byTg, byIg] = await Promise.all([
        allEmails.length
          ? ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, inArray(users.email, allEmails)))
          : ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, isNull(users.email), sql`1=0`)),
        allPhones.length
          ? ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, inArray(users.phone, allPhones)))
          : ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, isNull(users.phone), sql`1=0`)),
        allTg.length
          ? ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, inArray(users.tgUsername, allTg)))
          : ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, isNull(users.tgUsername), sql`1=0`)),
        allIg.length
          ? ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, inArray(users.igUsername, allIg)))
          : ctx.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), notDeleted, isNull(users.igUsername), sql`1=0`)),
      ]);

      // Build priority-ordered lookup maps: email → user, phone → user, etc.
      const emailMap = new Map<string, ClientRow>(
        (byEmail as ClientRow[]).filter((r) => r.email).map((r) => [r.email!, r]),
      );
      const phoneMap = new Map<string, ClientRow>(
        (byPhone as ClientRow[]).filter((r) => r.phone).map((r) => [r.phone!, r]),
      );
      const tgMap = new Map<string, ClientRow>(
        (byTg as ClientRow[]).filter((r) => r.tgUsername).map((r) => [r.tgUsername!, r]),
      );
      const igMap = new Map<string, ClientRow>(
        (byIg as ClientRow[]).filter((r) => r.igUsername).map((r) => [r.igUsername!, r]),
      );

      /** Resolve existing client using priority: email > phone > tg > ig (O(1) per row). */
      function findExistingInMaps(row: ParsedClientRow): ClientRow | null {
        if (row.email) { const r = emailMap.get(row.email); if (r) return r; }
        if (row.phone) { const r = phoneMap.get(row.phone); if (r) return r; }
        if (row.tgUsername) { const r = tgMap.get(row.tgUsername); if (r) return r; }
        if (row.igUsername) { const r = igMap.get(row.igUsername); if (r) return r; }
        return null;
      }

      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i]!;
        try {
          const existing = findExistingInMaps(row);
          if (existing) {
            const updates = mergeRowIntoUser(existing as ClientRow, row, now);
            if (Object.keys(updates).length > 1) {
              // > 1 because updatedAt is always present
              await ctx.db
                .update(users)
                .set(updates)
                .where(and(
                  eq(users.tenantId, input.tenantId),
                  eq(users.chatId, existing.chatId),
                ));
              updated++;
            }
            await syncMarketingContact(
              ctx.db, input.tenantId,
              {
                chatId: existing.chatId,
                name: (updates.name as string) ?? existing.name,
                phone: (updates.phone as string) ?? existing.phone,
                email: (updates.email as string) ?? existing.email,
                tgUsername: (updates.tgUsername as string) ?? existing.tgUsername,
                igUsername: (updates.igUsername as string) ?? existing.igUsername,
                tags: (updates.tags as string) ?? existing.tags,
              },
              "salon_clients_import",
              now,
            );
          } else {
            const chatId = syntheticChatId() - i; // -i guarantees within-batch uniqueness
            await ctx.db.insert(users).values({
              tenantId: input.tenantId,
              chatId,
              name: row.name ?? null,
              phone: row.phone,
              email: row.email,
              tgUsername: row.tgUsername,
              igUsername: row.igUsername,
              tags: row.tags,
              notes: row.notes,
              dob: row.dob,
              registeredAt: now,
              updatedAt: now,
              firstSource: "salon_clients_import",
            });
            const mcid = await syncMarketingContact(
              ctx.db, input.tenantId,
              {
                chatId,
                name: row.name ?? null,
                phone: row.phone,
                email: row.email,
                tgUsername: row.tgUsername,
                igUsername: row.igUsername,
                tags: row.tags,
              },
              "salon_clients_import",
              now,
            );
            if (mcid) {
              await ctx.db
                .update(users)
                .set({ marketingContactId: mcid })
                .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, chatId)));
            }
            created++;
          }
        } catch (e) {
          log.error("clients.importCsv.row", e instanceof Error ? e : new Error(String(e)));
          skipped.push({
            row: i + 1,
            reason: (e instanceof Error ? e.message : String(e)).slice(0, 200),
          });
        }
      }

      return {
        created,
        updated,
        skipped,
        preview: parsed.rows.slice(0, 10),
        total: parsed.rows.length,
      };
    }),

  /**
   * Return the canonical CSV template — used by the "Download template"
   * link in the import modal.
   */
  csvTemplate: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return { data: CLIENT_CSV_TEMPLATE, filename: "clients_template.csv" };
    }),

  /**
   * Return the manual-list memberships for a single client.
   *
   * Returns `{ marketingContactId, segmentIds }`:
   *   * `marketingContactId` — needed by the modal so it can call
   *     `marketingTenant.segmentAddContacts/segmentRemoveContacts` with
   *     the canonical contact id (not the chat id).
   *   * `segmentIds` — the manual segments the client is currently in.
   *
   * The query is scoped via the parent client row's tenantId; sysadmin /
   * tenant_owner gates are enforced by `assertTenantOwner`.
   */
  getListMemberships: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [clientRow] = await ctx.db
        .select({ marketingContactId: users.marketingContactId })
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)))
        .limit(1);
      if (!clientRow) throw new TRPCError({ code: "NOT_FOUND" });

      if (!clientRow.marketingContactId) {
        return { marketingContactId: null, segmentIds: [] as string[] };
      }

      // INNER JOIN segments so the WHERE can pin tenant_id at the segment
      // level — member rows have no tenant column themselves.
      const rows = await ctx.db
        .select({ segmentId: marketingSegmentMembers.segmentId })
        .from(marketingSegmentMembers)
        .innerJoin(marketingSegments, eq(marketingSegments.id, marketingSegmentMembers.segmentId))
        .where(and(
          eq(marketingSegmentMembers.contactId, clientRow.marketingContactId),
          eq(marketingSegments.tenantId, input.tenantId),
        ));

      return {
        marketingContactId: clientRow.marketingContactId,
        segmentIds: rows.map((r) => r.segmentId),
      };
    }),

  /**
   * Replace the client's manual-list memberships with `segmentIds`.
   *
   * Computes the diff against current membership and issues per-segment
   * INSERT OR IGNORE / DELETE calls. Used by the Edit-client modal where
   * the user toggles list chips and presses Save once; the modal calls
   * this AFTER `clients.update` finishes so the marketingContactId is
   * guaranteed to exist.
   */
  setListMemberships: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number().int(),
      segmentIds: z.array(z.string()).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [clientRow] = await ctx.db
        .select({ marketingContactId: users.marketingContactId })
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)))
        .limit(1);
      if (!clientRow) throw new TRPCError({ code: "NOT_FOUND" });
      const mcid = clientRow.marketingContactId;
      if (!mcid) {
        // Client has no marketing-directory row yet — the marketingSync
        // helper only seeds one when the client has an actual contact
        // channel. Refuse loudly so the UI can surface the reason.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "client_has_no_marketing_contact",
        });
      }

      // Validate every supplied segment belongs to this tenant + is a
      // manual list. We silently drop anything else (filter-based segments
      // are NOT user-managed memberships).
      const allowed = await ctx.db
        .select({ id: marketingSegments.id, kind: marketingSegments.kind })
        .from(marketingSegments)
        .where(eq(marketingSegments.tenantId, input.tenantId));
      const manualIds = new Set(allowed.filter((s) => s.kind === "manual").map((s) => s.id));
      const target = new Set(input.segmentIds.filter((id) => manualIds.has(id)));

      const current = await ctx.db
        .select({ segmentId: marketingSegmentMembers.segmentId })
        .from(marketingSegmentMembers)
        .innerJoin(marketingSegments, eq(marketingSegments.id, marketingSegmentMembers.segmentId))
        .where(and(
          eq(marketingSegmentMembers.contactId, mcid),
          eq(marketingSegments.tenantId, input.tenantId),
          eq(marketingSegments.kind, "manual"),
        ));
      const currentIds = new Set(current.map((r) => r.segmentId));

      const toAdd = Array.from(target).filter((id) => !currentIds.has(id));
      const toRemove = Array.from(currentIds).filter((id) => !target.has(id));

      const nowSecs = nowSec();
      for (const segId of toAdd) {
        await ctx.db.insert(marketingSegmentMembers).values({
          segmentId: segId,
          contactId: mcid,
          addedAt: nowSecs,
        });
        // Recompute denormalized count.
        const cnt = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(marketingSegmentMembers)
          .where(eq(marketingSegmentMembers.segmentId, segId));
        await ctx.db.update(marketingSegments)
          .set({ contactCount: Number(cnt[0]?.count ?? 0), updatedAt: nowSecs })
          .where(and(eq(marketingSegments.id, segId), eq(marketingSegments.tenantId, input.tenantId)));
      }
      for (const segId of toRemove) {
        await ctx.db.delete(marketingSegmentMembers)
          .where(and(
            eq(marketingSegmentMembers.segmentId, segId),
            eq(marketingSegmentMembers.contactId, mcid),
          ));
        const cnt = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(marketingSegmentMembers)
          .where(eq(marketingSegmentMembers.segmentId, segId));
        await ctx.db.update(marketingSegments)
          .set({ contactCount: Number(cnt[0]?.count ?? 0), updatedAt: nowSecs })
          .where(and(eq(marketingSegments.id, segId), eq(marketingSegments.tenantId, input.tenantId)));
      }

      return { added: toAdd.length, removed: toRemove.length };
    }),

  /**
   * Return the favorite-master suggestion for a client.
   *
   * Two layers:
   *   - `manual`   — `users.favorite_master_id` set explicitly by the
   *                  salon owner via the Client modal (highest priority).
   *   - `derived`  — most-frequent master across the client's COMPLETED
   *                  appointments (status='done' OR status='confirmed'
   *                  AND ts < now). Cancelled / no-show rows excluded so
   *                  a client who abandons one master 5 times doesn't
   *                  end up pinned to that master.
   *
   * Stale-row tolerance: a manual id that no longer matches an active
   * master row returns `manual:null` so the UI gracefully falls back to
   * the derived value.
   *
   * Cross-channel by construction: identity collapses to one (tenant,
   * chat_id) row regardless of the original contact channel (phone-in,
   * Telegram, IG, email match), so this single read works whether the
   * caller arrived via the dashboard, the mini-app, or the bot.
   */
  getFavoriteMasterSuggestion: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return computeFavoriteMasterSuggestion(ctx.db, input.tenantId, input.chatId);
    }),

  /**
   * Top-20 tag suggestions for the filter chip & form autocomplete.
   * Cheap: pulls `users.tags` for the tenant and splits client-side.
   */
  tagSuggestions: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({ tags: users.tags })
        .from(users)
        .where(and(
          eq(users.tenantId, input.tenantId),
          isNull(users.deletedAt),
          isNotNull(users.tags),
        ))
        .limit(2000);
      const counts = new Map<string, number>();
      for (const r of rows) {
        if (!r.tags) continue;
        for (const raw of r.tags.split(",")) {
          const tag = raw.trim().toLowerCase();
          if (!tag) continue;
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag]) => tag);
    }),
});

// ─── Helpers for importCsv ───────────────────────────────────────────────────
async function findClientByPriority(
  db: any,
  tenantId: string,
  row: ParsedClientRow,
): Promise<ClientRow | null> {
  const notDeleted = isNull(users.deletedAt);

  if (row.email) {
    const [r] = await db.select().from(users)
      .where(and(eq(users.tenantId, tenantId), notDeleted, eq(users.email, row.email))).limit(1);
    if (r) return r as ClientRow;
  }
  if (row.phone) {
    const [r] = await db.select().from(users)
      .where(and(eq(users.tenantId, tenantId), notDeleted, eq(users.phone, row.phone))).limit(1);
    if (r) return r as ClientRow;
  }
  if (row.tgUsername) {
    const [r] = await db.select().from(users)
      .where(and(eq(users.tenantId, tenantId), notDeleted, eq(users.tgUsername, row.tgUsername))).limit(1);
    if (r) return r as ClientRow;
  }
  if (row.igUsername) {
    const [r] = await db.select().from(users)
      .where(and(eq(users.tenantId, tenantId), notDeleted, eq(users.igUsername, row.igUsername))).limit(1);
    if (r) return r as ClientRow;
  }
  return null;
}

/**
 * 0074 — resolve & validate a favoriteMasterId before write.
 * Returns the id when the row exists and is non-archived in this tenant;
 * returns null when the caller cleared the pin OR the supplied id is stale.
 * Throws BAD_REQUEST when the id is a number but points outside this tenant
 * (defense against cross-tenant id-stuffing).
 */
async function resolveFavoriteMasterId(
  db: any,
  tenantId: string,
  raw: number | null | undefined,
): Promise<number | null> {
  if (raw == null) return null;
  const [row] = await db
    .select({ chatId: masters.chatId, archivedAt: masters.archivedAt })
    .from(masters)
    .where(and(eq(masters.tenantId, tenantId), eq(masters.chatId, raw)))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "favorite_master_not_in_tenant",
    });
  }
  if (row.archivedAt != null) return null; // gracefully clear stale pins
  return raw;
}

/**
 * 0074 — derive the manual + history-derived favorite. Returns
 * `{ manual, derived }` where each entry is either a `{ masterId, name }`
 * object or `null`. Cancelled / no-show rows are excluded so abandoned
 * masters don't dominate the histogram. Top-1 by visit count.
 */
export async function computeFavoriteMasterSuggestion(
  db: any,
  tenantId: string,
  chatId: number,
) {
  const [client] = await db
    .select({ favoriteMasterId: users.favoriteMasterId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.chatId, chatId)))
    .limit(1);

  let manual: { masterId: number; name: string | null } | null = null;
  if (client?.favoriteMasterId != null) {
    const [m] = await db
      .select({ chatId: masters.chatId, name: masters.name, archivedAt: masters.archivedAt })
      .from(masters)
      .where(and(
        eq(masters.tenantId, tenantId),
        eq(masters.chatId, client.favoriteMasterId),
      ))
      .limit(1);
    if (m && m.archivedAt == null) {
      manual = { masterId: m.chatId, name: m.name };
    }
  }

  // Histogram across past, non-cancelled, non-no-show appointments.
  // Includes 'confirmed' AND 'done' so a returning client who hasn't yet
  // had their second visit marked done still gets a derived favorite.
  const rows = await db
    .select({
      masterId: appointments.masterId,
      count: sql<number>`count(*)`,
    })
    .from(appointments)
    .where(and(
      eq(appointments.tenantId, tenantId),
      eq(appointments.chatId, chatId),
      eq(appointments.cancelled, 0),
      isNotNull(appointments.masterId),
    ))
    .groupBy(appointments.masterId)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  let derived: { masterId: number; count: number; name: string | null } | null = null;
  for (const r of rows) {
    if (r.masterId == null) continue;
    // Reject stale (archived) masters; walk the next ranked entry.
    const [m] = await db
      .select({ name: masters.name, archivedAt: masters.archivedAt })
      .from(masters)
      .where(and(eq(masters.tenantId, tenantId), eq(masters.chatId, r.masterId)))
      .limit(1);
    if (!m || m.archivedAt != null) continue;
    derived = { masterId: r.masterId, count: Number(r.count), name: m.name };
    break;
  }

  return { manual, derived };
}

function mergeRowIntoUser(
  existing: ClientRow,
  row: ParsedClientRow,
  now: number,
): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: now };
  if (row.name && !existing.name) updates.name = row.name;
  if (row.phone && !existing.phone) updates.phone = row.phone;
  if (row.email && !existing.email) updates.email = row.email;
  if (row.tgUsername && !existing.tgUsername) updates.tgUsername = row.tgUsername;
  if (row.igUsername && !existing.igUsername) updates.igUsername = row.igUsername;
  if (row.tags && !existing.tags) updates.tags = row.tags;
  if (row.notes && !existing.notes) updates.notes = row.notes;
  if (row.dob && !existing.dob) updates.dob = row.dob;
  return updates;
}

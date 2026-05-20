/**
 * Blog CMS — self-hosted marketing blog backing `/system/blog` (admin) and
 * the public `/blog` + `/blog/[slug]` pages.
 *
 * Auth model:
 *   - All write procs (create / update / publish / unpublish / archive /
 *     unarchive / delete / mintUploadToken / seedDefaults) are
 *     `adminProcedure` (system_admin only).
 *   - Read procs split:
 *       • `list` / `get` are admin-only (drafts + archived rows must not
 *         leak through a public API surface).
 *       • `listPublic` / `getPublic` are `publicProcedure` — they filter
 *         to `status='published'` server-side.
 *
 * Status lifecycle:
 *   draft ⇄ published ⇄ archived
 *   - publish:   status='published', published_at=now, archived_at=null
 *   - unpublish: status='draft',     published_at=null
 *   - archive:   status='archived',  archived_at=now (preserves published_at
 *                for auditability — if the post is restored later it doesn't
 *                lose its original publish stamp)
 *   - unarchive: status='draft',     archived_at=null
 *
 * Delete refuses `published` rows on purpose — archiving forces a soft state
 * before any destructive op, mirroring the pattern used by `clients.delete`.
 *
 * All multilingual fields (titles / excerpts / bodies / cover_alt / keywords)
 * are JSON-encoded by `serializeBlogInput` and decoded by `parseBlogRow` so
 * the on-the-wire DTO shape mirrors the existing static `BlogArticle`.
 *
 * Pinned by:
 *   - `src/__tests__/blog-router.test.ts` (auth gating + status transitions)
 *   - `src/__tests__/blog-serialize.test.ts` (pure helpers)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createTRPCRouter, adminProcedure, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { blogPosts } from "~/server/db/schema";
import { signUploadToken, type UploadKind } from "~/server/lib/uploadToken";
import {
  parseBlogRow,
  serializeBlogInput,
  validateSlug,
  type BlogPostRow,
} from "~/server/blog/serialize";

// ─── Input schemas ────────────────────────────────────────────────────────

const langKey = z.enum(["ru", "ua", "en", "pl"]);
const categoryEnum = z.enum(["tips", "product", "business", "trends"]);
const statusEnum = z.enum(["draft", "published", "archived"]);

const langBlobSchema = z.record(langKey, z.string()).optional();
const langArrayBlobSchema = z.record(langKey, z.array(z.string())).optional();
const dateOrNull = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .optional();

const createInputSchema = z.object({
  slug: z.string().min(1).max(100),
  category: categoryEnum,
  titles: z.record(langKey, z.string()),
  excerpts: langBlobSchema,
  bodies: langBlobSchema,
  coverUrl: z.union([z.string().url(), z.null()]).optional(),
  coverAlt: langBlobSchema,
  coverCredit: z.union([z.string().max(200), z.null()]).optional(),
  keywords: langArrayBlobSchema,
  relatedSlugs: z.array(z.string()).optional(),
  publishedDate: dateOrNull,
  updatedDate: dateOrNull,
});

const updateInputSchema = createInputSchema.extend({
  id: z.string(),
});

// ─── Helpers (router-private — DB-touching) ───────────────────────────────

function ensureSlug(slug: string): void {
  if (!validateSlug(slug)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid slug — must be lowercase ASCII + hyphens (no leading/trailing/double hyphens), 1..100 chars.",
    });
  }
}

function ensureAtLeastOneTitle(titles: Record<string, unknown>): void {
  const filled = Object.values(titles).filter((v) => typeof v === "string" && v.length > 0);
  if (filled.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one language title is required.",
    });
  }
}

function genBlogPostId(): string {
  // Same shape as other text IDs in the project (svc_*, msg_*, etc.).
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `bp_${rand}`;
}

async function loadPostById(ctx: { db: any }, id: string): Promise<BlogPostRow | null> {
  const rows = (await ctx.db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1)) as BlogPostRow[];
  return rows[0] ?? null;
}

async function loadPostBySlug(ctx: { db: any }, slug: string): Promise<BlogPostRow | null> {
  const rows = (await ctx.db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.slug, slug))
    .limit(1)) as BlogPostRow[];
  return rows[0] ?? null;
}

// ─── Router ───────────────────────────────────────────────────────────────

export const blogRouter = createTRPCRouter({
  // ── Admin reads ──────────────────────────────────────────────────────────

  list: adminProcedure
    .input(
      z
        .object({
          status: statusEnum.optional(),
          category: categoryEnum.optional(),
          search: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conds = [] as any[];
      if (input?.status) conds.push(eq(blogPosts.status, input.status));
      if (input?.category) conds.push(eq(blogPosts.category, input.category));
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
      const q = ctx.db.select().from(blogPosts);
      const rows = (await (where ? q.where(where) : q)
        .orderBy(desc(blogPosts.updatedAt))
        .limit(input?.limit ?? 200)) as BlogPostRow[];
      let mapped = rows.map(parseBlogRow);
      if (input?.search && input.search.trim().length > 0) {
        const needle = input.search.trim().toLowerCase();
        mapped = mapped.filter((r) => {
          if (r.slug.toLowerCase().includes(needle)) return true;
          for (const v of Object.values(r.titles)) {
            if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
          }
          return false;
        });
      }
      return mapped;
    }),

  get: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      return parseBlogRow(row);
    }),

  // ── Admin writes ─────────────────────────────────────────────────────────

  create: adminProcedure
    .input(createInputSchema)
    .mutation(async ({ ctx, input }) => {
      ensureSlug(input.slug);
      ensureAtLeastOneTitle(input.titles);

      const dup = await loadPostBySlug(ctx, input.slug);
      if (dup) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A blog post with slug "${input.slug}" already exists.`,
        });
      }

      const now = Math.floor(Date.now() / 1000);
      const cols = serializeBlogInput(input);
      const id = genBlogPostId();
      const uid = ctx.webUser?.id ?? null;

      await ctx.db.insert(blogPosts).values({
        id,
        ...cols,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        archivedAt: null,
        createdByWebUserId: uid,
        updatedByWebUserId: uid,
      });

      return { id };
    }),

  update: adminProcedure
    .input(updateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      ensureSlug(input.slug);
      ensureAtLeastOneTitle(input.titles);

      // Slug collision check (skip when unchanged).
      if (input.slug !== row.slug) {
        const dup = await loadPostBySlug(ctx, input.slug);
        if (dup && dup.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A blog post with slug "${input.slug}" already exists.`,
          });
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const cols = serializeBlogInput(input);
      const uid = ctx.webUser?.id ?? null;

      await ctx.db
        .update(blogPosts)
        .set({
          ...cols,
          updatedAt: now,
          updatedByWebUserId: uid,
        })
        .where(eq(blogPosts.id, input.id));

      return { ok: true as const };
    }),

  publish: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      const now = Math.floor(Date.now() / 1000);
      const uid = ctx.webUser?.id ?? null;
      await ctx.db
        .update(blogPosts)
        .set({
          status: "published",
          publishedAt: now,
          archivedAt: null,
          updatedAt: now,
          updatedByWebUserId: uid,
        })
        .where(eq(blogPosts.id, input.id));
      return { ok: true as const, status: "published" as const };
    }),

  unpublish: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      const now = Math.floor(Date.now() / 1000);
      const uid = ctx.webUser?.id ?? null;
      await ctx.db
        .update(blogPosts)
        .set({
          status: "draft",
          publishedAt: null,
          updatedAt: now,
          updatedByWebUserId: uid,
        })
        .where(eq(blogPosts.id, input.id));
      return { ok: true as const, status: "draft" as const };
    }),

  archive: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      const now = Math.floor(Date.now() / 1000);
      const uid = ctx.webUser?.id ?? null;
      await ctx.db
        .update(blogPosts)
        .set({
          status: "archived",
          archivedAt: now,
          updatedAt: now,
          updatedByWebUserId: uid,
        })
        .where(eq(blogPosts.id, input.id));
      return { ok: true as const, status: "archived" as const };
    }),

  unarchive: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      const now = Math.floor(Date.now() / 1000);
      const uid = ctx.webUser?.id ?? null;
      await ctx.db
        .update(blogPosts)
        .set({
          status: "draft",
          archivedAt: null,
          updatedAt: now,
          updatedByWebUserId: uid,
        })
        .where(eq(blogPosts.id, input.id));
      return { ok: true as const, status: "draft" as const };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadPostById(ctx, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      if (row.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Published posts must be archived before deletion.",
        });
      }
      await ctx.db.delete(blogPosts).where(eq(blogPosts.id, input.id));
      return { ok: true as const };
    }),

  // ── Upload tokens (R2 via Worker /upload/asset) ──────────────────────────

  mintUploadToken: adminProcedure
    .input(z.object({ kind: z.enum(["blog_cover", "blog_photo"]) }))
    .mutation(async ({ ctx, input }) => {
      if (!env.UPLOAD_TOKEN_SECRET) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "UPLOAD_TOKEN_SECRET not configured on admin-app",
        });
      }
      if (!env.WORKER_PUBLIC_URL) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "WORKER_PUBLIC_URL not configured on admin-app",
        });
      }
      // Blog assets are platform-owned (no tenant). Use the same `_platform`
      // sentinel that chat-attachment uploads use for tenant-less tickets.
      const token = await signUploadToken({
        tid: "_platform",
        kind: input.kind as UploadKind,
        secret: env.UPLOAD_TOKEN_SECRET,
        uid: ctx.webUser?.id,
      });
      const base = env.WORKER_PUBLIC_URL.replace(/\/$/, "");
      return {
        token,
        uploadUrl: `${base}/upload/asset?t=${encodeURIComponent(token)}&kind=${encodeURIComponent(input.kind)}`,
      };
    }),

  // ── Public reads (no auth, filter to published) ─────────────────────────

  listPublic: publicProcedure
    .input(
      z
        .object({
          category: categoryEnum.optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const where = input?.category
        ? and(eq(blogPosts.status, "published"), eq(blogPosts.category, input.category))
        : eq(blogPosts.status, "published");
      const rows = (await ctx.db
        .select()
        .from(blogPosts)
        .where(where)
        .orderBy(desc(blogPosts.publishedDate))
        .limit(input?.limit ?? 100)) as BlogPostRow[];
      return rows.map(parseBlogRow);
    }),

  getPublic: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = (await ctx.db
        .select()
        .from(blogPosts)
        .where(and(eq(blogPosts.slug, input.slug), eq(blogPosts.status, "published")))
        .limit(1)) as BlogPostRow[];
      return rows[0] ? parseBlogRow(rows[0]) : null;
    }),

  // ── One-time import of the legacy static BLOG_ARTICLES ──────────────────

  /**
   * Imports the 10 legacy hardcoded posts from `~/content/blog/articles`
   * into the new `blog_posts` table. Idempotent: rows with an existing slug
   * are skipped (INSERT OR IGNORE semantics via the slug uniqueness probe).
   * Returns { imported, skipped }.
   *
   * Surface: a one-shot button on the admin list page when DB is empty.
   * Safe to run more than once — the static content is the seed; further
   * edits happen on the DB rows.
   */
  seedDefaults: adminProcedure.mutation(async ({ ctx }) => {
    // Lazy import so the bundle doesn't carry ~270KB of legacy article TS
    // unless the seed is actually triggered.
    const { BLOG_ARTICLES } = await import("~/content/blog/articles");

    let imported = 0;
    let skipped = 0;
    const now = Math.floor(Date.now() / 1000);
    const uid = ctx.webUser?.id ?? null;

    for (const article of BLOG_ARTICLES) {
      const dup = await loadPostBySlug(ctx, article.slug);
      if (dup) {
        skipped++;
        continue;
      }
      const cols = serializeBlogInput({
        slug: article.slug,
        category: article.categoryKey,
        titles: article.titles,
        excerpts: article.excerpts,
        bodies: article.bodies,
        coverUrl: article.coverImage.url,
        coverAlt: article.coverImage.alt,
        coverCredit: article.coverImage.credit ?? null,
        keywords: article.keywords,
        relatedSlugs: article.relatedSlugs,
        publishedDate: article.date,
        updatedDate: article.updated ?? null,
      });
      await ctx.db.insert(blogPosts).values({
        id: genBlogPostId(),
        ...cols,
        status: "published",
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
        archivedAt: null,
        createdByWebUserId: uid,
        updatedByWebUserId: uid,
      });
      imported++;
    }

    return { imported, skipped };
  }),

  /** Stats summary for the admin list header (counts per status). */
  stats: adminProcedure.query(async ({ ctx }) => {
    const all = (await ctx.db.select().from(blogPosts)) as BlogPostRow[];
    let draft = 0;
    let published = 0;
    let archived = 0;
    for (const row of all) {
      if (row.status === "published") published++;
      else if (row.status === "archived") archived++;
      else draft++;
    }
    return { total: all.length, draft, published, archived };
  }),
});

// Suppress unused-import warning when `inArray` is reserved for future bulk ops.
void inArray;

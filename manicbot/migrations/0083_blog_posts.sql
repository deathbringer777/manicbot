-- Migration 0083 — blog_posts table (self-hosted blog CMS)
--
-- Why:
--   • Until now the marketing blog lived as a hardcoded TypeScript constant
--     (`~/content/blog/articles/posts/*.ts`, 10 articles, ~270 KB of static
--     content). Every new post = code edit + redeploy. Worse — there was no
--     way to manage drafts, archive old posts, or upload an image without
--     bouncing through a separate CMS subscription. The user flagged the
--     dependency risk: "если подписка закончится, я не смогу запостить".
--   • This migration introduces `blog_posts` as the first-class CMS entity.
--     Admin UI at `/system/blog` (system_admin only) drives CRUD. Public
--     `/blog` + `/blog/[slug]` query D1 instead of the static array (the
--     static `BLOG_ARTICLES` constant stays as a fallback for the
--     pre-seed window — see `blog.seedDefaults` adminProcedure).
--
-- Status lifecycle:
--   draft → published → archived  (also: archived → draft, draft → archived)
--   Hard delete is allowed for `draft` and `archived` rows; published rows
--   must be archived first (UI-enforced; the router rejects the transition).
--
-- Multilingual content:
--   • titles / excerpts / bodies are stored as JSON blobs keyed by Lang
--     (`{ru, ua, en, pl}`) to mirror the existing `BlogArticle` shape.
--     Single source for the public site, the admin editor, and the SEO
--     metadata generators.
--   • cover_alt is also per-lang (image alt text matters for SEO image
--     search), so cover_alt_json mirrors the same shape.
--   • keywords_json is OPTIONAL — falls back to `CATEGORY_KEYWORDS` in the
--     public router when null. Stored as `{ru?, ua?, en?, pl?}` where each
--     value is a string[] (JSON array).
--
-- Slug uniqueness:
--   • Globally UNIQUE — the URL `/blog/{slug}` has no language segment, and
--     each post serves all 4 languages from a single row (language picked
--     from `?lang=` query string). Two posts cannot share a slug.
--
-- Date columns:
--   • `published_date` (TEXT, YYYY-MM-DD) drives display + SEO `datePublished`
--     + the `ItemList` JSON-LD sort. Owner can edit this freely. Matches the
--     existing `BlogArticle.date` shape so the static-fallback rendering
--     path is identical.
--   • `updated_date` (TEXT, YYYY-MM-DD) is optional — set by the owner on
--     significant rewrites. Renders as Schema.org `dateModified`.
--   • `published_at` (INTEGER, epoch seconds) is the system-side stamp set
--     when status flipped to `published`. Distinct from `published_date` so
--     a future-dated post (published_date = 2026-12-01) can ship draft today
--     and become public on its publish_date via a future cron (not in this
--     PR; published_at IS NULL is the gate for "not yet live").
--   • `archived_at` (INTEGER) — soft-delete timestamp for the audit trail.
--
-- Authorship:
--   • `created_by_web_user_id` / `updated_by_web_user_id` reference
--     `web_users.id` (TEXT). Nullable because the seed proc may import
--     legacy articles without a known author.

CREATE TABLE IF NOT EXISTS blog_posts (
  id                       TEXT PRIMARY KEY,
  slug                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft',
  category                 TEXT NOT NULL DEFAULT 'tips',

  cover_url                TEXT,
  cover_alt_json           TEXT,
  cover_credit             TEXT,

  titles_json              TEXT NOT NULL DEFAULT '{}',
  excerpts_json            TEXT NOT NULL DEFAULT '{}',
  bodies_json              TEXT NOT NULL DEFAULT '{}',
  keywords_json            TEXT,
  related_slugs_json       TEXT,

  published_date           TEXT,
  updated_date             TEXT,

  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  published_at             INTEGER,
  archived_at              INTEGER,

  created_by_web_user_id   TEXT,
  updated_by_web_user_id   TEXT
);

-- One slug per blog post, globally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON blog_posts(slug);

-- Drives the public list ORDER BY (status=published, recent first).
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_pubdate
  ON blog_posts(status, published_date DESC);

-- Drives the admin list status-tab filters.
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_created
  ON blog_posts(status, created_at DESC);

-- Drives category-filtered listing (admin + future public filter).
CREATE INDEX IF NOT EXISTS idx_blog_posts_category_status
  ON blog_posts(category, status);

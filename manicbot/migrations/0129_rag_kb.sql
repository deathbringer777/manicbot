-- 0129_rag_kb.sql — 2026-06-30
--
-- RAG (retrieval-augmented generation) per-tenant knowledge base.
--
-- Two tenant-scoped tables that let the booking bot answer free-text knowledge
-- questions ("делаете снятие гель-лака?", "есть парковка?", "политика отмены?")
-- grounded in the salon's own content instead of guessing.
--
--  * salon_faq   — the owner-authored FAQ/policies surface (none existed before).
--  * rag_chunks  — the derived vector index: bge-m3 (1024-dim, multilingual)
--                  embeddings stored as little-endian Float32 BLOBs alongside the
--                  source text. The corpus is tiny (~tens of chunks/tenant), so
--                  retrieval brute-forces cosine similarity in the Worker over a
--                  `WHERE tenant_id = ?` slice — immediately consistent and on the
--                  same tenant-isolation invariant the CI scanner already gates
--                  (Vectorize queries are invisible to it). The larger public blog
--                  + internal-docs corpora use Vectorize separately, NOT this table.
--
-- BOTH tables are genuinely tenant-isolated: tenant_id IS the access boundary
-- (unlike `jobs`, where it is a payload attribute). Every query MUST scope by
-- tenant_id — enforced by scripts/check-tenant-isolation-worker.mjs.
--
-- Timestamps are epoch SECONDS (matches nowSec() / the jobs + cron convention).
--
-- Behaviour-neutral on existing tables: pure additive new tables + indexes.

CREATE TABLE IF NOT EXISTS salon_faq (
  tenant_id     TEXT NOT NULL,
  id            TEXT NOT NULL,
  question_json TEXT NOT NULL,                  -- {ru,uk,en,pl}
  answer_json   TEXT NOT NULL,                  -- {ru,uk,en,pl}
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,               -- epoch seconds
  updated_at    INTEGER NOT NULL,               -- epoch seconds
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_salon_faq_tenant ON salon_faq(tenant_id, active);

CREATE TABLE IF NOT EXISTS rag_chunks (
  tenant_id    TEXT NOT NULL,
  id           TEXT NOT NULL,                   -- `${source_table}:${source_id}:${lang}:${chunk_ix}`
  source_table TEXT NOT NULL,                   -- services | masters | tenants | album_photos | salon_faq
  source_id    TEXT NOT NULL,
  lang         TEXT,                            -- ru | uk | pl | en | NULL
  chunk_ix     INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,                   -- sanitized chunk text (sanitizeTenantField at write time)
  embedding    BLOB NOT NULL,                   -- Float32Array(dim) little-endian = dim*4 bytes
  dim          INTEGER NOT NULL DEFAULT 1024,   -- bge-m3 output dimension
  model        TEXT NOT NULL,                   -- embedding model id; refuse cross-model comparison
  content_hash TEXT NOT NULL,                   -- sha256 of source text → skip re-embed when unchanged
  updated_at   INTEGER NOT NULL,                -- epoch seconds
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant ON rag_chunks(tenant_id);

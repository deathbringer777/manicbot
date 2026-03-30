-- Migration 0004: FTS5 search index + search_text on tenants + bio/photo on masters

-- Add denormalized search text column to tenants
ALTER TABLE tenants ADD COLUMN search_text TEXT;

-- FTS5 virtual table for full-text search
-- unicode61 tokenizer handles Cyrillic, Polish diacritics and removes accents
CREATE VIRTUAL TABLE IF NOT EXISTS tenant_fts USING fts5(
  tenant_id UNINDEXED,
  content,
  tokenize='unicode61 remove_diacritics 1'
);

-- Add bio and photo columns to masters for public profile cards
ALTER TABLE masters ADD COLUMN bio TEXT;
ALTER TABLE masters ADD COLUMN photo TEXT;

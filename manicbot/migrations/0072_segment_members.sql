-- 0072_segment_members.sql — 2026-05-17
--
-- Brevo-style **manual lists** on top of marketing_segments.
--
-- Why: salon owners want explicit, human-managed groupings of clients
-- for marketing campaigns (e.g. "VIP", "Christmas regulars"). The v1
-- segments engine ships only filter-based segments (filter_json), so a
-- non-technical user has nothing to grab onto from the contacts page.
--
-- Shape:
--   * `marketing_segments.kind` — 'filter' (existing — uses filter_json)
--     or 'manual' (membership stored explicitly).
--   * `marketing_segment_members` — (segment_id, contact_id, added_at).
--     UNIQUE per pair so re-add is a no-op.
--
-- Audience resolver (`~/server/marketing/audience.ts`) reads `kind` and
-- branches: manual lists JOIN through the members table; filter lists
-- continue to evaluate filter_json. Backward-compatible — existing rows
-- default to kind='filter'.

ALTER TABLE marketing_segments ADD COLUMN kind TEXT NOT NULL DEFAULT 'filter';

CREATE TABLE IF NOT EXISTS marketing_segment_members (
  segment_id TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  added_at   INTEGER NOT NULL,
  added_by   TEXT,
  PRIMARY KEY (segment_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_msm_segment ON marketing_segment_members(segment_id);
CREATE INDEX IF NOT EXISTS idx_msm_contact ON marketing_segment_members(contact_id);

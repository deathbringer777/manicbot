/**
 * AUDIT YELLOW #5 (Worker side) — `marketing_sends` has no tenant_id column.
 *
 * Tenant-facing READS of sends live entirely in the admin tenant router behind a
 * `marketing_campaigns` JOIN (locked by admin-app
 * marketing-sends-tenant-isolation.test.ts). The Worker must therefore only ever
 * WRITE sends rows by their PRIMARY KEY `id` — never SELECT rows back in a way
 * that could span tenants. This scan over `manicbot/src` enforces that:
 *
 *   - INSERT INTO marketing_sends ...                 → allowed (send loop)
 *   - UPDATE marketing_sends ... WHERE id = ?         → allowed (by primary key)
 *   - SELECT/FROM marketing_sends without `id = ?` or
 *     a marketing_campaigns join                      → FORBIDDEN (cross-tenant read)
 *   - UPDATE/DELETE marketing_sends not keyed by id   → FORBIDDEN (unscoped write)
 *
 * The age-based retention DELETE in cron.js is a God-Mode platform sweep built by
 * interpolating the table name (`{ table: 'marketing_sends', where: ... }`), not
 * an inline SQL string — it is intentionally cross-tenant and out of scope here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

/** Recursively collect every `.js` file under `src/`. */
function collectJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectJsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** True when the `marketing_sends` mention on this line sits inside a comment. */
function isCommentMention(line) {
  const idx = line.indexOf('marketing_sends');
  const before = line.slice(0, idx);
  const trimmed = line.trimStart();
  return (
    before.includes('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('//')
  );
}

/**
 * Classify a code line that mentions `marketing_sends`.
 * @returns {{ ok: boolean, reason: string }}
 */
function classifyLine(line) {
  const keyedById = /\bid\s*=\s*\?/i.test(line);
  const joinsCampaign = /marketing_campaigns/i.test(line);

  // A correlated dedup subquery — `(NOT) EXISTS (SELECT 1 FROM marketing_sends
  // ms WHERE ms.campaign_id = ? AND ms.contact_id = <outer>)` — is tenant-safe:
  // it filters by a campaign_id that belongs to an already tenant-verified
  // campaign and correlates back to the outer contact row, never returning
  // sends rows. It must carry BOTH the `exists (` wrapper AND the
  // `campaign_id = ?` + `contact_id =` correlation so a bare
  // `SELECT * FROM marketing_sends WHERE campaign_id = ?` stays flagged.
  const isDedupSubquery =
    /\bexists\s*\(/i.test(line) &&
    /campaign_id\s*=\s*\?/i.test(line) &&
    /contact_id\s*=/i.test(line);

  if (/\binsert\s+(?:or\s+\w+\s+)?into\s+marketing_sends\b/i.test(line)) {
    return { ok: true, reason: 'insert' };
  }
  if (/\bupdate\s+marketing_sends\b/i.test(line)) {
    return { ok: keyedById, reason: keyedById ? 'update-by-id' : 'UPDATE marketing_sends not keyed by id (unscoped write)' };
  }
  if (/\bdelete\s+from\s+marketing_sends\b/i.test(line)) {
    return { ok: keyedById, reason: keyedById ? 'delete-by-id' : 'DELETE FROM marketing_sends not keyed by id' };
  }
  if (/\bfrom\s+marketing_sends\b/i.test(line) || /\bjoin\s+marketing_sends\b/i.test(line)) {
    const ok = keyedById || joinsCampaign || isDedupSubquery;
    return { ok, reason: ok ? 'read-isolated' : 'SELECT FROM marketing_sends without id=? or marketing_campaigns join (cross-tenant read)' };
  }
  // Bare identifier (e.g. retention config `table: 'marketing_sends'`) — no SQL verb.
  return { ok: true, reason: 'non-sql reference' };
}

describe('classifyLine predicate has teeth', () => {
  it('flags a cross-tenant read (campaignId only, no join)', () => {
    expect(classifyLine("SELECT * FROM marketing_sends WHERE campaign_id = ?").ok).toBe(false);
  });
  it('accepts a read keyed by id', () => {
    expect(classifyLine("SELECT * FROM marketing_sends WHERE id = ?").ok).toBe(true);
  });
  it('accepts a read joined to marketing_campaigns', () => {
    expect(classifyLine("FROM marketing_sends s JOIN marketing_campaigns c ON s.campaign_id = c.id WHERE c.tenant_id = ?").ok).toBe(true);
  });
  it('flags an unkeyed UPDATE', () => {
    expect(classifyLine("UPDATE marketing_sends SET status = 'sent'").ok).toBe(false);
  });
  it('accepts an UPDATE keyed by id', () => {
    expect(classifyLine("UPDATE marketing_sends SET status = 'sent' WHERE id = ?").ok).toBe(true);
  });
  it('accepts INSERT', () => {
    expect(classifyLine('INSERT INTO marketing_sends (id, campaign_id) VALUES (?, ?)').ok).toBe(true);
  });
  it('accepts INSERT OR IGNORE', () => {
    expect(classifyLine('INSERT OR IGNORE INTO marketing_sends (id, campaign_id) VALUES (?, ?)').ok).toBe(true);
  });
  it('accepts a correlated dedup NOT EXISTS subquery (campaign-scoped, contact-correlated)', () => {
    expect(classifyLine('AND NOT EXISTS (SELECT 1 FROM marketing_sends ms WHERE ms.campaign_id = ? AND ms.contact_id = c.id)').ok).toBe(true);
  });
  it('still flags a bare campaign-scoped read with no EXISTS / contact correlation', () => {
    // The dedup carve-out must NOT widen to a standalone campaign_id read.
    expect(classifyLine('SELECT * FROM marketing_sends WHERE campaign_id = ? AND contact_id = ?').ok).toBe(false);
    expect(classifyLine('EXISTS (SELECT 1 FROM marketing_sends WHERE campaign_id = ?)').ok).toBe(false);
  });
  it('treats a bare retention-config identifier as a non-SQL reference', () => {
    expect(classifyLine("{ table: 'marketing_sends', where: \"sent_at < x\" },").ok).toBe(true);
  });
});

describe('Worker never reads marketing_sends cross-tenant (AUDIT YELLOW #5)', () => {
  const files = collectJsFiles(SRC_DIR);
  /** @type {Array<{ file: string, line: number, text: string, verdict: { ok: boolean, reason: string } }>} */
  const codeMentions = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (!text.includes('marketing_sends')) return;
      if (isCommentMention(text)) return;
      codeMentions.push({ file, line: i + 1, text: text.trim(), verdict: classifyLine(text) });
    });
  }

  it('finds the known sends writes (regex sanity — INSERT + 4 by-id UPDATEs)', () => {
    expect(codeMentions.length).toBeGreaterThanOrEqual(5);
  });

  it('every code-level marketing_sends statement is a by-id write or an isolated read', () => {
    const violations = codeMentions
      .filter((m) => !m.verdict.ok)
      .map((m) => `${m.file.split('/src/')[1]}:${m.line} — ${m.verdict.reason} :: ${m.text}`);
    expect(violations).toEqual([]);
  });
});

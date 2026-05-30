/**
 * FTS5 search helpers for messenger.searchMessages (migration 0096).
 *
 * Kept pure + separate so the security-critical query construction (tenant
 * scope + caller thread-membership filter) is unit-testable without a DB.
 */

/**
 * Turn raw user input into a safe FTS5 MATCH expression.
 *
 * FTS5 MATCH has its own grammar (", *, :, ^, -, AND/OR/NOT, column filters).
 * Raw input throws "fts5: syntax error" on a stray quote/operator and could let
 * a user inject column-filter syntax. We lowercase, tokenize on whitespace,
 * strip metacharacters from each token, quote it (defusing operators), and
 * append `*` for prefix search. Returns null when nothing usable remains.
 */
export function sanitizeFtsQuery(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/["*:^()\-]/g, "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export interface MessageSearchSql {
  sql: string;
  binds: (string | number)[];
}

/**
 * Build the parameterized FTS search SQL.
 *
 * @param threadIds caller's thread ids to constrain to, or `null` for the
 *   system_admin tenant-wide search (support escalation). For a non-admin
 *   caller this MUST be a non-empty list — an empty list would mean "no
 *   membership filter" which would leak every thread; callers short-circuit
 *   to an empty result before reaching here.
 */
export function buildMessageSearchSql(opts: {
  tenantId: string;
  threadIds: string[] | null;
  match: string;
  limit: number;
}): MessageSearchSql {
  const binds: (string | number)[] = [opts.tenantId];
  let threadClause = "";
  if (opts.threadIds !== null) {
    const placeholders = opts.threadIds.map(() => "?").join(", ");
    threadClause = `AND f.thread_id IN (${placeholders})`;
    binds.push(...opts.threadIds);
  }
  binds.push(opts.match, opts.limit);
  const sql = `
    SELECT m.id AS id, m.thread_id AS threadId, m.sender_kind AS senderKind,
           m.sender_ref AS senderRef, m.body AS body, m.created_at AS createdAt,
           m.is_internal_note AS isInternalNote
    FROM thread_messages_fts f
    JOIN thread_messages m ON m.id = f.message_id
    WHERE f.tenant_id = ?
      ${threadClause}
      AND f.body MATCH ?
      AND m.deleted_at IS NULL
    ORDER BY m.id DESC
    LIMIT ?`;
  return { sql, binds };
}

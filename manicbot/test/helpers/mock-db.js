/**
 * D1 mock for tests — Map-based in-memory SQLite-like mock.
 * Supports basic SQL parsing for the queries used in ManicBot.
 */

// Tables with INTEGER PRIMARY KEY AUTOINCREMENT whose generated id the Worker
// reads back after insert (real D1 returns meta.last_row_id). The mock assigns
// max(id)+1 on a fresh insert, but only when the INSERT didn't specify an id
// (seeded explicit ids always win).
const AUTOINC_TABLES = new Set([
  'marketing_contacts', 'marketing_consent_log', 'leads', 'email_subscribers',
]);

export function createMockD1() {
  const tables = new Map();

  function getTable(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }

  function parseValue(v) {
    if (v === null || v === undefined) return null;
    return v;
  }

  function matchesWhere(row, conditions) {
    for (const cond of conditions) {
      if (cond[0] === '__OR__') {
        const leftMatch = matchesWhere(row, cond[1]);
        const rightMatch = matchesWhere(row, cond[2]);
        if (!leftMatch && !rightMatch) return false;
        continue;
      }
      const [key, op, value] = cond;
      const rv = row[key];
      if (op === '=') { if (rv !== value) return false; }
      else if (op === '!=') { if (rv === value) return false; }
      else if (op === '>') { if (!(rv > value)) return false; }
      else if (op === '<') { if (!(rv < value)) return false; }
      else if (op === '>=') { if (!(rv >= value)) return false; }
      else if (op === '<=') { if (!(rv <= value)) return false; }
      else if (op === 'IN') { if (!value.includes(rv)) return false; }
      else if (op === 'IS NULL') { if (rv !== null && rv !== undefined) return false; }
      else if (op === 'IS NOT NULL') { if (rv === null || rv === undefined) return false; }
    }
    return true;
  }

  class MockStatement {
    constructor(sql) {
      this._sql = sql;
      this._params = [];
    }

    bind(...params) {
      this._params = params;
      return this;
    }

    _substituteParams(sql, params) {
      let idx = 0;
      return sql.replace(/\?/g, () => {
        const val = params[idx++];
        return val;
      });
    }

    _parseInsert() {
      const sql = this._sql;
      const m = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (!m) {
        // fallback: без VALUES-части (старый формат)
        const m2 = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)/i);
        if (!m2) return null;
        return { table: m2[1], cols: m2[2].split(',').map(c => c.trim()), literals: null };
      }
      const table = m[1];
      const cols = m[2].split(',').map(c => c.trim());
      // Парсим VALUES: каждый элемент — либо '?' (placeholder), либо 'value' (строковый литерал),
      // либо число. Нужно для INSERT с литералами типа INSERT ... VALUES (?, 'support').
      const valParts = m[3].split(',').map(s => s.trim());
      const literals = valParts.map(v => {
        if (v === '?') return null; // будет взято из params
        const strLit = v.match(/^'([^']*)'$/);
        if (strLit) return { value: strLit[1] };
        const numLit = v.match(/^(\d+)$/);
        if (numLit) return { value: parseInt(numLit[1], 10) };
        return null; // неизвестный формат → из params
      });
      return { table, cols, literals };
    }

    _parseUpdate() {
      const sql = this._sql;
      const m = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
      if (!m) return null;
      return { table: m[1], setCols: m[2], whereClause: m[3] || '' };
    }

    _parseDelete() {
      const sql = this._sql;
      const m = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
      if (!m) return null;
      return { table: m[1], whereClause: m[2] || '' };
    }

    _parseSelect() {
      const sql = this._sql;
      const m = sql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
      if (!m) return null;
      return { cols: m[1], table: m[2], whereClause: m[3] || '', orderBy: m[4] || '', limit: m[5] ? parseInt(m[5]) : null };
    }

    _buildWhereConditions(whereClause, params) {
      if (!whereClause.trim()) return [];
      const conditions = [];
      let pIdx = 0;
      const parts = whereClause.split(/\s+AND\s+/i);
      for (const part of parts) {
        const trimmed = part.trim().replace(/^\(|\)$/g, '');
        const inMatch = trimmed.match(/^(\w+)\s+IN\s*\(([^)]+)\)/i);
        if (inMatch) {
          const col = inMatch[1];
          const placeholders = inMatch[2].split(',').map(s => s.trim());
          const values = placeholders.map(p => {
            if (p === '?') return params[pIdx++];
            const strLit = p.match(/^'([^']*)'$/);
            if (strLit) return strLit[1];
            if (/^\d+$/.test(p)) return parseInt(p, 10);
            return params[pIdx++];
          });
          conditions.push([col, 'IN', values]);
          continue;
        }
        const isNull = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
        if (isNull) { conditions.push([isNull[1], 'IS NULL', null]); continue; }
        const isNotNull = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
        if (isNotNull) { conditions.push([isNotNull[1], 'IS NOT NULL', null]); continue; }
        const cmp = trimmed.match(/^(\w+)\s*(!=|>=|<=|>|<|=)\s*\?$/);
        if (cmp) {
          conditions.push([cmp[1], cmp[2], params[pIdx++]]);
          continue;
        }
        // Поддержка литеральных строк: col = 'value' или col != 'value'
        // Нужно для запросов вида: WHERE type = 'support'
        const cmpLit = trimmed.match(/^(\w+)\s*(!=|>=|<=|>|<|=)\s*'([^']*)'$/);
        if (cmpLit) {
          conditions.push([cmpLit[1], cmpLit[2], cmpLit[3]]);
          continue;
        }
        // Поддержка числовых литералов: col = 1 или cancelled = 0
        const cmpNum = trimmed.match(/^(\w+)\s*(!=|>=|<=|>|<|=)\s*(\d+)$/);
        if (cmpNum) {
          conditions.push([cmpNum[1], cmpNum[2], parseInt(cmpNum[3], 10)]);
          continue;
        }
        // OR support: (col1 = ? OR col2 = ?)
        const orMatch = trimmed.match(/^(.+?)\s+OR\s+(.+)$/i);
        if (orMatch) {
          const leftConds = this._buildWhereConditions(orMatch[1].replace(/^\(|\)$/g, ''), params.slice(pIdx));
          let leftParams = 0;
          for (const c of leftConds) if (c[1] !== 'IS NULL' && c[1] !== 'IS NOT NULL' && c[1] !== 'IN') leftParams++;
            else if (c[1] === 'IN') leftParams += c[2].length;
          const rightConds = this._buildWhereConditions(orMatch[2].replace(/^\(|\)$/g, ''), params.slice(pIdx + leftParams));
          let rightParams = 0;
          for (const c of rightConds) if (c[1] !== 'IS NULL' && c[1] !== 'IS NOT NULL' && c[1] !== 'IN') rightParams++;
            else if (c[1] === 'IN') rightParams += c[2].length;
          conditions.push(['__OR__', leftConds, rightConds]);
          pIdx += leftParams + rightParams;
          continue;
        }
      }
      return conditions;
    }

    async first() {
      const parsed = this._parseSelect();
      if (!parsed) return null;
      const rows = getTable(parsed.table);
      const conditions = this._buildWhereConditions(parsed.whereClause, this._params);
      const filtered = rows.filter(r => matchesWhere(r, conditions));
      if (/^COUNT\(\*\)/i.test(parsed.cols.trim())) {
        const alias = parsed.cols.match(/\s+AS\s+(\w+)$/i)?.[1];
        return alias ? { [alias]: filtered.length } : { 'COUNT(*)': filtered.length };
      }
      return filtered[0] || null;
    }

    async all() {
      const parsed = this._parseSelect();
      if (!parsed) return { results: [] };
      const rows = getTable(parsed.table);
      const conditions = this._buildWhereConditions(parsed.whereClause, this._params);
      let filtered = rows.filter(r => matchesWhere(r, conditions));
      if (parsed.orderBy) {
        const orderParts = parsed.orderBy.split(',').map(s => s.trim());
        for (const op of orderParts.reverse()) {
          const [col, dir] = op.split(/\s+/);
          const desc = dir && dir.toUpperCase() === 'DESC';
          filtered.sort((a, b) => {
            if (a[col] < b[col]) return desc ? 1 : -1;
            if (a[col] > b[col]) return desc ? -1 : 1;
            return 0;
          });
        }
      }
      if (parsed.limit != null) filtered = filtered.slice(0, parsed.limit);
      if (/^COUNT\(\*\)/i.test(parsed.cols.trim())) {
        const alias = parsed.cols.match(/\s+AS\s+(\w+)$/i)?.[1];
        return { results: [alias ? { [alias]: filtered.length } : { 'COUNT(*)': filtered.length }] };
      }
      return { results: filtered };
    }

    async run() {
      const sql = this._sql.trim();
      const params = this._params;

      if (/^CREATE\s/i.test(sql)) return { success: true };
      if (/^CREATE\s+INDEX/i.test(sql)) return { success: true };

      if (/^INSERT/i.test(sql)) {
        const parsed = this._parseInsert();
        if (!parsed) return { success: false };
        const row = {};
        const isReplace = /INSERT\s+OR\s+REPLACE/i.test(sql);
        const isIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
        const isUpsert = /ON\s+CONFLICT/i.test(sql);
        // Заполняем строку: либо из literals (для строковых/числовых литералов в VALUES),
        // либо из params (для ? плейсхолдеров). Это поддерживает INSERT ... VALUES (?, 'support').
        let pIdx = 0;
        for (let i = 0; i < parsed.cols.length; i++) {
          if (parsed.literals && parsed.literals[i] !== null) {
            row[parsed.cols[i]] = parsed.literals[i].value;
          } else {
            row[parsed.cols[i]] = parseValue(params[pIdx++]);
          }
        }
        const table = getTable(parsed.table);

        if (isReplace) {
          const pkMap = {
            tenants: ['id'], bots: ['bot_id'], platform_roles: ['chat_id'],
            support_agents: ['chat_id', 'type'], tenant_support_agents: ['tenant_id', 'chat_id'],
            users: ['tenant_id', 'chat_id'], masters: ['tenant_id', 'chat_id'],
            tenant_roles: ['tenant_id', 'chat_id'], services: ['tenant_id', 'svc_id'],
            tenant_config: ['tenant_id', 'key'], blocked_users: ['tenant_id', 'chat_id'],
            local_tickets: ['tenant_id', 'client_cid'], human_requests: ['tenant_id', 'chat_id'],
            stripe_customers: ['customer_id'], appointments: ['id'],
            platform_tickets: ['id'],
          };
          const pkCols = pkMap[parsed.table] || [parsed.cols[0]];
          const idx = table.findIndex(r => pkCols.every(pk => r[pk] === row[pk]));
          if (idx >= 0) table.splice(idx, 1);
          table.push(row);
          return { success: true };
        }

        if (isIgnore) {
          const pkMap = {
            tenants: ['id'], bots: ['bot_id'], platform_roles: ['chat_id'],
            support_agents: ['chat_id', 'type'], tenant_support_agents: ['tenant_id', 'chat_id'],
            users: ['tenant_id', 'chat_id'], masters: ['tenant_id', 'chat_id'],
            tenant_roles: ['tenant_id', 'chat_id'], services: ['tenant_id', 'svc_id'],
            tenant_config: ['tenant_id', 'key'], blocked_users: ['tenant_id', 'chat_id'],
            stripe_customers: ['customer_id'], appointments: ['id'],
            // Migration 0104: album photos keyed on (tenant_id, id); `id` is a
            // fresh UUID per insert, so re-import never conflicts on the PK
            // (the service dedupes on photo_r2_key instead).
            album_photos: ['tenant_id', 'id'],
            // Migration 0063: idempotency claim for fired reminders.
            plugin_reminder_fires: ['reminder_id', 'fires_at_epoch'],
            // Migration 0063: per-source dedup of bell notifications. The
            // real DB index is partial (only when source_slug + source_id
            // are non-null); we approximate by skipping rows where either
            // is null (treat them as never colliding).
            user_notifications: ['web_user_id', 'source_slug', 'source_id', 'kind'],
          };
          const pkCols = pkMap[parsed.table] || [parsed.cols[0]];
          // Partial-index approximation for user_notifications: rows where
          // source_slug or source_id are null bypass dedup entirely.
          if (parsed.table === 'user_notifications' && (row.source_slug == null || row.source_id == null)) {
            table.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          const exists = table.some(r => pkCols.every(pk => r[pk] === row[pk]));
          if (exists) return { success: true, meta: { changes: 0 } };
          table.push(row);
          return { success: true, meta: { changes: 1 } };
        }
        if (isUpsert) {
          // Balanced parenthesised group so `(tenant_id, COALESCE(master_id, -1), date)`
          // captures everything up to the matching close. The simple `[^)]+` pattern stops
          // at the first `)` and feeds the rest of the clause back as a stray column name.
          const pkMatch = sql.match(/ON\s+CONFLICT\s*\(((?:[^()]|\([^()]*\))+)\)/i);
          if (pkMatch) {
            // Split top-level commas (not commas inside `(...)`).
            const pkSpecs = pkMatch[1]
              .split(/,(?![^(]*\))/)
              .map(c => c.trim());
            // Translate each spec into a row-extractor:
            //   `tenant_id`                  → r => r.tenant_id
            //   `COALESCE(master_id, -1)`    → r => r.master_id ?? -1
            //   anything else                → constant null (ignored)
            const extractors = pkSpecs
              .map(spec => {
                if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(spec)) {
                  return r => r[spec];
                }
                const cm = spec.match(/^COALESCE\(\s*(\w+)\s*,\s*(-?\d+)\s*\)$/i);
                if (cm) {
                  const col = cm[1];
                  const fallback = parseInt(cm[2], 10);
                  return r => (r[col] == null ? fallback : r[col]);
                }
                return null;
              })
              .filter(Boolean);
            // Optional partial-index filter: ON CONFLICT (...) WHERE <col> = <num> DO ...
            // Need a balanced-paren match because the conflict spec may contain
            // function calls like COALESCE(master_id, -1).
            const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*(-?\d+)\s+DO/i);
            const partialFilter = whereMatch
              ? (r => {
                  const col = whereMatch[1];
                  const want = parseInt(whereMatch[2], 10);
                  const got = r[col];
                  if (got == null) return want === 0; // SQLite default for INTEGER NOT NULL DEFAULT 0
                  return got === want;
                })
              : (() => true);
            const existingIdx = extractors.length
              ? table.findIndex(r =>
                  partialFilter(r) && extractors.every(fn => fn(r) === fn(row)))
              : -1;
            if (existingIdx >= 0) {
              // Use [\s\S] so a multi-line SET clause is captured whole.
              // Strip linebreaks afterwards to make the per-clause regexes
              // line-agnostic.
              const updateMatch = sql.match(/DO\s+UPDATE\s+SET\s+([\s\S]+)$/i);
              if (updateMatch) {
                const setBody = updateMatch[1].replace(/\s+/g, ' ');
                // Split top-level commas only — CASE WHEN clauses are
                // collapsed to a single line above.
                const updates = setBody.split(/,(?![^(]*\))/).map(s => s.trim());
                let uIdx = parsed.cols.length;
                for (const u of updates) {
                  // 1) col = excluded.col  OR  col = ?
                  const eqMatch = u.match(/^(\w+)\s*=\s*(?:excluded\.(\w+)|\?)$/);
                  if (eqMatch) {
                    if (eqMatch[2]) {
                      table[existingIdx][eqMatch[1]] = row[eqMatch[2]];
                    } else {
                      table[existingIdx][eqMatch[1]] = params[uIdx++];
                    }
                    continue;
                  }
                  // 2) col = CASE WHEN <a> = excluded.<a> THEN col + N ELSE M END
                  //    Used by checkRateLimit to roll the counter atomically.
                  const caseMatch = u.match(
                    /^(\w+)\s*=\s*CASE\s+WHEN\s+(\w+)\s*=\s*excluded\.(\w+)\s+THEN\s+(\w+)\s*\+\s*(-?\d+)\s+ELSE\s+(-?\d+)\s+END$/i,
                  );
                  if (caseMatch) {
                    const [, target, predCol, predExcl, addBase, deltaStr, elseStr] = caseMatch;
                    const sameWindow = table[existingIdx][predCol] === row[predExcl];
                    const delta = parseInt(deltaStr, 10);
                    const elseVal = parseInt(elseStr, 10);
                    if (sameWindow) {
                      table[existingIdx][target] = (table[existingIdx][addBase] ?? 0) + delta;
                    } else {
                      table[existingIdx][target] = elseVal;
                    }
                    continue;
                  }
                }
              }
              // DO NOTHING — leave existing row untouched and skip insert.
              return { success: true, meta: { changes: 0 } };
            }
          }
        }
        // Simulate AUTOINCREMENT for the allowlisted integer-PK tables so the
        // Worker can read back the generated id via meta.last_row_id.
        if (AUTOINC_TABLES.has(parsed.table) && row.id == null) {
          const maxId = table.reduce((mx, r) => (typeof r.id === 'number' && r.id > mx ? r.id : mx), 0);
          row.id = maxId + 1;
          table.push(row);
          return { success: true, meta: { last_row_id: row.id, changes: 1 } };
        }
        table.push(row);
        return { success: true };
      }

      if (/^UPDATE/i.test(sql)) {
        const parsed = this._parseUpdate();
        if (!parsed) return { success: false };
        const table = getTable(parsed.table);
        const setCols = parsed.setCols.split(',').map(s => s.trim());
        let pIdx = 0;
        const updates = [];
        for (const sc of setCols) {
          const m = sc.match(/^(\w+)\s*=\s*\?$/);
          if (m) updates.push({ col: m[1], valIdx: pIdx++ });
        }
        const conditions = this._buildWhereConditions(parsed.whereClause, params.slice(pIdx));
        let changed = 0;
        for (const row of table) {
          if (matchesWhere(row, conditions)) {
            for (const u of updates) {
              row[u.col] = parseValue(params[u.valIdx]);
            }
            changed++;
          }
        }
        return { success: true, changes: changed };
      }

      if (/^DELETE/i.test(sql)) {
        const parsed = this._parseDelete();
        if (!parsed) return { success: false };
        const table = getTable(parsed.table);
        const conditions = this._buildWhereConditions(parsed.whereClause, params);
        const before = table.length;
        const kept = table.filter(r => !matchesWhere(r, conditions));
        tables.set(parsed.table, kept);
        return { success: true, changes: before - kept.length };
      }

      return { success: true };
    }
  }

  return {
    _tables: tables,
    prepare(sql) {
      return new MockStatement(sql);
    },
    async batch(statements) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    _getTable: getTable,
    _reset() { tables.clear(); },
  };
}

export function makeMockKv(store = new Map()) {
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value, _opts) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

export function makeCtx(opts = {}) {
  const store = opts.store || new Map();
  const kv = opts.kv || makeMockKv(store);
  const db = opts.db || createMockD1();
  return {
    kv,
    globalKv: opts.globalKv || kv,
    db,
    prefix: opts.prefix || 't:test:',
    tenantId: opts.tenantId || 'test',
    tenant: opts.tenant || { salon: { name: 'Test Salon', workHours: { from: 9, to: 19 } }, billingStatus: 'trialing', plan: 'pro' },
    svc: opts.svc || [
      { id: 'classic', e: '💅', dur: 60, price: 80, active: true, names: { ru: 'Маникюр' } },
      { id: 'pedi', e: '🦶', dur: 90, price: 120, active: true, names: { ru: 'Педикюр' } },
    ],
    svcIds: opts.svcIds || new Set(['classic', 'pedi']),
    adminChatId: opts.adminChatId || null,
    ADMIN_CHAT_ID: opts.ADMIN_CHAT_ID || null,
    _store: store,
  };
}

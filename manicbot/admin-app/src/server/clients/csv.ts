/**
 * Clients CSV import/export — toleant parser + canonical exporter.
 *
 * Format (own template — see `CLIENT_CSV_TEMPLATE`):
 *
 *   name,phone,email,telegram,instagram,tags,notes,dob
 *   Karina,+48500152948,kar@nails.com,@karina,@kar_nails,vip,Loyal,1990-05-15
 *
 * Header parsing is case-insensitive and tolerant of common aliases
 * (`phone | tel | mobile`, `email | email_address`, `telegram | tg`,
 * `instagram | ig`, etc.). Unknown headers are silently dropped — they
 * surface in the import preview where the user can re-map them.
 *
 * Tag values may be `tag1,tag2,tag3` *within a single CSV cell* — quote
 * the cell to escape the commas (`"vip,returning"`). The parser stores
 * them verbatim in `tags`; the caller decides whether to split them.
 *
 * Dates: only `YYYY-MM-DD` is accepted. Anything else is collected as a
 * row-level error so the operator sees exactly which rows to fix.
 */

export interface ParsedClientRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  tgUsername: string | null;
  igUsername: string | null;
  tags: string | null;
  notes: string | null;
  dob: string | null;
}

export interface RowError {
  row: number;     // 1-based row number in the CSV (header is row 0)
  reason: string;
}

export interface ParseResult {
  rows: ParsedClientRow[];
  errors: RowError[];
}

/** Canonical CSV template offered as a download from the import modal. */
export const CLIENT_CSV_TEMPLATE =
  "name,phone,email,telegram,instagram,tags,notes,dob\n" +
  "Karina Sokolova,+48500152948,karina@example.com,karina,kar_nails,\"vip,returning\",Allergic to acetone,1990-05-15\n" +
  "Tatyana Holubieva,+48500152948,,tatyana,,returning,,\n";

// ─── Header alias table ──────────────────────────────────────────────────────
type Field = keyof ParsedClientRow;

const HEADER_ALIASES: Record<string, Field> = {
  name: "name", client_name: "name", first_name: "name", "full name": "name", "client name": "name",
  phone: "phone", tel: "phone", mobile: "phone", phone_number: "phone", "phone number": "phone", cell: "phone",
  email: "email", email_address: "email", mail: "email", "e-mail": "email", "email address": "email",
  telegram: "tgUsername", tg: "tgUsername", tg_username: "tgUsername", tgnick: "tgUsername", telegram_username: "tgUsername", "telegram nickname": "tgUsername",
  instagram: "igUsername", ig: "igUsername", insta: "igUsername", instahandle: "igUsername", instagram_username: "igUsername", "ig handle": "igUsername",
  tags: "tags", labels: "tags", categories: "tags",
  notes: "notes", comment: "notes", comments: "notes", note: "notes",
  dob: "dob", birthday: "dob", birth_date: "dob", date_of_birth: "dob", "date of birth": "dob",
};

function normHeader(h: string): Field | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, " ").replace(/-/g, "-");
  return HEADER_ALIASES[key] ?? null;
}

// ─── Tokeniser ───────────────────────────────────────────────────────────────
// RFC 4180-ish: handles quoted cells, embedded commas, embedded newlines,
// and doubled-up quotes for escaping. Returns array of rows; each row is
// an array of cells.
function tokenize(input: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuote = false;
  let i = 0;

  // Strip BOM if present.
  if (input.charCodeAt(0) === 0xfeff) i = 1;

  while (i < input.length) {
    const ch = input[i];

    if (inQuote) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = true;
      i++;
      continue;
    }
    if (ch === ",") {
      cur.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Normalize CRLF to single row break.
      if (ch === "\r" && input[i + 1] === "\n") i++;
      cur.push(cell);
      // Skip rows that are entirely empty (a single empty cell from a stray newline).
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  // Tail-handle the last row (no trailing newline).
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  }

  return rows;
}

// ─── Normalisers ─────────────────────────────────────────────────────────────
function tidy(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function tidyHandle(v: string | undefined): string | null {
  const t = tidy(v);
  if (!t) return null;
  return t.replace(/^@+/, "");
}

function tidyDob(v: string | undefined): { value: string | null; error: string | null } {
  const t = tidy(v);
  if (!t) return { value: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { value: null, error: `invalid date "${t}" — expected YYYY-MM-DD` };
  }
  // Reject sentinel values like 0000-00-00.
  const [y, m, d] = t.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
    return { value: null, error: `invalid date "${t}"` };
  }
  return { value: t, error: null };
}

// ─── Parser ──────────────────────────────────────────────────────────────────
export function parseClientsCsv(input: string): ParseResult {
  const errors: RowError[] = [];
  const rows: ParsedClientRow[] = [];

  if (!input || !input.trim()) {
    return { rows, errors };
  }

  const tokens = tokenize(input);
  if (tokens.length === 0) return { rows, errors };

  const headerRow = tokens[0]!;
  const mapping: Array<Field | null> = headerRow.map(normHeader);
  const knownCount = mapping.filter((m) => m !== null).length;
  if (knownCount === 0) {
    errors.push({
      row: 0,
      reason: "header has no recognized column (expected at least one of name/phone/email/telegram/instagram)",
    });
    return { rows, errors };
  }

  for (let r = 1; r < tokens.length; r++) {
    const row = tokens[r]!;
    if (row.length === 1 && row[0] === "") continue; // skip blank lines

    const parsed: ParsedClientRow = {
      name: null,
      phone: null,
      email: null,
      tgUsername: null,
      igUsername: null,
      tags: null,
      notes: null,
      dob: null,
    };

    for (let i = 0; i < row.length; i++) {
      const field = mapping[i];
      if (!field) continue;
      const raw = row[i];
      switch (field) {
        case "name":       parsed.name = tidy(raw); break;
        case "phone":      parsed.phone = tidy(raw); break;
        case "email":      parsed.email = tidy(raw)?.toLowerCase() ?? null; break;
        case "tgUsername": parsed.tgUsername = tidyHandle(raw); break;
        case "igUsername": parsed.igUsername = tidyHandle(raw); break;
        case "tags":       parsed.tags = tidy(raw); break;
        case "notes":      parsed.notes = tidy(raw); break;
        case "dob": {
          const { value, error } = tidyDob(raw);
          parsed.dob = value;
          if (error) errors.push({ row: r, reason: error });
          break;
        }
      }
    }

    // Reject row entirely if no contact at all.
    if (!parsed.name && !parsed.phone && !parsed.email && !parsed.tgUsername && !parsed.igUsername) {
      errors.push({ row: r, reason: "row has no recognizable contact (need at least one of name/phone/email/telegram/instagram)" });
      continue;
    }

    rows.push(parsed);
  }

  return { rows, errors };
}

// ─── Exporter ────────────────────────────────────────────────────────────────
export interface ExportableClient {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  tgUsername?: string | null;
  igUsername?: string | null;
  tags?: string | null;
  notes?: string | null;
  dob?: string | null;
  lifetimeVisits?: number | null;
  lastVisitAt?: number | null;
}

function escapeCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CLIENT_EXPORT_HEADERS = [
  "name",
  "phone",
  "email",
  "telegram",
  "instagram",
  "tags",
  "notes",
  "dob",
  "lifetime_visits",
  "last_visit_at",
];

export function clientsToCsv(clients: ExportableClient[]): string {
  const lines: string[] = [CLIENT_EXPORT_HEADERS.join(",")];
  for (const c of clients) {
    lines.push([
      escapeCell(c.name),
      escapeCell(c.phone),
      escapeCell(c.email),
      escapeCell(c.tgUsername),
      escapeCell(c.igUsername),
      escapeCell(c.tags),
      escapeCell(c.notes),
      escapeCell(c.dob),
      escapeCell(c.lifetimeVisits ?? 0),
      escapeCell(c.lastVisitAt ?? ""),
    ].join(","));
  }
  return lines.join("\n");
}

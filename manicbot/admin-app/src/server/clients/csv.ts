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

/**
 * Header → canonical field map. Includes ManicBot's own short names,
 * Google Contacts CSV columns (`First Name`, `E-mail 1 - Value`, …), and
 * common variants from third-party tools.
 *
 * A few extras are routed through internal sentinel fields:
 *   - `__firstName` / `__lastName`: composed into `name` after parse.
 *   - `__nickname`: used as `name` fallback when neither first nor last
 *     column exists (Google's "Nickname" column).
 */
const INTERNAL_FIRST_NAME = "__firstName" as const;
const INTERNAL_LAST_NAME = "__lastName" as const;
const INTERNAL_NICKNAME = "__nickname" as const;
type InternalField = typeof INTERNAL_FIRST_NAME | typeof INTERNAL_LAST_NAME | typeof INTERNAL_NICKNAME;
type MappableField = Field | InternalField;

const HEADER_ALIASES: Record<string, MappableField> = {
  // ManicBot native
  name: "name", client_name: "name", "full name": "name", "client name": "name",
  phone: "phone", tel: "phone", mobile: "phone", phone_number: "phone", "phone number": "phone", cell: "phone",
  email: "email", email_address: "email", mail: "email", "e-mail": "email", "email address": "email",
  telegram: "tgUsername", tg: "tgUsername", tg_username: "tgUsername", tgnick: "tgUsername", telegram_username: "tgUsername", "telegram nickname": "tgUsername",
  instagram: "igUsername", ig: "igUsername", insta: "igUsername", instahandle: "igUsername", instagram_username: "igUsername", "ig handle": "igUsername",
  tags: "tags", labels: "tags", categories: "tags", "group membership": "tags",
  notes: "notes", comment: "notes", comments: "notes", note: "notes",
  dob: "dob", birthday: "dob", birth_date: "dob", date_of_birth: "dob", "date of birth": "dob",
  // Google Contacts CSV — composed name
  "first name": INTERNAL_FIRST_NAME, first_name: INTERNAL_FIRST_NAME, given_name: INTERNAL_FIRST_NAME, "given name": INTERNAL_FIRST_NAME,
  "last name": INTERNAL_LAST_NAME, last_name: INTERNAL_LAST_NAME, family_name: INTERNAL_LAST_NAME, "family name": INTERNAL_LAST_NAME, surname: INTERNAL_LAST_NAME,
  nickname: INTERNAL_NICKNAME,
  // Google Contacts CSV — first-of-N indexed columns. We accept any
  // `e-mail N - value` / `phone N - value` and pick the first non-empty.
  "e-mail 1 - value": "email", "email 1 - value": "email",
  "e-mail 2 - value": "email", "email 2 - value": "email",
  "phone 1 - value": "phone",
  "phone 2 - value": "phone",
};

function normHeader(h: string): MappableField | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, " ");
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
/**
 * Parse a CSV string (ManicBot or Google Contacts shape) OR a vCard 3.0/4.0
 * payload (Apple Contacts export). The dispatch is auto-detected from the
 * first non-blank line: a `BEGIN:VCARD` prefix routes through the vCard
 * parser; anything else is treated as CSV.
 */
export function parseClientsCsv(input: string): ParseResult {
  if (!input || !input.trim()) {
    return { rows: [], errors: [] };
  }
  if (looksLikeVCard(input)) {
    return parseVCard(input);
  }

  const errors: RowError[] = [];
  const rows: ParsedClientRow[] = [];

  const tokens = tokenize(input);
  if (tokens.length === 0) return { rows, errors };

  const headerRow = tokens[0]!;
  const mapping: Array<MappableField | null> = headerRow.map(normHeader);
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
    let firstName: string | null = null;
    let lastName: string | null = null;
    let nickname: string | null = null;

    for (let i = 0; i < row.length; i++) {
      const field = mapping[i];
      if (!field) continue;
      const raw = row[i];
      switch (field) {
        case "name":       parsed.name = parsed.name ?? tidy(raw); break;
        case "phone":      parsed.phone = parsed.phone ?? tidy(raw); break;
        case "email":      parsed.email = parsed.email ?? (tidy(raw)?.toLowerCase() ?? null); break;
        case "tgUsername": parsed.tgUsername = parsed.tgUsername ?? tidyHandle(raw); break;
        case "igUsername": parsed.igUsername = parsed.igUsername ?? tidyHandle(raw); break;
        case "tags":       parsed.tags = parsed.tags ?? tidy(raw); break;
        case "notes":      parsed.notes = parsed.notes ?? tidy(raw); break;
        case "dob": {
          const { value, error } = tidyDob(raw);
          if (value !== null) parsed.dob = parsed.dob ?? value;
          if (error) errors.push({ row: r, reason: error });
          break;
        }
        case INTERNAL_FIRST_NAME: firstName = tidy(raw); break;
        case INTERNAL_LAST_NAME:  lastName = tidy(raw); break;
        case INTERNAL_NICKNAME:   nickname = tidy(raw); break;
      }
    }

    // Compose `name` from First + Last when the row carries them but no
    // explicit name column. Nickname is the lowest-priority fallback.
    if (!parsed.name) {
      if (firstName || lastName) {
        parsed.name = [firstName, lastName].filter(Boolean).join(" ") || null;
      } else if (nickname) {
        parsed.name = nickname;
      }
    }

    // Google Contacts CSV has no native Telegram / Instagram columns, so
    // our export buries them in Notes ("Telegram: @handle"). Re-extract
    // here so a Google round-trip preserves the handles.
    extractHandlesFromNotes(parsed);

    // Reject row entirely if no contact at all.
    if (!parsed.name && !parsed.phone && !parsed.email && !parsed.tgUsername && !parsed.igUsername) {
      errors.push({ row: r, reason: "row has no recognizable contact (need at least one of name/phone/email/telegram/instagram)" });
      continue;
    }

    rows.push(parsed);
  }

  return { rows, errors };
}

/**
 * Mutate `parsed` in place: if its notes carry "Telegram: @handle" or
 * "Instagram: @handle" and the corresponding handle field is still null,
 * lift the handle out. Used by both the CSV and vCard paths so a
 * Google ↔ ManicBot or Apple ↔ ManicBot round trip keeps the handles.
 */
function extractHandlesFromNotes(parsed: ParsedClientRow): void {
  if (!parsed.notes) return;
  if (!parsed.tgUsername) {
    // Min 1 char — the parser is permissive at the boundary; real Telegram
    // enforces a 5-char minimum on its side, but a tolerant import lets
    // garbage in for the operator to clean later (we'd lose data otherwise).
    const m = parsed.notes.match(/telegram[:\s]+@?([A-Za-z0-9_]+)/i);
    if (m) parsed.tgUsername = m[1]!;
  }
  if (!parsed.igUsername) {
    const m = parsed.notes.match(/instagram[:\s]+@?([A-Za-z0-9_.]+)/i);
    if (m) parsed.igUsername = m[1]!;
  }
}

// ─── vCard 3.0 / 4.0 parser (Apple Contacts export) ──────────────────────────
function looksLikeVCard(input: string): boolean {
  // Apple sometimes emits a UTF-8 BOM. Strip then check the first non-blank line.
  const trimmed = input.replace(/^﻿/, "").trimStart().toUpperCase();
  return trimmed.startsWith("BEGIN:VCARD");
}

/** Unfold RFC 6350 line continuations (a leading space/tab on the next line
 *  means "append to previous"). */
function unfoldVCardLines(text: string): string[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const unfolded: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function decodeVCardValue(v: string): string {
  // We don't support quoted-printable; just decode the common escape sequences.
  return v
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseVCard(input: string): ParseResult {
  const errors: RowError[] = [];
  const rows: ParsedClientRow[] = [];
  const lines = unfoldVCardLines(input);

  let inCard = false;
  let cur: ParsedClientRow | null = null;
  let cardIndex = 0;
  // Used for the "extract @telegram / @instagram from NOTE" rule below.
  let curNote: string | null = null;

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      inCard = true;
      cardIndex++;
      cur = { name: null, phone: null, email: null, tgUsername: null, igUsername: null, tags: null, notes: null, dob: null };
      curNote = null;
      continue;
    }
    if (upper === "END:VCARD") {
      if (cur) {
        if (curNote) cur.notes = curNote;
        // Lift "Telegram: @handle" / "Instagram: @handle" out of NOTE for
        // the same reason as the CSV path (shared regex helper).
        extractHandlesFromNotes(cur);
        if (!cur.name && !cur.phone && !cur.email && !cur.tgUsername && !cur.igUsername) {
          errors.push({ row: cardIndex, reason: "vCard has no recognizable contact" });
        } else {
          rows.push(cur);
        }
      }
      inCard = false;
      cur = null;
      continue;
    }
    if (!inCard || !cur) continue;

    // Split at the first colon to separate property+params from value.
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const head = line.slice(0, colonIdx);
    const value = decodeVCardValue(line.slice(colonIdx + 1));
    if (!value) continue;

    // Property name = head up to the first semicolon (the rest is params we ignore).
    const semi = head.indexOf(";");
    const prop = (semi >= 0 ? head.slice(0, semi) : head).toUpperCase();

    switch (prop) {
      case "FN":
        if (!cur.name) cur.name = value;
        break;
      case "N":
        // Format: Family;Given;Middle;Prefix;Suffix
        if (!cur.name) {
          const parts = value.split(";");
          const family = parts[0]?.trim() ?? "";
          const given = parts[1]?.trim() ?? "";
          const composed = [given, family].filter(Boolean).join(" ").trim();
          if (composed) cur.name = composed;
        }
        break;
      case "TEL":
        if (!cur.phone) cur.phone = value;
        break;
      case "EMAIL":
        if (!cur.email) cur.email = value.toLowerCase();
        break;
      case "BDAY": {
        // Accept YYYY-MM-DD or YYYYMMDD. Anything else is silently dropped.
        const m = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
        if (m && !cur.dob) cur.dob = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
      case "NOTE":
        curNote = value;
        break;
      case "CATEGORIES":
        if (!cur.tags) cur.tags = value;
        break;
      case "X-TELEGRAM":
      case "X-MANICBOT-TELEGRAM":
        if (!cur.tgUsername) cur.tgUsername = value.replace(/^@+/, "");
        break;
      case "X-INSTAGRAM":
      case "X-MANICBOT-INSTAGRAM":
        if (!cur.igUsername) cur.igUsername = value.replace(/^@+/, "");
        break;
    }
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

// ─── Google Contacts CSV ─────────────────────────────────────────────────────
/**
 * Google Contacts CSV (a focused subset of the format documented at
 * https://support.google.com/contacts/answer/1069522). Google's CSV import
 * accepts a sparse column set as long as the canonical header names are
 * spelled correctly — we ship First / Last / E-mail 1 - Value / Phone 1
 * - Value / Birthday / Notes / Labels.
 *
 * Telegram + Instagram handles are appended to the Notes field as
 * "Telegram: @handle" / "Instagram: @handle" — Google has no native column
 * for them, but our own importer (and the vCard re-import path) can pull
 * them back out via a regex on Notes.
 */
export const GOOGLE_EXPORT_HEADERS = [
  "First Name",
  "Last Name",
  "E-mail 1 - Value",
  "Phone 1 - Value",
  "Birthday",
  "Notes",
  "Labels",
];

function splitName(full: string | null | undefined): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const trimmed = full.trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() };
}

function composeNotesWithHandles(c: ExportableClient): string {
  const parts: string[] = [];
  if (c.notes) parts.push(c.notes);
  if (c.tgUsername) parts.push(`Telegram: @${c.tgUsername}`);
  if (c.igUsername) parts.push(`Instagram: @${c.igUsername}`);
  return parts.join("\n");
}

export function clientsToGoogleCsv(clients: ExportableClient[]): string {
  const lines: string[] = [GOOGLE_EXPORT_HEADERS.join(",")];
  for (const c of clients) {
    const { first, last } = splitName(c.name);
    lines.push([
      escapeCell(first),
      escapeCell(last),
      escapeCell(c.email),
      escapeCell(c.phone),
      escapeCell(c.dob),                  // Google accepts YYYY-MM-DD
      escapeCell(composeNotesWithHandles(c)),
      escapeCell(c.tags),                 // Google calls these "Labels"
    ].join(","));
  }
  return lines.join("\n");
}

// ─── Apple Contacts vCard 3.0 ────────────────────────────────────────────────
function vcardEscape(v: string): string {
  // RFC 6350 §3.4 — escape backslash, comma, semicolon, newline.
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/**
 * One vCard 3.0 block per client. Apple Contacts imports vCard files
 * natively (drag-drop into the app or open via Files). Optional `X-`
 * properties carry the Telegram / Instagram handles so an Apple → Apple
 * round trip preserves them; non-Apple consumers ignore unknown X-prefixed
 * fields per RFC 6350 §6.10.
 */
export function clientsToVcard(clients: ExportableClient[]): string {
  const blocks: string[] = [];
  for (const c of clients) {
    const { first, last } = splitName(c.name);
    const lines: string[] = [];
    lines.push("BEGIN:VCARD");
    lines.push("VERSION:3.0");
    if (c.name) {
      lines.push(`FN:${vcardEscape(c.name)}`);
      lines.push(`N:${vcardEscape(last)};${vcardEscape(first)};;;`);
    }
    if (c.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(c.phone)}`);
    if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(c.email)}`);
    if (c.dob) lines.push(`BDAY:${vcardEscape(c.dob)}`);
    const note = composeNotesWithHandles(c);
    if (note) lines.push(`NOTE:${vcardEscape(note)}`);
    if (c.tags) lines.push(`CATEGORIES:${vcardEscape(c.tags)}`);
    if (c.tgUsername) lines.push(`X-TELEGRAM:${vcardEscape(c.tgUsername)}`);
    if (c.igUsername) lines.push(`X-INSTAGRAM:${vcardEscape(c.igUsername)}`);
    lines.push("END:VCARD");
    // CRLF per RFC 6350 §3.2 — Apple is tolerant of LF, but the spec is CRLF.
    blocks.push(lines.join("\r\n"));
  }
  return blocks.join("\r\n");
}

// ─── Export format dispatch ──────────────────────────────────────────────────
export type ExportFormat = "manicbot" | "google" | "apple";

export interface ExportArtifact {
  data: string;
  mime: string;
  extension: string;
}

/** Single entry point used by `clients.exportCsv` — formats are 1:1 with
 *  the UI dropdown in the Salon Clients tab header. */
export function clientsToFormat(
  clients: ExportableClient[],
  format: ExportFormat,
): ExportArtifact {
  switch (format) {
    case "google":
      return { data: clientsToGoogleCsv(clients), mime: "text/csv;charset=utf-8", extension: "csv" };
    case "apple":
      return { data: clientsToVcard(clients), mime: "text/vcard;charset=utf-8", extension: "vcf" };
    case "manicbot":
    default:
      return { data: clientsToCsv(clients), mime: "text/csv;charset=utf-8", extension: "csv" };
  }
}

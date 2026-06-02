/**
 * #M-07-1 / #M-07-5 — CSV-injection-safe cell encoder.
 *
 * Spreadsheet apps (Excel / Google Sheets / LibreOffice) execute a cell whose
 * text begins with `=`, `+`, `-`, `@` (or a leading TAB / CR) as a FORMULA when
 * the file is opened. ManicBot CSV exports carry UNTRUSTED booking/lead input
 * (e.g. a client's display name, set during a public booking), so a value like
 * `=HYPERLINK("http://evil","x")` or `=cmd|'/c calc'!A1` would execute on the
 * operator's machine when they open the export. We neutralize by prefixing a
 * single quote — the spreadsheet text-marker, which the app hides on display —
 * then apply standard CSV quoting (RFC 4180).
 *
 * Single source of truth for every CSV exporter (clients, marketing, god-mode
 * exports). Re-importers should strip a leading `'` (the Clients importer is
 * tolerant of it).
 */
export function csvCell(value: string | number | null | undefined): string {
  let v = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

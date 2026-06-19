/**
 * AUTO-GENERATED — top-down, domain-grouped DB map (Mermaid flowchart),
 * derived from `manicbot/src/db/schema.sql`.
 *
 * The COMMITTED copy of this file is intentionally a STUB. The real diagram is
 * regenerated on every admin-app deploy by `scripts/gen-erd.mjs` (CI step
 * "Generate architecture ERD"), which overwrites this file in the build
 * workspace ONLY — it is never committed back. That keeps the rendered
 * architecture private to the God-Mode page and out of the public repo: the
 * diagram is served exclusively through `system.getArchitectureDiagram`
 * (adminProcedure) and contains table NAMES only — the same surface already
 * public in schema.sql, never any secret values.
 *
 * Do NOT hand-edit. Do NOT commit a generated (non-stub) copy.
 */
export const ERD_MERMAID = `flowchart TD
  ROOT["🗄️ ManicBot · база данных D1"]:::root
  ROOT --> pending["Карта генерируется на деплое"]
  classDef root fill:#0f172a,stroke:#0ea5e9,color:#f8fafc;`;

export const ERD_META: {
  generatedAt: string | null;
  tableCount: number;
  domainCount: number;
  source: "stub" | "generated";
} = {
  generatedAt: null,
  tableCount: 0,
  domainCount: 0,
  source: "stub",
};

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFtsMatchExpression } from "~/server/api/publicSalon/publicSalonSearchLogic";

/**
 * End-to-end FTS5 integration test (relax.md §4 P0-5).
 *
 * Spins up an in-memory SQLite database via `node:sqlite` (Node 22+),
 * runs migration 0004 (`tenant_fts` virtual table) and migration 0054
 * (the new INSERT/UPDATE/DELETE triggers we add in this PR), and then
 * exercises `MATCH ?` against multi-language fixtures.
 *
 * We deliberately do not import the tRPC router here — the goal is to
 * lock the SQL behaviour the router depends on. Router-shape tests live
 * in `publicSalon-fts-logic.test.ts` and the existing `salon.test.ts`.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../../../migrations");

const M0004 = readFileSync(resolve(MIGRATIONS_DIR, "0004_fts_search.sql"), "utf8");
const M0054 = readFileSync(resolve(MIGRATIONS_DIR, "0054_tenant_fts_triggers.sql"), "utf8");

/** Strip `ALTER TABLE ...` lines from 0004 — the test schema below
 * already includes `search_text` etc. so we can apply the migration
 * against a fresh tenants table. */
function applicableFtsBootstrap(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.match(/^\s*ALTER\s+TABLE/i))
    .join("\n");
}

async function openTestDb() {
  // node:sqlite is shipped with Node 22+ but has no @types entry, so
  // the dynamic import is intentionally untyped. The DatabaseSync API
  // is stable across the 22.x line.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error -- node:sqlite is a runtime-only module
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(":memory:");

  // Minimal schema that mirrors the tenants columns the FTS triggers
  // touch (id + search_text). Real schema has 40+ cols — we only need
  // these to exercise the indexing pipeline.
  db.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      city TEXT,
      search_text TEXT,
      public_active INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(applicableFtsBootstrap(M0004));
  db.exec(M0054);
  return db;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  city: string;
  searchText: string;
  publicActive?: number;
}

function seed(db: any, rows: Tenant[]) {
  const stmt = db.prepare(
    `INSERT INTO tenants(id, name, slug, city, search_text, public_active) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(r.id, r.name, r.slug, r.city, r.searchText, r.publicActive ?? 1);
  }
}

// Multi-lang fixtures. Words chosen so the FTS5 `unicode61` tokenizer
// gives us correct rows for the queries the relax.md §4 P0-5 audit
// explicitly called out (Polish "łańcuch", Ukrainian "лак", Russian
// "маникюр", English "polish").
//
// Note on diacritics: SQLite's `remove_diacritics 1` strips combining
// marks via NFD — that works for ż/ó/ą/ć/ń but NOT for ł (Polish "ł"
// is not NFD-decomposable). So our search_text stores BOTH the form
// with diacritics AND the ASCII variant for ł — mimicking what the app
// already does via `cyrillicToLatin` for Cyrillic queries.
const FIXTURES: Tenant[] = [
  // Polish — "łańcuch" with diacritic-safe transliteration.
  {
    id: "t_pl_lancuch",
    name: "Salon Łańcuch Złoty",
    slug: "lancuch-zloty",
    city: "Warszawa",
    searchText: "salon łańcuch złoty lancuch zloty warszawa paznokcie polish manicure",
  },
  // Polish — pure ASCII so we exercise "polish" English match too.
  {
    id: "t_pl_polish",
    name: "Polish Studio",
    slug: "polish-studio",
    city: "Krakow",
    searchText: "polish studio krakow nails english manicure",
  },
  // Ukrainian language (PL-based salon serving Ukrainian-speaking clients)
  {
    id: "t_ua_lak",
    name: "Лак Студія",
    slug: "lak-studia",
    city: "Wrocław",
    searchText: "лак студія wrocław манікюр",
  },
  // Russian language (PL-based salon serving Russian-speaking clients)
  {
    id: "t_ru_manicure",
    name: "Маникюр Плюс",
    slug: "manicure-plus",
    city: "Gdańsk",
    searchText: "маникюр педикюр gdańsk салон",
  },
  // English
  {
    id: "t_en_nails",
    name: "English Nails",
    slug: "english-nails",
    city: "London",
    searchText: "english nails london",
  },
];

// node:sqlite ships with Node 22+. CI is still on Node 20 — skip the
// integration suite there. The migration-shape suite below (text-only,
// no DB) still runs everywhere.
const NODE_MAJOR = Number(process.versions.node.split(".")[0] ?? 0);
const describeOnSqlite = NODE_MAJOR >= 22 ? describe : describe.skip;

describeOnSqlite("FTS5 integration — multi-language search", () => {
  let db: any;
  beforeAll(async () => {
    db = await openTestDb();
    seed(db, FIXTURES);
  });

  function ftsMatch(expr: string): { id: string }[] {
    return db
      .prepare(
        `SELECT tenants.id FROM tenants
         INNER JOIN tenant_fts ON tenant_fts.tenant_id = tenants.id
         WHERE tenant_fts MATCH ? AND tenants.public_active = 1
         ORDER BY tenants.id`,
      )
      .all(expr) as { id: string }[];
  }

  function searchViaBuilder(raw: string): string[] {
    const expr = buildFtsMatchExpression(raw);
    if (!expr) return [];
    return ftsMatch(expr).map((r) => r.id);
  }

  it("seeds tenant_fts via the INSERT trigger (no manual reindex needed)", () => {
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM tenant_fts")
      .get() as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(FIXTURES.length);
  });

  it("finds the Polish row by 'lancuch' (ASCII fallback in search_text)", () => {
    expect(searchViaBuilder("lancuch")).toContain("t_pl_lancuch");
  });

  it("finds the Polish row by 'łańcuch' (with original diacritics)", () => {
    // Stored search_text has 'łańcuch' verbatim. unicode61 indexes Polish
    // ł as itself; the query token must match. We assert the row is
    // returned for the diacritic form.
    expect(searchViaBuilder("łańcuch")).toContain("t_pl_lancuch");
  });

  it("finds the Ukrainian row by Cyrillic 'лак'", () => {
    expect(searchViaBuilder("лак")).toContain("t_ua_lak");
  });

  it("finds the Russian row by Cyrillic 'маникюр'", () => {
    expect(searchViaBuilder("маникюр")).toContain("t_ru_manicure");
  });

  it("matches English 'polish' on the polish-studio row", () => {
    const ids = searchViaBuilder("polish");
    expect(ids).toContain("t_pl_polish");
    // The Polish-named row also has the english word "polish" in its
    // search_text blob, so it matches too — that's expected with FTS5.
    expect(ids).toContain("t_pl_lancuch");
  });

  it("supports prefix matching via trailing '*' for the partial 'man'", () => {
    const ids = searchViaBuilder("man");
    // Both Polish rows mention 'manicure' in search_text.
    expect(ids).toEqual(expect.arrayContaining(["t_pl_lancuch", "t_pl_polish"]));
  });

  it("Cyrillic→Latin OR-branch lets a Cyrillic query find a Latin-only row", () => {
    // Add a tenant whose search_text was stored entirely in Latin (legacy
    // /admin/seed pattern) but whose canonical name is Cyrillic.
    db.prepare(
      `INSERT INTO tenants(id, name, slug, city, search_text, public_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "t_latin_only",
      "Маникюр Latin",
      "manikyur-latin",
      "Warszawa",
      "manikyur latin warsaw",
      1,
    );
    // Cyrillic input "маникюр" should still find this row because
    // buildFtsMatchExpression emits the Latin transliteration as an
    // OR-branch.
    expect(searchViaBuilder("маникюр")).toContain("t_latin_only");
  });

  it("UPDATE trigger keeps tenant_fts in sync when search_text changes", () => {
    db.prepare(`UPDATE tenants SET search_text = ? WHERE id = ?`).run(
      "completely different keywords",
      "t_en_nails",
    );
    // Old token "english" no longer matches.
    expect(searchViaBuilder("english")).not.toContain("t_en_nails");
    // New tokens do.
    expect(searchViaBuilder("completely")).toContain("t_en_nails");
    expect(searchViaBuilder("keywords")).toContain("t_en_nails");
  });

  it("DELETE trigger drops the corresponding tenant_fts row", () => {
    db.prepare("DELETE FROM tenants WHERE id = ?").run("t_ru_manicure");
    // After delete, the Russian-language row is gone — but the Latin-only
    // sibling tenant "t_latin_only" inserted earlier still matches "маникюр"
    // via the Cyrillic→Latin OR-branch, so we assert specifically that the
    // deleted row no longer appears in results.
    expect(searchViaBuilder("маникюр")).not.toContain("t_ru_manicure");
  });

  it("returns no rows when sanitisation strips the query to empty", () => {
    expect(buildFtsMatchExpression("!!!")).toBeNull();
    expect(searchViaBuilder("!!!")).toEqual([]);
  });
});

describe("FTS5 migration shape (text-only, no DB)", () => {
  it("0054 declares INSERT, UPDATE, and DELETE triggers on tenants", () => {
    expect(M0054).toMatch(/CREATE TRIGGER IF NOT EXISTS tenant_fts_ai[\s\S]+?AFTER INSERT ON tenants/);
    expect(M0054).toMatch(/CREATE TRIGGER IF NOT EXISTS tenant_fts_au[\s\S]+?AFTER UPDATE ON tenants/);
    expect(M0054).toMatch(/CREATE TRIGGER IF NOT EXISTS tenant_fts_ad[\s\S]+?AFTER DELETE ON tenants/);
  });

  it("0054 backfills tenant_fts from existing tenants", () => {
    expect(M0054).toMatch(/INSERT INTO tenant_fts\(tenant_id, content\)[\s\S]+SELECT id, COALESCE\(search_text, ''\)[\s\S]+FROM tenants;/);
  });

  it("0054 uses 'delete then insert' update pattern (FTS5 cannot UPDATE rows in place)", () => {
    expect(M0054).toMatch(/AFTER UPDATE ON tenants[\s\S]+DELETE FROM tenant_fts WHERE tenant_id = OLD\.id;[\s\S]+INSERT INTO tenant_fts/);
  });
});

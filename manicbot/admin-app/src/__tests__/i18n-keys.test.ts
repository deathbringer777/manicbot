import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t, type Lang } from "~/lib/i18n";

const LANGS: Lang[] = ["ru", "ua", "en", "pl"];

const i18nSource = readFileSync(
  join(import.meta.dirname, "..", "lib", "i18n.ts"),
  "utf8",
);

/** Pull every translation key declaration ("key.name": { ru: ..., ua: ..., en: ..., pl: ... }) out of the source file. */
function parseI18nEntries(): Array<{ key: string; ru: string; ua: string; en: string; pl: string; line: number }> {
  const entries: Array<{ key: string; ru: string; ua: string; en: string; pl: string; line: number }> = [];
  const lines = i18nSource.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^\s*"([^"]+)":\s*\{\s*ru:\s*"((?:[^"\\]|\\.)*)",\s*ua:\s*"((?:[^"\\]|\\.)*)",\s*en:\s*"((?:[^"\\]|\\.)*)",\s*pl:\s*"((?:[^"\\]|\\.)*)"\s*\}/.exec(line);
    if (m) {
      entries.push({ key: m[1]!, ru: m[2]!, ua: m[3]!, en: m[4]!, pl: m[5]!, line: i + 1 });
    }
  }
  return entries;
}

describe("i18n keys", () => {
  const entries = parseI18nEntries();

  it("file is parsed (sanity check)", () => {
    expect(entries.length).toBeGreaterThan(500);
  });

  it("every key has a non-empty translation in all 4 languages", () => {
    const broken: string[] = [];
    for (const e of entries) {
      for (const lang of LANGS) {
        if (!e[lang] || e[lang].trim() === "") {
          broken.push(`${e.key} (line ${e.line}) missing/empty for ${lang}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("there are no duplicate keys", () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const e of entries) {
      const prev = seen.get(e.key);
      if (prev !== undefined) {
        dupes.push(`${e.key}: lines ${prev} and ${e.line}`);
      } else {
        seen.set(e.key, e.line);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("t() returns a non-empty string for every key in every language", () => {
    const broken: string[] = [];
    for (const e of entries) {
      for (const lang of LANGS) {
        // The key is asserted via the parser to exist on `translations` — cast to keyof typeof translations.
        const value = t(e.key as never, lang);
        if (!value || value === e.key) {
          broken.push(`t("${e.key}", "${lang}") returned ${JSON.stringify(value)}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("Russian and Polish translations differ for at least 80% of keys (no copy-paste regressions)", () => {
    // Sanity check — if someone accidentally fills pl with the ru value for many keys this catches it.
    // 80% threshold accounts for legitimately identical short tokens (Email, Stripe, Telegram, OK, MRR, etc.).
    let differ = 0;
    for (const e of entries) {
      if (e.ru !== e.pl) differ++;
    }
    const ratio = differ / entries.length;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
  });
});

describe("dashboard pages have no hardcoded Cyrillic strings", () => {
  // Files we've explicitly migrated to t() — they must not regress.
  const dashboardRoot = join(import.meta.dirname, "..", "app", "(dashboard)");
  const componentsRoot = join(import.meta.dirname, "..", "components");

  // Files that still legitimately contain a small amount of Cyrillic (intentionally left as-is)
  // Each entry: relative path => list of substrings that are allowed Cyrillic occurrences
  const ALLOWLIST: Record<string, string[]> = {
    // Single-letter weekday abbreviations (ru/ua localized at runtime)
    "(dashboard)/appointments/AppointmentsPageClient.tsx": ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    // timeAgo unit abbreviations — single letters (с/м/ч/д) are universal short forms
    "(dashboard)/events/EventsPageClient.tsx": ["с", "м", "ч", "д"],
    "components/ActivityFeed.tsx": ["с"],
  };

  const TARGET_FILES = [
    "(dashboard)/billing/BillingPageClient.tsx",
    "(dashboard)/tenants/TenantsPageClient.tsx",
    "(dashboard)/users/UsersPageClient.tsx",
    "(dashboard)/agents/AgentsPageClient.tsx",
    "(dashboard)/system/SystemPageClient.tsx",
    "(dashboard)/leads/LeadsPageClient.tsx",
    "(dashboard)/role-requests/RoleRequestsPageClient.tsx",
    "(dashboard)/events/EventsPageClient.tsx",
    "(dashboard)/channels/ChannelsPageClient.tsx",
    "(dashboard)/DashboardClient.tsx",
    "(dashboard)/appointments/AppointmentsPageClient.tsx",
  ];

  for (const rel of TARGET_FILES) {
    it(`${rel} has no untranslated Cyrillic strings`, () => {
      const path = rel.startsWith("(dashboard)")
        ? join(dashboardRoot, rel.replace("(dashboard)/", ""))
        : join(componentsRoot, rel.replace("components/", ""));
      const content = readFileSync(path, "utf8");
      const allowed = new Set(ALLOWLIST[rel] ?? []);

      const lines = content.split("\n");
      const offenders: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const matches = line.match(/[А-Яа-яЁёІіЇїЄєҐґ]+/g);
        if (!matches) continue;
        for (const m of matches) {
          if (!allowed.has(m)) {
            offenders.push(`line ${i + 1}: "${m}" in: ${line.trim().slice(0, 100)}`);
          }
        }
      }
      expect(offenders, `Unexpected Cyrillic in ${rel}`).toEqual([]);
    });
  }
});

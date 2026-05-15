/**
 * Self-consistency check for the tenant-isolation scanner allowlist.
 *
 * Background — scripts/check-tenant-isolation.mjs uses (file, line)-keyed
 * entries to whitelist intentional cross-tenant queries (e.g. the global
 * bot_id collision check in salon.ts). PR #67 added unrelated logic above
 * `salon.ts:883`, the line drifted to 913, and the allowlist key went
 * stale. The scanner then failed on every push to main for two days,
 * silently skipping the Worker + Pages deploy jobs (PR #69 was the fix —
 * just bumped the line number).
 *
 * This test pins each ALLOWLIST entry to a real `.from(<TABLE>)` callsite
 * at the exact recorded line, so the next time a line drifts the test
 * suite fails locally before merge instead of the CI deploy gate failing
 * silently on main.
 *
 * Maintenance: when ALLOWLIST changes, this test re-runs automatically. If
 * an entry is removed because the underlying query is gone, the test also
 * checks no stale entries linger.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCANNER_PATH = join(
  process.cwd(),
  "scripts/check-tenant-isolation.mjs",
);

/** Extract the string contents of the ALLOWLIST set literal from the scanner. */
function extractAllowlistEntries(): string[] {
  const src = readFileSync(SCANNER_PATH, "utf8");
  const match = src.match(/const\s+ALLOWLIST\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!match) {
    throw new Error("ALLOWLIST literal not found in scanner — has the script been restructured?");
  }
  // Walk the literal line-by-line so apostrophes inside `//` comments
  // (e.g. "scanner's") don't break the extraction.
  const entries: string[] = [];
  for (const rawLine of match[1]!.split("\n")) {
    const stripped = rawLine.replace(/\/\/.*$/, "").trim();
    const m = stripped.match(/^"([^"]+)"\s*,?$/);
    if (m) entries.push(m[1]!);
  }
  return entries;
}

describe("tenant-isolation scanner allowlist", () => {
  const entries = extractAllowlistEntries();

  it("parses at least one entry (script structure invariant)", () => {
    // If this fails, the regex above is wrong, not the codebase.
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("entry %s points to a real .from() callsite", (entry) => {
    // Each entry must be "<relative path>:<line>" with a 1-based line number.
    const m = entry.match(/^(.+):(\d+)$/);
    expect(m, `entry "${entry}" is not in <path>:<line> format`).not.toBeNull();
    const [, relPath, lineStr] = m!;
    const lineNo = Number(lineStr);
    const fullPath = join(process.cwd(), relPath!);
    expect(existsSync(fullPath), `entry "${entry}" points to a missing file`).toBe(true);

    const lines = readFileSync(fullPath, "utf8").split("\n");
    // 1-based line number.
    const line = lines[lineNo - 1];
    expect(line, `entry "${entry}" is past EOF`).toBeDefined();
    // The whole point of the allowlist is to exempt a specific `.from(<table>)`
    // callsite. If the line no longer contains `.from(`, the underlying query
    // has moved or been deleted — either way the entry needs to be re-anchored
    // or removed.
    expect(
      /\.from\s*\(\s*[a-zA-Z_]/.test(line!),
      `entry "${entry}" no longer points to a .from(<table>) call — got:\n  ${line}\n` +
        `If the query was renamed/moved, update the allowlist line number.\n` +
        `If the query was deleted, remove the entry.`,
    ).toBe(true);
  });
});

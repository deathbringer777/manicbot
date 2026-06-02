/**
 * Self-consistency check for the tenant-isolation scanner's EXCEPTION mechanism.
 *
 * History: the scanner used to keep a brittle (file, line)-keyed ALLOWLIST.
 * Line numbers drifted constantly (the salon.ts bot_id collision check was
 * re-bumped ~30×: 883 → … → 2143) and a stale key once failed CI on main for
 * two days, silently skipping the deploy jobs. The scanner was rewritten
 * (2026-06-02) to use CONTENT-ANCHORED inline directives —
 * `// tenant-scan-ignore: <reason>` on the line above an intentional
 * cross-tenant / authorized-by-other-means query — which survive line drift.
 *
 * This test pins the new mechanism: every directive must (a) carry a non-empty
 * justification, and (b) sit immediately above a real Drizzle query callsite,
 * so a directive can't rot in place after the query it annotated was moved or
 * deleted (the successor to the old "no stale entries" check).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTERS_DIR = join(process.cwd(), "src", "server", "api", "routers");

function listRouterFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRouterFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

type Directive = { file: string; line: number; reason: string; following: string };

function collectDirectives(): Directive[] {
  const out: Directive[] = [];
  for (const file of listRouterFiles(ROUTERS_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(/tenant-scan-ignore:?(.*)$/);
      if (!m) continue;
      const rel = file.slice(Math.max(0, file.indexOf("src/")));
      out.push({
        file: rel,
        line: i + 1,
        reason: m[1]!.trim(),
        following: lines.slice(i + 1, i + 6).join("\n"),
      });
    }
  }
  return out;
}

describe("tenant-isolation scanner — content-anchored directives", () => {
  const directives = collectDirectives();

  it("the codebase uses inline directives (mechanism is wired up)", () => {
    expect(directives.length).toBeGreaterThan(0);
  });

  it.each(directives.map((d) => [`${d.file}:${d.line}`, d] as const))(
    "%s carries a justification and anchors a real query",
    (_label, d) => {
      // (a) must explain WHY — a bare `// tenant-scan-ignore` is not allowed.
      expect(
        d.reason.length,
        `directive at ${d.file}:${d.line} has no reason after the colon`,
      ).toBeGreaterThanOrEqual(12);
      // (b) must sit just above a real Drizzle query callsite (not orphaned).
      expect(
        /\.(from|update|delete|insert)\s*\(\s*[a-zA-Z_]/.test(d.following),
        `directive at ${d.file}:${d.line} does not anchor a .from/.update/.delete/.insert ` +
          `callsite within 5 lines — re-anchor it to the query or remove it`,
      ).toBe(true);
    },
  );
});

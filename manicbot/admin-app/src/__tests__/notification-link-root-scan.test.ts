/**
 * Regression scanner — no notification writer may store a link anchored at
 * root "/" or as a bare relative query ("?tab=…").
 *
 * Root links ("/", "/?tab=…") navigate the user to the marketing LANDING page,
 * because the Worker (src/http/adminAppProxy.js) intentionally does not proxy
 * "/" to the admin-app. Bare relative links resolve against whatever page is
 * current — wrong from any full-page route (the bell + /notifications). Every
 * notification link must anchor at a whitelisted full-page route, canonically
 * /dashboard (see ~/lib/notifications/linkTarget.ts).
 *
 * This walks BOTH deployable units' source (Worker `src/`, admin-app
 * `src/`, excluding tests) and fails on any offending `link:` string literal.
 * Mirrors the project's source-scan guard pattern (tenant-isolation scanners).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// __dirname = manicbot/admin-app/src/__tests__
const WORKER_SRC = resolve(__dirname, "../../../src");
const ADMIN_SRC = resolve(__dirname, "..");

const CODE_EXT = /\.(ts|tsx|js|mjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|__tests__|\.next)(\/|$)/;
const SKIP_FILE = /\.(test|spec)\.[tj]sx?$/;

/**
 * Offending link literals:
 *   link: '/'            exact root      → alt 2: quote slash quote
 *   link: '/?tab=…'      root + query    → alt 1: quote (slash) "?"
 *   link: '?tab=…'       bare relative   → alt 1: quote "?"
 * (template-literal backtick form included). Variable values such as
 * `link: opts.link` or `link: text("link")` are NOT string literals → ignored.
 * No backreferences: a non-participating-group backref in JS collapses to the
 * empty string and would match every `link: '/…'`.
 *
 * Matches BOTH the object-property form (`link: '…'`) and the local-assignment
 * form (`const link = '…'`). The `\b` keeps `permalink:` / `.permalink` from
 * being flagged.
 */
const BAD_LINK = /\blink\s*[:=]\s*['"`]\/?\?|\blink\s*[:=]\s*['"`]\/['"`]/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIR.test(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry) && !SKIP_FILE.test(entry)) out.push(full);
  }
}

describe("notification link scanner — no root/relative link literals", () => {
  it("finds no `link:` anchored at root or bare-relative across both units", () => {
    const files: string[] = [];
    walk(WORKER_SRC, files);
    walk(ADMIN_SRC, files);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (BAD_LINK.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `Notification links must anchor at /dashboard (or another full-page route), not "/" / "?…".\n` +
        `Use resolveNotificationHref-compatible paths. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

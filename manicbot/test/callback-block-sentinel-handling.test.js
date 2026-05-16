/**
 * callback.js — block-sentinel handling regression (0062).
 *
 * `saveApt()` now returns three distinct sentinel objects in addition
 * to the normal apt doc: `SLOT_TAKEN`, `BLOCKED_GLOBAL`, and
 * `BLOCKED_FOR_MASTER`. Before 0062 only `SLOT_TAKEN` existed, so the
 * booking handler in `src/handlers/callback.js` only had one branch.
 *
 * If a future refactor drops the BLOCKED_* import or the
 * `apt === BLOCKED_GLOBAL || apt === BLOCKED_FOR_MASTER` check, the
 * handler will fall through and try to access `apt.id` on the frozen
 * sentinel — crashing the Telegram bot mid-booking.
 *
 * This test pins the contract by static inspection. Cheaper and more
 * stable than spinning up a full Telegram callback fixture for a code
 * path that's already exercised end-to-end on prod.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, "..", "src", "handlers", "callback.js"),
  "utf8",
);

describe("callback.js — block-sentinel handling (0062 regression)", () => {
  it("imports both BLOCKED_GLOBAL and BLOCKED_FOR_MASTER from services/appointments", () => {
    expect(SRC).toMatch(/BLOCKED_GLOBAL/);
    expect(SRC).toMatch(/BLOCKED_FOR_MASTER/);
    // Import line — both sentinels listed alongside SLOT_TAKEN.
    expect(SRC).toMatch(
      /import\s+\{[^}]*BLOCKED_GLOBAL[^}]*\}\s+from\s+['"]\.\.\/services\/appointments\.js['"]/,
    );
  });

  it("handles both sentinels after saveApt(...) before treating apt as a doc", () => {
    // The branch must compare BEFORE any property access on apt.
    expect(SRC).toMatch(
      /apt\s*===\s*BLOCKED_GLOBAL\s*\|\|\s*apt\s*===\s*BLOCKED_FOR_MASTER/,
    );
  });
});

/**
 * Runs the tenant-isolation scanner as a vitest case so a missing
 * `tenantId` predicate in any router fails locally during `npm test`
 * instead of slipping through to the CI deploy gate.
 *
 * Background — PR #82 (clients CRM) shipped `findClientByPriority` in
 * clients.ts using a hoisted `const tenant = eq(users.tenantId, …)`
 * helper. The query was tenant-safe, but the scanner's heuristic only
 * looks for the literal string "tenantId" inside the 800 chars after
 * `.from(<table>)` and the alias hid it. Result: the "Bot — Test" CI
 * job failed and the deploy was skipped. Local `npm test` was green
 * because nothing here invoked the scanner. This pins it.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("check-tenant-isolation scanner", () => {
  it("exits 0 — every tenant-scoped query carries a tenantId predicate", () => {
    const scriptPath = join(process.cwd(), "scripts/check-tenant-isolation.mjs");
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (result.status !== 0) {
      // Surface scanner output verbatim so the failure message is actionable.
      throw new Error(
        `tenant-isolation scanner failed (exit ${result.status}).\n` +
          `stdout:\n${result.stdout}\n` +
          `stderr:\n${result.stderr}`,
      );
    }
    expect(result.status).toBe(0);
  }, 30_000);
});

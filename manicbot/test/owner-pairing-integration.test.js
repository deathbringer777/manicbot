/**
 * 0082 — integration coverage on top of the unit tests in
 * `test/owner-pairing.test.js`.
 *
 * Pins the wiring in `handlers/message.js`:
 *
 *   1. `tryConsumePairingCode` from `services/ownerPairing.js` is
 *      imported.
 *   2. The `/start own_<token>` branch fires BEFORE the analytics
 *      `decodeStartPayload` path (so the UTM tracker never sees the
 *      pairing token).
 *   3. Success path hands control to `showAdminPanel`.
 *
 * Static-string pins keep this lean — the full webhook pipeline is
 * exercised by the existing `channels-inbound.test.js`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MESSAGE_JS = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "handlers", "message.js"),
  "utf8",
);

describe("handlers/message.js wires the /start own_<token> pairing branch", () => {
  it("imports tryConsumePairingCode from services/ownerPairing", () => {
    expect(MESSAGE_JS).toMatch(/from\s+['"]\.\.\/services\/ownerPairing\.js['"]/);
    expect(MESSAGE_JS).toContain("tryConsumeOwnerPairingCode");
  });

  it("intercepts startPayload.startsWith('own_') BEFORE the analytics decodeStartPayload path", () => {
    const ownIdx = MESSAGE_JS.indexOf("startsWith('own_')");
    const decodeIdx = MESSAGE_JS.indexOf("decodeStartPayload(startPayload)");
    expect(ownIdx).toBeGreaterThan(0);
    expect(decodeIdx).toBeGreaterThan(0);
    expect(ownIdx).toBeLessThan(decodeIdx);
  });

  it("renders showAdminPanel on successful pairing", () => {
    // Locate the own_ branch and confirm showAdminPanel is invoked
    // inside the `if (result.ok)` block.
    const branchStart = MESSAGE_JS.indexOf("startsWith('own_')");
    const branchEnd = MESSAGE_JS.indexOf("// Fall through so the user still lands", branchStart);
    const branch = MESSAGE_JS.slice(branchStart, branchEnd);
    expect(branch).toContain("showAdminPanel(ctx, cid, name)");
  });

  it("uses the owner-pairing i18n keyspace, not the master one", () => {
    const branchStart = MESSAGE_JS.indexOf("startsWith('own_')");
    const branchEnd = MESSAGE_JS.indexOf("// Fall through so the user still lands", branchStart);
    const branch = MESSAGE_JS.slice(branchStart, branchEnd);
    expect(branch).toContain("owner_pairing_success_prefix");
    expect(branch).toContain("owner_pairing_err_not_found");
    expect(branch).not.toContain("master_pairing_success_prefix");
  });
});

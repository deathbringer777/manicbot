/**
 * Stored-XSS guard for email templates that interpolate user-controlled
 * display names / salon names directly into the HTML body.
 *
 * Findings (Phase-3 security sweep, item #4):
 *   - masterInviteEmailHtml          → `salonName` (tenant-controlled)
 *   - ownershipTransferRequestEmailHtml
 *       → `tenantName`, `toName`, `toEmail`
 *   - ownershipTransferCompletedOldOwnerEmailHtml
 *       → `tenantName`, `newOwnerName`
 *   - ownershipTransferCompletedNewOwnerEmailHtml
 *       → `tenantName`, `oldOwnerName`
 *
 * All of these reach the rendered HTML of an email. A salon owner or master
 * who sets their salon/display name to `<script>…</script>` or
 * `<img src=x onerror=…>` would land an active-content payload in the
 * recipient's mail client. `sanitizeEmailDisplayName` (already imported by
 * templates.ts) strips tags + escapes the residue, so after the fix no
 * `<script>` / `onerror=` substring may survive into the output.
 */
import { describe, it, expect } from "vitest";
import {
  masterInviteEmailHtml,
  ownershipTransferRequestEmailHtml,
  ownershipTransferCompletedOldOwnerEmailHtml,
  ownershipTransferCompletedNewOwnerEmailHtml,
} from "~/server/email/templates";

const LANGS = ["ru", "ua", "en", "pl"] as const;

const SCRIPT = "<script>alert(1)</script>";
const IMG = `<img src=x onerror="alert(document.cookie)">`;

/** Assert no active-content payload survived into the rendered HTML. */
function assertNoActivePayload(html: string) {
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("</script>");
  // `onerror=` (or any inline handler attribute) must never appear as a
  // live attribute. The escaped form `onerror=` is harmless, so we only
  // reject the raw `<img …onerror=` shape.
  expect(html).not.toMatch(/<img[^>]*onerror=/i);
  // The opening tag itself must be neutralised (escaped or stripped).
  expect(html).not.toContain("<img src=x");
}

describe("masterInviteEmailHtml — salonName XSS", () => {
  it("strips a <script> salon name in every language", () => {
    for (const lang of LANGS) {
      const html = masterInviteEmailHtml(
        { salonName: SCRIPT, roleLabel: "Master", dashboardUrl: "https://x.test/d" },
        lang,
      );
      assertNoActivePayload(html);
    }
  });

  it("strips an <img onerror> salon name", () => {
    const html = masterInviteEmailHtml(
      { salonName: IMG, roleLabel: "Master", dashboardUrl: "https://x.test/d" },
      "en",
    );
    assertNoActivePayload(html);
  });
});

describe("ownershipTransferRequestEmailHtml — tenantName / toName / toEmail XSS", () => {
  it("strips script payloads in all interpolated identity fields", () => {
    for (const lang of LANGS) {
      const html = ownershipTransferRequestEmailHtml({
        fromName: SCRIPT,
        toName: SCRIPT,
        toEmail: `${SCRIPT}@evil.test`,
        tenantName: SCRIPT,
        confirmUrl: "https://x.test/confirm",
        lang,
      });
      assertNoActivePayload(html);
    }
  });

  it("strips an <img onerror> tenant name", () => {
    const html = ownershipTransferRequestEmailHtml({
      fromName: "Owner",
      toName: "New",
      toEmail: "new@real.test",
      tenantName: IMG,
      confirmUrl: "https://x.test/confirm",
      lang: "en",
    });
    assertNoActivePayload(html);
  });
});

describe("ownershipTransferCompletedOldOwnerEmailHtml — tenantName / newOwnerName XSS", () => {
  it("strips script payloads in tenantName + newOwnerName", () => {
    for (const lang of LANGS) {
      const html = ownershipTransferCompletedOldOwnerEmailHtml({
        newOwnerName: SCRIPT,
        tenantName: SCRIPT,
        lang,
      });
      assertNoActivePayload(html);
    }
  });
});

describe("ownershipTransferCompletedNewOwnerEmailHtml — tenantName / oldOwnerName XSS", () => {
  it("strips script payloads in tenantName + oldOwnerName", () => {
    for (const lang of LANGS) {
      const html = ownershipTransferCompletedNewOwnerEmailHtml({
        oldOwnerName: SCRIPT,
        tenantName: IMG,
        lang,
      });
      assertNoActivePayload(html);
    }
  });
});

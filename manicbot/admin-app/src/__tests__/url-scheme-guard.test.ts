/**
 * #U1/#U2 — attachment/photo URLs must be https (Zod .url() accepts
 * javascript:/data:). Guards messenger.sendMessage attachments,
 * support.replyToTicket/replyToMyTicket attachmentUrl, and
 * salon.updateSalonProfile photos[].
 */
import { describe, it, expect } from "vitest";
import { isHttpsUrl } from "~/server/lib/url";

describe("#U1/#U2 — isHttpsUrl scheme guard", () => {
  it("accepts https URLs (case-insensitive)", () => {
    expect(isHttpsUrl("https://cdn.manicbot.com/t/x/a.webp")).toBe(true);
    expect(isHttpsUrl("HTTPS://cdn.x/a.png")).toBe(true);
  });

  it("rejects javascript: / data: / non-https schemes", () => {
    expect(isHttpsUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(isHttpsUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpsUrl("http://insecure")).toBe(false);
    expect(isHttpsUrl("  javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpsUrl("//evil.com")).toBe(false);
  });
});

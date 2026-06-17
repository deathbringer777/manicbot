/**
 * Admin-app twin of the Worker link-rewrite tests. Confirms the TS twin
 * rewrites http(s) links, skips unsubscribe/mailto, and mints a token whose
 * decoded payload uses the SAME key shape (`c`, `s`, `t`, `ct`, `u`, `exp`)
 * the Worker `/r/` endpoint verifies.
 */
import { describe, it, expect } from "vitest";
import { rewriteLinksForTracking } from "~/server/marketing/linkRewrite";

const SECRET = "rewrite-secret-which-is-long-enough";
const BASE = {
  origin: "https://manicbot.com", campaignId: "cmp_1", sendId: "snd_1",
  tenantId: "t_a", contactId: 7, secret: SECRET,
};

function decodePayload(token: string): Record<string, unknown> {
  const p = token.split(".")[0]!;
  const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

describe("admin rewriteLinksForTracking", () => {
  it("rewrites http(s), skips unsubscribe/mailto, token carries the destination", async () => {
    const html = [
      '<a href="https://salon.example/book">b</a>',
      '<a href="https://manicbot.com/u/x">u</a>',
      '<a href="mailto:a@b.c">m</a>',
    ].join("");
    const out = await rewriteLinksForTracking(html, BASE);

    expect(out).toContain("https://manicbot.com/r/");
    expect(out).toContain("/u/x");
    expect(out).toContain("mailto:a@b.c");
    expect(out).not.toContain('href="https://salon.example/book"');

    const m = out.match(/\/r\/([A-Za-z0-9._-]+)/)!;
    const payload = decodePayload(m[1]!);
    expect(payload.u).toBe("https://salon.example/book");
    expect(payload.c).toBe("cmp_1");
    expect(payload.s).toBe("snd_1");
    expect(payload.t).toBe("t_a");
    expect(payload.ct).toBe(7);
  });

  it("fail-open without secret", async () => {
    const html = '<a href="https://x.example/y">y</a>';
    expect(await rewriteLinksForTracking(html, { ...BASE, secret: "" })).toBe(html);
  });
});

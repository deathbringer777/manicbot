/**
 * isCdnUploadUrl — host-pinned CDN upload URL validator (audit 2026-06-12,
 * follow-up to V-2). Generalizes the chat-attachment host pin to the other
 * minted-image fields (client/master avatars, master profile photo,
 * portfolio) which previously matched only `isHttpsUrl` or a path shape with
 * an unconstrained host — the same tracking-pixel / external-injection gap.
 *
 * Every minted upload URL has the shape
 *   https://<worker-host>/cdn/t/<tenantId>/<kind>-<sha>.<webp|jpg|jpeg|png>
 * (uploadHttp.js). The host must be the configured WORKER_PUBLIC_URL origin
 * or the production apex; the kind must be in the caller's allowlist.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("~/env", () => ({ env: { WORKER_PUBLIC_URL: "https://worker.test" } }));

import { isCdnUploadUrl } from "~/server/lib/url";

const T = "t_abc";
const ok = (kind: string) => `https://worker.test/cdn/t/${T}/${kind}-deadbeef0123.png`;

describe("isCdnUploadUrl", () => {
  it("accepts a minted URL whose kind is in the allowlist", () => {
    expect(isCdnUploadUrl(ok("client_avatar"), ["client_avatar"])).toBe(true);
    expect(isCdnUploadUrl(ok("master_avatar"), ["master_avatar", "photo"])).toBe(true);
    expect(isCdnUploadUrl("https://manicbot.com/cdn/t/" + T + "/portfolio-abc123.webp", ["portfolio"])).toBe(true);
  });

  it("rejects a kind outside the allowlist", () => {
    expect(isCdnUploadUrl(ok("chat_attachment"), ["client_avatar"])).toBe(false);
  });

  it("rejects an attacker host with a path-valid URL (V-2 class)", () => {
    expect(isCdnUploadUrl(`https://evil.example/cdn/t/${T}/client_avatar-deadbeef0123.png`, ["client_avatar"])).toBe(false);
    expect(isCdnUploadUrl(`https://worker.test@evil.com/cdn/t/${T}/client_avatar-deadbeef0123.png`, ["client_avatar"])).toBe(false);
  });

  it("rejects non-image extensions, http, and junk", () => {
    expect(isCdnUploadUrl(`https://worker.test/cdn/t/${T}/client_avatar-deadbeef0123.svg`, ["client_avatar"])).toBe(false);
    expect(isCdnUploadUrl(`http://worker.test/cdn/t/${T}/client_avatar-deadbeef0123.png`, ["client_avatar"])).toBe(false);
    expect(isCdnUploadUrl("javascript:alert(1)", ["client_avatar"])).toBe(false);
    expect(isCdnUploadUrl("https://worker.test/evil", ["client_avatar"])).toBe(false);
  });
});

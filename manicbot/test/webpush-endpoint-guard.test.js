/**
 * SEC-002 — Web Push endpoint SSRF guard (Worker side, defense-in-depth).
 *
 * `sendWebPush` does `fetch(subscription.endpoint)`, so a malicious/legacy
 * endpoint is an SSRF primitive. `isAllowedPushEndpoint` pins the fetch target
 * to https + the four real browser push services; `sendWebPush` short-circuits
 * before any crypto/fetch when the endpoint is not allowed.
 */
import { describe, it, expect, vi } from "vitest";
import { isAllowedPushEndpoint, sendWebPush } from "../src/services/webpush.js";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/AAA",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc123",
    "https://db5p.notify.windows.com/w/?token=xyz",
  ])("allows real push host %j", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://localhost:8787/admin/notify", // loopback
    "http://127.0.0.1/", // loopback IP
    "https://evil.example.com/collect", // arbitrary external host
    "http://fcm.googleapis.com/fcm/send/x", // right host, bare http
    "javascript:alert(1)", // non-http scheme
    "", // empty
    "not-a-url", // unparseable
    "https://fcm.googleapis.com.evil.com/x", // suffix-spoof attempt
  ])("blocks %j", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("sendWebPush — endpoint guard short-circuit", () => {
  it("refuses a disallowed endpoint before any fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await sendWebPush(
      { endpoint: "http://169.254.169.254/", p256dh: "x", auth: "y" },
      { hello: "world" },
      { subject: "mailto:a@b.c", publicKey: "pk", privateKey: "sk" },
    );
    expect(res).toEqual({ ok: false, status: 0, body: "endpoint_host_not_allowed" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("still rejects missing endpoint", async () => {
    const res = await sendWebPush({ p256dh: "x", auth: "y" }, {}, { subject: "s", publicKey: "p", privateKey: "k" });
    expect(res).toEqual({ ok: false, status: 0, body: "missing_endpoint" });
  });
});

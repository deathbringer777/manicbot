/**
 * Upload-token binding: the minted token payload carries the `uid`
 * (web_users.id) of the requesting user so the Worker upload handler can log
 * it in the audit trail.
 *
 * Security note: TTL (5 min) + HMAC IS the auth on the Worker side — the
 * admin-app tRPC procedure already verified the caller (tenant ownership /
 * thread membership / ticket access) before signing. The `uid` field is
 * defense-in-depth for forensics, not an active authorization check.
 */

import { describe, it, expect } from "vitest";
import { signUploadToken } from "~/server/lib/uploadToken";
import { verifyUploadToken } from "../../../src/services/upload.js";

const SECRET = "x".repeat(32);

function decodePayload(token: string): Record<string, unknown> {
  const payloadB64 = token.split(".")[0]!;
  const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
  const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

describe("upload-token uid binding", () => {
  it("embeds the uid in the token payload when provided", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "logo",
      secret: SECRET,
      uid: "user_123",
    });
    const payload = decodePayload(token);
    expect(payload.uid).toBe("user_123");
    expect(payload.tid).toBe("t_abc");
    expect(payload.kind).toBe("logo");
    expect(typeof payload.exp).toBe("number");
  });

  it("omits uid when not provided (back-compat)", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "logo",
      secret: SECRET,
    });
    const payload = decodePayload(token);
    expect("uid" in payload).toBe(false);
  });

  it("Worker verifyUploadToken returns uid on a valid token", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "chat_attachment",
      secret: SECRET,
      uid: "user_456",
    });
    const claim = await verifyUploadToken(token, SECRET);
    expect(claim).not.toBeNull();
    expect(claim!.tid).toBe("t_abc");
    expect(claim!.kind).toBe("chat_attachment");
    expect(claim!.uid).toBe("user_456");
  });

  it("Worker verifyUploadToken returns uid=null on legacy tokens without uid", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "logo",
      secret: SECRET,
    });
    const claim = await verifyUploadToken(token, SECRET);
    expect(claim).not.toBeNull();
    expect(claim!.uid).toBeNull();
  });

  it("rejects an expired token (TTL is the primary guard)", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "logo",
      secret: SECRET,
      ttlSec: -10, // already expired
      uid: "user_789",
    });
    const claim = await verifyUploadToken(token, SECRET);
    expect(claim).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signUploadToken({
      tid: "t_abc",
      kind: "logo",
      secret: SECRET,
      uid: "user_789",
    });
    const claim = await verifyUploadToken(token, "y".repeat(32));
    expect(claim).toBeNull();
  });
});

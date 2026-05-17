/**
 * Pure-unit coverage for the chat-attachment client helpers used by all
 * three composers (HelpSection / SupportDashboard / MessageComposer).
 *
 * Pins:
 *   - `validateChatAttachmentFile` rejects non-image MIMEs and oversize files.
 *   - `describeChatAttachmentError` produces a Russian user-facing message
 *     for every documented error code (the i18n the composers display).
 *   - `uploadChatAttachment` happy path returns the CDN URL from the
 *     Worker response and surfaces typed `ChatAttachmentUploadError`s
 *     on failure paths.
 *   - `filesFromPasteEvent` / `filesFromDropEvent` extract File objects
 *     from the appropriate event surfaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CHAT_ATTACHMENT_ALLOWED_MIME,
  CHAT_ATTACHMENT_MAX_BYTES,
  validateChatAttachmentFile,
  describeChatAttachmentError,
  uploadChatAttachment,
  ChatAttachmentUploadError,
  filesFromPasteEvent,
  filesFromDropEvent,
} from "~/lib/chatAttachments";

function makeFile(opts: { type: string; size?: number; name?: string }): File {
  // We only need a File-like object with `type` and `size` for validation.
  // For upload tests we need the full File so FormData can serialize it.
  return new File([new Uint8Array(opts.size ?? 100)], opts.name ?? "x.png", {
    type: opts.type,
  });
}

// ─── Allowlist + size cap ─────────────────────────────────────────────────

describe("CHAT_ATTACHMENT_ALLOWED_MIME", () => {
  it("matches the Worker's image/* whitelist", () => {
    expect(CHAT_ATTACHMENT_ALLOWED_MIME.has("image/png")).toBe(true);
    expect(CHAT_ATTACHMENT_ALLOWED_MIME.has("image/jpeg")).toBe(true);
    expect(CHAT_ATTACHMENT_ALLOWED_MIME.has("image/webp")).toBe(true);
    expect(CHAT_ATTACHMENT_ALLOWED_MIME.has("image/gif")).toBe(false);
    expect(CHAT_ATTACHMENT_ALLOWED_MIME.has("application/pdf")).toBe(false);
  });

  it("CHAT_ATTACHMENT_MAX_BYTES matches Worker MAX_UPLOAD_BYTES (2 MB)", () => {
    expect(CHAT_ATTACHMENT_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

// ─── validateChatAttachmentFile ───────────────────────────────────────────

describe("validateChatAttachmentFile", () => {
  it("accepts PNG / JPEG / WEBP under the size cap", () => {
    expect(validateChatAttachmentFile(makeFile({ type: "image/png", size: 1024 }))).toBeNull();
    expect(validateChatAttachmentFile(makeFile({ type: "image/jpeg", size: 1024 }))).toBeNull();
    expect(validateChatAttachmentFile(makeFile({ type: "image/webp", size: 1024 }))).toBeNull();
  });

  it("rejects unsupported MIME with 'unsupported_type'", () => {
    expect(validateChatAttachmentFile(makeFile({ type: "image/gif" }))).toBe("unsupported_type");
    expect(validateChatAttachmentFile(makeFile({ type: "application/pdf" }))).toBe("unsupported_type");
    expect(validateChatAttachmentFile(makeFile({ type: "" }))).toBe("unsupported_type");
  });

  it("rejects oversize files with 'too_large'", () => {
    const f = makeFile({ type: "image/png", size: CHAT_ATTACHMENT_MAX_BYTES + 1 });
    expect(validateChatAttachmentFile(f)).toBe("too_large");
  });

  it("accepts at-cap exact-size files (edge)", () => {
    const f = makeFile({ type: "image/png", size: CHAT_ATTACHMENT_MAX_BYTES });
    expect(validateChatAttachmentFile(f)).toBeNull();
  });
});

// ─── describeChatAttachmentError ──────────────────────────────────────────

describe("describeChatAttachmentError", () => {
  it("returns a Russian string for every documented error code", () => {
    const codes = [
      "unsupported_type",
      "too_large",
      "token_mint_failed",
      "upload_failed",
      "network_error",
    ] as const;
    for (const c of codes) {
      const msg = describeChatAttachmentError(c);
      expect(msg).toBeTypeOf("string");
      expect(msg.length).toBeGreaterThan(8); // not a placeholder
      // Russian: must contain at least one Cyrillic char.
      expect(/[А-Яа-я]/.test(msg)).toBe(true);
    }
  });

  it("each code yields a distinct message (no collision)", () => {
    const seen = new Set<string>();
    const codes = ["unsupported_type", "too_large", "token_mint_failed", "upload_failed", "network_error"] as const;
    for (const c of codes) {
      const msg = describeChatAttachmentError(c);
      expect(seen.has(msg)).toBe(false);
      seen.add(msg);
    }
  });
});

// ─── uploadChatAttachment ─────────────────────────────────────────────────

describe("uploadChatAttachment", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { globalThis.fetch = origFetch; });

  it("happy path: returns the Worker's CDN URL on 200 + { ok: true, url }", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, url: "https://w/cdn/t/abc/x.png" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as never;
    const file = makeFile({ type: "image/png", size: 200 });
    const url = await uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment");
    expect(url).toBe("https://w/cdn/t/abc/x.png");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects oversize input BEFORE making any network call", async () => {
    globalThis.fetch = vi.fn(async () => new Response("should-not-be-called", { status: 500 })) as never;
    const file = makeFile({ type: "image/png", size: CHAT_ATTACHMENT_MAX_BYTES + 1 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "too_large" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME BEFORE making any network call", async () => {
    globalThis.fetch = vi.fn() as never;
    const file = makeFile({ type: "image/gif", size: 200 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "unsupported_type" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("surfaces 'network_error' when fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as never;
    const file = makeFile({ type: "image/png", size: 200 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "network_error" });
  });

  it("surfaces 'upload_failed' on non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Bad", { status: 415 })) as never;
    const file = makeFile({ type: "image/png", size: 200 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "upload_failed" });
  });

  it("surfaces 'upload_failed' when JSON is malformed", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as never;
    const file = makeFile({ type: "image/png", size: 200 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "upload_failed" });
  });

  it("surfaces 'upload_failed' when the JSON body says { ok: false }", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: "Token expired" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as never;
    const file = makeFile({ type: "image/png", size: 200 });
    await expect(uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment"))
      .rejects.toMatchObject({ code: "upload_failed", message: expect.stringContaining("Token expired") });
  });

  it("posts FormData with a 'file' field to the upload URL", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      captured = { url: typeof input === "string" ? input : input.toString(), init };
      return new Response(JSON.stringify({ ok: true, url: "https://w/cdn/y.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as never;
    const file = makeFile({ type: "image/png", size: 50, name: "snapshot.png" });
    await uploadChatAttachment(file, "https://w/upload/asset?t=TOK&kind=chat_attachment");
    expect(captured).toBeTruthy();
    expect(captured!.url).toContain("/upload/asset?t=TOK&kind=chat_attachment");
    expect(captured!.init?.method).toBe("POST");
    expect(captured!.init?.body).toBeInstanceOf(FormData);
    const form = captured!.init!.body as FormData;
    const f = form.get("file");
    expect(f).toBeInstanceOf(File);
    expect((f as File).name).toBe("snapshot.png");
  });
});

// ─── ChatAttachmentUploadError shape ──────────────────────────────────────

describe("ChatAttachmentUploadError", () => {
  it("carries the code on the instance for error.code assertions", () => {
    const e = new ChatAttachmentUploadError("network_error", "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("network_error");
    expect(e.message).toBe("boom");
  });

  it("defaults the message to the code when omitted", () => {
    const e = new ChatAttachmentUploadError("too_large");
    expect(e.message).toBe("too_large");
  });
});

// ─── filesFromPasteEvent / filesFromDropEvent ─────────────────────────────

describe("filesFromPasteEvent", () => {
  it("extracts files from clipboardData.items", () => {
    const file = makeFile({ type: "image/png", size: 50 });
    const evt = {
      clipboardData: {
        items: [
          { kind: "string", getAsFile: () => null },
          { kind: "file", getAsFile: () => file },
        ],
      },
    } as unknown as ClipboardEvent;
    expect(filesFromPasteEvent(evt)).toEqual([file]);
  });

  it("returns empty array when clipboardData is null", () => {
    const evt = { clipboardData: null } as unknown as ClipboardEvent;
    expect(filesFromPasteEvent(evt)).toEqual([]);
  });

  it("returns empty array when no file items present", () => {
    const evt = {
      clipboardData: { items: [{ kind: "string", getAsFile: () => null }] },
    } as unknown as ClipboardEvent;
    expect(filesFromPasteEvent(evt)).toEqual([]);
  });
});

describe("filesFromDropEvent", () => {
  it("extracts files from dataTransfer.files", () => {
    const a = makeFile({ type: "image/png", size: 10, name: "a.png" });
    const b = makeFile({ type: "image/jpeg", size: 10, name: "b.jpg" });
    const evt = {
      dataTransfer: {
        files: { 0: a, 1: b, length: 2 } as unknown as FileList,
      },
    } as unknown as DragEvent;
    expect(filesFromDropEvent(evt)).toHaveLength(2);
  });

  it("returns empty array when dataTransfer is null", () => {
    const evt = { dataTransfer: null } as unknown as DragEvent;
    expect(filesFromDropEvent(evt)).toEqual([]);
  });

  it("returns empty array when files.length is 0", () => {
    const evt = {
      dataTransfer: { files: { length: 0 } as unknown as FileList },
    } as unknown as DragEvent;
    expect(filesFromDropEvent(evt)).toEqual([]);
  });
});

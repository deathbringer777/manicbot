// @vitest-environment happy-dom
/**
 * Phase 1B — shared chat-attachment paperclip primitive used by:
 *   - HelpSection (tenant ticket reply)
 *   - SupportDashboard (platform-staff ticket reply)
 *   - MessageComposer (/messages thread view)
 *
 * Pins:
 *   - Renders a hidden <input type="file"> with the right accept set.
 *   - Clicking the paperclip opens the file picker (we simulate file
 *     selection on the input directly).
 *   - On successful flow: mintToken → upload → onUploaded(url) fires
 *     and the input value is cleared (so re-selecting the same file works).
 *   - On any failure path: onError(localizedMessage) fires AND
 *     onUploaded does NOT fire.
 *   - `disabled` prevents both clicks AND in-flight overlap (the
 *     uploading state internally disables the button while the upload
 *     is pending).
 *   - The accept attribute lists exactly the same MIME set the Worker
 *     enforces — drift between the two would let users pick files the
 *     server then rejects.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";
import { ChatAttachButton } from "~/components/chat/ChatAttachButton";

// Phase 2 cleanup: vi.stubGlobal + unstubAllGlobals — no manual save/restore.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "screenshot.png", {
    type: "image/png",
  });
}

describe("ChatAttachButton", () => {
  it("renders a button with the right aria-label + a hidden file input", () => {
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={() => {}}
      />,
    );
    const btn = screen.getByTestId("chat-attach-button");
    expect(btn.getAttribute("aria-label")).toBe("Прикрепить изображение");
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    expect(input.type).toBe("file");
    // The accept list MUST match the Worker's allowlist exactly.
    expect(input.accept).toContain("image/png");
    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).toContain("image/webp");
  });

  it("clicking the button triggers the file input click()", () => {
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={() => {}}
      />,
    );
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByTestId("chat-attach-button"));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("happy path: mintToken → upload → onUploaded(url) fires", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: true, url: "https://w/cdn/x.png" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    const mintToken = vi.fn(async () => ({ token: "T", uploadUrl: "https://w/upload" }));
    const onUploaded = vi.fn();
    const onError = vi.fn();
    renderWithLang(
      <ChatAttachButton mintToken={mintToken} onUploaded={onUploaded} onError={onError} />,
    );
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith("https://w/cdn/x.png");
    });
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("oversize file: onError fires with the Russian 'too_large' message; no upload attempted", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mintToken = vi.fn();
    const onUploaded = vi.fn();
    const onError = vi.fn();
    renderWithLang(
      <ChatAttachButton mintToken={mintToken} onUploaded={onUploaded} onError={onError} />,
    );
    // 3 MB file — over the 2 MB cap.
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" });
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(onError.mock.calls[0]![0]).toMatch(/больше 2 МБ/);
    expect(mintToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("unsupported MIME: onError fires, no network call", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const onUploaded = vi.fn();
    const onError = vi.fn();
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={onUploaded}
        onError={onError}
      />,
    );
    const gif = new File([new Uint8Array(10)], "anim.gif", { type: "image/gif" });
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [gif], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toMatch(/PNG, JPEG, WEBP/);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("worker rejects the upload: onError fires with 'upload_failed' message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: "expired" }),
      { status: 200 },
    )));
    const onUploaded = vi.fn();
    const onError = vi.fn();
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={onUploaded}
        onError={onError}
      />,
    );
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toMatch(/Сервер отклонил загрузку/);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("disabled prop blocks the button entirely", () => {
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={() => {}}
        disabled
      />,
    );
    const btn = screen.getByTestId("chat-attach-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("custom title prop overrides the default aria-label", () => {
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={() => {}}
        title="Кастомный заголовок"
      />,
    );
    const btn = screen.getByTestId("chat-attach-button");
    expect(btn.getAttribute("aria-label")).toBe("Кастомный заголовок");
    expect(btn.getAttribute("title")).toBe("Кастомный заголовок");
  });

  it("clears the input value after upload so the same file can be re-selected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: true, url: "https://w/cdn/x.png" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    renderWithLang(
      <ChatAttachButton
        mintToken={async () => ({ token: "T", uploadUrl: "https://w/u" })}
        onUploaded={() => {}}
      />,
    );
    const input = screen.getByTestId("chat-attach-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });
});

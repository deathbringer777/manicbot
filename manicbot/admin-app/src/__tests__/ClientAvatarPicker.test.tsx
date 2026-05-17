// @vitest-environment happy-dom
/**
 * ClientAvatarPicker — emoji + photo picker opened by clicking the
 * avatar circle in the Salon Clients detail modal.
 *
 * The contract pinned here:
 *   * Default emoji shown in the preview is 👩 when currentEmoji is null.
 *   * Clicking an emoji fires `clients.update` with `avatarEmoji` AND
 *     `avatarUrl: null` so the photo is cleared atomically.
 *   * Clicking "Reset avatar" sends both fields as null.
 *   * Switching to the photo tab reveals the upload button.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ClientAvatarPicker } from "~/components/salon/tabs/clients/ClientAvatarPicker";

const updateMutate = vi.fn();
const mintMutateAsync = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    salon: {
      mintUploadToken: {
        useMutation: () => ({
          mutateAsync: mintMutateAsync,
          isPending: false,
        }),
      },
    },
    clients: {
      update: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            updateMutate(vars);
            opts?.onSuccess?.({ ok: true });
          },
          isPending: false,
        }),
      },
    },
  },
}));

function renderPicker(props: Partial<React.ComponentProps<typeof ClientAvatarPicker>> = {}) {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <ClientAvatarPicker
        tenantId="t_demo"
        chatId={-1}
        currentEmoji={null}
        currentUrl={null}
        onClose={() => {}}
        onSaved={() => {}}
        {...props}
      />
    </LangContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
  mintMutateAsync.mockClear();
});

describe("ClientAvatarPicker", () => {
  it("shows the default 👩 emoji in the preview when nothing is set", () => {
    renderPicker();
    expect(screen.getByTestId("avatar-picker-current-emoji").textContent).toBe("👩");
  });

  it("shows the saved emoji in the preview when one is set", () => {
    renderPicker({ currentEmoji: "👸" });
    expect(screen.getByTestId("avatar-picker-current-emoji").textContent).toBe("👸");
  });

  it("clicking a palette emoji updates the row and clears any photo", () => {
    renderPicker({ currentUrl: "https://example.com/x.webp" });
    fireEvent.click(screen.getByTestId("avatar-emoji-👑"));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({
      tenantId: "t_demo",
      chatId: -1,
      patch: { avatarEmoji: "👑", avatarUrl: null },
    });
  });

  it("the photo tab swaps to the upload button", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("avatar-tab-photo"));
    expect(screen.getByTestId("avatar-upload-btn")).toBeTruthy();
  });

  it("`Reset avatar` is hidden when the row has neither photo nor custom emoji", () => {
    renderPicker();
    expect(screen.queryByTestId("avatar-clear-btn")).toBeNull();
  });

  it("`Reset avatar` clears both fields when shown", () => {
    renderPicker({ currentEmoji: "🦄" });
    fireEvent.click(screen.getByTestId("avatar-clear-btn"));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({
      patch: { avatarEmoji: null, avatarUrl: null },
    });
  });
});

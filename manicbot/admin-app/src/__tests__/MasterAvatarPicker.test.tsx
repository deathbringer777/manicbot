// @vitest-environment happy-dom
/**
 * MasterAvatarPicker — emoji + photo picker opened by clicking the
 * avatar circle in MasterDetailModal.
 *
 * Contract pinned:
 *   * Default emoji shown in the preview is 💅 when currentEmoji is null.
 *   * Clicking a palette emoji fires `salon.updateMasterAvatar` with
 *     `avatarEmoji` AND `avatarUrl: null` so the photo is cleared atomically.
 *   * Clicking "Reset avatar" sends both fields as null.
 *   * Switching to the photo tab reveals the upload button.
 *   * "Reset avatar" button is hidden when neither photo nor custom emoji is set.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { MasterAvatarPicker } from "~/components/salon/tabs/masters/MasterAvatarPicker";

const updateAvatarMutate = vi.fn();
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
      updateMasterAvatar: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            updateAvatarMutate(vars);
            opts?.onSuccess?.({ success: true });
          },
          isPending: false,
        }),
      },
    },
  },
}));

function renderPicker(props: Partial<React.ComponentProps<typeof MasterAvatarPicker>> = {}) {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <MasterAvatarPicker
        tenantId="t_demo"
        chatId={10_000_000_001}
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
  updateAvatarMutate.mockClear();
  mintMutateAsync.mockClear();
});

describe("MasterAvatarPicker", () => {
  it("shows the default 💅 emoji in the preview when nothing is set", () => {
    renderPicker();
    expect(screen.getByTestId("master-avatar-picker-current-emoji").textContent).toBe("💅");
  });

  it("shows the saved emoji in the preview when one is set", () => {
    renderPicker({ currentEmoji: "👑" });
    expect(screen.getByTestId("master-avatar-picker-current-emoji").textContent).toBe("👑");
  });

  it("clicking a palette emoji calls updateMasterAvatar with emoji + avatarUrl: null", () => {
    renderPicker({ currentUrl: "https://cdn.example.com/m.webp" });
    fireEvent.click(screen.getByTestId("master-avatar-emoji-💅"));
    expect(updateAvatarMutate).toHaveBeenCalledTimes(1);
    expect(updateAvatarMutate.mock.calls[0]![0]).toMatchObject({
      tenantId: "t_demo",
      chatId: 10_000_000_001,
      avatarEmoji: "💅",
      avatarUrl: null,
    });
  });

  it("the photo tab swaps to the upload button", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("master-avatar-tab-photo"));
    expect(screen.getByTestId("master-avatar-upload-btn")).toBeTruthy();
  });

  it("Reset avatar button is hidden when neither photo nor custom emoji is set", () => {
    renderPicker();
    expect(screen.queryByTestId("master-avatar-clear-btn")).toBeNull();
  });

  it("Reset avatar clears both fields when a custom emoji is set", () => {
    renderPicker({ currentEmoji: "✂️" });
    fireEvent.click(screen.getByTestId("master-avatar-clear-btn"));
    expect(updateAvatarMutate).toHaveBeenCalledTimes(1);
    expect(updateAvatarMutate.mock.calls[0]![0]).toMatchObject({
      avatarEmoji: null,
      avatarUrl: null,
    });
  });

  it("Reset avatar clears both fields when a photo is set", () => {
    renderPicker({ currentUrl: "https://cdn.example.com/m.webp" });
    fireEvent.click(screen.getByTestId("master-avatar-clear-btn"));
    expect(updateAvatarMutate).toHaveBeenCalledTimes(1);
    expect(updateAvatarMutate.mock.calls[0]![0]).toMatchObject({
      avatarEmoji: null,
      avatarUrl: null,
    });
  });
});

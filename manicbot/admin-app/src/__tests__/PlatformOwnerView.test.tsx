// @vitest-environment happy-dom
/**
 * PlatformOwnerView — owner-side ManicBot channel.
 *
 * Pins the read-only / one-way contract (it's a Telegram-style broadcast
 * channel, not a two-way DM):
 *   - NO composer: the message textarea and "Send" button are gone, so the
 *     owner cannot type or send a reply (the server also rejects sendMyReply
 *     with FORBIDDEN — see platform-messenger-router.test.ts).
 *   - Header subtitle reads "Новости и объявления платформы" (the old
 *     "…и поддержка…" wording is gone now that replies are disabled).
 *   - Empty state announces incoming news instead of inviting the owner to
 *     write.
 *   - Platform messages still render (read path is unchanged).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type ThreadDetail = {
  thread: { id: string } | null;
  messages: Array<{
    id: string;
    senderKind: "platform" | "owner";
    body: string;
    createdAt: number;
  }>;
  unreadCount: number;
};

let getMyThreadMock: { data: ThreadDetail | undefined } = { data: undefined };

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      platformMessenger: { getMyThread: { invalidate: vi.fn() } },
    }),
    platformMessenger: {
      getMyThread: { useQuery: () => getMyThreadMock },
      markMyThreadRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { PlatformOwnerView } from "~/app/(dashboard)/messages/_components/PlatformOwnerView";

afterEach(() => {
  cleanup();
  getMyThreadMock = { data: undefined };
});

describe("PlatformOwnerView — read-only channel", () => {
  it("renders no composer (no textarea, no Send button) — owner cannot reply", () => {
    getMyThreadMock = {
      data: { thread: { id: "pt_1" }, messages: [], unreadCount: 0 },
    };
    renderWithLang(<PlatformOwnerView />);

    expect(screen.queryByTestId("platform-owner-composer")).toBeNull();
    expect(screen.queryByTestId("platform-owner-send")).toBeNull();
    // No editable surface at all.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("header subtitle drops «поддержка» and reads news/announcements", () => {
    getMyThreadMock = {
      data: { thread: { id: "pt_1" }, messages: [], unreadCount: 0 },
    };
    renderWithLang(<PlatformOwnerView />);

    expect(screen.getByText("Новости и объявления платформы")).toBeTruthy();
    expect(screen.queryByText(/поддержка от платформы/)).toBeNull();
  });

  it("empty state announces incoming news, not an invitation to write", () => {
    getMyThreadMock = {
      data: { thread: null, messages: [], unreadCount: 0 },
    };
    renderWithLang(<PlatformOwnerView />);

    expect(
      screen.getByText("Здесь будут появляться новости и объявления от платформы."),
    ).toBeTruthy();
    // The old "пишите прямо тут" invitation must be gone.
    expect(screen.queryByText(/пишите прямо тут/)).toBeNull();
  });

  it("still renders platform messages (read path intact) and no composer with content present", () => {
    getMyThreadMock = {
      data: {
        thread: { id: "pt_1" },
        messages: [
          { id: "m_1", senderKind: "platform", body: "Новая функция уже доступна", createdAt: 1000 },
        ],
        unreadCount: 0,
      },
    };
    renderWithLang(<PlatformOwnerView />);

    expect(screen.getByText("Новая функция уже доступна")).toBeTruthy();
    expect(screen.queryByTestId("platform-owner-send")).toBeNull();
  });
});

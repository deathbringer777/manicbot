// @vitest-environment happy-dom
/**
 * Pins the chat-composer Enter-to-send / Shift+Enter newline behavior for both
 * ticket surfaces:
 *
 *   1. HelpSection (tenant settings → support tickets)
 *   2. SupportDashboard (platform support staff inbox)
 *
 * Regression guard: the original Send-button-only implementation forced users
 * to mouse over to the icon button after every message. The user explicitly
 * called this out as a launch-blocker for 1-on-1 ticket support flows.
 *
 * Behavior contract for both composers:
 *   - Enter (no shift)          → submit the reply mutation, prevent newline
 *   - Shift+Enter               → insert newline, no submit
 *   - Empty / whitespace-only   → no-op
 *   - In-flight mutation        → no-op (prevents double-send)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// ─── HelpSection mocks ───────────────────────────────────────────────────────

const TICKET_ID = "pt_keyboard_test";
const helpReplyMutate = vi.fn();

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({
    role: "tenant_owner",
    previewRole: null,
    tenantId: "t_x",
    userId: "u_x",
    hasPassword: true,
    emailVerified: true,
    billingStatus: "active",
    isTrialExpired: false,
  }),
}));

// Shell uses next/navigation usePathname; default null crashes its render.
vi.mock("next/navigation", () => ({
  usePathname: () => "/platform-support",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// SupportDashboard wraps its content in <Shell>, which spawns a tree of
// peripheral components (NotificationBell, MasterSwitcher, command palette,
// activity feed) that each pull from a different tRPC namespace. We're
// testing the chat composer, not the dashboard chrome — replace Shell with
// a transparent pass-through so the test stays focused.
vi.mock("~/components/layout/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-shell">{children}</div>,
}));

vi.mock("~/trpc/react", () => {
  const ticket = {
    id: TICKET_ID,
    status: "open" as const,
    updatedAt: Math.floor(Date.now() / 1000),
    createdAt: Math.floor(Date.now() / 1000),
    clientName: "test@manicbot.com",
    clientChatId: 0,
    tenantId: "t_x",
    claimedBy: null,
    claimedByWebUserId: null,
  };
  const detail = { ticket, messages: [] };

  // ListTickets returns the seeded ticket so the user can click into the
  // detail view from list view, which is where the textarea is rendered.
  return {
    api: {
      useUtils: () => ({
        support: {
          getMyTickets: { invalidate: () => Promise.resolve() },
          getMyTicket: { invalidate: () => Promise.resolve() },
          getTicket: { invalidate: () => Promise.resolve() },
          getAllTickets: { invalidate: () => Promise.resolve() },
        },
      }),
      // SupportDashboard wraps content in <Shell>, which calls
      // useDashboardPrefs → api.webUsers.getMyUiPrefs.useQuery + setMyUiPrefs,
      // and the MasterSwitcherInline → api.master.getMastersForOwner.
      webUsers: {
        getMyUiPrefs: {
          useQuery: () => ({ data: null, isLoading: false }),
        },
        setMyUiPrefs: {
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        },
      },
      master: {
        getMastersForOwner: {
          useQuery: () => ({ data: [], isLoading: false }),
        },
      },
      tenants: {
        getAll: {
          useQuery: () => ({ data: [], isLoading: false }),
        },
      },
      support: {
        // HelpSection (tenant)
        getMyTickets: {
          useQuery: () => ({ data: [ticket], isLoading: false }),
        },
        getMyTicket: {
          useQuery: () => ({ data: detail, isLoading: false }),
        },
        createTicket: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
        },
        replyToMyTicket: {
          useMutation: () => ({ mutate: helpReplyMutate, isPending: false }),
        },
        // SupportDashboard (platform staff)
        getAllTickets: {
          useQuery: () => ({ data: [ticket], isLoading: false, isError: false, isRefetching: false }),
        },
        getTicket: {
          useQuery: () => ({ data: detail, isLoading: false, isError: false }),
        },
        claimTicket: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        closeTicket: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        escalateTicket: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        replyToTicket: {
          useMutation: () => ({ mutate: supportReplyMutate, isPending: false }),
        },
      },
    },
  };
});

const supportReplyMutate = vi.fn();

// Lazy imports AFTER the mocks are registered.
async function loadHelpSection() {
  const mod = await import("~/components/settings/sections/HelpSection");
  return mod.HelpSection;
}
async function loadSupportDashboard() {
  const mod = await import("~/components/dashboards/SupportDashboard");
  return mod.SupportDashboard;
}

afterEach(() => {
  cleanup();
  helpReplyMutate.mockReset();
  supportReplyMutate.mockReset();
});

describe("HelpSection ticket reply — keyboard behavior", () => {
  it("Enter submits the reply with the trimmed text", async () => {
    const HelpSection = await loadHelpSection();
    renderWithLang(<HelpSection />);

    // Click the ticket card to flip into detail view (textarea only renders there).
    const card = screen.getByText(TICKET_ID).closest("button")!;
    fireEvent.click(card);

    const ta = (await screen.findByTestId("help-ticket-reply-input")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "  hello world  " } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });

    expect(helpReplyMutate).toHaveBeenCalledTimes(1);
    expect(helpReplyMutate).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      text: "hello world",
    });
  });

  it("Shift+Enter does NOT submit (lets the textarea insert a newline)", async () => {
    const HelpSection = await loadHelpSection();
    renderWithLang(<HelpSection />);

    const card = screen.getByText(TICKET_ID).closest("button")!;
    fireEvent.click(card);

    const ta = (await screen.findByTestId("help-ticket-reply-input")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "line one" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });

    expect(helpReplyMutate).not.toHaveBeenCalled();
  });

  it("Enter on whitespace-only input is a no-op", async () => {
    const HelpSection = await loadHelpSection();
    renderWithLang(<HelpSection />);

    const card = screen.getByText(TICKET_ID).closest("button")!;
    fireEvent.click(card);

    const ta = (await screen.findByTestId("help-ticket-reply-input")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "   \n  " } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });

    expect(helpReplyMutate).not.toHaveBeenCalled();
  });
});

describe("SupportDashboard ticket reply — keyboard behavior", () => {
  it("Enter submits the reply (no attachment URL when blank)", async () => {
    const SupportDashboard = await loadSupportDashboard();
    renderWithLang(<SupportDashboard />);

    // Click the ticket row to open detail view.
    const card = screen.getAllByRole("button").find((b) =>
      b.textContent?.includes(TICKET_ID) || b.textContent?.includes("test@manicbot.com"),
    );
    expect(card).toBeTruthy();
    fireEvent.click(card!);

    const ta = (await screen.findByTestId("support-ticket-reply-input")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "platform reply" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });

    expect(supportReplyMutate).toHaveBeenCalledTimes(1);
    const call = supportReplyMutate.mock.calls[0]![0];
    expect(call.ticketId).toBe(TICKET_ID);
    expect(call.text).toBe("platform reply");
    // attachmentUrl is omitted when the field is blank — never sent as ""
    expect(call.attachmentUrl).toBeUndefined();
  });

  it("Shift+Enter does NOT submit", async () => {
    const SupportDashboard = await loadSupportDashboard();
    renderWithLang(<SupportDashboard />);

    const card = screen.getAllByRole("button").find((b) =>
      b.textContent?.includes(TICKET_ID) || b.textContent?.includes("test@manicbot.com"),
    );
    fireEvent.click(card!);

    const ta = (await screen.findByTestId("support-ticket-reply-input")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "draft" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });

    expect(supportReplyMutate).not.toHaveBeenCalled();
  });
});

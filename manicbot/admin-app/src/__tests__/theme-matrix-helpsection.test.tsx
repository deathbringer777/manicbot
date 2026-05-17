// @vitest-environment happy-dom
/**
 * Theme matrix — HelpSection (the 2026-05-16 smoking-gun bug).
 *
 * Renders HelpSection in BOTH themes and asserts:
 *  - Tour replay button uses the <Button> primitive (data-tone="violet", soft).
 *  - "New ticket" button uses <Button tone="emerald" variant="soft">.
 *  - Status badges use <Pill> (data-tone present).
 *  - No raw `text-violet-200` / `text-emerald-200` strings without a
 *    `dark:` pair appear in the rendered DOM.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithLang, setDarkMode } from "./helpers/renderWithLang";

// Mock RoleContext so the section thinks user is tenant_owner.
vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ role: "tenant_owner", previewRole: null, tenantId: "t_x", userId: "u_x", hasPassword: true, emailVerified: true, billingStatus: "active", isTrialExpired: false }),
}));

// Mock tRPC api for support tickets.
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      support: {
        getMyTickets: { invalidate: () => Promise.resolve() },
        getMyTicket: { invalidate: () => Promise.resolve() },
      },
    }),
    support: {
      getMyTickets: { useQuery: () => ({ data: [{ id: "pt_abc", status: "open", updatedAt: Date.now() / 1000 }], isLoading: false }) },
      getMyTicket: { useQuery: () => ({ data: null, isLoading: false }) },
      createTicket: { useMutation: () => ({ mutate: () => {}, isPending: false, error: null }) },
      replyToMyTicket: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      mintTicketUploadToken: {
        useMutation: () => ({
          mutate: () => {},
          mutateAsync: async () => ({ token: "tok", uploadUrl: "https://w/x" }),
          isPending: false,
        }),
      },
    },
  },
}));

import { HelpSection } from "~/components/settings/sections/HelpSection";

afterEach(() => {
  cleanup();
  setDarkMode(false);
});

describe("HelpSection theme matrix", () => {
  it.each([false, true])("renders with dark=%s and uses Button primitives for actions", (dark) => {
    setDarkMode(dark);
    renderWithLang(<HelpSection />);

    // Tour-replay button — soft violet
    const tourBtn = screen.getAllByRole("button").find(
      (b) => b.getAttribute("data-tone") === "violet" && b.getAttribute("data-variant") === "soft",
    );
    expect(tourBtn).toBeTruthy();

    // New-ticket button — soft emerald
    const newTicketBtn = screen.getAllByRole("button").find(
      (b) => b.getAttribute("data-tone") === "emerald" && b.getAttribute("data-variant") === "soft",
    );
    expect(newTicketBtn).toBeTruthy();
  });

  it.each([false, true])("status pills use Pill primitive with data-tone (dark=%s)", (dark) => {
    setDarkMode(dark);
    const { container } = renderWithLang(<HelpSection />);
    const pills = container.querySelectorAll("span[data-tone]");
    // At least one ticket status pill should be rendered for the seeded "open" ticket.
    const tones = Array.from(pills).map((p) => p.getAttribute("data-tone"));
    expect(tones).toContain("amber"); // status: "open" -> amber tone
  });

  it("no raw `text-violet-200` or `text-emerald-200` survive without a `dark:` pair", () => {
    setDarkMode(false);
    const { container } = renderWithLang(<HelpSection />);
    const html = container.innerHTML;
    // The original bug strings. If they appear anywhere in the rendered output,
    // it means the inline styles snuck back in.
    const offenders = [
      /(?<!dark:)text-violet-200\b/,
      /(?<!dark:)text-emerald-200\b/,
    ];
    for (const re of offenders) {
      expect(re.test(html)).toBe(false);
    }
  });

  it("Button + Pill primitives ship both light and dark classes", () => {
    setDarkMode(false);
    renderWithLang(<HelpSection />);
    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("data-tone"));
    for (const b of buttons) {
      expect(b.className).toMatch(/dark:/);
      // And a non-dark utility — i.e. a light-mode class.
      expect(b.className).toMatch(/\b(?:bg|text|border)-/);
    }
  });
});

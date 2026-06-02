// @vitest-environment happy-dom
/**
 * InvitationsNavSection — the sidebar "Invitations" section is a self-clearing
 * signal: it renders ONLY when the user has pending master invitations, one
 * row per invite linking to its accept page, with a count badge. Collapsed
 * rail shows a single icon + count linking to the first invite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type Inv = { invitationId: string; tenantId: string; salonName: string; createdAt: number };
let mockInvData: Inv[] = [];

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    webUsers: {
      myPendingInvitations: {
        useQuery: () => ({ data: mockInvData, isLoading: false }),
      },
    },
  },
}));

import { InvitationsNavSection } from "~/components/layout/InvitationsNavSection";

beforeEach(() => {
  mockInvData = [];
});
afterEach(() => cleanup());

describe("InvitationsNavSection", () => {
  it("renders nothing when there are no pending invitations", () => {
    mockInvData = [];
    const { container } = renderWithLang(<InvitationsNavSection />);
    expect(screen.queryByTestId("invitations-nav-section")).toBeNull();
    expect(container.querySelector('[data-testid="invitations-nav-section"]')).toBeNull();
  });

  it("renders one row per invitation, each linking to its accept page", () => {
    mockInvData = [
      { invitationId: "inv_1", tenantId: "t1", salonName: "Demo Studio", createdAt: 1 },
      { invitationId: "inv_2", tenantId: "t2", salonName: "Second Salon", createdAt: 2 },
    ];
    renderWithLang(<InvitationsNavSection />, "ru");
    expect(screen.getByTestId("invitations-nav-section")).toBeTruthy();

    const items = screen.getAllByTestId("invitation-nav-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute("href")).toBe("/invitations/inv_1");
    expect(items[1]!.getAttribute("href")).toBe("/invitations/inv_2");

    expect(screen.getByText("Demo Studio")).toBeTruthy();
    expect(screen.getByText("Second Salon")).toBeTruthy();
    // Localized header label (ru). Regex avoids the adjacent count badge.
    expect(screen.getByText(/Приглашения/)).toBeTruthy();
  });

  it("collapsed: a single icon link to the first invite with a count badge", () => {
    mockInvData = [
      { invitationId: "inv_1", tenantId: "t1", salonName: "Demo Studio", createdAt: 1 },
      { invitationId: "inv_2", tenantId: "t2", salonName: "Second Salon", createdAt: 2 },
    ];
    renderWithLang(<InvitationsNavSection collapsed />);
    const collapsed = screen.getByTestId("invitations-nav-collapsed");
    expect(collapsed.getAttribute("href")).toBe("/invitations/inv_1");
    expect(collapsed.textContent).toContain("2");
    // No full rows in collapsed mode.
    expect(screen.queryByTestId("invitation-nav-item")).toBeNull();
  });
});

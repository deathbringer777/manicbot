// @vitest-environment happy-dom
/**
 * StatusActionMenu — the dropdown that replaces the three inline action
 * buttons under every confirmed appointment row in the dashboard.
 *
 * Why these tests exist
 *   The component encodes the available-actions matrix per status. Getting
 *   that matrix wrong is a regression that's hard to spot visually — a
 *   confirmed appointment with a "Confirm" item, or a cancelled row that
 *   still surfaces "Mark no-show", would silently break the workflow.
 *   These tests pin the matrix and the click→callback wiring so future
 *   refactors of the menu can't quietly shift it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { StatusActionMenu } from "~/components/dashboard-ui/StatusActionMenu";

type ActionFn = (status: "confirmed" | "cancelled" | "rejected") => void;
type NoShowFn = (by: "client" | "master") => void;

// vi.fn() returns a Mock that TS doesn't unify with the typed callback
// props on StatusActionMenu — cast through unknown to keep mocks ergonomic.
const mkAction = (): ActionFn & { mock: { calls: unknown[][] } } =>
  vi.fn() as unknown as ActionFn & { mock: { calls: unknown[][] } };
const mkNoShow = (): NoShowFn & { mock: { calls: unknown[][] } } =>
  vi.fn() as unknown as NoShowFn & { mock: { calls: unknown[][] } };

describe("StatusActionMenu", () => {
  afterEach(cleanup);

  describe("read-only states (no menu)", () => {
    for (const status of ["cancelled", "rejected", "no_show", "done"] as const) {
      it(`renders a non-interactive pill for status=${status}`, () => {
        render(
          <StatusActionMenu
            statusKey={status}
            label="Status label"
            lang="ru"
            onAction={mkAction()}
            onNoShow={mkNoShow()}
          />,
        );
        expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
        expect(screen.queryByTestId("status-pill-menu")).toBeNull();
        expect(screen.getByTestId("status-pill-readonly")).toBeTruthy();
      });
    }
  });

  describe("pending → confirm / reject", () => {
    let onAction: ActionFn & { mock: { calls: unknown[][] } };
    beforeEach(() => {
      onAction = mkAction();
      render(
        <StatusActionMenu
          statusKey="pending"
          label="Ожидание"
          lang="ru"
          onAction={onAction}
          onNoShow={undefined}
        />,
      );
    });

    it("renders the pill button with chevron and starts collapsed", () => {
      const trigger = screen.getByTestId("status-pill-trigger");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      const menu = screen.getByTestId("status-pill-menu");
      expect(menu.className).toMatch(/\bhidden\b/);
    });

    it("opens the menu on click and shows only Confirm + Reject items", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("true");
      expect(screen.queryByTestId("status-action-confirm")).toBeTruthy();
      expect(screen.queryByTestId("status-action-reject")).toBeTruthy();
      expect(screen.queryByTestId("status-action-cancel")).toBeNull();
      expect(screen.queryByTestId("status-action-client_no_show")).toBeNull();
      expect(screen.queryByTestId("status-action-master_no_show")).toBeNull();
    });

    it("fires onAction('confirmed') when Confirm is clicked and closes the menu", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      fireEvent.click(screen.getByTestId("status-action-confirm"));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith("confirmed");
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("false");
    });

    it("fires onAction('rejected') when Reject is clicked", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      fireEvent.click(screen.getByTestId("status-action-reject"));
      expect(onAction).toHaveBeenCalledWith("rejected");
    });
  });

  describe("confirmed → cancel / no-show client / no-show master", () => {
    let onAction: ActionFn & { mock: { calls: unknown[][] } };
    let onNoShow: NoShowFn & { mock: { calls: unknown[][] } };
    beforeEach(() => {
      onAction = mkAction();
      onNoShow = mkNoShow();
      render(
        <StatusActionMenu
          statusKey="confirmed"
          label="Подтверждено"
          lang="ru"
          onAction={onAction}
          onNoShow={onNoShow}
        />,
      );
    });

    it("shows Cancel + client no-show + master no-show items, NOT Confirm/Reject", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(screen.queryByTestId("status-action-cancel")).toBeTruthy();
      expect(screen.queryByTestId("status-action-client_no_show")).toBeTruthy();
      expect(screen.queryByTestId("status-action-master_no_show")).toBeTruthy();
      expect(screen.queryByTestId("status-action-confirm")).toBeNull();
      expect(screen.queryByTestId("status-action-reject")).toBeNull();
    });

    it("fires onAction('cancelled') when Cancel is clicked", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      fireEvent.click(screen.getByTestId("status-action-cancel"));
      expect(onAction).toHaveBeenCalledWith("cancelled");
      expect(onNoShow).not.toHaveBeenCalled();
    });

    it("fires onNoShow('client') from the client no-show item", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      fireEvent.click(screen.getByTestId("status-action-client_no_show"));
      expect(onNoShow).toHaveBeenCalledWith("client");
      expect(onAction).not.toHaveBeenCalled();
    });

    it("fires onNoShow('master') from the master no-show item", () => {
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      fireEvent.click(screen.getByTestId("status-action-master_no_show"));
      expect(onNoShow).toHaveBeenCalledWith("master");
    });
  });

  describe("keyboard + outside-click", () => {
    it("Escape closes the open menu without firing any callback", () => {
      const onAction = mkAction();
      const onNoShow = mkNoShow();
      const { container } = render(
        <StatusActionMenu
          statusKey="confirmed"
          label="Подтверждено"
          lang="ru"
          onAction={onAction}
          onNoShow={onNoShow}
        />,
      );
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("true");
      // Keyboard handler lives on the wrapper div (the container that
      // owns the trigger + menu).
      const wrapper = container.querySelector("[aria-haspopup='menu']")!.parentElement!;
      fireEvent.keyDown(wrapper, { key: "Escape" });
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("false");
      expect(onAction).not.toHaveBeenCalled();
      expect(onNoShow).not.toHaveBeenCalled();
    });

    it("outside-click closes the menu", () => {
      const onAction = mkAction();
      render(
        <StatusActionMenu
          statusKey="pending"
          label="Ожидание"
          lang="ru"
          onAction={onAction}
        />,
      );
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("true");
      act(() => {
        document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("safety guards", () => {
    it("renders read-only when status=confirmed but no callbacks are provided", () => {
      render(<StatusActionMenu statusKey="confirmed" label="Подтверждено" lang="ru" />);
      // With neither onAction nor onNoShow the matrix is empty → the
      // component falls back to the non-interactive pill.
      expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
      expect(screen.getByTestId("status-pill-readonly")).toBeTruthy();
    });

    it("renders read-only when status=pending and only onNoShow is provided (no Confirm/Reject anchor)", () => {
      render(<StatusActionMenu statusKey="pending" label="Ожидание" lang="ru" onNoShow={mkNoShow()} />);
      // pending uses onAction for both items; without onAction the menu
      // is empty so the trigger is suppressed.
      expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
    });
  });

  describe("portal + sizing", () => {
    // The dropdown used to render INSIDE AptCard, which had
    // overflow-hidden + a glass-card stacking context — so the open
    // menu was either clipped or painted behind the next row. These
    // tests pin the portal escape hatch and the enlarged pill so
    // neither regresses.

    it("renders the open menu in document.body (not inside the trigger wrapper)", () => {
      const { container } = render(
        <StatusActionMenu
          statusKey="confirmed"
          label="Подтверждено"
          lang="ru"
          onAction={mkAction()}
          onNoShow={mkNoShow()}
        />,
      );
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(container.querySelector('[data-testid="status-pill-menu"]')).toBeNull();
      expect(document.body.querySelector('[data-testid="status-pill-menu"]')).toBeTruthy();
    });

    it("pill trigger uses the enlarged tap-target classes (regression guard)", () => {
      render(
        <StatusActionMenu
          statusKey="confirmed"
          label="Подтверждено"
          lang="ru"
          onAction={mkAction()}
          onNoShow={mkNoShow()}
        />,
      );
      const trigger = screen.getByTestId("status-pill-trigger");
      expect(trigger.className).toMatch(/\btext-xs\b/);
      expect(trigger.className).toMatch(/\bpx-2\.5\b/);
      expect(trigger.className).toMatch(/\bpy-1\b/);
    });

    it("scroll closes the open menu (prevents stale fixed-position floater)", () => {
      render(
        <StatusActionMenu
          statusKey="confirmed"
          label="Подтверждено"
          lang="ru"
          onAction={mkAction()}
          onNoShow={mkNoShow()}
        />,
      );
      fireEvent.click(screen.getByTestId("status-pill-trigger"));
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("true");
      act(() => {
        window.dispatchEvent(new Event("scroll"));
      });
      expect(screen.getByTestId("status-pill-trigger").getAttribute("aria-expanded")).toBe("false");
    });
  });
});

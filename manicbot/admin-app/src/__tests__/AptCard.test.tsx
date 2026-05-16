// @vitest-environment happy-dom
/**
 * AptCard — the appointment row used in agenda lists and the today's-
 * appointments card on the dashboard Overview.
 *
 * The 2026-05-16 dashboard cleanup replaced three inline action buttons
 * (Cancel / Client no-show / Master no-show) with a single status-pill
 * dropdown (StatusActionMenu). Cancelled / no-show / rejected / done rows
 * stay visible but are dimmed via opacity-50 instead of being filtered
 * out. These tests pin both behaviours so a future stylistic refactor
 * can't accidentally bring back the action strip or hide terminal rows.
 *
 * StatusActionMenu's own behaviour is covered in StatusActionMenu.test.tsx;
 * here we only assert the AptCard ↔ StatusActionMenu wiring.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AptCard } from "~/components/dashboard-ui/AptCard";

type ActionFn = (id: string | number, status: "confirmed" | "cancelled" | "rejected") => void;
type NoShowFn = (id: string | number, by: "client" | "master") => void;

const mkAction = (): ActionFn & { mock: { calls: unknown[][] } } =>
  vi.fn() as unknown as ActionFn & { mock: { calls: unknown[][] } };
const mkNoShow = (): NoShowFn & { mock: { calls: unknown[][] } } =>
  vi.fn() as unknown as NoShowFn & { mock: { calls: unknown[][] } };

const baseApt = {
  id: "apt_1",
  userName: "Анна Иванова",
  chatId: 12345,
  svcId: "manicure",
  time: "11:30",
  duration: 60,
  status: "confirmed",
  cancelled: 0,
  noShow: 0,
};

describe("AptCard", () => {
  afterEach(cleanup);

  it("renders client name, service, time, and the status-pill trigger", () => {
    render(<AptCard a={baseApt} lang="ru" onAction={mkAction()} onNoShow={mkNoShow()} />);
    expect(screen.getByText("Анна Иванова")).toBeTruthy();
    expect(screen.getByText("manicure")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText(":30")).toBeTruthy();
    expect(screen.queryByTestId("status-pill-trigger")).toBeTruthy();
  });

  it("does NOT render the legacy inline action buttons (Confirm / Reject / Cancel / no-show)", () => {
    render(<AptCard a={baseApt} lang="ru" onAction={mkAction()} onNoShow={mkNoShow()} />);
    // The legacy strip had plain buttons with text; they're gone now —
    // anything that looks like one means the dropdown rollback regressed.
    expect(screen.queryByRole("button", { name: /^Отмена$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Клиент не пришёл$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Мастер не пришёл$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Подтвердить$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Отклонить$/ })).toBeNull();
  });

  it("delegates onAction to StatusActionMenu (Cancel for confirmed rows)", () => {
    const onAction = mkAction();
    const onNoShow = mkNoShow();
    render(<AptCard a={baseApt} lang="ru" onAction={onAction} onNoShow={onNoShow} />);

    fireEvent.click(screen.getByTestId("status-pill-trigger"));
    fireEvent.click(screen.getByTestId("status-action-cancel"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("apt_1", "cancelled");
  });

  it("delegates onNoShow with the right party from the dropdown items", () => {
    const onAction = mkAction();
    const onNoShow = mkNoShow();
    render(<AptCard a={baseApt} lang="ru" onAction={onAction} onNoShow={onNoShow} />);

    fireEvent.click(screen.getByTestId("status-pill-trigger"));
    fireEvent.click(screen.getByTestId("status-action-master_no_show"));
    expect(onNoShow).toHaveBeenCalledWith("apt_1", "master");
  });

  describe("terminal rows stay in the list but are dimmed", () => {
    const terminalCases = [
      { name: "cancelled flag", apt: { ...baseApt, cancelled: 1 } },
      { name: "no_show flag", apt: { ...baseApt, noShow: 1 } },
      { name: "status=rejected", apt: { ...baseApt, status: "rejected" } },
      { name: "status=done", apt: { ...baseApt, status: "done" } },
    ];

    for (const { name, apt } of terminalCases) {
      it(`${name} → card renders with opacity-50 and a read-only pill`, () => {
        render(<AptCard a={apt} lang="ru" onAction={mkAction()} onNoShow={mkNoShow()} />);
        const card = screen.getByTestId("apt-card");
        expect(card.className).toMatch(/\bopacity-50\b/);
        expect(card.getAttribute("data-terminal")).toBe("1");
        // Terminal rows must not expose an actionable dropdown — that
        // would let a salon owner "un-cancel" a row from the UI when
        // the server explicitly refuses (appointment_terminal guard).
        expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
        expect(screen.queryByTestId("status-pill-readonly")).toBeTruthy();
      });
    }

    it("non-terminal confirmed row does NOT carry opacity-50 or the terminal flag", () => {
      render(<AptCard a={baseApt} lang="ru" onAction={mkAction()} onNoShow={mkNoShow()} />);
      const card = screen.getByTestId("apt-card");
      expect(card.className).not.toMatch(/\bopacity-50\b/);
      expect(card.getAttribute("data-terminal")).toBe("0");
    });
  });

  it("falls back to #chatId when userName is missing", () => {
    render(
      <AptCard
        a={{ ...baseApt, userName: undefined }}
        lang="ru"
        onAction={mkAction()}
        onNoShow={mkNoShow()}
      />,
    );
    expect(screen.getByText("#12345")).toBeTruthy();
  });

  it("renders a read-only pill when no callbacks are wired (read-only role)", () => {
    render(<AptCard a={baseApt} lang="ru" />);
    expect(screen.queryByTestId("status-pill-trigger")).toBeNull();
    expect(screen.queryByTestId("status-pill-readonly")).toBeTruthy();
  });

  it("outer card wrapper does NOT carry overflow-hidden (would clip the status dropdown)", () => {
    // The legacy bottom action strip needed overflow-hidden for rounded
    // corners; after the 2026-05-16 dashboard cleanup that strip is
    // gone and the class only served to clip the StatusActionMenu
    // dropdown. Keep the regression guard so it can't sneak back in.
    render(<AptCard a={baseApt} lang="ru" onAction={mkAction()} onNoShow={mkNoShow()} />);
    const card = screen.getByTestId("apt-card");
    expect(card.className).not.toMatch(/\boverflow-hidden\b/);
  });
});

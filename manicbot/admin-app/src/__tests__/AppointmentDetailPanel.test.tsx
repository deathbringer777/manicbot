// @vitest-environment happy-dom
/**
 * AppointmentDetailPanel — the rich bottom drawer that appears when a salon
 * owner clicks an appointment block on the day grid. Locks in the read/edit
 * state machine so a future refactor can't accidentally:
 *
 *   - leave status quick-actions visible in edit mode (would let a click
 *     during an in-flight save clobber the row),
 *   - re-introduce a bare `window.confirm()` for delete (must stay styled),
 *   - call `appointments.update` with a `note` field (no DB column yet),
 *   - send `serviceId: undefined` when the user actually changed services
 *     (would silently drop the edit).
 *
 * The behind-the-scenes mutations (appointments.update, appointments.updateStatus,
 * appointments.markNoShow) are covered separately in appointments.test.ts —
 * here we only assert the UI ↔ mutation wiring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import type { SelectedAppointment } from "~/components/dashboard-ui/AppointmentDetailPanel";

// ── tRPC mocks ──────────────────────────────────────────────────────────────

const updateMutate = vi.fn();
const confirmAptMutate = vi.fn();
const markDoneMutate = vi.fn();
const markNoShowMutate = vi.fn();
const cancelAptMutate = vi.fn();
let updateOnError: ((e: { message: string }) => void) | undefined;
let lastMarkNoShowVars: { noShowBy?: string } | undefined;

vi.mock("~/trpc/react", () => ({
  api: {
    appointments: {
      update: {
        useMutation: (opts?: { onError?: (e: { message: string }) => void; onSuccess?: () => void }) => {
          updateOnError = opts?.onError;
          return { mutate: updateMutate, isPending: false };
        },
      },
    },
    salon: {
      confirmAppointment: {
        useMutation: () => ({ mutate: confirmAptMutate, isPending: false }),
      },
      markDone: {
        useMutation: () => ({ mutate: markDoneMutate, isPending: false }),
      },
      markNoShow: {
        useMutation: () => ({
          mutate: (vars: { noShowBy: string }) => {
            lastMarkNoShowVars = vars;
            markNoShowMutate(vars);
          },
          isPending: false,
          variables: lastMarkNoShowVars,
        }),
      },
      cancelAppointment: {
        useMutation: () => ({ mutate: cancelAptMutate, isPending: false }),
      },
      getNoShowPolicy: {
        // Default grace (15 min); baseSelected is in 2020 so the grace window
        // has long passed → the client no-show button stays enabled.
        useQuery: () => ({ data: { graceMinutes: 15 }, isLoading: false }),
      },
    },
  },
}));

// Avoid loading the appointments lib (pulls i18n + brand-color tables we
// don't need for the panel-level wiring contract).
vi.mock("~/lib/appointments", () => ({
  STATUS_STYLES: {
    confirmed: "bg-emerald-500/15",
    pending: "bg-amber-500/15",
    cancelled: "bg-red-500/15",
    rejected: "bg-red-500/15",
    no_show: "bg-orange-500/15",
    done: "bg-brand-500/15",
  },
  APT_BORDER: {},
}));

// Stub the full client modal — its own data layer (clients.get etc.) is
// covered by ClientDetailModal's own tests. Here we only assert the panel
// mounts it with the right props when «Профиль клиента» is clicked.
vi.mock("~/components/salon/tabs/clients/ClientDetailModal", () => ({
  ClientDetailModal: ({ tenantId, chatId, onClose }: { tenantId: string; chatId: number; onClose: () => void }) => (
    <div data-testid="client-detail-modal-stub" data-tenant={tenantId} data-chat={chatId}>
      <button type="button" data-testid="client-modal-close" onClick={onClose}>x</button>
    </div>
  ),
}));

import { AppointmentDetailPanel } from "~/components/dashboard-ui/AppointmentDetailPanel";

// Past date so the "Mark Done" button is enabled by default. The server-
// side `salon.markDone` refuses when `apt.ts > now`; the panel mirrors
// that check client-side so a future date would render "Done" disabled
// and our click assertions would silently no-op.
const baseSelected: SelectedAppointment = {
  id: "apt_42",
  tenantId: "t_demo",
  date: "2020-01-15",
  time: "14:00",
  duration: 60,
  status: "confirmed",
  cancelled: 0,
  noShow: 0,
  masterId: 5,
  svcId: "svc_classic",
  userName: "Анастасия Орлова",
  userPhone: "+48 555 1111",
  userTg: null,
  chatId: 12345,
};

const masters = [
  { chatId: 5, name: "Юлия" },
  { chatId: 6, name: "Анна" },
];

const services = [
  { svcId: "svc_classic", names: '{"ru":"Маникюр","en":"Classic"}', duration: 60, price: 120 },
  { svcId: "svc_long", names: '{"ru":"Длинная процедура","en":"Long"}', duration: 90, price: 180 },
];

function renderPanel(overrides: Partial<SelectedAppointment> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const utils = render(
    <AppointmentDetailPanel
      tenantId="t_demo"
      selected={{ ...baseSelected, ...overrides }}
      masters={masters}
      services={services}
      lang="ru"
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { ...utils, onClose, onChanged };
}

describe("AppointmentDetailPanel", () => {
  afterEach(() => {
    cleanup();
    updateMutate.mockReset();
    confirmAptMutate.mockReset();
    markDoneMutate.mockReset();
    markNoShowMutate.mockReset();
    cancelAptMutate.mockReset();
    updateOnError = undefined;
    lastMarkNoShowVars = undefined;
  });

  describe("read mode (default)", () => {
    it("renders the status badge, time, duration, and client name", () => {
      renderPanel();
      expect(screen.getByTestId("panel-status-badge")).toBeTruthy();
      // "14:00" appears twice — header time + sub-row of the date card.
      // Client name also appears twice — big header name + Client DetailRow.
      // Both repetitions are intentional; assert presence with the *All*
      // variants to avoid locator ambiguity.
      expect(screen.getAllByText("14:00").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Анастасия Орлова").length).toBeGreaterThan(0);
      expect(screen.getByText("Юлия")).toBeTruthy();
      expect(screen.getByText("Маникюр")).toBeTruthy();
    });

    it("exposes Edit + Delete + Close icon buttons in the header", () => {
      renderPanel();
      expect(screen.getByTestId("panel-edit")).toBeTruthy();
      expect(screen.getByTestId("panel-delete")).toBeTruthy();
    });

    it("hides Edit and Delete on cancelled appointments (can't un-cancel from the panel)", () => {
      renderPanel({ cancelled: 1, status: "cancelled" });
      expect(screen.queryByTestId("panel-edit")).toBeNull();
      expect(screen.queryByTestId("panel-delete")).toBeNull();
    });

    it("shows 'Done' quick-action for confirmed apts", () => {
      renderPanel();
      expect(screen.getByTestId("panel-done")).toBeTruthy();
    });

    it("shows 'Confirm' quick-action for pending apts", () => {
      renderPanel({ status: "pending" });
      expect(screen.getByTestId("panel-confirm")).toBeTruthy();
      // 'Done' shouldn't show on pending — not actionable yet.
      expect(screen.queryByTestId("panel-done")).toBeNull();
    });

    it("hides all status quick-actions on terminal rows", () => {
      renderPanel({ status: "done" });
      expect(screen.queryByTestId("panel-confirm")).toBeNull();
      expect(screen.queryByTestId("panel-done")).toBeNull();
      expect(screen.queryByTestId("panel-client-no-show")).toBeNull();
      expect(screen.queryByTestId("panel-master-no-show")).toBeNull();
    });
  });

  describe("status quick actions", () => {
    it("'Done' calls salon.markDone({ tenantId, id })", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-done"));
      expect(markDoneMutate).toHaveBeenCalledWith({ tenantId: "t_demo", id: "apt_42" });
    });

    it("'Done' button is disabled when the appointment is still in the future", () => {
      // Future date — `salon.markDone` would 400 with cannot_mark_done_before_start.
      const futureYear = new Date().getFullYear() + 1;
      renderPanel({ date: `${futureYear}-01-15` });
      const btn = screen.getByTestId("panel-done") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.dataset.canMarkDone).toBe("0");
    });

    it("'Confirm' on pending calls salon.confirmAppointment({ tenantId, id })", () => {
      renderPanel({ status: "pending" });
      fireEvent.click(screen.getByTestId("panel-confirm"));
      expect(confirmAptMutate).toHaveBeenCalledWith({ tenantId: "t_demo", id: "apt_42" });
    });

    it("'Client no-show' calls salon.markNoShow({ tenantId, id, noShowBy: 'client' })", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-client-no-show"));
      expect(markNoShowMutate).toHaveBeenCalledWith({ tenantId: "t_demo", id: "apt_42", noShowBy: "client" });
    });

    it("'Master no-show' calls salon.markNoShow({ tenantId, id, noShowBy: 'master' })", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-master-no-show"));
      expect(markNoShowMutate).toHaveBeenCalledWith({ tenantId: "t_demo", id: "apt_42", noShowBy: "master" });
    });
  });

  describe("edit mode", () => {
    it("clicking the pencil switches to edit mode (date / time inputs visible)", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      expect(screen.getByTestId("panel-edit-date")).toBeTruthy();
      expect(screen.getByTestId("panel-edit-time")).toBeTruthy();
      expect(screen.getByTestId("panel-edit-cancel")).toBeTruthy();
      expect(screen.getByTestId("panel-edit-save")).toBeTruthy();
    });

    it("HIDES status quick-actions in edit mode (so an in-flight save can't be clobbered)", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      expect(screen.queryByTestId("panel-done")).toBeNull();
      expect(screen.queryByTestId("panel-client-no-show")).toBeNull();
      expect(screen.queryByTestId("panel-master-no-show")).toBeNull();
    });

    it("Save is disabled until something changes (clean snapshot)", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      const save = screen.getByTestId("panel-edit-save") as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });

    it("Save enables after the date changes and fires update() with only the changed field", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      // DatePicker: open the popover and pick another day in the SAME month
      // (Jan 2020 — the appointment's month) so no month navigation is needed.
      fireEvent.click(screen.getByTestId("panel-edit-date-trigger"));
      const day = screen
        .getAllByTestId("panel-edit-date-day")
        .find((d) => d.getAttribute("data-iso") === "2020-01-20");
      fireEvent.click(day!);

      const save = screen.getByTestId("panel-edit-save") as HTMLButtonElement;
      expect(save.disabled).toBe(false);

      fireEvent.click(save);
      expect(updateMutate).toHaveBeenCalledTimes(1);
      // Only the changed field is sent — other fields stay undefined so the
      // mutation skips its cross-tenant guards.
      expect(updateMutate.mock.calls[0]![0]).toEqual({
        id: "apt_42",
        date: "2020-01-20",
        time: undefined,
        masterId: undefined,
        serviceId: undefined,
      });
    });

    it("Cancel reverts edits and returns to read mode (with the original snapshot)", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      // Change the date via the picker (same month — Jan 2020).
      fireEvent.click(screen.getByTestId("panel-edit-date-trigger"));
      const day9 = screen
        .getAllByTestId("panel-edit-date-day")
        .find((d) => d.getAttribute("data-iso") === "2020-01-09");
      fireEvent.click(day9!);

      fireEvent.click(screen.getByTestId("panel-edit-cancel"));
      // Back in read mode — edit-mode inputs are gone, read-mode quick
      // actions are back.
      expect(screen.queryByTestId("panel-edit-date")).toBeNull();
      expect(screen.getByTestId("panel-done")).toBeTruthy();

      // Re-enter edit mode — the picker should show the ORIGINAL value, not
      // the 2020-01-09 we picked earlier. This is the snapshot-revert contract.
      fireEvent.click(screen.getByTestId("panel-edit"));
      expect(
        screen.getByTestId("panel-edit-date-trigger").getAttribute("data-value"),
      ).toBe("2020-01-15");
    });

    it("surfaces 'slot_conflict' from the server as a localized inline error", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-edit"));
      fireEvent.change(screen.getByTestId("panel-edit-time"), { target: { value: "16:00" } });
      fireEvent.click(screen.getByTestId("panel-edit-save"));

      // Mutation rejected — fire the onError captured by the mock. Wrap in
      // act() so React flushes the setErr state update before we query.
      expect(updateOnError).toBeDefined();
      act(() => {
        updateOnError!({ message: "slot_conflict" });
      });

      const err = screen.getByTestId("panel-error");
      // Russian copy from i18n key salon.day.panel.slotConflict.
      expect(err.textContent).toMatch(/уже занят/i);
    });
  });

  describe("delete flow", () => {
    it("clicking the trash icon opens the ConfirmDialog (NOT a native window.confirm)", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-delete"));
      // ConfirmDialog renders an aria-modal dialog with the localized
      // delete title — pin the styled-modal contract.
      const dlg = screen.getByRole("dialog");
      expect(dlg).toBeTruthy();
      expect(dlg.textContent).toMatch(/Отменить запись\?/i);
    });

    it("confirming the dialog calls salon.cancelAppointment({ cancelledBy: 'admin' })", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-delete"));
      // Scope to the modal dialog — the page also has a panel-delete button
      // labelled "Удалить запись", which would otherwise match too.
      const dlg = screen.getByRole("dialog");
      const confirmBtn = within(dlg).getByRole("button", { name: /^Удалить$/i });
      fireEvent.click(confirmBtn);
      expect(cancelAptMutate).toHaveBeenCalledWith({
        tenantId: "t_demo",
        id: "apt_42",
        cancelledBy: "admin",
        comment: expect.any(String),
      });
    });
  });

  describe("client profile button", () => {
    it("renders «Профиль клиента» in read mode when the appointment has a chatId", () => {
      renderPanel();
      expect(screen.getByTestId("panel-open-client")).toBeTruthy();
    });

    it("hides the button when chatId is null (no resolvable client)", () => {
      renderPanel({ chatId: null });
      expect(screen.queryByTestId("panel-open-client")).toBeNull();
    });

    it("opens ClientDetailModal with the appointment's tenantId + chatId on click", () => {
      renderPanel();
      // Modal not mounted until the button is pressed.
      expect(screen.queryByTestId("client-detail-modal-stub")).toBeNull();
      fireEvent.click(screen.getByTestId("panel-open-client"));
      const modal = screen.getByTestId("client-detail-modal-stub");
      expect(modal.getAttribute("data-tenant")).toBe("t_demo");
      expect(modal.getAttribute("data-chat")).toBe("12345");
    });

    it("closes the modal via its onClose without closing the panel", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("panel-open-client"));
      fireEvent.click(screen.getByTestId("client-modal-close"));
      expect(screen.queryByTestId("client-detail-modal-stub")).toBeNull();
      // Panel is still open — the button is back.
      expect(screen.getByTestId("panel-open-client")).toBeTruthy();
    });
  });

  describe("presentation (anchored popover vs centered modal)", () => {
    const anchor = { left: 100, top: 120, width: 120, height: 48 };

    it("read mode renders inside the anchored popover when anchorRect is given", () => {
      render(
        <AppointmentDetailPanel
          tenantId="t_demo"
          selected={baseSelected}
          masters={masters}
          services={services}
          lang="ru"
          anchorRect={anchor}
          onClose={() => undefined}
          onChanged={() => undefined}
        />,
      );
      expect(screen.getByTestId("appointment-detail-popover")).toBeTruthy();
      expect(screen.queryByTestId("appointment-detail-edit-modal")).toBeNull();
      // Read content lives inside the popover.
      expect(screen.getByTestId("panel-status-badge")).toBeTruthy();
    });

    it("escalates to the centered edit modal when the pencil is clicked", () => {
      render(
        <AppointmentDetailPanel
          tenantId="t_demo"
          selected={baseSelected}
          masters={masters}
          services={services}
          lang="ru"
          anchorRect={anchor}
          onClose={() => undefined}
          onChanged={() => undefined}
        />,
      );
      fireEvent.click(screen.getByTestId("panel-edit"));
      expect(screen.getByTestId("appointment-detail-edit-modal")).toBeTruthy();
      expect(screen.queryByTestId("appointment-detail-popover")).toBeNull();
      expect(screen.getByTestId("panel-edit-date")).toBeTruthy();
    });

    it("still renders read content when no anchorRect is provided (backward compatible)", () => {
      render(
        <AppointmentDetailPanel
          tenantId="t_demo"
          selected={baseSelected}
          masters={masters}
          services={services}
          lang="ru"
          onClose={() => undefined}
          onChanged={() => undefined}
        />,
      );
      expect(screen.getByTestId("appointment-detail-popover")).toBeTruthy();
      expect(screen.getByTestId("panel-status-badge")).toBeTruthy();
    });
  });
});

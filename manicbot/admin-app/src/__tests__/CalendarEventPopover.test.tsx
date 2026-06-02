// @vitest-environment happy-dom
/**
 * Calendar event popover layer — the Google-Calendar-style anchored cards
 * introduced so clicking/selecting on the calendar work area no longer slams
 * up a full-screen blurred modal ("фон не видно"). Pins:
 *
 *   - AnchoredPopover portals its children, and dismisses on Esc /
 *     outside-mousedown — but ONLY when `closeOnOutside` is true (so a nested
 *     dialog can freeze dismissal and survive an inside click).
 *   - CreateSlotPopover renders the slot summary + the two create intents
 *     ("Создать запись" → booking form, "Резерв времени" → reservation) and
 *     routes each to the right callback without duplicating booking logic.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { AnchoredPopover } from "~/components/calendar/AnchoredPopover";
import { CreateSlotPopover } from "~/components/calendar/CreateSlotPopover";

const rect = { left: 120, top: 140, width: 120, height: 48 };

afterEach(() => cleanup());

describe("AnchoredPopover", () => {
  it("portals its children to the document body", () => {
    render(
      <AnchoredPopover anchorRect={rect} onClose={() => undefined} testId="anchored-pop">
        <div data-testid="pop-child">hello</div>
      </AnchoredPopover>,
    );
    expect(screen.getByTestId("anchored-pop")).toBeTruthy();
    expect(screen.getByTestId("pop-child").textContent).toBe("hello");
  });

  it("closes on Escape and on an outside mousedown", () => {
    const onClose = vi.fn();
    render(
      <AnchoredPopover anchorRect={rect} onClose={onClose} testId="anchored-pop">
        <button data-testid="inside-btn">x</button>
      </AnchoredPopover>,
    );

    // mousedown INSIDE the panel must not close it.
    fireEvent.mouseDown(screen.getByTestId("inside-btn"));
    expect(onClose).not.toHaveBeenCalled();

    // mousedown OUTSIDE closes.
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape closes.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does NOT dismiss while closeOnOutside is false (a nested dialog is open)", () => {
    const onClose = vi.fn();
    render(
      <AnchoredPopover anchorRect={rect} onClose={onClose} closeOnOutside={false} testId="anchored-pop">
        <div>frozen</div>
      </AnchoredPopover>,
    );
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CreateSlotPopover", () => {
  function renderCreate(overrides: Partial<Parameters<typeof CreateSlotPopover>[0]> = {}) {
    const onCreate = vi.fn();
    const onReserve = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateSlotPopover
        anchorRect={rect}
        date="2026-06-02"
        time="09:00"
        durationMin={60}
        lang="ru"
        onCreate={onCreate}
        onReserve={onReserve}
        onClose={onClose}
        {...overrides}
      />,
    );
    return { onCreate, onReserve, onClose };
  }

  it("shows the slot summary (title + start–end time) and both intents", () => {
    renderCreate();
    const card = screen.getByTestId("create-slot-popover");
    // Localized title + computed end time (09:00 + 60min → 10:00).
    expect(card.textContent).toContain("Новая запись");
    expect(card.textContent).toContain("09:00");
    expect(card.textContent).toContain("10:00");
    expect(screen.getByTestId("create-slot-create")).toBeTruthy();
    expect(screen.getByTestId("create-slot-reserve")).toBeTruthy();
  });

  it("routes «Создать запись» → onCreate and «Резерв времени» → onReserve", () => {
    const { onCreate, onReserve } = renderCreate();
    fireEvent.click(screen.getByTestId("create-slot-create"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onReserve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("create-slot-reserve"));
    expect(onReserve).toHaveBeenCalledTimes(1);
  });

  it("carries the typed title into onCreate / onReserve (GCal inline create)", () => {
    const { onCreate, onReserve } = renderCreate();
    const title = screen.getByTestId("create-slot-title") as HTMLInputElement;

    fireEvent.change(title, { target: { value: "Стрижка" } });
    fireEvent.click(screen.getByTestId("create-slot-create"));
    expect(onCreate).toHaveBeenCalledWith("Стрижка");

    fireEvent.change(title, { target: { value: "Обед" } });
    fireEvent.click(screen.getByTestId("create-slot-reserve"));
    expect(onReserve).toHaveBeenCalledWith("Обед");
  });

  it("Enter in the title field fires the primary create intent", () => {
    const { onCreate } = renderCreate();
    const title = screen.getByTestId("create-slot-title");
    fireEvent.change(title, { target: { value: "Маникюр" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Маникюр");
  });

  it("the × button calls onClose", () => {
    const { onClose } = renderCreate();
    fireEvent.click(screen.getByTestId("create-slot-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment happy-dom
/**
 * BlockDetailPanel — delete must dim the whole screen like the create/edit
 * modal and NOT leave the read popover layered behind the confirm dialog
 * (the user's "наслаивание и затемнение" complaint, screenshot 1).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      appointmentBlocks: { listByRange: { invalidate: vi.fn() } },
      appointments: { getAll: { invalidate: vi.fn() } },
    }),
    appointmentBlocks: {
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { BlockDetailPanel } from "~/components/dashboard-ui/BlockDetailPanel";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(cleanup);

const block = {
  id: "b1",
  date: "2026-06-03",
  time: "10:45",
  durationMin: 60,
  endDate: null,
  masterId: 100,
  type: "reservation" as const,
  reason: "Прогрев",
};
const masters = [{ chatId: 100, name: "Anna" }];
const anchorRect = { left: 100, top: 100, width: 120, height: 48 };

function setup() {
  return renderWithLang(
    <BlockDetailPanel
      tenantId="t1"
      block={block}
      masters={masters}
      lang="ru"
      anchorRect={anchorRect}
      onClose={() => undefined}
      onChanged={() => undefined}
    />,
    "ru",
  );
}

describe("BlockDetailPanel — delete dimming / layering", () => {
  it("shows the read popover by default", () => {
    setup();
    expect(screen.getByTestId("block-detail-popover")).toBeTruthy();
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("clicking delete hides the popover and shows ONLY the full-screen confirm (no stacked cards)", () => {
    setup();
    fireEvent.click(screen.getByTestId("block-panel-delete"));
    expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    // The read popover must NOT remain layered behind the confirm dialog.
    expect(screen.queryByTestId("block-detail-popover")).toBeNull();
  });

  it("cancelling the confirm restores the read popover", () => {
    setup();
    fireEvent.click(screen.getByTestId("block-panel-delete"));
    fireEvent.click(screen.getByText("Отмена"));
    expect(screen.getByTestId("block-detail-popover")).toBeTruthy();
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });
});

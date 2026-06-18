// @vitest-environment happy-dom
/**
 * TimeReservationDialog — a slot reservation must target ONE master (or the
 * whole team only when «Все мастера» is chosen EXPLICITLY).
 *
 * Regression: the submit branch used `if (allMasters || masterId == null)`,
 * so opening the dialog from the FAB (no `defaultMasterId`) and submitting
 * without touching the master picker silently fanned the reservation out to
 * every master — one hatched block per column ("куча блоков"). The picker's
 * `null` ("not yet chosen") was being conflated with "all masters".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";

const { createMutate, createManyMutate } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  createManyMutate: vi.fn(),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      appointmentBlocks: { listByRange: { invalidate: vi.fn() } },
      appointments: { getAll: { invalidate: vi.fn() } },
    }),
    salon: {
      getMasters: {
        useQuery: () => ({
          data: [
            { chatId: 100, name: "Anna" },
            { chatId: 200, name: "Bohdan" },
          ],
        }),
      },
    },
    appointmentBlocks: {
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      createMany: { useMutation: () => ({ mutate: createManyMutate, isPending: false }) },
    },
  },
}));

import { TimeReservationDialog } from "~/components/dashboard/TimeReservationDialog";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  createManyMutate.mockClear();
});

function setup(props?: Partial<React.ComponentProps<typeof TimeReservationDialog>>) {
  return renderWithLang(
    <TimeReservationDialog
      tenantId="t1"
      defaultDate="2026-06-20"
      defaultTime="10:00"
      defaultDurationMin={30}
      onClose={() => undefined}
      {...props}
    />,
    "ru",
  );
}

describe("TimeReservationDialog — master targeting", () => {
  it("blocks submit while no master is chosen (no silent fan-out to all)", () => {
    const { container } = setup();
    const submit = screen.getByTestId("block-submit") as HTMLButtonElement;
    // Date/time/duration are valid, yet submit stays disabled until a master
    // (or «Все мастера») is picked — the regression that fanned out is gone.
    expect(submit.disabled).toBe(true);

    // Even forcing a form submit must not fire either mutation.
    fireEvent.submit(container.querySelector("form")!);
    expect(createManyMutate).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("creates a SINGLE block for a specific master, never createMany", () => {
    setup({ defaultMasterId: 100 });
    const submit = screen.getByTestId("block-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ tenantId: "t1", masterId: 100 });
    expect(createManyMutate).not.toHaveBeenCalled();
  });

  it("fans out only when «Все мастера» is chosen explicitly", () => {
    setup();
    // Open the master picker and pick the first option («Все мастера»).
    fireEvent.click(screen.getByTestId("block-master-trigger"));
    // Options share one testid; the first is «Все мастера».
    fireEvent.click(screen.getAllByTestId("block-master-option")[0]!);

    const submit = screen.getByTestId("block-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(createManyMutate).toHaveBeenCalledTimes(1);
    expect(createManyMutate.mock.calls[0]![0]).toMatchObject({
      tenantId: "t1",
      masterIds: [100, 200],
    });
    expect(createMutate).not.toHaveBeenCalled();
  });
});

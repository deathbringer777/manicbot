// @vitest-environment happy-dom
/**
 * ClientFormModal — multi-channel contact form.
 *
 * Pins the 0062 contract:
 *   * Name + at-least-one-contact is the only valid state. Submit
 *     button stays disabled otherwise.
 *   * All four contact channels (phone / email / Telegram / Instagram)
 *     are independently optional but at least ONE must be filled.
 *   * On submit, the create mutation is called with the exact payload
 *     shape expected by the server-side `clients.create` procedure —
 *     `{ tenantId, name, contacts: { phone?, email?, tgUsername?, igUsername? } }`.
 *   * The form survives mode switch: passing `initial` puts it into
 *     edit mode and routes to `clients.update` instead.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ClientFormModal } from "~/components/salon/tabs/clients/ClientFormModal";

const createMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      clients: {
        list: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
        getListMemberships: { invalidate: vi.fn() },
        // 0074 — favorite-master suggestion cache invalidation.
        getFavoriteMasterSuggestion: { invalidate: vi.fn() },
      },
      marketingTenant: {
        segmentsList: { invalidate: vi.fn() },
      },
    }),
    clients: {
      create: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            createMutate(vars);
            opts?.onSuccess?.({ chatId: -1, marketingContactId: 99 });
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            updateMutate(vars);
            opts?.onSuccess?.({ ok: true });
          },
          isPending: false,
        }),
      },
      // 0072: client lists membership — stubbed as a noop so the form
      // renders without DB. The router-level tests cover real behavior.
      getListMemberships: {
        useQuery: () => ({ data: { marketingContactId: null, segmentIds: [] }, isLoading: false }),
      },
      setListMemberships: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({ added: 0, removed: 0 }), isPending: false }),
      },
    },
    // 0074: favorite-master picker reads the active-master roster.
    // Empty list keeps the picker hidden in this test (which exercises
    // the contact-channel surface, not the picker itself — those go in
    // clients-favorite-master.test.ts on the router side).
    salon: {
      getMasters: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    marketingTenant: {
      segmentsList: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      segmentCreate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function renderForm(initial: any = null) {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <ClientFormModal
        tenantId="t_demo"
        initial={initial}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </LangContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  updateMutate.mockClear();
});

describe("ClientFormModal — multi-channel contact (0062)", () => {
  it("submit stays disabled with name only (no contact)", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: "Karina" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit stays disabled with contact only (no name)", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-phone"), { target: { value: "+48500152948" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit is enabled with name + phone", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: "Karina" } });
    fireEvent.change(screen.getByTestId("cf-phone"), { target: { value: "+48500152948" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submit is enabled with name + email (no phone needed)", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: "Karina" } });
    fireEvent.change(screen.getByTestId("cf-email"), { target: { value: "k@n.com" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submit is enabled with name + Telegram only", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("cf-tg"), { target: { value: "@karina" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submit is enabled with name + Instagram only", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("cf-ig"), { target: { value: "@kar_nails" } });
    expect((screen.getByTestId("cf-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls create.mutate with the canonical payload shape", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("cf-name"), { target: { value: " Karina " } });
    fireEvent.change(screen.getByTestId("cf-phone"), { target: { value: "+48500152948" } });
    fireEvent.change(screen.getByTestId("cf-email"), { target: { value: "k@n.com" } });
    fireEvent.change(screen.getByTestId("cf-tg"), { target: { value: "@karina" } });
    fireEvent.change(screen.getByTestId("cf-ig"), { target: { value: "@kar_nails" } });

    fireEvent.click(screen.getByTestId("cf-submit"));

    expect(createMutate).toHaveBeenCalledOnce();
    const payload = createMutate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      tenantId: "t_demo",
      name: "Karina",      // trimmed
      contacts: {
        phone: "+48500152948",
        email: "k@n.com",
        tgUsername: "@karina",
        igUsername: "@kar_nails",
      },
    });
  });

  it("edit mode (initial provided) routes to update.mutate, not create", () => {
    renderForm({
      chatId: 42,
      name: "Karina",
      phone: "+48500152948",
      email: null,
      tgUsername: null,
      igUsername: null,
      tags: null,
      notes: null,
      dob: null,
    });
    fireEvent.change(screen.getByTestId("cf-email"), { target: { value: "k@n.com" } });
    fireEvent.click(screen.getByTestId("cf-submit"));

    expect(updateMutate).toHaveBeenCalledOnce();
    expect(createMutate).not.toHaveBeenCalled();
    const payload = updateMutate.mock.calls[0]![0];
    expect(payload.chatId).toBe(42);
    expect(payload.patch.email).toBe("k@n.com");
  });

  it("normalizes empty trimmed fields to null in the update patch", () => {
    renderForm({
      chatId: 42,
      name: "K",
      phone: "+48500152948",
      email: "existing@e.com",
      tgUsername: null,
      igUsername: null,
      tags: null,
      notes: null,
      dob: null,
    });
    // Clear the email by entering whitespace.
    fireEvent.change(screen.getByTestId("cf-email"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("cf-submit"));
    const payload = updateMutate.mock.calls[0]![0];
    expect(payload.patch.email).toBeNull();
  });
});

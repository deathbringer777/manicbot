// @vitest-environment happy-dom
/**
 * ClientRow — Clients-tab list row render contract.
 *
 * Pins the 0062 + 0072 behaviour:
 *   * Avatar is the saved emoji (default 👩) or an uploaded photo;
 *     rose-tinted background variant for globally-blocked clients.
 *   * Mobile shows ONE truncated primary contact line + icon row for
 *     additional channels; tablet+ shows phone/email/tg/ig inline.
 *     (We assert the markup via the sm:hidden / sm:inline classes — the
 *     visual breakpoint isn't exercised in jsdom, but the className
 *     contract is the source of truth.)
 *   * Loyalty star appears at 5+ lifetime visits.
 *   * Ban icon (no chip label) replaces the "blocked" badge on mobile.
 *   * Clicking the row fires onClick.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientRow, type ClientRowData } from "~/components/salon/tabs/clients/ClientRow";

const BASE: ClientRowData = {
  chatId: 1,
  name: "Karina",
  phone: "+48500152948",
  email: null,
  tgUsername: null,
  igUsername: null,
  tags: null,
  lifetimeVisits: 0,
  lastVisitAt: null,
  isBlockedGlobal: 0,
};

afterEach(cleanup);

describe("ClientRow", () => {
  it("renders the default 👩 emoji in the avatar when none is saved", () => {
    render(<ClientRow c={{ ...BASE, name: "karina" }} onClick={() => {}} />);
    const avatar = screen.getByTestId(`client-row-avatar-${BASE.chatId}`);
    expect(avatar.textContent).toContain("👩");
  });

  it("renders the saved emoji when avatarEmoji is set", () => {
    render(
      <ClientRow
        c={{ ...BASE, name: "Karina", avatarEmoji: "👸" }}
        onClick={() => {}}
      />,
    );
    const avatar = screen.getByTestId(`client-row-avatar-${BASE.chatId}`);
    expect(avatar.textContent).toContain("👸");
    expect(avatar.textContent).not.toContain("👩");
  });

  it("renders an <img> when avatarUrl is set (photo wins over emoji)", () => {
    render(
      <ClientRow
        c={{ ...BASE, name: "Karina", avatarEmoji: "👸", avatarUrl: "https://example.com/a.webp" }}
        onClick={() => {}}
      />,
    );
    const img = screen
      .getByTestId(`client-row-avatar-${BASE.chatId}`)
      .querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/a.webp");
  });

  it("falls back to #chatId when name is null", () => {
    render(<ClientRow c={{ ...BASE, name: null }} onClick={() => {}} />);
    expect(screen.getByTestId(`client-row-${BASE.chatId}`).textContent).toContain("#1");
  });

  it("shows the loyalty star only at 5+ lifetime visits", () => {
    const { rerender } = render(
      <ClientRow c={{ ...BASE, lifetimeVisits: 4 }} onClick={() => {}} />,
    );
    expect(screen.getByTestId(`client-row-${BASE.chatId}`).querySelector('[aria-label="loyal-client"]')).toBeNull();
    rerender(<ClientRow c={{ ...BASE, lifetimeVisits: 5 }} onClick={() => {}} />);
    expect(screen.getByTestId(`client-row-${BASE.chatId}`).querySelector('[aria-label="loyal-client"]')).toBeTruthy();
  });

  it("paints the avatar rose-tinted when client is globally blocked", () => {
    render(<ClientRow c={{ ...BASE, isBlockedGlobal: 1 }} onClick={() => {}} />);
    const avatar = screen.getByTestId(`client-row-avatar-${BASE.chatId}`);
    expect(avatar?.className ?? "").toMatch(/bg-rose-500\/15/);
  });

  it("surfaces a Ban icon (aria-label='blocked') when isBlockedGlobal=1", () => {
    render(<ClientRow c={{ ...BASE, isBlockedGlobal: 1 }} onClick={() => {}} />);
    expect(
      screen.getByTestId(`client-row-${BASE.chatId}`).querySelector('[aria-label="blocked"]'),
    ).toBeTruthy();
  });

  it("primary mobile contact line picks phone first, then email, then @tg, then @ig", () => {
    // phone wins
    const { container, rerender } = render(
      <ClientRow
        c={{ ...BASE, phone: "+48000", email: "x@y.com", tgUsername: "tg1", igUsername: "ig1" }}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".sm\\:hidden")?.textContent).toContain("+48000");

    // email wins when no phone
    rerender(
      <ClientRow
        c={{ ...BASE, phone: null, email: "x@y.com", tgUsername: "tg1", igUsername: "ig1" }}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".sm\\:hidden")?.textContent).toContain("x@y.com");

    // tg wins when no phone/email
    rerender(
      <ClientRow
        c={{ ...BASE, phone: null, email: null, tgUsername: "tg1", igUsername: "ig1" }}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".sm\\:hidden")?.textContent).toContain("@tg1");
  });

  it("renders up to 3 tag chips", () => {
    render(
      <ClientRow
        c={{ ...BASE, tags: "vip, returning, new, fifth, sixth" }}
        onClick={() => {}}
      />,
    );
    const text = screen.getByTestId(`client-row-${BASE.chatId}`).textContent ?? "";
    expect(text).toContain("vip");
    expect(text).toContain("returning");
    expect(text).toContain("new");
    expect(text).not.toContain("fifth");
    expect(text).not.toContain("sixth");
  });

  it("clicking the row fires onClick exactly once", () => {
    const onClick = vi.fn();
    render(<ClientRow c={BASE} onClick={onClick} />);
    fireEvent.click(screen.getByTestId(`client-row-${BASE.chatId}`));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

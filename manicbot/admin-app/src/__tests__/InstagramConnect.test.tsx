// @vitest-environment happy-dom
/**
 * UI tests for `InstagramConnect.tsx` — the OAuth-first IG connect surface.
 *
 * Coverage:
 *   - renders two OAuth buttons + collapsed manual paste escape hatch
 *   - clicking IG button triggers metaOAuth.start with provider='instagram'
 *   - clicking FB button triggers metaOAuth.start with provider='facebook'
 *   - mount-time URL param handler:
 *     * meta_state + meta_ok=1 → consume → autoFinalize → onConnected()
 *     * meta_state + meta_ok=1 + multi-page response → opens page picker
 *     * meta_state + meta_ok=0 → renders error
 *   - page picker disables rows with no IG link, calls finalize on click
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

const startMutate = vi.fn();
const consumeMutate = vi.fn();
const finalizeMutate = vi.fn();
const routerReplace = vi.fn();

let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    metaOAuth: {
      start: { useMutation: () => ({ mutate: startMutate, isPending: false }) },
      consume: { useMutation: () => ({ mutate: consumeMutate, isPending: false }) },
      finalize: { useMutation: () => ({ mutate: finalizeMutate, isPending: false }) },
    },
    salon: {
      connectInstagram: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

// MetaGuide pulls a heavy tree we don't need here.
vi.mock("~/components/settings/MetaGuide", () => ({
  MetaGuide: () => null,
}));

import { InstagramConnect } from "~/components/salon/InstagramConnect";

afterEach(() => {
  cleanup();
  startMutate.mockReset();
  consumeMutate.mockReset();
  finalizeMutate.mockReset();
  routerReplace.mockReset();
  searchParamsValue = new URLSearchParams();
});

// Helper: install a stub on window.open so we can detect the popup
// attempt and choose whether to simulate a successful or blocked popup.
function installPopupStub({ blocked = false }: { blocked?: boolean } = {}) {
  const fakePopup = {
    location: { href: "about:blank" } as { href: string },
    closed: false,
    close() { this.closed = true; },
  };
  const open = vi.fn().mockImplementation(() => (blocked ? null : fakePopup));
  Object.defineProperty(window, "open", { value: open, writable: true, configurable: true });
  return { open, fakePopup };
}

describe("InstagramConnect — initial render", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels"),
      writable: true,
    });
    installPopupStub();
  });

  it("renders two OAuth buttons with the recommended badge on Instagram", () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    expect(screen.getByTestId("ig-oauth-instagram-btn")).toBeTruthy();
    expect(screen.getByTestId("ig-oauth-facebook-btn")).toBeTruthy();
    expect(screen.getByText(/Рекомендуем/)).toBeTruthy();
  });

  it("clicking Instagram opens a popup synchronously THEN calls metaOAuth.start with popup=true", () => {
    const { open } = installPopupStub();
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));
    // popup-blocker workaround — open() must fire synchronously inside the
    // click handler. Asserting *before* the mutation pin guarantees order.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe("about:blank");
    expect(open.mock.calls[0]![1]).toBe("meta-oauth");

    expect(startMutate).toHaveBeenCalledTimes(1);
    const [input] = startMutate.mock.calls[0]!;
    expect(input).toMatchObject({ tenantId: "t_x", provider: "instagram", popup: true });
    expect(input.returnTo).toContain("manicbot.com");
  });

  it("clicking Facebook button calls metaOAuth.start with provider='facebook' + popup=true", () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-facebook-btn"));
    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(startMutate.mock.calls[0]![0]).toMatchObject({
      tenantId: "t_x",
      provider: "facebook",
      popup: true,
    });
  });

  it("when popup is blocked → passes popup=false to start and falls back to top-level navigation", () => {
    installPopupStub({ blocked: true });
    const navTarget: { href: string } = { href: "" };
    Object.defineProperty(window, "location", {
      value: new Proxy(new URL("https://admin.manicbot.com/dashboard?tab=channels"), {
        set(target, prop, value) {
          if (prop === "href") { navTarget.href = String(value); return true; }
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          if (prop === "href") return navTarget.href || target.href;
          return Reflect.get(target, prop);
        },
      }),
      writable: true,
      configurable: true,
    });

    startMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        authUrl: "https://www.instagram.com/oauth/authorize?state=abc",
        state: "abc".padEnd(64, "0"),
        callbackOrigin: "https://manicbot.com",
        expiresAt: 9999,
      });
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    expect(startMutate.mock.calls[0]![0].popup).toBe(false);
    expect(navTarget.href).toContain("instagram.com/oauth/authorize");
  });

  it("returnTo strips oauth-related params so refresh during consume doesn't loop", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels&meta_state=oldstate&meta_ok=1"),
      writable: true,
    });
    installPopupStub();
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));
    const input = startMutate.mock.calls[0]![0];
    const returnUrl = new URL(input.returnTo);
    expect(returnUrl.searchParams.get("meta_state")).toBeNull();
    expect(returnUrl.searchParams.get("meta_ok")).toBeNull();
    expect(returnUrl.searchParams.get("tab")).toBe("channels");
  });

  it("on start success: navigates the popup to the auth URL (instead of full-page navigation)", () => {
    const { fakePopup } = installPopupStub();
    startMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        authUrl: "https://www.instagram.com/oauth/authorize?state=abc",
        state: "abc".padEnd(64, "0"),
        callbackOrigin: "https://manicbot.com",
        expiresAt: 9999,
      });
    });
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));
    expect(fakePopup.location.href).toBe("https://www.instagram.com/oauth/authorize?state=abc");
  });
});

// ── postMessage path ────────────────────────────────────────────────────────

describe("InstagramConnect — postMessage bridge", () => {
  const STATE = "deadbeef".repeat(8); // 64 hex chars
  const ORIGIN = "https://manicbot.com";

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels"),
      writable: true,
    });
    installPopupStub();
    startMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        authUrl: "https://www.instagram.com/oauth/authorize?state=" + STATE,
        state: STATE,
        callbackOrigin: ORIGIN,
        expiresAt: 9999,
      });
    });
  });

  function fireOAuthMessage(data: Record<string, unknown>, origin: string = ORIGIN) {
    const event = new MessageEvent("message", { data, origin });
    window.dispatchEvent(event);
  }

  it("on success message: validates origin + state, runs consume", async () => {
    consumeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({ autoFinalized: true, channelConfigId: "cc_1", subscribed: true });
    });
    const onConnected = vi.fn();
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={onConnected} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    fireOAuthMessage({
      source: "manicbot-meta-oauth",
      meta_ok: "1",
      meta_state: STATE,
    });

    await waitFor(() => expect(consumeMutate).toHaveBeenCalledTimes(1));
    expect(consumeMutate.mock.calls[0]![0]).toMatchObject({ tenantId: "t_x", state: STATE });
    expect(onConnected).toHaveBeenCalled();
  });

  it("ignores messages from a foreign origin (defense-in-depth)", async () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    fireOAuthMessage(
      { source: "manicbot-meta-oauth", meta_ok: "1", meta_state: STATE },
      "https://evil.example.com",
    );

    // Give the event loop a beat — consume must NOT have been called.
    await new Promise((r) => setTimeout(r, 0));
    expect(consumeMutate).not.toHaveBeenCalled();
  });

  it("ignores messages with a state that doesn't match the pending flow", async () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    fireOAuthMessage({
      source: "manicbot-meta-oauth",
      meta_ok: "1",
      meta_state: "f".repeat(64),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(consumeMutate).not.toHaveBeenCalled();
  });

  it("ignores messages without the expected source field (random postMessage from extensions etc.)", async () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    fireOAuthMessage({ meta_ok: "1", meta_state: STATE });
    await new Promise((r) => setTimeout(r, 0));
    expect(consumeMutate).not.toHaveBeenCalled();
  });

  it("on error message: renders friendly cancelled copy, skips consume", async () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));

    fireOAuthMessage({
      source: "manicbot-meta-oauth",
      meta_ok: "0",
      meta_state: STATE,
      meta_error: "access_denied",
    });

    await waitFor(() => expect(screen.getByText(/Подключение отменено/)).toBeTruthy());
    expect(consumeMutate).not.toHaveBeenCalled();
  });
});

describe("InstagramConnect — Meta callback handler", () => {
  // The mount-time URL-params intake path is the popup-blocker fallback.
  // We force window.location to mirror the searchParams mock so the
  // clearMetaParams() call (which reads window.location.href, not the mock)
  // actually finds something to strip.
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels&meta_state=" + "a".repeat(64) + "&meta_ok=1"),
      writable: true,
      configurable: true,
    });
  });

  it("on meta_state + meta_ok=1 + auto-finalize → calls onConnected + clears URL params", async () => {
    const onConnected = vi.fn();
    searchParamsValue = new URLSearchParams({
      meta_state: "a".repeat(64),
      meta_ok: "1",
    });
    consumeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({ autoFinalized: true, channelConfigId: "cc_1", subscribed: true });
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={onConnected} />, "ru");

    await waitFor(() => {
      expect(consumeMutate).toHaveBeenCalledTimes(1);
    });
    expect(onConnected).toHaveBeenCalled();
    expect(routerReplace).toHaveBeenCalled();
  });

  it("on meta_ok=1 with FB picker payload → opens picker modal", async () => {
    searchParamsValue = new URLSearchParams({
      meta_state: "b".repeat(64),
      meta_ok: "1",
    });
    consumeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        autoFinalized: false,
        provider: "facebook",
        pages: [
          { id: "pg_1", name: "Salon Page", igBusinessId: "ig1", igUsername: "salon" },
          { id: "pg_2", name: "Other Page", igBusinessId: null, igUsername: null },
        ],
      });
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");

    await waitFor(() => {
      expect(screen.queryByTestId("meta-page-picker")).toBeTruthy();
    });
    expect(screen.getByText("Salon Page")).toBeTruthy();
    expect(screen.getByText("Other Page")).toBeTruthy();
  });

  it("on meta_ok=0 with access_denied → renders cancelled message", async () => {
    searchParamsValue = new URLSearchParams({
      meta_state: "c".repeat(64),
      meta_ok: "0",
      meta_error: "access_denied",
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");

    await waitFor(() => {
      expect(screen.getByText(/Подключение отменено/)).toBeTruthy();
    });
    expect(consumeMutate).not.toHaveBeenCalled();
  });

  it("on meta_ok=0 with expired state error → renders friendly retry message", async () => {
    searchParamsValue = new URLSearchParams({
      meta_state: "d".repeat(64),
      meta_ok: "0",
      meta_error: "session_expired",
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");

    await waitFor(() => {
      // Falls through to the default expired/unknown message.
      expect(screen.getByText(/session_expired|истекла/i)).toBeTruthy();
    });
  });
});

describe("InstagramConnect — Page picker", () => {
  it("disables Pages with no IG account and enables ones with an IG link", async () => {
    searchParamsValue = new URLSearchParams({
      meta_state: "e".repeat(64),
      meta_ok: "1",
    });
    consumeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        autoFinalized: false,
        provider: "facebook",
        pages: [
          { id: "pg_1", name: "Salon Page", igBusinessId: "ig1", igUsername: "salon" },
          { id: "pg_2", name: "Other Page", igBusinessId: null, igUsername: null },
        ],
      });
    });

    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    await waitFor(() => expect(screen.queryByTestId("meta-page-picker")).toBeTruthy());

    const salonButton = screen.getByText("Salon Page").closest("button")!;
    const otherButton = screen.getByText("Other Page").closest("button")!;
    expect(salonButton.hasAttribute("disabled")).toBe(false);
    expect(otherButton.hasAttribute("disabled")).toBe(true);
  });

  it("clicking an IG-linked Page calls metaOAuth.finalize with state + pageId", async () => {
    searchParamsValue = new URLSearchParams({
      meta_state: "f".repeat(64),
      meta_ok: "1",
    });
    consumeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({
        autoFinalized: false,
        provider: "facebook",
        pages: [
          { id: "pg_1", name: "Salon Page", igBusinessId: "ig1", igUsername: "salon" },
        ],
      });
    });

    const onConnected = vi.fn();
    renderWithLang(<InstagramConnect tenantId="t_xy" onConnected={onConnected} />, "ru");
    await waitFor(() => expect(screen.queryByTestId("meta-page-picker")).toBeTruthy());

    finalizeMutate.mockImplementation((_input, opts) => {
      opts.onSuccess({ channelConfigId: "cc_fb_1" });
    });

    fireEvent.click(screen.getByText("Salon Page").closest("button")!);
    expect(finalizeMutate).toHaveBeenCalledTimes(1);
    expect(finalizeMutate.mock.calls[0]![0]).toMatchObject({
      tenantId: "t_xy",
      state: "f".repeat(64),
      pageId: "pg_1",
    });
    expect(onConnected).toHaveBeenCalled();
  });
});

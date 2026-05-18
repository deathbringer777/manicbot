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

describe("InstagramConnect — initial render", () => {
  beforeEach(() => {
    // Ensure window.location returns a sensible default for buildReturnTo().
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels"),
      writable: true,
    });
  });

  it("renders two OAuth buttons with the recommended badge on Instagram", () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    expect(screen.getByTestId("ig-oauth-instagram-btn")).toBeTruthy();
    expect(screen.getByTestId("ig-oauth-facebook-btn")).toBeTruthy();
    expect(screen.getByText(/Рекомендуем/)).toBeTruthy();
  });

  it("clicking Instagram button calls metaOAuth.start with provider='instagram'", () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));
    expect(startMutate).toHaveBeenCalledTimes(1);
    const [input] = startMutate.mock.calls[0]!;
    expect(input).toMatchObject({ tenantId: "t_x", provider: "instagram" });
    expect(input.returnTo).toContain("manicbot.com");
  });

  it("clicking Facebook button calls metaOAuth.start with provider='facebook'", () => {
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-facebook-btn"));
    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(startMutate.mock.calls[0]![0]).toMatchObject({ tenantId: "t_x", provider: "facebook" });
  });

  it("returnTo strips oauth-related params so refresh during consume doesn't loop", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://admin.manicbot.com/dashboard?tab=channels&meta_state=oldstate&meta_ok=1"),
      writable: true,
    });
    renderWithLang(<InstagramConnect tenantId="t_x" onConnected={vi.fn()} />, "ru");
    fireEvent.click(screen.getByTestId("ig-oauth-instagram-btn"));
    const input = startMutate.mock.calls[0]![0];
    const returnUrl = new URL(input.returnTo);
    expect(returnUrl.searchParams.get("meta_state")).toBeNull();
    expect(returnUrl.searchParams.get("meta_ok")).toBeNull();
    expect(returnUrl.searchParams.get("tab")).toBe("channels");
  });
});

describe("InstagramConnect — Meta callback handler", () => {
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

// @vitest-environment happy-dom
/**
 * TrackingLinksGenerator — tracking-link builder.
 *
 * Pins the UX contract:
 *   - Source + Campaign visible by default; Channel + Content sit behind the
 *     collapsed "Дополнительно" toggle (à la Mailchimp / Bitly campaign builders).
 *   - No raw `Токен: … · N/64` debug row.
 *   - Human-readable RU placeholders, not UTM jargon.
 *   - Links carry a persisted SHORT CODE (e.g. ?start=ab12cd34), not an inline
 *     base64 payload — so there is no 64-char limit and no length warning, and a
 *     server failure surfaces a friendly localized message (not the raw error).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type BuildLinksData = {
  shortCode: string;
  links: Array<{ label: string; url: string }>;
};

let buildLinksMock: {
  mutate: ReturnType<typeof vi.fn>;
  data: BuildLinksData | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

vi.mock("~/trpc/react", () => ({
  api: {
    analytics: {
      buildTrackingLinks: { useMutation: () => buildLinksMock },
    },
  },
}));

// qrcode.react renders a <canvas>-backed SVG that JSDOM-likes don't support
// fully; the component never opens the QR panel in these tests anyway.
vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => null,
}));

import { TrackingLinksGenerator } from "~/components/salon/TrackingLinksGenerator";

beforeEach(() => {
  buildLinksMock = {
    mutate: vi.fn(),
    data: {
      shortCode: "ab12cd34",
      links: [{ label: "Telegram", url: "https://t.me/manicbot?start=ab12cd34" }],
    },
    isPending: false,
    isError: false,
    error: null,
  };
});

afterEach(() => cleanup());

describe("TrackingLinksGenerator — advanced fields collapse", () => {
  it("hides Channel + Content behind the 'Дополнительно' toggle by default", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    const toggle = screen.getByTestId("tracking-advanced-toggle");
    expect(toggle.getAttribute("data-open")).toBe("0");
    expect(screen.queryByTestId("tracking-advanced-fields")).toBeNull();

    // The basic Source + Campaign fields ARE present from the start.
    expect(screen.getByText("Источник *")).toBeTruthy();
    expect(screen.getByText("Кампания")).toBeTruthy();

    // Channel + Content live inside the advanced block — hidden when collapsed.
    expect(screen.queryByText("Канал")).toBeNull();
    expect(screen.queryByText("Контент")).toBeNull();
  });

  it("reveals Channel + Content when the toggle is clicked", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    fireEvent.click(screen.getByTestId("tracking-advanced-toggle"));

    const fields = screen.getByTestId("tracking-advanced-fields");
    expect(fields).toBeTruthy();
    expect(fields.textContent).toContain("Канал");
    expect(fields.textContent).toContain("Контент");
    expect(screen.getByTestId("tracking-advanced-toggle").getAttribute("data-open")).toBe("1");
  });
});

describe("TrackingLinksGenerator — human placeholders (no UTM jargon)", () => {
  it("uses RU placeholders, not 'cpc / organic / social' or 'button_a / creative_1'", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    // Campaign field is visible from the start.
    const campaign = screen.getByPlaceholderText("Весна 2026");
    expect(campaign).toBeTruthy();

    // Open the advanced section to reach Channel + Content placeholders.
    fireEvent.click(screen.getByTestId("tracking-advanced-toggle"));

    expect(screen.getByPlaceholderText("реклама, посты, рассылка")).toBeTruthy();
    expect(screen.getByPlaceholderText("баннер, сторис")).toBeTruthy();

    // The old jargon must be gone.
    expect(screen.queryByPlaceholderText("cpc / organic / social")).toBeNull();
    expect(screen.queryByPlaceholderText("spring_2026")).toBeNull();
    expect(screen.queryByPlaceholderText("button_a / creative_1")).toBeNull();
  });
});

describe("TrackingLinksGenerator — short-code links", () => {
  it("does NOT render the 'Токен: xxx · N/64' debug row anywhere", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Токен:\s*eyJ/);
    expect(body).not.toMatch(/·\s*\d+\/64/);
  });

  it("renders the short Telegram link and no length-warning chip", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    expect(screen.getByText("https://t.me/manicbot?start=ab12cd34")).toBeTruthy();
    // The 64-char token warning is obsolete — short codes never overflow.
    expect(screen.queryByTestId("tracking-token-warning")).toBeNull();
  });

  it("surfaces a friendly localized error, never the raw server message", () => {
    buildLinksMock.data = undefined;
    buildLinksMock.isError = true;
    buildLinksMock.error = { message: "Internal server error" };

    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    const err = screen.getByTestId("tracking-error");
    expect(err).toBeTruthy();
    expect(err.textContent).not.toContain("Internal server error");
    expect(err.textContent).toContain("Не удалось создать ссылку");
  });
});

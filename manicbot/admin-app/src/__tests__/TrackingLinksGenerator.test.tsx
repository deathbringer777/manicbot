// @vitest-environment happy-dom
/**
 * TrackingLinksGenerator — UTM-style deep-link builder.
 *
 * Pins the post-2026-05-16 UX contract (PR #85):
 *   - The form starts with Source + Campaign visible only; Channel and
 *     Content sit behind a collapsed "Дополнительно" toggle (à la
 *     Mailchimp Campaign URL Builder / Bitly Campaigns).
 *   - The raw `Токен: eyJzIjoicXIifQ · 14/64` debug row is GONE — that
 *     was the most-complained-about element in production feedback.
 *   - A token warning chip appears ONLY when the generated /start payload
 *     would exceed Telegram's 64-byte limit. Below the limit, no chip.
 *   - All placeholders are human-readable RU strings, not UTM jargon
 *     (`cpc / organic / social`, `button_a / creative_1`).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type BuildLinksData = {
  token: string;
  links: Array<{ label: string; url: string }>;
};

let buildLinksMock: {
  data: BuildLinksData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
} = {
  data: { token: "eyJzIjoicXIifQ", links: [{ label: "Telegram", url: "https://t.me/manicbot?start=eyJzIjoicXIifQ" }] },
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock("~/trpc/react", () => ({
  api: {
    analytics: {
      buildTrackingLinks: { useQuery: () => buildLinksMock },
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
    data: {
      token: "eyJzIjoicXIifQ",
      links: [{ label: "Telegram", url: "https://t.me/manicbot?start=eyJzIjoicXIifQ" }],
    },
    isLoading: false,
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

describe("TrackingLinksGenerator — no raw token row", () => {
  it("does NOT render the 'Токен: xxx · N/64' debug row anywhere", () => {
    renderWithLang(
      <TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" slug="demo" />,
    );

    // Looking for the "/64" length suffix that the old implementation rendered.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Токен:\s*eyJ/);
    expect(body).not.toMatch(/·\s*\d+\/64/);
  });
});

describe("TrackingLinksGenerator — token-length warning", () => {
  it("hides the warning chip when token fits the 64-byte Telegram /start limit", () => {
    buildLinksMock.data = {
      token: "a".repeat(64),
      links: [{ label: "Telegram", url: "https://t.me/bot?start=" + "a".repeat(64) }],
    };

    renderWithLang(<TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" />);

    expect(screen.queryByTestId("tracking-token-warning")).toBeNull();
  });

  it("shows the warning chip when token exceeds 64 bytes", () => {
    buildLinksMock.data = {
      token: "a".repeat(80),
      links: [{ label: "Telegram", url: "https://t.me/bot?start=" + "a".repeat(80) }],
    };

    renderWithLang(<TrackingLinksGenerator tenantId="t_demo" botUsername="manicbot" />);

    const chip = screen.getByTestId("tracking-token-warning");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("Метка слишком длинная");
  });
});

// @vitest-environment happy-dom
/**
 * Tests for ReviewCollectorRuntime — Phase 3 Variant A plugin #2.
 *
 * Confirms the contract for settings-only plugins: state hydrates from
 * plugin_installations.settings_json, save fires plugins.updateSettings,
 * URL validation rejects non-https, the preview reflects current state.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

let mockInstall = {
  id: "inst_review_1",
  pluginSlug: "review-collector" as string,
  enabled: 1,
  tenantId: "t_pro" as string | null,
  settingsJson: null as string | null,
  version: "1.0.0",
  installedBy: "w_owner",
  installedAt: 1000,
  updatedAt: 1000,
  billingState: "not_applicable" as const,
  stripeSubscriptionItemId: null,
  stripePaymentIntentId: null,
};

const updateCalls: Array<{ installationId: string; settings: Record<string, unknown> }> = [];

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: "t_pro", role: "tenant_owner" }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: { getInstalled: { invalidate: () => Promise.resolve() } },
    }),
    plugins: {
      getInstalled: {
        useQuery: () => ({ data: [mockInstall], isLoading: false }),
      },
      updateSettings: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void } = {}) => ({
          mutate: (
            input: { installationId: string; settings: Record<string, unknown> },
            opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void },
          ) => {
            updateCalls.push(input);
            mockInstall = { ...mockInstall, settingsJson: JSON.stringify(input.settings) };
            opts?.onSuccess?.();
            onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import ReviewCollectorRuntime from "~/components/plugins/runtimes/ReviewCollectorRuntime";

beforeEach(() => {
  updateCalls.length = 0;
  mockInstall = {
    id: "inst_review_1",
    pluginSlug: "review-collector",
    enabled: 1,
    tenantId: "t_pro",
    settingsJson: null,
    version: "1.0.0",
    installedBy: "w_owner",
    installedAt: 1000,
    updatedAt: 1000,
    billingState: "not_applicable",
    stripeSubscriptionItemId: null,
    stripePaymentIntentId: null,
  };
});

afterEach(() => cleanup());

function render() {
  return renderWithLang(
    <ReviewCollectorRuntime installationId="inst_review_1" slug="review-collector" />,
  );
}

describe("ReviewCollectorRuntime — settings hydration", () => {
  it("renders empty inputs when no settings_json is persisted", () => {
    render();
    expect((screen.getByTestId("review-collector-google") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("review-collector-yandex") as HTMLInputElement).value).toBe("");
  });

  it("hydrates from persisted settings_json on the install row", () => {
    mockInstall.settingsJson = JSON.stringify({
      googleReviewUrl: "https://g.page/r/xyz",
      yandexReviewUrl: "https://yandex.ru/maps/org/123",
      customMessage: "Кинь отзыв 🙏",
    });
    render();
    expect((screen.getByTestId("review-collector-google") as HTMLInputElement).value).toBe(
      "https://g.page/r/xyz",
    );
    expect((screen.getByTestId("review-collector-yandex") as HTMLInputElement).value).toBe(
      "https://yandex.ru/maps/org/123",
    );
    expect((screen.getByTestId("review-collector-message") as HTMLTextAreaElement).value).toBe(
      "Кинь отзыв 🙏",
    );
  });
});

describe("ReviewCollectorRuntime — save mutation", () => {
  it("persists trimmed values via plugins.updateSettings on save", () => {
    render();
    fireEvent.change(screen.getByTestId("review-collector-google"), {
      target: { value: "  https://g.page/r/abc  " },
    });
    fireEvent.change(screen.getByTestId("review-collector-yandex"), {
      target: { value: "https://yandex.ru/maps/org/456" },
    });
    fireEvent.change(screen.getByTestId("review-collector-message"), {
      target: { value: "  Спасибо за оценку!  " },
    });
    fireEvent.click(screen.getByTestId("review-collector-save"));

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.settings).toEqual({
      googleReviewUrl: "https://g.page/r/abc",
      yandexReviewUrl: "https://yandex.ru/maps/org/456",
      customMessage: "Спасибо за оценку!",
    });
  });

  it("caps customMessage to 280 chars on save", () => {
    render();
    const long = "a".repeat(500);
    fireEvent.change(screen.getByTestId("review-collector-google"), {
      target: { value: "https://g.page/r/x" },
    });
    fireEvent.change(screen.getByTestId("review-collector-message"), {
      target: { value: long },
    });
    fireEvent.click(screen.getByTestId("review-collector-save"));

    expect((updateCalls[0]!.settings.customMessage as string)).toHaveLength(280);
  });

  it("rejects save when URL doesn't start with https://", async () => {
    render();
    fireEvent.change(screen.getByTestId("review-collector-google"), {
      target: { value: "ftp://oops" },
    });
    fireEvent.click(screen.getByTestId("review-collector-save"));

    expect(updateCalls).toHaveLength(0);
    await waitFor(() => {
      const flash = screen.getByTestId("plugin-runtime-flash");
      expect(flash.getAttribute("data-kind")).toBe("err");
    });
  });

  it("allows save with one URL empty (only one of Google / Yandex is fine)", () => {
    render();
    fireEvent.change(screen.getByTestId("review-collector-google"), {
      target: { value: "https://g.page/r/x" },
    });
    // yandex stays empty
    fireEvent.click(screen.getByTestId("review-collector-save"));

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.settings.googleReviewUrl).toBe("https://g.page/r/x");
    expect(updateCalls[0]!.settings.yandexReviewUrl).toBe("");
  });
});

describe("ReviewCollectorRuntime — preview", () => {
  it("renders the default message when customMessage is empty", () => {
    mockInstall.settingsJson = JSON.stringify({
      googleReviewUrl: "https://g.page/r/x",
      customMessage: "",
    });
    render();
    expect(screen.getByTestId("review-collector-preview").textContent).toContain(
      "Спасибо за оценку",
    );
  });

  it("renders both Google and Yandex chips when both URLs are set", () => {
    mockInstall.settingsJson = JSON.stringify({
      googleReviewUrl: "https://g.page/r/x",
      yandexReviewUrl: "https://yandex.ru/maps/org/1",
    });
    render();
    const preview = screen.getByTestId("review-collector-preview");
    expect(preview.textContent).toContain("Google");
    expect(preview.textContent).toContain("Яндекс");
  });

  it("shows the empty-state hint when both URLs are missing", () => {
    render();
    const preview = screen.getByTestId("review-collector-preview");
    expect(preview.textContent).toContain("Добавь хотя бы одну ссылку");
  });
});

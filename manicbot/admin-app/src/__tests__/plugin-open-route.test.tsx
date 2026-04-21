// @vitest-environment happy-dom
/**
 * Tests for the /plugin/[slug] runtime-open route.
 *
 * Verifies that:
 * 1. When installed + enabled + has runtime, the runtime area is mounted and
 *    catalog chrome (install/uninstall/pin/settings/tags) is NOT present.
 * 2. The back link points to /plugins (catalog).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "quick-notes" }),
  useRouter: () => ({ replace: vi.fn() }),
}));

// Mock tRPC — simulate an installed + enabled quick-notes plugin
// Note: DB row uses `pluginSlug` (not `slug`) to match the Drizzle schema.
vi.mock("~/trpc/react", () => ({
  api: {
    plugins: {
      getInstalled: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: "inst_test_123",
              pluginSlug: "quick-notes",
              enabled: 1, // SQLite integer
              tenantId: "t_test",
              settingsJson: null,
              version: "1.0.0",
              installedBy: "user_test",
              installedAt: Date.now(),
              updatedAt: Date.now(),
              billingState: "not_applicable",
              stripeSubscriptionItemId: null,
              stripePaymentIntentId: null,
            },
          ],
        }),
      },
    },
  },
}));

// Mock runtimePanels to return a simple stub component for quick-notes
vi.mock("~/components/plugins/runtimePanels", () => ({
  hasRuntime: (slug: string) => slug === "quick-notes",
  loadRuntime: (slug: string) => {
    if (slug === "quick-notes") {
      return function StubRuntime() {
        return <div data-testid="stub-runtime">Runtime content</div>;
      };
    }
    return null;
  },
}));

import PluginOpenClient from "~/app/(dashboard)/plugin/[slug]/PluginOpenClient";

afterEach(() => cleanup());

describe("PluginOpenClient — installed + enabled + has runtime", () => {
  it("renders the runtime area with data-testid=plugin-runtime-area", async () => {
    renderWithLang(<PluginOpenClient />);
    await waitFor(() => {
      expect(screen.getByTestId("plugin-runtime-area")).toBeTruthy();
    });
  });

  it("renders stub runtime content inside runtime area", async () => {
    renderWithLang(<PluginOpenClient />);
    await waitFor(() => {
      expect(screen.getByTestId("stub-runtime")).toBeTruthy();
    });
  });

  it("does NOT render install/uninstall/pin/settings/tags catalog chrome", async () => {
    renderWithLang(<PluginOpenClient />);
    await waitFor(() => {
      expect(screen.getByTestId("plugin-runtime-area")).toBeTruthy();
    });
    // Catalog chrome elements must be absent
    expect(screen.queryByTestId("plugin-detail-install")).toBeNull();
    expect(screen.queryByTestId("plugin-detail-uninstall")).toBeNull();
    expect(screen.queryByTestId("plugin-detail-pin")).toBeNull();
    expect(screen.queryByTestId("plugin-detail-settings")).toBeNull();
    expect(screen.queryByTestId("plugin-detail-available-for")).toBeNull();
  });

  it("has a back link pointing to /plugins", async () => {
    renderWithLang(<PluginOpenClient />);
    await waitFor(() => {
      expect(screen.getByTestId("plugin-runtime-area")).toBeTruthy();
    });
    const links = screen.getAllByRole("link");
    const backLink = links.find((l) => l.getAttribute("href") === "/plugins");
    expect(backLink).toBeTruthy();
  });
});

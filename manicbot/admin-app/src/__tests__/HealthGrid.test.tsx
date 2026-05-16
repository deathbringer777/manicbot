// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang, setDarkMode } from "./helpers/renderWithLang";

// Minimal mock for tRPC API
vi.mock("~/trpc/react", () => ({
  api: {
    system: {
      getHealth: {
        useQuery: () => ({
          data: { status: "ok", dbConnected: true, dbLatencyMs: 42 },
          isLoading: false,
        }),
      },
    },
  },
}));

import { HealthGrid } from "~/components/HealthGrid";

afterEach(() => {
  cleanup();
  setDarkMode(false);
});

describe("HealthGrid", () => {
  it("renders 4 core health cells", () => {
    renderWithLang(<HealthGrid />);
    const cells = screen.getAllByTestId("health-cell");
    // at least 4 core cells (D1, Stripe, Resend, Workers AI)
    expect(cells.length).toBeGreaterThanOrEqual(4);
  });

  it("shows D1 status='ok' when healthy", () => {
    renderWithLang(<HealthGrid />);
    const cells = screen.getAllByTestId("health-cell");
    const d1Cell = cells.find((c) => c.textContent?.includes("D1"));
    expect(d1Cell?.getAttribute("data-status")).toBe("ok");
  });

  it("does NOT render a plugins-health section when no retained plugin declares healthCheck", () => {
    // 2026-05-16 — the only seed-catalog plugins that declared healthCheck
    // (ai-abuse-monitor, sla-tracker) were removed. Until Phase 3 ships a
    // plugin with a real health check, this section must stay absent so
    // we don't render an empty UI row.
    renderWithLang(<HealthGrid />);
    expect(screen.queryByTestId("health-grid-plugins")).toBeNull();
  });

  it("renders in dark mode without crashing", () => {
    setDarkMode(true);
    renderWithLang(<HealthGrid />);
    expect(screen.getByTestId("health-grid")).toBeTruthy();
  });
});

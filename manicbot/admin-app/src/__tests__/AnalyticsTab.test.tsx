// @vitest-environment happy-dom
/**
 * AnalyticsTab — salon-owner analytics dashboard.
 *
 * Pins the post-2026-05-16 UX contract (PR #85):
 *   - When `user_origins` is empty (touches = 0) the funnel renders a
 *     FunnelEmptyState with a CTA instead of the misleading 0→0→0→N→N bars.
 *   - The Conversion stat shows "—" (with hint "no tracking data") rather
 *     than "0%" when there are no tracked touches but bookings exist.
 *   - The CTA inside the empty state opens the tracking-link generator
 *     (collapsible section at the bottom of the tab).
 *   - When `user_origins` is populated, the regular FunnelCard renders.
 *
 * Each scenario mocks `api.analytics.getFunnel` / `getAcquisition` /
 * `getTopCampaigns` with a fixed shape; that's the only contract this
 * component depends on.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type FunnelStage = { key: string; label: string; count: number };
type FunnelData = { stages: FunnelStage[] };
type AcquisitionData = {
  daily: Array<Record<string, number | string>>;
  sources: string[];
  totalBySource: Record<string, number>;
  totalUsers: number;
};

let funnelMock: { data: FunnelData | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
let acquisitionMock: { data: AcquisitionData | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
let topCampaignsMock: { data: { campaigns: unknown[] } | undefined; isLoading: boolean } = {
  data: { campaigns: [] },
  isLoading: false,
};
let buildLinksMock: { mutate: ReturnType<typeof vi.fn>; data: { shortCode: string; links: Array<{ label: string; url: string }> } | undefined; isPending: boolean; isError: boolean; error: { message: string } | null } = {
  mutate: vi.fn(),
  data: { shortCode: "ab12cd34", links: [] },
  isPending: false,
  isError: false,
  error: null,
};
let myMetricsMock: { data: { clientsProcessed: number; appointmentsTotal: number; appointmentsThisMonth: number } | undefined; isLoading: boolean } = {
  data: { clientsProcessed: 0, appointmentsTotal: 0, appointmentsThisMonth: 0 },
  isLoading: false,
};

vi.mock("~/trpc/react", () => ({
  api: {
    analytics: {
      getFunnel: { useQuery: () => funnelMock },
      getAcquisition: { useQuery: () => acquisitionMock },
      getTopCampaigns: { useQuery: () => topCampaignsMock },
      buildTrackingLinks: { useMutation: () => buildLinksMock },
    },
    salon: {
      getMyMetrics: { useQuery: () => myMetricsMock },
    },
  },
}));

// Recharts pulls a heavy SVG tree we don't need in JSDOM-like envs; the
// component still renders even when its children short-circuit to null.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    children as React.ReactElement;
  return {
    BarChart: Pass,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ResponsiveContainer: Pass,
    Legend: () => null,
    CartesianGrid: () => null,
  };
});

import { AnalyticsTab } from "~/components/salon/AnalyticsTab";

function stages(touches: number, users: number, registered: number, booked: number, confirmed: number): FunnelStage[] {
  return [
    { key: "touches", label: "Касания", count: touches },
    { key: "users", label: "Уникальные", count: users },
    { key: "registered", label: "С телефоном", count: registered },
    { key: "booked", label: "Записались", count: booked },
    { key: "confirmed", label: "Подтверждено", count: confirmed },
  ];
}

beforeEach(() => {
  funnelMock = { data: { stages: stages(0, 0, 0, 0, 0) }, isLoading: false };
  acquisitionMock = {
    data: { daily: [], sources: [], totalBySource: {}, totalUsers: 0 },
    isLoading: false,
  };
  topCampaignsMock = { data: { campaigns: [] }, isLoading: false };
  buildLinksMock = {
    mutate: vi.fn(),
    data: { shortCode: "ab12cd34", links: [] },
    isPending: false,
    isError: false,
    error: null,
  };
});

afterEach(() => cleanup());

describe("AnalyticsTab — funnel empty state (the 2026-05-16 bug)", () => {
  it("hides the funnel and renders FunnelEmptyState when touches=0 but bookings>0", () => {
    // Repro of the production screenshot: 16 organic bookings via Telegram,
    // zero tracked touches because no /start payload was ever shared.
    funnelMock.data = { stages: stages(0, 0, 0, 16, 16) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" />);

    expect(screen.queryByTestId("funnel-card")).toBeNull();
    expect(screen.getByTestId("funnel-empty")).toBeTruthy();
  });

  it("renders the regular FunnelCard once at least one tracked touch arrives", () => {
    funnelMock.data = { stages: stages(5, 4, 3, 2, 1) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" />);

    expect(screen.getByTestId("funnel-card")).toBeTruthy();
    expect(screen.queryByTestId("funnel-empty")).toBeNull();
  });

  it("opens the tracking-link generator when the empty-state CTA is clicked", () => {
    funnelMock.data = { stages: stages(0, 0, 0, 16, 16) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" botUsername="manicbot" slug="demo" />);

    // Before click: TrackingLinksGenerator is collapsed (its Source select is not in the tree).
    expect(screen.queryByText("QR-код")).toBeNull();

    // The empty state hosts a "Создать трекинг-ссылку" CTA. There is also a
    // collapsible button with the same label at the bottom — both share the
    // i18n key `analytics.createLink`. Click the first (the one inside the
    // empty state); after click, the generator's Source select must render.
    const ctas = screen.getAllByText("Создать трекинг-ссылку");
    expect(ctas.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(ctas[0]!);

    // The generator's source select renders the "QR-код" option.
    expect(screen.getAllByText("QR-код").length).toBeGreaterThan(0);
  });
});

describe("AnalyticsTab — Conversion stat card", () => {
  it("shows '—' with the no-tracking hint when touches=0", () => {
    funnelMock.data = { stages: stages(0, 0, 0, 16, 16) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" />);

    const conversion = screen.getByTestId("conversion-stat");
    expect(conversion.getAttribute("data-tracked")).toBe("0");
    expect(conversion.textContent).toContain("—");
    expect(conversion.textContent).toContain("нет трекинг-данных");
    // The misleading "0%" must NOT appear in the conversion card when
    // there are no tracked touches but bookings exist.
    expect(conversion.textContent).not.toContain("0%");
  });

  it("computes booked / uniqueUsers * 100 when touches > 0", () => {
    funnelMock.data = { stages: stages(20, 10, 8, 5, 4) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" />);

    const conversion = screen.getByTestId("conversion-stat");
    expect(conversion.getAttribute("data-tracked")).toBe("1");
    expect(conversion.textContent).toContain("50%"); // 5 / 10 = 50%
    expect(conversion.textContent).toContain("касание");
  });
});

describe("AnalyticsTab — overall empty state", () => {
  it("renders the global AnalyticsEmptyState only when ALL signals are zero", () => {
    funnelMock.data = { stages: stages(0, 0, 0, 0, 0) };

    renderWithLang(<AnalyticsTab tenantId="t_demo" />);

    // The stat cards row must NOT appear when hasAnyData=false; the global
    // empty state takes over instead.
    expect(screen.queryByTestId("conversion-stat")).toBeNull();
    expect(screen.queryByTestId("funnel-empty")).toBeNull();
    expect(screen.queryByTestId("funnel-card")).toBeNull();
  });
});

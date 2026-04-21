// @vitest-environment happy-dom
/**
 * Tests for the Google Calendar plugin runtime.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { hasRuntime } from "~/components/plugins/runtimePanels";

// Mock tRPC — the runtime queries googleCalendar.list and getConnectInfo
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      googleCalendar: {
        list: { invalidate: () => Promise.resolve() },
      },
    }),
    googleCalendar: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      getConnectInfo: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      toggleSync: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
  },
}));

import GoogleCalendarRuntime from "~/components/plugins/runtimes/GoogleCalendarRuntime";
import { renderWithLang } from "./helpers/renderWithLang";
import { LangContext } from "~/components/LangContext";
import { RoleContext } from "~/components/RoleContext";
import { render } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

function renderRuntime(tenantId: string | null = "t_test") {
  return render(
    <LangContext.Provider value={{ lang: "en", setLang: () => {} }}>
      <RoleContext.Provider
        value={{
          role: tenantId ? "tenant_owner" : null,
          tenantId,
          tenantName: null,
          userId: null,
          createdAt: null,
          emailVerified: true,
          hasPassword: true,
          isPersonalTenant: false,
          isTest: false,
          permissions: [],
          previewRole: null,
          previewTenantId: null,
          setPreviewRole: () => {},
          previewMasterId: null,
          setPreviewMaster: () => {},
        }}
      >
        <GoogleCalendarRuntime installationId="inst_test" slug="google-calendar" />
      </RoleContext.Provider>
    </LangContext.Provider>
  );
}

describe("Google Calendar runtime", () => {
  it("hasRuntime('google-calendar') === true", () => {
    expect(hasRuntime("google-calendar")).toBe(true);
  });

  it("shows 'available to salon owners' warning when tenantId is null", () => {
    renderRuntime(null);
    const el = screen.getByTestId("google-calendar-runtime");
    expect(el.textContent).toContain("salon owners");
  });
});

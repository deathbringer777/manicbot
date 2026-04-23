// @vitest-environment happy-dom
/**
 * Tests for the Google Calendar plugin runtime.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { hasRuntime } from "~/components/plugins/runtimePanels";

// Mock tRPC — cover every procedure the runtime calls (hooks run
// unconditionally, so even procedures gated by `enabled:` must be defined).
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      googleCalendar: {
        list: { invalidate: () => Promise.resolve() },
        getStatus: { invalidate: () => Promise.resolve() },
      },
    }),
    googleCalendar: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      getConnectInfo: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      getStatus: {
        useQuery: () => ({
          data: null,
          isLoading: false,
          isError: false,
          refetch: () => Promise.resolve({ data: null }),
        }),
      },
      createWebConnectUrl: {
        useMutation: () => ({
          mutate: () => {},
          mutateAsync: () => Promise.resolve({ url: "" }),
          isPending: false,
        }),
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

  // When tenantId is null (no salon context yet) the runtime must not crash —
  // it falls back to a loading spinner while the role context settles.
  it("renders without crashing when tenantId is null", () => {
    const { container } = renderRuntime(null);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders without crashing when tenantId is present", () => {
    const { container } = renderRuntime("t_test");
    expect(container.firstChild).not.toBeNull();
  });
});

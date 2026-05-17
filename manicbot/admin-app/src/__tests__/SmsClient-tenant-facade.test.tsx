// @vitest-environment happy-dom
/**
 * Render-level contract pin for the SMS tab tenant facade.
 *
 * Sibling to `marketing-sms-tenant-leak.test.ts` (static-source pin):
 * that file is brittle to a refactor that preserves the strings but
 * breaks the conditional; this file actually mounts the component for
 * both modes (admin / tenant) and asserts the rendered DOM.
 *
 * The contract under test:
 *
 *   1. Tenant (`mode === "tenant"`) + SMS not configured →
 *        - amber "coming soon" notice with no Brevo / ENV strings
 *        - workspace carries opacity-60 + pointer-events-none + cursor-not-allowed
 *        - data-testid="sms-coming-soon" hook present
 *        - "Create SMS campaign" button is disabled (aria-disabled="true")
 *
 *   2. Admin (`mode === "admin"`) + SMS not configured →
 *        - amber Brevo gate WITH BREVO_API_KEY + BREVO_SMS_SENDER strings
 *        - no data-testid="sms-coming-soon" element (the disabled-feel facade
 *          does not render — sysadmin sees the live empty-state)
 *
 *   3. SMS configured (either mode) → no amber gate at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// ─────────────────────────────────────────────────────────────────────────
// Mutable mock state — controls what `useMarketingScope` returns and what
// the tRPC `providersList` queries return.
// ─────────────────────────────────────────────────────────────────────────

type MockScope = { mode: "admin" | "tenant"; tenantId: string | null };

let mockScope: MockScope = { mode: "tenant", tenantId: "t_demo" };
let mockAdminProviders: Array<{ name: string; channels: string[]; configured: Record<string, boolean> }> = [];
let mockTenantProviders: { canSendEmail: boolean; canSendSms: boolean } = {
  canSendEmail: false,
  canSendSms: false,
};

vi.mock("~/app/(dashboard)/marketing/useMarketingScope", () => ({
  useMarketingScope: () => mockScope,
}));

// MarketingShell would otherwise drag in the global Shell which needs the
// real RoleContext, NextAuth session, etc. We don't care about the chrome
// here — just the SMS tab body.
vi.mock("~/app/(dashboard)/marketing/MarketingShell", () => ({
  MarketingShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="marketing-shell-mock">{children}</div>
  ),
}));

// CampaignFormModal is only rendered when the create flow opens; we never
// exercise that here. Stub to keep the dependency surface tight.
vi.mock("~/components/marketing/CampaignFormModal", () => ({
  CampaignFormModal: () => null,
}));

// ConfirmDialog is open=false in all assertions below — stub for safety.
vi.mock("~/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      marketing: { campaignsList: { invalidate: () => Promise.resolve() } },
      marketingTenant: { campaignsList: { invalidate: () => Promise.resolve() } },
    }),
    marketing: {
      providersList: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? { data: undefined, isLoading: false }
            : { data: mockAdminProviders, isLoading: false },
      },
      campaignsList: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? { data: undefined, isLoading: false }
            : { data: [], isLoading: false },
      },
      campaignDelete: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      campaignSendNow: { useMutation: () => ({ mutate: () => {}, mutateAsync: async () => null, isPending: false }) },
    },
    marketingTenant: {
      providersList: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? { data: undefined, isLoading: false }
            : { data: mockTenantProviders, isLoading: false },
      },
      campaignsList: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? { data: undefined, isLoading: false }
            : { data: [], isLoading: false },
      },
      campaignDelete: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      campaignSendNow: { useMutation: () => ({ mutate: () => {}, mutateAsync: async () => null, isPending: false }) },
    },
  },
}));

import SmsClient from "~/app/(dashboard)/marketing/sms/SmsClient";

beforeEach(() => {
  cleanup();
  mockScope = { mode: "tenant", tenantId: "t_demo" };
  mockAdminProviders = [];
  mockTenantProviders = { canSendEmail: false, canSendSms: false };
});

describe("SmsClient — tenant facade (SMS not configured)", () => {
  it("renders the 'coming soon' facade with no Brevo or ENV strings", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    mockTenantProviders = { canSendEmail: false, canSendSms: false };
    const { container } = renderWithLang(<SmsClient />);

    // The facade hook is present.
    expect(screen.getByTestId("sms-coming-soon")).toBeTruthy();

    // No Brevo plumbing anywhere in the DOM.
    const html = container.innerHTML;
    expect(html).not.toMatch(/Brevo/i);
    expect(html).not.toMatch(/BREVO_API_KEY/);
    expect(html).not.toMatch(/BREVO_SMS_SENDER/);
    expect(html).not.toMatch(/xkeysib/i);
    // No "Cloudflare Pages" environment-config hint.
    expect(html).not.toMatch(/Cloudflare Pages/i);
    expect(html).not.toMatch(/ENV-перемен/);
  });

  it("greys out the workspace + sets cursor-not-allowed", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    mockTenantProviders = { canSendEmail: false, canSendSms: false };
    renderWithLang(<SmsClient />);

    const facade = screen.getByTestId("sms-coming-soon");
    const cls = facade.getAttribute("class") ?? "";
    expect(cls).toContain("opacity-60");
    expect(cls).toContain("pointer-events-none");
    expect(cls).toContain("cursor-not-allowed");
    expect(cls).toContain("select-none");
    expect(facade.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables the create button (aria-disabled + tabIndex=-1)", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    mockTenantProviders = { canSendEmail: false, canSendSms: false };
    renderWithLang(<SmsClient />);

    const facade = screen.getByTestId("sms-coming-soon");
    const btn = facade.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn!.hasAttribute("disabled")).toBe(true);
    expect(btn!.getAttribute("aria-disabled")).toBe("true");
    expect(btn!.getAttribute("tabIndex")).toBe("-1");
  });

  it("renders the localized 'Coming soon' title (ru locale)", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    renderWithLang(<SmsClient />, "ru");
    expect(screen.getByText("Скоро будет доступно")).toBeTruthy();
  });

  it("renders the localized 'Coming soon' title (en locale)", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    renderWithLang(<SmsClient />, "en");
    expect(screen.getByText("Coming soon")).toBeTruthy();
  });

  it("does not render the technical 'Brevo SMS не настроен' string anywhere", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    const { container } = renderWithLang(<SmsClient />, "ru");
    expect(container.innerHTML).not.toMatch(/не настроен/);
    expect(container.innerHTML).not.toMatch(/не налаштовано/);
    expect(container.innerHTML).not.toMatch(/not configured/i);
    expect(container.innerHTML).not.toMatch(/niedostępne/);
  });

  it("the sysadmin-previewing-tenant case (mode='tenant' but with admin role) still gets the facade", () => {
    // Sysadmin previewing a tenant flows through useMarketingScope as
    // `mode === "tenant"`. The facade must apply — we don't have a
    // separate "admin previewing" path that leaks Brevo.
    mockScope = { mode: "tenant", tenantId: "t_preview_target" };
    mockTenantProviders = { canSendEmail: false, canSendSms: false };
    const { container } = renderWithLang(<SmsClient />);
    expect(screen.getByTestId("sms-coming-soon")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/Brevo/i);
  });
});

describe("SmsClient — admin Brevo gate (SMS not configured)", () => {
  it("renders the technical Brevo ENV gate for sysadmin", () => {
    mockScope = { mode: "admin", tenantId: null };
    mockAdminProviders = [{
      name: "brevo",
      channels: ["email", "sms"],
      configured: { email: true, sms: false },
    }];
    const { container } = renderWithLang(<SmsClient />, "ru");

    // The facade hook is NOT present (sysadmin sees the live empty-state).
    expect(screen.queryByTestId("sms-coming-soon")).toBeNull();
    // Brevo ENV strings DO appear — sysadmin needs to know what's missing.
    expect(container.innerHTML).toMatch(/BREVO_API_KEY/);
    expect(container.innerHTML).toMatch(/BREVO_SMS_SENDER/);
    // Technical "не настроен" string lives in the sysadmin path.
    expect(container.innerHTML).toMatch(/не настроен/);
  });
});

describe("SmsClient — SMS configured (real UI for both modes)", () => {
  it("tenant + configured → no facade, no amber gate", () => {
    mockScope = { mode: "tenant", tenantId: "t_demo" };
    mockTenantProviders = { canSendEmail: true, canSendSms: true };
    const { container } = renderWithLang(<SmsClient />);
    expect(screen.queryByTestId("sms-coming-soon")).toBeNull();
    expect(container.innerHTML).not.toMatch(/BREVO_API_KEY/);
  });

  it("admin + configured → no amber gate", () => {
    mockScope = { mode: "admin", tenantId: null };
    mockAdminProviders = [{
      name: "brevo",
      channels: ["email", "sms"],
      configured: { email: true, sms: true },
    }];
    const { container } = renderWithLang(<SmsClient />);
    expect(container.innerHTML).not.toMatch(/BREVO_API_KEY/);
  });
});

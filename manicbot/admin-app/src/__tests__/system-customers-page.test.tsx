// @vitest-environment happy-dom
/**
 * SystemCustomersClient — page-level integration test.
 *
 * Pins:
 *  - Sysadmin sees the page (KPI strip + Accounts tab table).
 *  - Sysadmin under a tenant-role preview sees the forbidden placeholder
 *    (no data leak across previewed tenant).
 *  - Tenant_owner / master / support roles all see the forbidden placeholder.
 *  - Tab switching via ?tab= URL param wires the right table client-side.
 *  - Subscribers `tableMissing` payload renders the "migration in flight"
 *    notice instead of an empty list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoleContext, type RoleContextValue } from "~/components/RoleContext";
import type { AppRole } from "~/server/api/routers/auth";

// ─── tRPC mocks ───────────────────────────────────────────────────────

// Per-test fixtures so we can flip query shape without re-mounting.
type StatsShape = {
  total_accounts: number;
  paying: number;
  trialing: number;
  churned: number;
  mrr_total_pln: number;
  newsletter_subs: number;
};

interface AccountsRow {
  webUserId: string;
  name: string | null;
  email: string;
  lang?: string | null;
  tenantId: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  tenantName: string | null;
  plan: string | null;
  billingStatus: string | null;
  trialEndsAt: number | null;
  stripeCustomerId: string | null;
  isTest: number | null;
  isPersonal: number | null;
  mastersCount: number;
  appointments30d: number;
  mrrPln: number;
}

interface SubscribersPayload {
  tableMissing: boolean;
  table: string | null;
  rows: Array<{
    email: string;
    source: string | null;
    lang: string | null;
    confirmed: number;
    unsubscribed: number;
    createdAt: number;
  }>;
  total: number;
}

const fixtures = {
  stats: { data: undefined as StatsShape | undefined, isLoading: false },
  accounts: {
    data: undefined as { rows: AccountsRow[]; total: number; page: number; pageSize: number } | undefined,
    isLoading: false,
    isFetching: false,
  },
  subscribers: {
    data: undefined as SubscribersPayload | undefined,
    isLoading: false,
    isFetching: false,
  },
};

vi.mock("~/trpc/react", () => ({
  api: {
    platformCustomers: {
      stats: { useQuery: () => fixtures.stats },
      listAccounts: { useQuery: () => fixtures.accounts },
      listSubscribers: { useQuery: () => fixtures.subscribers },
      accountDetail: { useQuery: () => ({ data: undefined, isLoading: true, isError: false }) },
    },
    useUtils: () => ({}),
  },
}));

// next/navigation — useSearchParams / useRouter need stubs.
let mockSearchParams = new URLSearchParams();
const mockRouterReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    replace: mockRouterReplace,
    push: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/system/customers",
}));

// Shell wraps everything in a layout — stub to a passthrough so we can
// assert headings without rendering the entire sidebar.
vi.mock("~/components/layout/Shell", () => ({
  Shell: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="shell-stub">
      {title && <h1>{title}</h1>}
      {children}
    </div>
  ),
}));

// LangContext is consumed by Shell only; stub it to bypass.
vi.mock("~/components/LangContext", () => ({
  LangContext: { Provider: ({ children }: any) => children },
  useLang: () => "ru",
}));

import SystemCustomersClient from "~/app/(dashboard)/system/customers/SystemCustomersClient";

// ─── helpers ──────────────────────────────────────────────────────────

function withRole(value: Partial<RoleContextValue>) {
  const ctx: RoleContextValue = {
    role: "system_admin",
    tenantId: null,
    tenantName: null,
    tenantLogo: null,
    masterAvatarUrl: null,
    masterAvatarEmoji: null,
    userId: null,
    webUserId: "w_admin",
    createdAt: null,
    emailVerified: true,
    hasPassword: true,
    isPersonalTenant: false,
    isTest: false,
    permissions: [],
    billingStatus: null,
    isTrialExpired: false,
    previewRole: null,
    previewTenantId: null,
    setPreviewRole: () => {},
    previewMasterId: null,
    previewMasterWebUserId: null,
    setPreviewMaster: () => {},
    ...value,
  };
  return (
    <RoleContext.Provider value={ctx}>
      <SystemCustomersClient />
    </RoleContext.Provider>
  );
}

function resetFixtures() {
  fixtures.stats.data = {
    total_accounts: 12,
    paying: 5,
    trialing: 4,
    churned: 3,
    mrr_total_pln: 345,
    newsletter_subs: 250,
  };
  fixtures.stats.isLoading = false;
  fixtures.accounts.data = {
    rows: [
      {
        webUserId: "w1",
        name: "Alice Owner",
        email: "alice@salon.com",
        lang: "ru",
        tenantId: "t1",
        createdAt: 1700000000,
        lastLoginAt: 1701000000,
        tenantName: "Salon Alice",
        plan: "pro",
        billingStatus: "active",
        trialEndsAt: null,
        stripeCustomerId: "cus_X",
        isTest: 0,
        isPersonal: 0,
        mastersCount: 3,
        appointments30d: 12,
        mrrPln: 60,
      },
    ],
    total: 1,
    page: 0,
    pageSize: 50,
  };
  fixtures.accounts.isLoading = false;
  fixtures.accounts.isFetching = false;
  fixtures.subscribers.data = {
    tableMissing: false,
    table: "newsletter_subscribers",
    rows: [
      {
        email: "subscriber@example.com",
        source: "footer",
        lang: "ru",
        confirmed: 1,
        unsubscribed: 0,
        createdAt: 1700000000,
      },
    ],
    total: 1,
  };
  fixtures.subscribers.isLoading = false;
  fixtures.subscribers.isFetching = false;
  mockSearchParams = new URLSearchParams();
  mockRouterReplace.mockReset();
}

// ─── tests ────────────────────────────────────────────────────────────

describe("SystemCustomersClient — role gating", () => {
  beforeEach(() => {
    resetFixtures();
  });
  afterEach(() => cleanup());

  it("renders the full page for system_admin", () => {
    render(withRole({ role: "system_admin" }));
    expect(screen.getByText("Клиенты ManicBot")).toBeTruthy();
    expect(screen.getByText("Всего аккаунтов")).toBeTruthy();
    // "MRR" appears in both the KPI strip AND the accounts table column header.
    expect(screen.getAllByText("MRR").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("customers-page-forbidden")).toBeNull();
    expect(screen.getByText("alice@salon.com")).toBeTruthy();
  });

  const FORBIDDEN_ROLES: AppRole[] = ["tenant_owner", "master", "support", "technical_support"];
  for (const role of FORBIDDEN_ROLES) {
    it(`renders the placeholder for role=${role}`, () => {
      render(withRole({ role }));
      expect(screen.getByTestId("customers-page-forbidden")).toBeTruthy();
      expect(screen.queryByText("Клиенты ManicBot")).toBeNull();
    });
  }

  it("renders the placeholder for sysadmin under a tenant-role preview", () => {
    // Even though raw role is system_admin, the active preview means the
    // sidebar is showing a tenant_owner-shaped UI. The page must NOT leak
    // cross-tenant data under that preview.
    render(withRole({ role: "system_admin", previewRole: "tenant_owner" as AppRole, previewTenantId: "t1" }));
    expect(screen.getByTestId("customers-page-forbidden")).toBeTruthy();
    expect(screen.queryByText("Клиенты ManicBot")).toBeNull();
  });
});

describe("SystemCustomersClient — tabs", () => {
  beforeEach(() => {
    resetFixtures();
  });
  afterEach(() => cleanup());

  it("renders Accounts tab by default", () => {
    render(withRole({ role: "system_admin" }));
    // The Accounts table headers are visible.
    expect(screen.getByText("Триал до")).toBeTruthy();
    // Subscribers-specific column heading is not visible yet.
    expect(screen.queryByText("Подтверждён")).toBeNull();
  });

  it("renders Subscribers tab when ?tab=subscribers", () => {
    mockSearchParams = new URLSearchParams("tab=subscribers");
    render(withRole({ role: "system_admin" }));
    expect(screen.getByText("Подтверждён")).toBeTruthy();
    // Accounts-specific column heading is now hidden.
    expect(screen.queryByText("Триал до")).toBeNull();
  });

  it("tab buttons trigger router.replace with the right URL", () => {
    render(withRole({ role: "system_admin" }));
    const subscribersTab = screen.getByTestId("customers-tab-subscribers");
    subscribersTab.click();
    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    const arg = mockRouterReplace.mock.calls[0]?.[0] as string;
    expect(arg).toContain("/system/customers");
    expect(arg).toContain("tab=subscribers");
  });

  it("Subscribers tab with tableMissing renders the migration notice", () => {
    mockSearchParams = new URLSearchParams("tab=subscribers");
    fixtures.subscribers.data = {
      tableMissing: true,
      table: null,
      rows: [],
      total: 0,
    };
    render(withRole({ role: "system_admin" }));
    expect(screen.getByText(/Таблица ещё не создана/)).toBeTruthy();
    expect(screen.queryByText("Подтверждён")).toBeNull();
  });
});

describe("SystemCustomersClient — stats", () => {
  beforeEach(() => {
    resetFixtures();
  });
  afterEach(() => cleanup());

  it("shows formatted values from the stats payload", () => {
    render(withRole({ role: "system_admin" }));
    // 345 PLN — fix the locale form ("345 PLN" — toLocaleString of 345 returns "345").
    expect(screen.getByText(/345 PLN/)).toBeTruthy();
    // 250 newsletter subs.
    expect(screen.getByText("250")).toBeTruthy();
  });

  it("falls back to zeros while the stats query is loading", () => {
    fixtures.stats.data = undefined;
    fixtures.stats.isLoading = true;
    render(withRole({ role: "system_admin" }));
    // Each KPI card renders a skeleton while loading — we don't assert
    // its exact markup, just that no thrown error reaches the surface.
    expect(screen.getByText("Всего аккаунтов")).toBeTruthy();
    expect(screen.getAllByText("MRR").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SystemCustomersClient — accounts table content", () => {
  beforeEach(() => {
    resetFixtures();
  });
  afterEach(() => cleanup());

  it("renders the row for the seeded account", () => {
    render(withRole({ role: "system_admin" }));
    expect(screen.getByText("Alice Owner")).toBeTruthy();
    expect(screen.getByText("alice@salon.com")).toBeTruthy();
    expect(screen.getByText("60 PLN")).toBeTruthy();
  });

  it("renders empty-state when listAccounts returns no rows", () => {
    fixtures.accounts.data = { rows: [], total: 0, page: 0, pageSize: 50 };
    render(withRole({ role: "system_admin" }));
    expect(screen.getByText(/аккаунтов нет/)).toBeTruthy();
  });
});

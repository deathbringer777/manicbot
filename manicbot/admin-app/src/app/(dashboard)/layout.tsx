"use client";

export const runtime = "edge";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "~/trpc/react";
import { RoleContext } from "~/components/RoleContext";
import { WebShell } from "~/components/layout/WebShell";
import { SalonDashboard } from "~/components/dashboards/SalonDashboard";
import { MasterDashboard } from "~/components/dashboards/MasterDashboard";
import { SupportDashboard } from "~/components/dashboards/SupportDashboard";
import { NoTenantOnboarding } from "~/components/onboarding/NoTenantOnboarding";
import { EmailVerificationGate } from "~/components/EmailVerificationGate";
import { EmailVerificationPopup } from "~/components/EmailVerificationPopup";
import { SetPasswordBanner } from "~/components/SetPasswordBanner";
import { BillingGate } from "~/components/BillingGate";
import { shouldShowBillingGate } from "~/lib/billing/trialState";
import { isFullPageRoute } from "~/lib/routing/fullPageRoutes";

// Lazy-loaded god-mode tab pages that live under broken (dashboard) routes on CF Pages.
// @cloudflare/next-on-pages routes new (dashboard)/* paths to (public) layout → 404.
// Workaround: render them inline via ?tab= on the working /dashboard route.
const GodRoleRequests = dynamic(() => import("./role-requests/RoleRequestsPageClient"));
const GodLeads = dynamic(() => import("./leads/LeadsPageClient"));
const CommandPalette = dynamic(
  () => import("~/components/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);
const ActivityFeed = dynamic(
  () => import("~/components/ActivityFeed").then((m) => m.ActivityFeed),
  { ssr: false },
);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Auth: query role from next-auth session (email/password)
  const roleQuery = api.auth.getMyRole.useQuery(undefined, { retry: false });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!roleQuery.isLoading && !roleQuery.data?.role) {
      router.replace("/login");
    }
  }, [roleQuery.isLoading, roleQuery.data?.role, router]);

  // Scope the authenticated-app palette (beige + red + turquoise) to this
  // subtree. globals.css overrides the design tokens under [data-app="authed"];
  // tagging <body> (a descendant of the <html>.dark theme node) makes every
  // authed surface — including body-portaled modals, toasts and the command
  // palette — adopt the palette, while public/marketing/storefront routes,
  // which never mount this layout, keep the default palette. Cleared on unmount.
  useEffect(() => {
    document.body.setAttribute("data-app", "authed");
    return () => document.body.removeAttribute("data-app");
  }, []);

  // Loading
  if (roleQuery.isLoading || !roleQuery.data?.role) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-brand-500" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  const { role, webUserId, tenantId, tenantName, tenantLogo, masterId, masterAvatarUrl, masterAvatarEmoji, isPersonalTenant, createdAt, emailVerified, hasPassword, permissions, billingStatus, isTrialExpired } = roleQuery.data;
  // No impersonation: effective role/tenant are always the caller's own.
  const effectiveRole = role;
  const effectiveTenantId = tenantId;

  const ctxValue = {
    role,
    tenantId,
    tenantName: tenantName ?? null,
    tenantLogo: tenantLogo ?? null,
    masterAvatarUrl: masterAvatarUrl ?? null,
    masterAvatarEmoji: masterAvatarEmoji ?? null,
    userId: null, // web users don't have Telegram userId
    webUserId: webUserId ?? null,
    createdAt: createdAt ?? null,
    emailVerified: emailVerified ?? true,
    hasPassword: hasPassword ?? true,
    isPersonalTenant: isPersonalTenant ?? false,
    permissions: permissions ?? [],
    billingStatus: billingStatus ?? null,
    isTrialExpired: isTrialExpired ?? false,
  };

  // Non-admin roles get their dedicated dashboard inside WebShell. Some paths
  // must instead render their OWN page.tsx (inside WebShell) for every role —
  // the single source of truth is fullPageRoutes.ts. Add new full-page routes
  // THERE, not here. Notably /invitations: the salon-accept page must render
  // for an invited owner (the bell/email link lands here); omitting it made the
  // notification "do nothing" by swapping in the home dashboard.
  const isFullPage = isFullPageRoute(pathname);
  // /settings keeps its own boolean: the email-verification gate below lets it
  // through even when the user is unverified.
  const isSettingsPage = pathname === "/settings";

  // Gate: block dashboard content if email is not verified (except /settings)
  function wrapWithEmailGate(content: React.ReactNode) {
    if (!emailVerified && !isSettingsPage) {
      return (
        <>
          <EmailVerificationPopup />
          <EmailVerificationGate />
        </>
      );
    }
    return (
      <>
        {!emailVerified && <EmailVerificationPopup />}
        <SetPasswordBanner />
        {content}
      </>
    );
  }

  // Gate: block dashboard content when the tenant's trial has expired and they
  // have not started a paid subscription. Whitelisted paths (/billing, /settings,
  // /plugins) remain reachable so the user can resolve the gate or escape.
  // System admins / support never trigger this gate. Effective role is used so
  // a system_admin previewing a tenant_owner still sees their unblocked view.
  function wrapWithBillingGate(content: React.ReactNode) {
    if (shouldShowBillingGate({ role: effectiveRole, isTrialExpired, pathname })) {
      return <BillingGate />;
    }
    return content;
  }

  if (effectiveRole === "tenant_owner") {
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(wrapWithBillingGate(
            isFullPage
              ? children
              : !effectiveTenantId
                ? <NoTenantOnboarding role="tenant_owner" />
                : <SalonDashboard tenantId={effectiveTenantId} />
          ))}
        </WebShell>
        <CommandPalette />
        <ActivityFeed />
      </RoleContext.Provider>
    );
  }

  // Phase 2: tenant_manager — render SalonDashboard (tabs are gated by useHasPermission).
  if (effectiveRole === "tenant_manager") {
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(wrapWithBillingGate(
            isFullPage
              ? children
              : !effectiveTenantId
                ? <NoTenantOnboarding role="tenant_owner" />
                : <SalonDashboard tenantId={effectiveTenantId} />
          ))}
        </WebShell>
        <CommandPalette />
        <ActivityFeed />
      </RoleContext.Provider>
    );
  }

  if (effectiveRole === "master") {
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(wrapWithBillingGate(
            isFullPage
              ? children
              : !effectiveTenantId
                ? <NoTenantOnboarding role="master" />
                : <MasterDashboard tenantId={effectiveTenantId} masterId={masterId!} isPersonal={isPersonalTenant} />
          ))}
        </WebShell>
        <CommandPalette />
        <ActivityFeed />
      </RoleContext.Provider>
    );
  }

  if (effectiveRole === "support" || effectiveRole === "technical_support") {
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(
            isFullPage
              ? children
              : <SupportDashboard />,
          )}
        </WebShell>
        <CommandPalette />
        <ActivityFeed />
      </RoleContext.Provider>
    );
  }

  // system_admin → full page routing with WebShell.
  // Some (dashboard)/* routes 404 on CF Pages (routed to (public) group).
  // For those, render inline via ?tab= on the working /dashboard route.
  const godTab = searchParams.get("tab");
  const GOD_TAB_COMPONENTS: Record<string, React.ComponentType> = {
    "role-requests": GodRoleRequests,
    "leads": GodLeads,
  };
  const GodTabComponent = godTab ? GOD_TAB_COMPONENTS[godTab] : null;

  return (
    <RoleContext.Provider value={ctxValue}>
      <WebShell>{wrapWithEmailGate(GodTabComponent ? <GodTabComponent /> : children)}</WebShell>
      <CommandPalette />
      <ActivityFeed />
    </RoleContext.Provider>
  );
}

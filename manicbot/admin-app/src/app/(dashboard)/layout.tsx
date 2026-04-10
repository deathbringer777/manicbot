"use client";

export const runtime = "edge";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import type { AppRole } from "~/server/api/routers/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [previewRole, setPreviewRoleState] = useState<AppRole>(null);
  const [previewTenantId, setPreviewTenantId] = useState<string | null>(null);
  const [previewMasterId, setPreviewMasterIdState] = useState<number | null>(null);

  // Check for Telegram WebApp — redirect to /tg if present
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData) {
      window.location.replace("/tg");
    }
  }, []);

  // Auth: query role from next-auth session or Telegram initData
  const roleQuery = api.auth.getMyRole.useQuery(undefined, { retry: false });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!roleQuery.isLoading && !roleQuery.data?.role) {
      router.replace("/login");
    }
  }, [roleQuery.isLoading, roleQuery.data?.role, router]);

  function setPreviewRole(r: AppRole, tenantId?: string | null) {
    setPreviewRoleState(r);
    setPreviewTenantId(tenantId ?? null);
    setPreviewMasterIdState(null);
    // When God activates a preview, redirect to /dashboard so content matches nav
    if (r && r !== "system_admin") {
      router.replace("/dashboard");
    }
  }

  function setPreviewMaster(masterId: number | null) {
    setPreviewMasterIdState(masterId);
  }

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

  const { role, tenantId, masterId, isPersonalTenant, createdAt, emailVerified, hasPassword } = roleQuery.data;
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  const ctxValue = {
    role,
    tenantId,
    userId: null, // web users don't have Telegram userId
    createdAt: createdAt ?? null,
    emailVerified: emailVerified ?? true,
    hasPassword: hasPassword ?? true,
    isPersonalTenant: isPersonalTenant ?? false,
    previewRole,
    previewTenantId,
    setPreviewRole,
    previewMasterId,
    setPreviewMaster,
  };

  // Non-admin roles get their dedicated dashboard inside WebShell.
  // /settings is always rendered as {children} so SettingsPageClient mounts for all roles.
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

  if (effectiveRole === "tenant_owner") {
    const isSalonRoute = pathname.startsWith("/salon/") || pathname === "/salon";
    const isMasterRoute = pathname.startsWith("/master/") || pathname === "/master";
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(
            isSettingsPage
              ? children
              : (isSalonRoute || isMasterRoute)
                ? children
                : !effectiveTenantId
                  ? <NoTenantOnboarding role="tenant_owner" />
                  : previewMasterId !== null
                    ? <MasterDashboard tenantId={effectiveTenantId} masterId={previewMasterId} isDelegating={true} />
                    : <SalonDashboard tenantId={effectiveTenantId} />
          )}
        </WebShell>
      </RoleContext.Provider>
    );
  }

  if (effectiveRole === "master") {
    const isMasterRoute = pathname.startsWith("/master/") || pathname === "/master";
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(
            isSettingsPage
              ? children
              : isMasterRoute
                ? children
                : !effectiveTenantId
                  ? <NoTenantOnboarding role="master" />
                  : <MasterDashboard tenantId={effectiveTenantId} masterId={masterId!} isPersonal={isPersonalTenant} />
          )}
        </WebShell>
      </RoleContext.Provider>
    );
  }

  if (effectiveRole === "support" || effectiveRole === "technical_support") {
    return (
      <RoleContext.Provider value={ctxValue}>
        <WebShell>
          {wrapWithEmailGate(isSettingsPage ? children : <SupportDashboard />)}
        </WebShell>
      </RoleContext.Provider>
    );
  }

  // system_admin → full page routing with WebShell
  return (
    <RoleContext.Provider value={ctxValue}>
      <WebShell>{wrapWithEmailGate(children)}</WebShell>
    </RoleContext.Provider>
  );
}

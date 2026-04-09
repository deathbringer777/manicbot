"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SupportDashboard } from "~/components/dashboards/SupportDashboard";
import { useRole } from "~/components/RoleContext";

const SUPPORT_ROLES = new Set(["system_admin", "support", "technical_support"]);

/** Platform tickets (staff ↔ ManicBot). Salon omnichannel stays under /conversations. */
export default function PlatformSupportPage() {
  const { role } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (role && !SUPPORT_ROLES.has(role)) router.replace("/dashboard");
  }, [role, router]);

  if (!role || !SUPPORT_ROLES.has(role)) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-500 text-sm">Loading…</div>
    );
  }

  return <SupportDashboard />;
}

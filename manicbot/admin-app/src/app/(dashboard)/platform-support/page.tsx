"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SupportDashboard } from "~/components/dashboards/SupportDashboard";
import { useRole } from "~/components/RoleContext";

/** God Mode: platform tickets (staff ↔ ManicBot). Salon omnichannel stays under /conversations. */
export default function PlatformSupportPage() {
  const { role } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (role && role !== "system_admin") router.replace("/dashboard");
  }, [role, router]);

  if (role !== "system_admin") {
    return (
      <div className="flex h-40 items-center justify-center text-slate-500 text-sm">Loading…</div>
    );
  }

  return <SupportDashboard />;
}

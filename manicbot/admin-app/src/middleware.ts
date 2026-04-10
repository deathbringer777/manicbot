import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Redirect legacy ?tab= URLs to new /my-salon/* and /master/* routes.
 * Only fires on /dashboard with a tab query param.
 */

const SALON_TAB_REDIRECTS: Record<string, string> = {
  appointments: "/my-salon/appointments",
  services: "/my-salon/services",
  masters: "/my-salon/masters",
  clients: "/my-salon/clients",
  billing: "/my-salon/billing",
  channels: "/my-salon/channels",
  analytics: "/my-salon/analytics",
  reviews: "/my-salon/reviews",
  public_profile: "/my-salon/public-profile",
  // Channel shortcuts
  instagram: "/my-salon/channels",
  whatsapp: "/my-salon/channels",
};

const MASTER_TAB_REDIRECTS: Record<string, string> = {
  schedule: "/master/schedule",
  clients: "/master/clients",
  earnings: "/master/earnings",
  reviews: "/master/reviews",
  services: "/master/services",
  profile: "/master/profile",
};

export function middleware(request: NextRequest) {
  const tab = request.nextUrl.searchParams.get("tab");
  if (!tab) return NextResponse.next();

  // Only redirect from /dashboard path
  if (request.nextUrl.pathname !== "/dashboard" && request.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }

  // Try salon redirects first, then master
  const dest = SALON_TAB_REDIRECTS[tab] ?? MASTER_TAB_REDIRECTS[tab];
  if (dest) {
    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.searchParams.delete("tab");
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard", "/"],
};

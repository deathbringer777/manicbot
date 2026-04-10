import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Redirect legacy ?tab= URLs to new flat /s-* and /m-* routes.
 * Only fires on /dashboard with a tab query param.
 */

const SALON_TAB_REDIRECTS: Record<string, string> = {
  appointments: "/s-appointments",
  services: "/s-services",
  masters: "/s-masters",
  clients: "/s-clients",
  billing: "/s-billing",
  channels: "/s-channels",
  analytics: "/s-analytics",
  reviews: "/s-reviews",
  public_profile: "/s-public-profile",
  // Channel shortcuts
  instagram: "/s-channels",
  whatsapp: "/s-channels",
};

const MASTER_TAB_REDIRECTS: Record<string, string> = {
  schedule: "/m-schedule",
  clients: "/m-clients",
  earnings: "/m-earnings",
  reviews: "/m-reviews",
  services: "/m-services",
  profile: "/m-profile",
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

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Pass-through middleware required for Cloudflare Pages + @cloudflare/next-on-pages.
 * Without a middleware.ts file, new routes added under the (dashboard) route group
 * fall through to the (public) layout and 404. The middleware's presence ensures
 * all edge function routes are correctly dispatched by the compiled worker.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

import type { MetadataRoute } from "next";

/**
 * PWA manifest (WS-7). Lets the dashboard be installed to the home screen and
 * launched chromeless (display: standalone) for a native-app feel — pairs with
 * the viewport-fit=cover + safe-area work in WS-0. Next.js auto-serves this at
 * /manifest.webmanifest and injects the <link rel="manifest"> for every page.
 *
 * Icons: the brand mark at its native 256px (purpose "any") plus a 512px
 * maskable variant — the mark centered on the app's dark tile so the OS can
 * crop it to a circle/squircle without clipping the logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ManicBot",
    short_name: "ManicBot",
    description: "AI receptionist for beauty salons — bookings, reminders and clients, 24/7.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    orientation: "portrait",
    icons: [
      { src: "/manicbot-mark-ui.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

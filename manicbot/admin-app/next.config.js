/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./src/env.js";
import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  // StrictMode double-invokes effects/state setters in dev to surface
  // unsafe lifecycle patterns (e.g. setState-after-unmount inside mutation
  // onSuccess callbacks). Production is a no-op. Without this, the React
  // #300 from settings/AccountSection slipped past local development.
  reactStrictMode: true,
  transpilePackages: [],
  // Pin Turbopack's root to this admin-app directory. Without this, when the
  // tree contains a sibling lockfile (a git worktree under .claude/worktrees
  // does — both the main checkout and the worktree carry one), Next picks
  // whichever lockfile it finds first and resolves modules relative to that.
  // In a worktree dev that produces the wildly-confusing symptom of seeing
  // the *main* checkout's content rendered, not the local worktree edits.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Blog cover images live on Pexels/Unsplash. We use `unoptimized` on the
    // <Image /> tags themselves (Cloudflare Pages doesn't run the Next image
    // optimizer), but declaring the hostnames here keeps Next from rejecting
    // the URLs in dev / build with NEXT_IMAGE_PATTERN_MISMATCH.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/dashboard",
        destination: "/",
      },
    ];
  },
};

if (process.env.NODE_ENV === "development") {
  await setupDevPlatform();
}

export default config;

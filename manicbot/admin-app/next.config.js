/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

/** @type {import("next").NextConfig} */
const config = {
  // StrictMode double-invokes effects/state setters in dev to surface
  // unsafe lifecycle patterns (e.g. setState-after-unmount inside mutation
  // onSuccess callbacks). Production is a no-op. Without this, the React
  // #300 from settings/AccountSection slipped past local development.
  reactStrictMode: true,
  transpilePackages: [],
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

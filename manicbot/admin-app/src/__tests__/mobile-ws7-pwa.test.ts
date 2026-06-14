// @vitest-environment node
/**
 * WS-7 guard — the dashboard is installable as a standalone PWA. Pattern, not
 * pixel: assert the manifest declares standalone + a maskable icon, the asset
 * exists, and iOS standalone is opted into.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

describe("WS-7 — installable standalone PWA", () => {
  it("manifest declares standalone with any + maskable icons", () => {
    const src = read("src/app/manifest.ts");
    expect(src).toContain('display: "standalone"');
    expect(src).toContain('purpose: "any"');
    expect(src).toContain('purpose: "maskable"');
    expect(src).toContain('start_url: "/dashboard"');
  });

  it("the maskable icon asset is present", () => {
    expect(exists("public/icon-maskable-512.png")).toBe(true);
  });

  it("opts iOS into standalone via appleWebApp", () => {
    const src = read("src/app/layout.tsx");
    expect(src).toContain("appleWebApp");
    expect(src).toContain("capable: true");
  });
});

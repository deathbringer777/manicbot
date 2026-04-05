import { describe, it, expect, afterEach, vi } from "vitest";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";

describe("authPublicBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers AUTH_URL", () => {
    vi.stubEnv("AUTH_URL", "https://app.example.com/");
    vi.stubEnv("NEXTAUTH_URL", "https://ignored.com");
    vi.stubEnv("VERCEL_URL", undefined);
    expect(authPublicBaseUrl()).toBe("https://app.example.com");
  });

  it("falls back to NEXTAUTH_URL", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "https://auth.example.com");
    expect(authPublicBaseUrl()).toBe("https://auth.example.com");
  });

  it("prefixes https for VERCEL_URL", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "my-app.vercel.app");
    expect(authPublicBaseUrl()).toBe("https://my-app.vercel.app");
  });

  it("returns empty when unset", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(authPublicBaseUrl()).toBe("");
  });
});

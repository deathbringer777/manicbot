import { describe, it, expect } from "vitest";
import { LEGAL_ROUTES, getLegalPage } from "@/lib/routes";

describe("LEGAL_ROUTES", () => {
  it("has all expected page keys", () => {
    const paths = Object.keys(LEGAL_ROUTES);
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
    expect(paths).toContain("/cookies");
    expect(paths).toContain("/support");
    expect(paths).toContain("/rules");
  });

  it("maps paths to correct page keys", () => {
    expect(LEGAL_ROUTES["/privacy"]).toBe("privacy");
    expect(LEGAL_ROUTES["/terms"]).toBe("terms");
    expect(LEGAL_ROUTES["/cookies"]).toBe("cookies");
    expect(LEGAL_ROUTES["/support"]).toBe("support");
    expect(LEGAL_ROUTES["/rules"]).toBe("rules");
  });
});

describe("getLegalPage()", () => {
  it("returns page key for known paths", () => {
    expect(getLegalPage("/privacy")).toBe("privacy");
    expect(getLegalPage("/terms")).toBe("terms");
    expect(getLegalPage("/cookies")).toBe("cookies");
    expect(getLegalPage("/support")).toBe("support");
    expect(getLegalPage("/rules")).toBe("rules");
  });

  it("returns null for root path", () => {
    expect(getLegalPage("/")).toBeNull();
  });

  it("returns null for unknown paths", () => {
    expect(getLegalPage("/unknown")).toBeNull();
    expect(getLegalPage("/dashboard")).toBeNull();
    expect(getLegalPage("/login")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getLegalPage("")).toBeNull();
  });
});

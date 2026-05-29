import { describe, it, expect } from "vitest";
import { deriveEffectiveProfile } from "~/lib/effectiveProfile";

describe("deriveEffectiveProfile — pure helper", () => {
  it("regular signed-in user → own profile, writable", () => {
    const p = deriveEffectiveProfile({ webUserId: "u-1" });
    expect(p.effectiveWebUserId).toBe("u-1");
    expect(p.effectiveProfileKey).toBe("uu-1");
    expect(p.canWrite).toBe(true);
  });

  it("unauthenticated → anon profile, read-only", () => {
    const p = deriveEffectiveProfile({ webUserId: null });
    expect(p.effectiveWebUserId).toBe(null);
    expect(p.effectiveProfileKey).toBe("anon");
    expect(p.canWrite).toBe(false);
  });
});

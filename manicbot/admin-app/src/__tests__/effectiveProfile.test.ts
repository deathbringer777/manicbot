import { describe, it, expect } from "vitest";
import { deriveEffectiveProfile } from "~/lib/effectiveProfile";

describe("deriveEffectiveProfile — pure helper", () => {
  it("regular signed-in user → own profile, writable", () => {
    const p = deriveEffectiveProfile({
      webUserId: "u-1",
      previewMasterId: null,
      previewMasterWebUserId: null,
    });
    expect(p.effectiveWebUserId).toBe("u-1");
    expect(p.effectiveProfileKey).toBe("uu-1");
    expect(p.isPreview).toBe(false);
    expect(p.isPreviewSynthetic).toBe(false);
    expect(p.canWrite).toBe(true);
  });

  it("unauthenticated → anon profile, read-only", () => {
    const p = deriveEffectiveProfile({
      webUserId: null,
      previewMasterId: null,
      previewMasterWebUserId: null,
    });
    expect(p.effectiveWebUserId).toBe(null);
    expect(p.effectiveProfileKey).toBe("anon");
    expect(p.canWrite).toBe(false);
  });

  it("preview-as-master with real master web_user_id → that master's profile, read-only", () => {
    const p = deriveEffectiveProfile({
      webUserId: "owner-uid",
      previewMasterId: 7777,
      previewMasterWebUserId: "master-uid",
    });
    expect(p.effectiveWebUserId).toBe("master-uid");
    expect(p.effectiveProfileKey).toBe("umaster-uid");
    expect(p.isPreview).toBe(true);
    expect(p.isPreviewSynthetic).toBe(false);
    expect(p.canWrite).toBe(false);
  });

  it("preview-as-synthetic-master (no web_users row) → m<chatId> namespace, no destination", () => {
    const p = deriveEffectiveProfile({
      webUserId: "owner-uid",
      previewMasterId: 4242,
      previewMasterWebUserId: null,
    });
    expect(p.effectiveWebUserId).toBe(null);
    expect(p.effectiveProfileKey).toBe("m4242");
    expect(p.isPreview).toBe(true);
    expect(p.isPreviewSynthetic).toBe(true);
    expect(p.canWrite).toBe(false);
  });

  it("namespacing prevents key collisions between owner-uid and master-uid", () => {
    // Even if owner-uid happens to be `m4242` (string), the profile key
    // namespace prefix (`u` vs `m`) guarantees no collision.
    const owner = deriveEffectiveProfile({
      webUserId: "m4242",
      previewMasterId: null,
      previewMasterWebUserId: null,
    });
    const preview = deriveEffectiveProfile({
      webUserId: "owner-uid",
      previewMasterId: 4242,
      previewMasterWebUserId: null,
    });
    expect(owner.effectiveProfileKey).toBe("um4242");
    expect(preview.effectiveProfileKey).toBe("m4242");
    expect(owner.effectiveProfileKey).not.toBe(preview.effectiveProfileKey);
  });
});

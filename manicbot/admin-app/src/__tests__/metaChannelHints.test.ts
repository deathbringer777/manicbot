import { describe, it, expect } from "vitest";
import { buildMetaChannelHints } from "~/lib/metaChannelHints";

describe("buildMetaChannelHints (Meta Channels smoke / contract)", () => {
  it("defaults base URL when empty", () => {
    const h = buildMetaChannelHints({});
    expect(h.waWebhookUrl).toBe("https://manicbot.com/webhook/wa");
    expect(h.igWebhookUrl).toBe("https://manicbot.com/webhook/ig");
    expect(h.waVerifyToken).toBeNull();
    expect(h.igVerifyToken).toBeNull();
  });

  it("strips trailing slash from worker URL", () => {
    const h = buildMetaChannelHints({ workerPublicUrl: "https://example.com/" });
    expect(h.waWebhookUrl).toBe("https://example.com/webhook/wa");
    expect(h.igWebhookUrl).toBe("https://example.com/webhook/ig");
  });

  it("trims verify tokens", () => {
    const h = buildMetaChannelHints({
      workerPublicUrl: "https://x.dev",
      waVerify: "  wa_secret  ",
      igVerify: "ig_secret",
    });
    expect(h.waVerifyToken).toBe("wa_secret");
    expect(h.igVerifyToken).toBe("ig_secret");
  });
});

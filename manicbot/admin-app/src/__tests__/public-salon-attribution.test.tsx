// @vitest-environment happy-dom
/**
 * Public salon page must forward the `?s=google_maps&c=spring2026` query
 * string into the Telegram `?start=<token>` deep link so the Worker's
 * `/start` handler can decode it via `decodeStartPayload` and write a
 * `user_origins` row. Without this round-trip the Analytics tab funnel
 * stays at 0 even though bookings happen.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SalonProfileClient } from "~/app/(public)/salon/[slug]/SalonProfileClient";
import { decodeStartPayload } from "~/lib/trackingPayload";

const baseProfile = {
  id: "t_demo",
  slug: "demo",
  name: "Demo Salon",
  description: null,
  city: null,
  lat: null,
  lng: null,
  address: null,
  phone: null,
  workHours: null,
  photos: [],
  mapsUrl: null,
  instagramUrl: null,
  botUsername: "manicbot",
  services: [
    {
      svcId: "s1",
      emoji: "💅",
      name: "Маникюр",
      names: {},
      description: null,
      duration: 60,
      price: 100,
      photos: [],
    },
  ],
  masters: [],
};

function telegramHrefs(): string[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='https://t.me/']")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

beforeEach(() => {
  // Stub fetch so the salon_view /api/track POST does not blow up jsdom.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SalonProfileClient — attribution → Telegram /start token", () => {
  it("rewrites every Telegram CTA with ?start=<base64url-token> when attribution is present", () => {
    render(
      <SalonProfileClient
        profile={baseProfile}
        attribution={{ source: "google_maps", campaign: "spring2026" }}
      />,
    );

    const hrefs = telegramHrefs();
    expect(hrefs.length).toBeGreaterThanOrEqual(2);

    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\/t\.me\/manicbot\?start=[A-Za-z0-9_-]+$/);
      const token = href.replace(/^https:\/\/t\.me\/manicbot\?start=/, "");
      expect(decodeStartPayload(token)).toEqual({
        source: "google_maps",
        campaign: "spring2026",
      });
    }
  });

  it("emits bare Telegram URL when no attribution is passed", () => {
    render(<SalonProfileClient profile={baseProfile} />);
    const hrefs = telegramHrefs();
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(href).toBe("https://t.me/manicbot");
    }
  });

  it("falls back to bare URL when token would exceed Telegram's 64-byte limit", () => {
    const longSource = "x".repeat(200);
    render(<SalonProfileClient profile={baseProfile} attribution={{ source: longSource }} />);
    const hrefs = telegramHrefs();
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(href).toBe("https://t.me/manicbot");
    }
  });

  it("fires a salon_view event to /api/track with source + campaign on mount", () => {
    const fetchMock = vi.mocked(globalThis.fetch as unknown as typeof fetch);
    render(
      <SalonProfileClient
        profile={baseProfile}
        attribution={{ source: "google_maps", campaign: "spring2026" }}
      />,
    );

    const calls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/track");
    expect(calls.length).toBe(1);

    const [, init] = calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.event).toBe("salon_view");
    expect(body.properties.source).toBe("google_maps");
    expect(body.properties.campaign).toBe("spring2026");
    expect(body.properties.slug).toBe("demo");
    expect(body.anonymousId).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it("does not call /api/track when attribution is absent (no tracking signal)", () => {
    const fetchMock = vi.mocked(globalThis.fetch as unknown as typeof fetch);
    render(<SalonProfileClient profile={baseProfile} />);
    const calls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/track");
    expect(calls.length).toBe(0);
  });

  it("does not break when botUsername is missing", () => {
    expect(() =>
      render(
        <SalonProfileClient
          profile={{ ...baseProfile, botUsername: null }}
          attribution={{ source: "google_maps" }}
        />,
      ),
    ).not.toThrow();
  });
});

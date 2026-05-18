/**
 * lib/notifications/prefs — pure logic for the per-user notification
 * preferences blob. Both the admin-app `notifyWebUser` and the Worker
 * `userNotify.js` consult this; the contract must stay stable so a
 * partial JSON blob written by an old client doesn't drop notifications.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  categoryForKind,
  parsePrefs,
  serializePrefs,
  shouldDeliver,
} from "~/lib/notifications/prefs";

describe("categoryForKind", () => {
  it.each([
    ["appointment.created", "appointment"],
    ["appointment.no_show_master", "appointment"],
    ["support.reply", "support"],
    ["birthday.client", "birthday"],
    ["platform.message", "platform"],
    ["master.invite", "master"],
    ["reminder.fired", "reminder"],
    ["messenger.thread.new", "messenger"],
    ["thread.message.new", "messenger"],
    ["billing.alert", "billing"],
    ["marketing.campaign.sent", "marketing"],
  ])("maps %s → %s", (kind, expected) => {
    expect(categoryForKind(kind)).toBe(expected);
  });

  it("returns null for unknown prefixes", () => {
    expect(categoryForKind("totally.unknown")).toBeNull();
    expect(categoryForKind("")).toBeNull();
  });
});

describe("parsePrefs", () => {
  it("returns DEFAULT_PREFS for null / empty / malformed input", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[]")).toEqual(DEFAULT_PREFS); // not an object
    expect(parsePrefs("{}")).toEqual(DEFAULT_PREFS); // no categories
  });

  it("fills in missing categories with defaults", () => {
    const partial = JSON.stringify({
      categories: {
        appointment: { inapp: false, push: false },
      },
    });
    const parsed = parsePrefs(partial);
    expect(parsed.categories.appointment).toEqual({ inapp: false, push: false });
    // Missing categories fall back to DEFAULT_PREFS.
    expect(parsed.categories.support).toEqual(DEFAULT_PREFS.categories.support);
    expect(parsed.categories.marketing).toEqual(DEFAULT_PREFS.categories.marketing);
  });

  it("recovers from partially-typed category objects (missing channels)", () => {
    const partial = JSON.stringify({
      categories: {
        support: { inapp: false }, // missing push
        appointment: { push: false }, // missing inapp
      },
    });
    const parsed = parsePrefs(partial);
    expect(parsed.categories.support.inapp).toBe(false);
    expect(parsed.categories.support.push).toBe(true); // default
    expect(parsed.categories.appointment.inapp).toBe(true); // default
    expect(parsed.categories.appointment.push).toBe(false);
  });
});

describe("shouldDeliver", () => {
  it("respects opt-outs on the matching channel", () => {
    const prefs = parsePrefs(JSON.stringify({
      categories: {
        marketing: { inapp: false, push: false },
      },
    }));
    expect(shouldDeliver("marketing.campaign.sent", prefs, "inapp")).toBe(false);
    expect(shouldDeliver("marketing.campaign.sent", prefs, "push")).toBe(false);
  });

  it("unknown kinds always deliver — never silently drop unknown writers", () => {
    expect(shouldDeliver("totally.unknown", DEFAULT_PREFS, "inapp")).toBe(true);
    expect(shouldDeliver("totally.unknown", DEFAULT_PREFS, "push")).toBe(true);
  });

  it("each channel is independent — push off ≠ inapp off", () => {
    const prefs = parsePrefs(JSON.stringify({
      categories: { support: { inapp: true, push: false } },
    }));
    expect(shouldDeliver("support.reply", prefs, "inapp")).toBe(true);
    expect(shouldDeliver("support.reply", prefs, "push")).toBe(false);
  });
});

describe("serializePrefs", () => {
  it("emits categories in canonical (NOTIFICATION_CATEGORIES) order", () => {
    const prefs = DEFAULT_PREFS;
    const json = serializePrefs(prefs);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed.categories)).toEqual([...NOTIFICATION_CATEGORIES]);
  });

  it("round-trips: parse(serialize(x)) === x", () => {
    const tweaked = parsePrefs(JSON.stringify({
      categories: { marketing: { inapp: false, push: false } },
    }));
    const rt = parsePrefs(serializePrefs(tweaked));
    expect(rt).toEqual(tweaked);
  });
});

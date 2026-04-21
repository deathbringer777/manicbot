/**
 * CI guard: ensures no fixture/dev/test plugins can sneak back into the
 * production registry.
 *
 * Rules enforced:
 *  1. No plugin slug starts with "_" (underscore convention for dev fixtures).
 *  2. None of the deleted fixture slugs are present.
 *  3. None of name/tagline/description fields contain banned placeholder words.
 */

import { describe, it, expect } from "vitest";
import { listManifests, getPlugin } from "@plugins/registry";

const BANNED_WORDS = [
  "fixture",
  "test plugin",
  "hello world",
  "demo",
  "sample",
  "placeholder",
] as const;

const DELETED_FIXTURE_SLUGS = [
  "_hello-world",
  "_live-test",
  "_platform-test",
] as const;

// Canonical slugs the deleted fixtures used (without the underscore prefix)
const DELETED_REGISTRY_SLUGS = [
  "hello-world",
  "live-test",
  "platform-test",
] as const;

const manifests = listManifests();

describe("No fixture / dev plugins in production registry", () => {
  it("no plugin slug starts with '_'", () => {
    const underscoreSlugs = manifests.map((m) => m.slug).filter((s) => s.startsWith("_"));
    expect(underscoreSlugs).toEqual([]);
  });

  for (const slug of DELETED_FIXTURE_SLUGS) {
    it(`deleted fixture directory slug "${slug}" is absent from registry`, () => {
      expect(getPlugin(slug)).toBeNull();
    });
  }

  for (const slug of DELETED_REGISTRY_SLUGS) {
    it(`deleted fixture registry slug "${slug}" is absent from registry`, () => {
      const allSlugs = manifests.map((m) => m.slug);
      expect(allSlugs).not.toContain(slug);
      expect(getPlugin(slug)).toBeNull();
    });
  }

  const LANGS = ["ru", "ua", "en", "pl"] as const;
  const FIELDS = ["name", "tagline", "description"] as const;

  for (const m of manifests) {
    for (const field of FIELDS) {
      for (const lang of LANGS) {
        const text = m[field][lang] ?? "";
        for (const word of BANNED_WORDS) {
          it(`${m.slug}.${field}.${lang} does not contain banned word "${word}"`, () => {
            expect(text.toLowerCase()).not.toContain(word.toLowerCase());
          });
        }
      }
    }
  }
});

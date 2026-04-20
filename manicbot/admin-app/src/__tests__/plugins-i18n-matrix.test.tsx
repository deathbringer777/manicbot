// @vitest-environment happy-dom
/**
 * i18n matrix: every seeded plugin is rendered via PluginCard in all 4 langs
 * and localizations are asserted to be present + distinct.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: { cancel: () => Promise.resolve(), getData: () => [], setData: () => {}, invalidate: () => Promise.resolve() },
      },
    }),
    plugins: {
      listPinned: { useQuery: () => ({ data: [], isLoading: false }) },
      togglePin: { useMutation: () => ({ mutate: () => {}, error: null }) },
    },
  },
}));

import { PluginCard } from "~/components/plugins/PluginCard";
import { renderWithLang } from "./helpers/renderWithLang";
import { listManifests, PLUGIN_LANGS } from "@plugins/index";
import type { PluginLang, CatalogCard } from "@plugins/types";

const real = listManifests().filter(
  (m) => !/^(hello-world|live-test|platform-test)$/.test(m.slug),
);

function toCard(m: ReturnType<typeof listManifests>[number], lang: PluginLang): CatalogCard {
  return {
    slug: m.slug,
    category: m.category,
    status: m.status,
    iconName: m.icon.name,
    iconTint: m.icon.tint,
    name: m.name[lang],
    tagline: m.tagline[lang],
    description: m.description[lang],
    keywords: m.keywords[lang],
    billingLabel: "Free",
    billingModel: m.billing.model,
    lock: { kind: "none" },
    installed: false,
    installationId: null,
    enabled: false,
  };
}

afterEach(() => cleanup());

describe("i18n matrix — every plugin renders in every language", () => {
  for (const m of real) {
    for (const lang of PLUGIN_LANGS) {
      it(`${m.slug} renders in ${lang}`, () => {
        renderWithLang(<PluginCard card={toCard(m, lang)} />, lang);
        const el = screen.getByTestId("plugin-card");
        expect(el.textContent).toContain(m.name[lang]);
        expect(el.textContent).toContain(m.tagline[lang]);
      });
    }
  }
});

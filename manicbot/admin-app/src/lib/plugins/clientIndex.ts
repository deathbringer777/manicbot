/**
 * Client-side Fuse.js index over the localized catalog.
 * Built once per render and cached in useMemo so filters stay snappy.
 */

import Fuse from "fuse.js";
import type { CatalogCard } from "@plugins/types";

export interface SearchIndex {
  search(query: string): CatalogCard[];
}

export function buildCatalogIndex(cards: CatalogCard[]): SearchIndex {
  if (!cards.length) {
    return { search: () => [] };
  }
  const fuse = new Fuse(cards, {
    keys: [
      { name: "name", weight: 0.5 },
      { name: "tagline", weight: 0.2 },
      { name: "description", weight: 0.1 },
      { name: "keywords", weight: 0.2 },
      { name: "slug", weight: 0.05 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
  });
  return {
    search(query: string) {
      const q = query.trim();
      if (!q) return cards;
      return fuse.search(q).map((r) => r.item);
    },
  };
}

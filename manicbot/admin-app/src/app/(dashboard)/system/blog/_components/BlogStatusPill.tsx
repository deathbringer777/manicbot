"use client";

import { Pill } from "~/components/ui/Pill";
import type { BlogStatus } from "~/server/blog/serialize";

const LABELS: Record<BlogStatus, { ru: string; ua: string; en: string; pl: string }> = {
  draft: { ru: "Черновик", ua: "Чернетка", en: "Draft", pl: "Szkic" },
  published: { ru: "Опубликовано", ua: "Опубліковано", en: "Published", pl: "Opublikowane" },
  archived: { ru: "В архиве", ua: "В архіві", en: "Archived", pl: "W archiwum" },
};

const TONES: Record<BlogStatus, "slate" | "emerald" | "amber"> = {
  draft: "slate",
  published: "emerald",
  archived: "amber",
};

export function BlogStatusPill({ status, lang }: { status: BlogStatus; lang: "ru" | "ua" | "en" | "pl" }) {
  return (
    <Pill tone={TONES[status]} variant="soft" size="sm">
      {LABELS[status][lang]}
    </Pill>
  );
}

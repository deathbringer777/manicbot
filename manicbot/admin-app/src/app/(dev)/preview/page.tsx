"use client";

/**
 * DEV-ONLY palette preview. Not a product route — 404s in production. Renders
 * the authed-app primitives + semantic tokens with hardcoded mock data so the
 * beige + red + turquoise palette can be eyeballed in BOTH themes on localhost
 * (the real dashboard can't run locally — no D1 binding). Light + dark panels
 * sit side by side, each wrapped in data-app="authed" so they pick up the
 * scoped tokens; the dark panel adds a .dark ancestor.
 */

import { useEffect } from "react";
import { notFound } from "next/navigation";
import { Button } from "~/components/ui/Button";
import { Pill } from "~/components/ui/Pill";

const SWATCHES: Array<{ name: string; cls: string }> = [
  { name: "primary (red)", cls: "bg-primary text-primary-foreground" },
  { name: "secondary (turq)", cls: "bg-secondary text-secondary-foreground" },
  { name: "success", cls: "bg-success text-success-foreground" },
  { name: "warning", cls: "bg-warning text-warning-foreground" },
  { name: "danger", cls: "bg-danger text-danger-foreground" },
  { name: "card", cls: "bg-card text-card-foreground border border-border" },
  { name: "surface-muted", cls: "bg-surface-muted text-foreground" },
  { name: "background", cls: "bg-background text-foreground border border-border" },
];

const BTN_TONES = ["brand", "accent", "slate"] as const; // brand→red, accent→turquoise
const BTN_VARIANTS = ["solid", "soft", "outline", "ghost"] as const;
const PILL_TONES = ["brand", "accent", "emerald", "amber", "red", "slate"] as const;

function Showcase() {
  return (
    <div className="bg-background text-foreground min-h-full p-6 space-y-8">
      <div>
        <h2 className="text-xl font-bold text-foreground">ManicBot · авторизованное приложение</h2>
        <p className="text-sm text-muted-foreground">
          Палитра: бежевый фон, красный primary, бирюзовый secondary.{" "}
          <span className="text-secondary-text font-medium">Бирюзовая ссылка</span>.
        </p>
      </div>

      {/* Semantic swatches */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tokens</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SWATCHES.map((s) => (
            <div key={s.name} className={`rounded-xl px-3 py-4 text-xs font-medium ${s.cls}`}>
              {s.name}
            </div>
          ))}
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buttons</h3>
        <div className="space-y-2">
          {BTN_VARIANTS.map((v) => (
            <div key={v} className="flex flex-wrap items-center gap-2">
              <span className="w-14 text-[11px] text-muted-foreground">{v}</span>
              {BTN_TONES.map((t) => (
                <Button key={t} tone={t} variant={v} size="sm">
                  {t === "brand" ? "Сохранить" : t === "accent" ? "Подтвердить" : "Отмена"}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Pills */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pills</h3>
        <div className="flex flex-wrap gap-2">
          {PILL_TONES.map((t) => (
            <Pill key={`soft-${t}`} tone={t} variant="soft" size="sm">{t}</Pill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {PILL_TONES.map((t) => (
            <Pill key={`solid-${t}`} tone={t} variant="solid" size="sm">{t}</Pill>
          ))}
        </div>
      </section>

      {/* Cards */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cards</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="glass-card rounded-2xl p-4">
            <p className="text-sm font-semibold text-foreground">Записей сегодня</p>
            <p className="mt-1 text-3xl font-bold text-foreground">12</p>
            <p className="mt-1 text-xs text-muted-foreground">+3 к прошлой неделе</p>
            <div className="mt-3 flex gap-2">
              <Button tone="brand" variant="solid" size="sm">Добавить</Button>
              <Button tone="accent" variant="soft" size="sm">Календарь</Button>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Запись</p>
              <Pill tone="accent" variant="soft" size="xs">подтверждена</Pill>
            </div>
            <p className="mt-2 text-sm text-foreground">Маникюр · 14:00</p>
            <p className="text-xs text-muted-foreground">Мастер: Анна</p>
            <a href="#" className="mt-2 inline-block text-xs font-medium text-secondary-text">Открыть карточку →</a>
          </div>
        </div>
      </section>

      {/* Skeletons */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Loading</h3>
        <div className="space-y-2">
          <div className="skeleton-shimmer h-4 w-3/4 rounded" />
          <div className="skeleton-shimmer h-4 w-1/2 rounded" />
          <div className="skeleton-shimmer h-20 w-full rounded-xl" />
        </div>
      </section>
    </div>
  );
}

function Panel({ theme }: { theme: "light" | "dark" }) {
  const inner = (
    <div data-app="authed" className="min-h-screen">
      <Showcase />
    </div>
  );
  return (
    <div className={theme === "dark" ? "dark" : undefined}>
      <div className="bg-background min-h-screen">{inner}</div>
    </div>
  );
}

export default function PreviewPage() {
  // Force a light baseline on <html> so the light panel isn't tinted by a
  // globally-toggled .dark; the dark panel supplies its own .dark ancestor.
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  if (process.env.NODE_ENV === "production") return notFound();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      <Panel theme="light" />
      <Panel theme="dark" />
    </div>
  );
}

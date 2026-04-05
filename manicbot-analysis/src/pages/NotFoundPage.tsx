import { Header } from "@/components/Header";
import { useLanguage } from "@/i18n";

const COPY = {
  ru: { title: "Страница не найдена", desc: "Такой страницы не существует или она была удалена.", back: "На главную" },
  en: { title: "Page not found", desc: "This page doesn't exist or has been removed.", back: "Go to homepage" },
  ua: { title: "Сторінку не знайдено", desc: "Такої сторінки не існує або вона була видалена.", back: "На головну" },
  pl: { title: "Strona nie znaleziona", desc: "Ta strona nie istnieje lub została usunięta.", back: "Na stronę główną" },
} as const;

export function NotFoundPage() {
  const { locale } = useLanguage();
  const c = COPY[locale] ?? COPY.ru;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 antialiased dark:bg-[#050812] dark:text-white">
      <Header />

      <main className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 pt-32 text-center sm:pt-44">
        <span className="mb-6 text-7xl font-extrabold tracking-tighter text-violet-600/20 dark:text-violet-400/15 sm:text-9xl">
          404
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          {c.title}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-white/45">
          {c.desc}
        </p>

        <a
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-violet-700 hover:shadow-lg active:scale-[0.97]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {c.back}
        </a>
      </main>
    </div>
  );
}

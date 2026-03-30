import type { Metadata } from "next";
import "~/styles/globals.css";

export const metadata: Metadata = {
  title: "ManicBot — Найдите свой салон",
  description: "Каталог nail-салонов. Онлайн-запись через Telegram.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 antialiased">
      {/* Topbar */}
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 font-bold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/20 text-sm">
              💅
            </span>
            ManicBot
          </a>
          <nav className="flex items-center gap-3">
            <a
              href="/search"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Поиск салонов
            </a>
            <a
              href="/login"
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
            >
              Для владельцев
            </a>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      {/* Footer */}
      <footer className="mt-20 border-t border-slate-800/60 bg-slate-900/50 py-10">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-slate-500">
          <p className="mb-2 font-semibold text-slate-400">ManicBot</p>
          <p>Платформа онлайн-записи для nail-салонов</p>
          <div className="mt-4 flex justify-center gap-6">
            <a href="/search" className="hover:text-slate-300">Найти салон</a>
            <a href="/login" className="hover:text-slate-300">Кабинет владельца</a>
            <a href="https://t.me/manic_preview_bot" className="hover:text-slate-300">Telegram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

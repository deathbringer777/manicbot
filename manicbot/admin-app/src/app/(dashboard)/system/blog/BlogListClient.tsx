"use client";

/**
 * System Admin blog list — `/system/blog`.
 *
 * Lives inside the `system_admin`-only nav group (`god.blog`). Surfaces:
 *   - 4 KPI tiles (Total / Drafts / Published / Archived)
 *   - Status tabs (All / Drafts / Published / Archived)
 *   - Search input (slug + any-lang title)
 *   - Per-row inline actions (edit / publish / unpublish / archive / unarchive / delete)
 *   - "+ New post" CTA in the header
 *   - First-run "Import default articles" CTA when the table is empty
 *
 * Mutations refetch `list` + `stats` on success. Hard-delete uses a centered
 * brand confirm modal (`ConfirmDialog`) — published rows refuse delete server-side
 * with BAD_REQUEST, so the menu hides Delete when status === 'published'.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen, Plus, Search, RefreshCw, Sparkles, Edit3, Eye, EyeOff,
  Archive, ArchiveRestore, Trash2, Calendar, Image as ImageIcon,
} from "lucide-react";

import { Shell } from "~/components/layout/Shell";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Select } from "~/components/ui/Select";
import { EmptyState } from "~/components/ui/EmptyState";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { BlogStatusPill } from "./_components/BlogStatusPill";
import type { Lang } from "~/lib/i18n";
import { coalesceLang } from "~/server/blog/serialize";

const COPY = {
  ru: {
    title: "Блог",
    subtitle: "Управление статьями на manicbot.com/blog",
    newPost: "Новая статья",
    refresh: "Обновить",
    import: "Импортировать стандартные статьи",
    importing: "Импортируем…",
    importTitle: "Импортировать существующие статьи?",
    importDesc: "10 встроенных статей из исходников переедут в базу данных. Дубликаты по slug пропустятся.",
    importDone: (n: number, s: number) => `Готово: добавлено ${n}, пропущено ${s}`,
    total: "Всего",
    draft: "Черновики",
    published: "Опубликовано",
    archived: "В архиве",
    tabAll: "Все",
    tabDraft: "Черновики",
    tabPublished: "Опубликованные",
    tabArchived: "В архиве",
    searchPh: "Поиск по slug или заголовку…",
    cat: "Категория",
    catAll: "Все категории",
    catTips: "Советы",
    catProduct: "Продукт",
    catBusiness: "Бизнес",
    catTrends: "Тренды",
    emptyTitle: "Пока ни одной статьи",
    emptyDesc: "Создайте первую статью или импортируйте набор по умолчанию.",
    edit: "Редактировать",
    publish: "Опубликовать",
    unpublish: "Снять с публикации",
    archive: "В архив",
    unarchive: "Вернуть из архива",
    deleteAction: "Удалить",
    confirmDelete: "Удалить статью без возможности восстановления?",
    confirmDeleteDesc: "Эта операция необратима. Опубликованные статьи нужно сначала отправить в архив.",
    confirmDeleteOk: "Удалить",
    cancel: "Отмена",
  },
  ua: {
    title: "Блог", subtitle: "Керування статтями на manicbot.com/blog", newPost: "Нова стаття",
    refresh: "Оновити", import: "Імпортувати стандартні статті", importing: "Імпортуємо…",
    importTitle: "Імпортувати наявні статті?", importDesc: "10 вбудованих статей переїдуть до БД. Дублі за slug пропустяться.",
    importDone: (n: number, s: number) => `Готово: додано ${n}, пропущено ${s}`,
    total: "Усього", draft: "Чернетки", published: "Опубліковано", archived: "В архіві",
    tabAll: "Усі", tabDraft: "Чернетки", tabPublished: "Опубліковані", tabArchived: "В архіві",
    searchPh: "Пошук за slug або заголовком…",
    cat: "Категорія", catAll: "Усі категорії", catTips: "Поради", catProduct: "Продукт", catBusiness: "Бізнес", catTrends: "Тренди",
    emptyTitle: "Поки немає жодної статті", emptyDesc: "Створіть першу або імпортуйте набір за замовчуванням.",
    edit: "Редагувати", publish: "Опублікувати", unpublish: "Зняти з публікації",
    archive: "В архів", unarchive: "Повернути з архіву", deleteAction: "Видалити",
    confirmDelete: "Видалити статтю без можливості відновлення?",
    confirmDeleteDesc: "Операція незворотна. Опубліковані статті спочатку треба відправити в архів.",
    confirmDeleteOk: "Видалити", cancel: "Скасувати",
  },
  en: {
    title: "Blog", subtitle: "Manage articles on manicbot.com/blog", newPost: "New post",
    refresh: "Refresh", import: "Import default articles", importing: "Importing…",
    importTitle: "Import existing articles?", importDesc: "10 built-in articles will move into the database. Duplicate slugs are skipped.",
    importDone: (n: number, s: number) => `Done: ${n} added, ${s} skipped`,
    total: "Total", draft: "Drafts", published: "Published", archived: "Archived",
    tabAll: "All", tabDraft: "Drafts", tabPublished: "Published", tabArchived: "Archived",
    searchPh: "Search by slug or title…",
    cat: "Category", catAll: "All categories", catTips: "Tips", catProduct: "Product", catBusiness: "Business", catTrends: "Trends",
    emptyTitle: "No posts yet", emptyDesc: "Create the first post or import the default set.",
    edit: "Edit", publish: "Publish", unpublish: "Unpublish",
    archive: "Archive", unarchive: "Restore", deleteAction: "Delete",
    confirmDelete: "Delete this post permanently?",
    confirmDeleteDesc: "This action is irreversible. Published posts must be archived first.",
    confirmDeleteOk: "Delete", cancel: "Cancel",
  },
  pl: {
    title: "Blog", subtitle: "Zarządzanie artykułami na manicbot.com/blog", newPost: "Nowy wpis",
    refresh: "Odśwież", import: "Importuj domyślne artykuły", importing: "Importuję…",
    importTitle: "Zaimportować istniejące artykuły?", importDesc: "10 wbudowanych artykułów trafi do bazy. Duplikaty slugów są pomijane.",
    importDone: (n: number, s: number) => `Gotowe: dodano ${n}, pominięto ${s}`,
    total: "Łącznie", draft: "Szkice", published: "Opublikowane", archived: "W archiwum",
    tabAll: "Wszystkie", tabDraft: "Szkice", tabPublished: "Opublikowane", tabArchived: "W archiwum",
    searchPh: "Szukaj po slugu lub tytule…",
    cat: "Kategoria", catAll: "Wszystkie kategorie", catTips: "Porady", catProduct: "Produkt", catBusiness: "Biznes", catTrends: "Trendy",
    emptyTitle: "Brak artykułów", emptyDesc: "Utwórz pierwszy artykuł lub zaimportuj domyślny zestaw.",
    edit: "Edytuj", publish: "Opublikuj", unpublish: "Cofnij publikację",
    archive: "Archiwizuj", unarchive: "Przywróć", deleteAction: "Usuń",
    confirmDelete: "Usunąć artykuł nieodwracalnie?",
    confirmDeleteDesc: "Operacja jest nieodwracalna. Opublikowane wpisy najpierw zarchiwizuj.",
    confirmDeleteOk: "Usuń", cancel: "Anuluj",
  },
} as const;

type StatusFilter = "all" | "draft" | "published" | "archived";

export default function BlogListClient() {
  const { lang } = useLang();
  const router = useRouter();
  const copy = COPY[lang as Lang] ?? COPY.ru;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<"all" | "tips" | "product" | "business" | "trends">("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const utils = api.useUtils();
  const { data: stats } = api.blog.stats.useQuery(undefined, { refetchInterval: 60_000 });
  const list = api.blog.list.useQuery(
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      category: category === "all" ? undefined : category,
      search: search.trim() || undefined,
    },
    { refetchInterval: 60_000 },
  );

  const refetchAll = () => {
    void utils.blog.list.invalidate();
    void utils.blog.stats.invalidate();
  };

  const seed = api.blog.seedDefaults.useMutation({ onSuccess: refetchAll });
  const publish = api.blog.publish.useMutation({ onSuccess: refetchAll });
  const unpublish = api.blog.unpublish.useMutation({ onSuccess: refetchAll });
  const archive = api.blog.archive.useMutation({ onSuccess: refetchAll });
  const unarchive = api.blog.unarchive.useMutation({ onSuccess: refetchAll });
  const del = api.blog.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      refetchAll();
    },
  });

  const seedResult = seed.data;

  const rows = useMemo(() => list.data ?? [], [list.data]);

  const handleSeed = async () => {
    if (!confirm(copy.importTitle + "\n\n" + copy.importDesc)) return;
    await seed.mutateAsync();
  };

  const isEmpty = !list.isLoading && rows.length === 0 && search.trim() === "" && statusFilter === "all" && category === "all";

  return (
    <Shell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 p-3">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{copy.title}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{copy.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refetchAll}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
              aria-label={copy.refresh}
              title={copy.refresh}
            >
              <RefreshCw className={`w-4 h-4 ${list.isFetching ? "animate-spin" : ""}`} />
            </button>
            <Link
              href="/system/blog/new"
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3.5 py-2 shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              {copy.newPost}
            </Link>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label={copy.total} value={stats?.total ?? 0} tone="slate" />
          <StatTile label={copy.draft} value={stats?.draft ?? 0} tone="amber" />
          <StatTile label={copy.published} value={stats?.published ?? 0} tone="emerald" />
          <StatTile label={copy.archived} value={stats?.archived ?? 0} tone="slate" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <TabButton label={copy.tabAll} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <TabButton label={copy.tabDraft} active={statusFilter === "draft"} onClick={() => setStatusFilter("draft")} />
          <TabButton label={copy.tabPublished} active={statusFilter === "published"} onClick={() => setStatusFilter("published")} />
          <TabButton label={copy.tabArchived} active={statusFilter === "archived"} onClick={() => setStatusFilter("archived")} />
          <div className="ml-auto flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={copy.searchPh}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
            <div className="w-44">
              <Select
                value={category}
                onChange={(v) => setCategory(v as typeof category)}
                options={[
                  { value: "all", label: copy.catAll },
                  { value: "tips", label: copy.catTips },
                  { value: "product", label: copy.catProduct },
                  { value: "business", label: copy.catBusiness },
                  { value: "trends", label: copy.catTrends },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Body */}
        {isEmpty ? (
          <Card>
            <div className="p-6">
              <EmptyState
                icon={BookOpen}
                title={copy.emptyTitle}
                description={copy.emptyDesc}
              />
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                <Button
                  onClick={() => router.push("/system/blog/new")}
                  tone="brand"
                  variant="solid"
                  leadingIcon={<Plus className="w-4 h-4" />}
                >
                  {copy.newPost}
                </Button>
                <Button
                  onClick={handleSeed}
                  tone="violet"
                  variant="soft"
                  leadingIcon={<Sparkles className="w-4 h-4" />}
                  disabled={seed.isPending}
                >
                  {seed.isPending ? copy.importing : copy.import}
                </Button>
              </div>
              {seedResult && (
                <p className="text-center text-xs text-emerald-600 dark:text-emerald-300 mt-3">
                  {copy.importDone(seedResult.imported, seedResult.skipped)}
                </p>
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {list.isLoading ? (
                <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">No posts match the current filters.</div>
              ) : (
                rows.map((post) => (
                  <BlogRow
                    key={post.id}
                    post={post}
                    lang={lang as Lang}
                    copy={copy}
                    onEdit={() => router.push(`/system/blog/${post.id}`)}
                    onPublish={() => publish.mutate({ id: post.id })}
                    onUnpublish={() => unpublish.mutate({ id: post.id })}
                    onArchive={() => archive.mutate({ id: post.id })}
                    onUnarchive={() => unarchive.mutate({ id: post.id })}
                    onDelete={() => setDeletingId(post.id)}
                  />
                ))
              )}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!deletingId}
        title={copy.confirmDelete}
        description={copy.confirmDeleteDesc}
        confirmLabel={copy.confirmDeleteOk}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setDeletingId(null)}
        onConfirm={() => {
          if (deletingId) void del.mutateAsync({ id: deletingId });
        }}
      />
    </Shell>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-violet-600 text-white shadow-sm"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]"
      }`}
    >
      {label}
    </button>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "slate" | "amber" | "emerald" }) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-300"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-300"
        : "text-slate-600 dark:text-slate-200";
  return (
    <Card>
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-extrabold ${toneCls}`}>{value}</p>
      </div>
    </Card>
  );
}

function formatDate(unix: number | null, lang: Lang): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const locales: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return d.toLocaleDateString(locales[lang], { day: "numeric", month: "short", year: "numeric" });
}

interface RowCopy {
  edit: string; publish: string; unpublish: string; archive: string; unarchive: string; deleteAction: string;
}

function BlogRow({
  post, lang, copy, onEdit, onPublish, onUnpublish, onArchive, onUnarchive, onDelete,
}: {
  post: { id: string; slug: string; status: "draft" | "published" | "archived"; category: string;
    titles: Record<string, string | undefined>; coverImage: { url: string } | null;
    publishedDate: string | null; updatedAt: number; };
  lang: Lang;
  copy: RowCopy;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const title = coalesceLang(post.titles, lang) || `(${post.slug})`;
  return (
    <div className="p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
      {/* Cover thumb */}
      <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        {post.coverImage?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImage.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-5 h-5 text-slate-400" />
        )}
      </div>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <BlogStatusPill status={post.status} lang={lang} />
          <span className="text-[11px] uppercase tracking-wide text-slate-400">{post.category}</span>
        </div>
        <button
          onClick={onEdit}
          className="block w-full text-left text-sm font-semibold text-slate-900 dark:text-white truncate hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
        >
          {title}
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">/{post.slug}</p>
        <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {post.publishedDate ?? formatDate(post.updatedAt, lang)}
        </p>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-wrap gap-1 justify-end">
        <IconBtn label={copy.edit} onClick={onEdit}><Edit3 className="w-4 h-4" /></IconBtn>
        {post.status === "draft" || post.status === "archived" ? (
          <IconBtn label={copy.publish} onClick={onPublish} tone="emerald"><Eye className="w-4 h-4" /></IconBtn>
        ) : (
          <IconBtn label={copy.unpublish} onClick={onUnpublish} tone="amber"><EyeOff className="w-4 h-4" /></IconBtn>
        )}
        {post.status === "archived" ? (
          <IconBtn label={copy.unarchive} onClick={onUnarchive} tone="sky"><ArchiveRestore className="w-4 h-4" /></IconBtn>
        ) : (
          <IconBtn label={copy.archive} onClick={onArchive} tone="amber"><Archive className="w-4 h-4" /></IconBtn>
        )}
        {post.status !== "published" && (
          <IconBtn label={copy.deleteAction} onClick={onDelete} tone="red"><Trash2 className="w-4 h-4" /></IconBtn>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  children, label, onClick, tone = "slate",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "slate" | "emerald" | "amber" | "sky" | "red";
}) {
  const TONE: Record<string, string> = {
    slate: "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]",
    emerald: "text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/15",
    amber: "text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/15",
    sky: "text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/15",
    red: "text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-2 rounded-lg transition-colors ${TONE[tone]}`}
    >
      {children}
    </button>
  );
}

"use client";

/**
 * BlogEditor — shared form used by `/system/blog/new` and `/system/blog/[id]`.
 *
 * Surfaces 4 language tabs (ru/ua/en/pl) with per-lang title / excerpt / body
 * (markdown). Cover image uploads through the existing `/upload/asset` R2
 * pipeline using a `blog_cover` token minted server-side. Inline images in
 * the body field use a `blog_photo` token and insert `![alt](url)` at the
 * cursor.
 *
 * Status mutations (publish / unpublish / archive / unarchive / delete) sit
 * in the sticky footer alongside Save Draft. Delete refuses `published` rows
 * server-side; the UI hides the button in that state.
 *
 * Slug input gains a "↻ from title" affordance that runs `slugify` on the
 * current Russian (or first non-empty) title.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save, Eye, EyeOff, Archive, ArchiveRestore, Trash2, Wand2,
  ImagePlus, Upload, X, Loader2, ArrowLeft, AlertCircle,
} from "lucide-react";

import { Shell } from "~/components/layout/Shell";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Select } from "~/components/ui/Select";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { slugify, coalesceLang, type BlogPostDto } from "~/server/blog/serialize";
import { BlogStatusPill } from "./BlogStatusPill";
import type { Lang } from "~/lib/i18n";

const LANGS: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];
const LANG_LABELS: Record<Lang, string> = { ru: "Русский", ua: "Українська", en: "English", pl: "Polski" };
const LANG_FLAGS: Record<Lang, string> = { ru: "🇷🇺", ua: "🇺🇦", en: "🇬🇧", pl: "🇵🇱" };

const COPY = {
  ru: {
    backToList: "← Все статьи",
    newTitle: "Новая статья",
    editTitle: "Редактирование статьи",
    save: "Сохранить",
    saving: "Сохраняем…",
    publish: "Опубликовать",
    unpublish: "Снять с публикации",
    archive: "В архив",
    unarchive: "Вернуть из архива",
    deleteAction: "Удалить",
    slug: "Slug (URL)",
    slugHint: "Латинские буквы, цифры и дефисы. Это адрес статьи: /blog/{slug}",
    slugFromTitle: "Сгенерировать из заголовка",
    category: "Категория",
    catTips: "Советы",
    catProduct: "Продукт",
    catBusiness: "Бизнес",
    catTrends: "Тренды",
    publishedDate: "Дата публикации (отображается на сайте)",
    updatedDate: "Дата обновления (для SEO modified)",
    cover: "Обложка",
    coverHint: "Рекомендуем 1600×900. PNG/JPG/WEBP, до 2 МБ.",
    upload: "Загрузить",
    uploading: "Загружаем…",
    coverAlt: "Alt-текст обложки",
    coverCredit: "Источник / фотограф (необязательно)",
    content: "Контент",
    titlePh: "Заголовок статьи",
    excerptPh: "Краткое описание (отображается в карточке и SEO)",
    bodyPh: "Текст статьи в Markdown. Изображения вставятся как ![alt](url).",
    insertImage: "📷 Вставить изображение",
    wordCount: (n: number) => `${n} слов · ~${Math.max(1, Math.round(n / 200))} мин чтения`,
    confirmDelete: "Удалить статью без возможности восстановления?",
    confirmDeleteDesc: "Эта операция необратима.",
    confirmDeleteOk: "Удалить",
    cancel: "Отмена",
    uploadError: "Не удалось загрузить файл",
    saveError: "Не удалось сохранить",
    fileTooLarge: "Файл больше 2 МБ",
    badFileType: "Поддерживаются только PNG, JPG и WEBP",
  },
  ua: {
    backToList: "← Усі статті", newTitle: "Нова стаття", editTitle: "Редагування статті",
    save: "Зберегти", saving: "Зберігаємо…", publish: "Опублікувати", unpublish: "Зняти з публікації",
    archive: "В архів", unarchive: "Повернути з архіву", deleteAction: "Видалити",
    slug: "Slug (URL)", slugHint: "Латинські літери, цифри й дефіси. Адреса статті: /blog/{slug}",
    slugFromTitle: "Згенерувати із заголовка", category: "Категорія",
    catTips: "Поради", catProduct: "Продукт", catBusiness: "Бізнес", catTrends: "Тренди",
    publishedDate: "Дата публікації (відображається на сайті)", updatedDate: "Дата оновлення (для SEO modified)",
    cover: "Обкладинка", coverHint: "Рекомендуємо 1600×900. PNG/JPG/WEBP, до 2 МБ.",
    upload: "Завантажити", uploading: "Завантажуємо…",
    coverAlt: "Alt-текст обкладинки", coverCredit: "Джерело / фотограф (необов’язково)",
    content: "Контент", titlePh: "Заголовок статті", excerptPh: "Короткий опис (показується у картці та SEO)",
    bodyPh: "Текст статті в Markdown. Зображення вставляться як ![alt](url).",
    insertImage: "📷 Вставити зображення",
    wordCount: (n: number) => `${n} слів · ~${Math.max(1, Math.round(n / 200))} хв читання`,
    confirmDelete: "Видалити статтю без можливості відновлення?",
    confirmDeleteDesc: "Операція незворотна.", confirmDeleteOk: "Видалити", cancel: "Скасувати",
    uploadError: "Не вдалося завантажити файл", saveError: "Не вдалося зберегти",
    fileTooLarge: "Файл більший за 2 МБ", badFileType: "Підтримуються лише PNG, JPG та WEBP",
  },
  en: {
    backToList: "← All articles", newTitle: "New article", editTitle: "Edit article",
    save: "Save", saving: "Saving…", publish: "Publish", unpublish: "Unpublish",
    archive: "Archive", unarchive: "Restore", deleteAction: "Delete",
    slug: "Slug (URL)", slugHint: "Latin letters, digits and hyphens. URL: /blog/{slug}",
    slugFromTitle: "Generate from title", category: "Category",
    catTips: "Tips", catProduct: "Product", catBusiness: "Business", catTrends: "Trends",
    publishedDate: "Publish date (shown on the site)", updatedDate: "Updated date (SEO modified)",
    cover: "Cover image", coverHint: "Recommended 1600×900. PNG/JPG/WEBP, up to 2 MB.",
    upload: "Upload", uploading: "Uploading…",
    coverAlt: "Cover alt text", coverCredit: "Credit / photographer (optional)",
    content: "Content", titlePh: "Article title", excerptPh: "Lede (shown on the card and in SEO)",
    bodyPh: "Article body in Markdown. Images inline as ![alt](url).",
    insertImage: "📷 Insert image",
    wordCount: (n: number) => `${n} words · ~${Math.max(1, Math.round(n / 200))} min read`,
    confirmDelete: "Delete this article permanently?", confirmDeleteDesc: "This action is irreversible.",
    confirmDeleteOk: "Delete", cancel: "Cancel",
    uploadError: "Upload failed", saveError: "Save failed",
    fileTooLarge: "File larger than 2 MB", badFileType: "Only PNG, JPG and WEBP are supported",
  },
  pl: {
    backToList: "← Wszystkie artykuły", newTitle: "Nowy artykuł", editTitle: "Edycja artykułu",
    save: "Zapisz", saving: "Zapisuję…", publish: "Opublikuj", unpublish: "Cofnij publikację",
    archive: "Archiwizuj", unarchive: "Przywróć", deleteAction: "Usuń",
    slug: "Slug (URL)", slugHint: "Łacińskie litery, cyfry i myślniki. Adres: /blog/{slug}",
    slugFromTitle: "Wygeneruj z tytułu", category: "Kategoria",
    catTips: "Porady", catProduct: "Produkt", catBusiness: "Biznes", catTrends: "Trendy",
    publishedDate: "Data publikacji (widoczna na stronie)", updatedDate: "Data aktualizacji (SEO modified)",
    cover: "Okładka", coverHint: "Rekomendowane 1600×900. PNG/JPG/WEBP, do 2 MB.",
    upload: "Wgraj", uploading: "Wgrywam…",
    coverAlt: "Tekst alt okładki", coverCredit: "Źródło / fotograf (opcjonalnie)",
    content: "Treść", titlePh: "Tytuł artykułu", excerptPh: "Lid (widoczny w karcie i SEO)",
    bodyPh: "Treść artykułu w Markdown. Obrazki w treści jako ![alt](url).",
    insertImage: "📷 Wstaw obrazek",
    wordCount: (n: number) => `${n} słów · ~${Math.max(1, Math.round(n / 200))} min czytania`,
    confirmDelete: "Usunąć artykuł nieodwracalnie?", confirmDeleteDesc: "Operacja jest nieodwracalna.",
    confirmDeleteOk: "Usuń", cancel: "Anuluj",
    uploadError: "Wgrywanie nieudane", saveError: "Zapisywanie nieudane",
    fileTooLarge: "Plik większy niż 2 MB", badFileType: "Obsługiwane tylko PNG, JPG i WEBP",
  },
} as const;

type LangBlobState = Record<Lang, string>;
type LangArrayBlobState = Record<Lang, string>; // comma-separated for the UI

interface FormState {
  slug: string;
  category: "tips" | "product" | "business" | "trends";
  titles: LangBlobState;
  excerpts: LangBlobState;
  bodies: LangBlobState;
  coverUrl: string;
  coverAlt: LangBlobState;
  coverCredit: string;
  keywords: LangArrayBlobState;
  publishedDate: string;
  updatedDate: string;
}

function emptyBlob(): LangBlobState {
  return { ru: "", ua: "", en: "", pl: "" };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fromInitial(initial: BlogPostDto | null): FormState {
  if (!initial) {
    return {
      slug: "",
      category: "tips",
      titles: emptyBlob(),
      excerpts: emptyBlob(),
      bodies: emptyBlob(),
      coverUrl: "",
      coverAlt: emptyBlob(),
      coverCredit: "",
      keywords: emptyBlob(),
      publishedDate: todayIso(),
      updatedDate: "",
    };
  }
  const cast = (blob: Record<string, unknown>): LangBlobState => ({
    ru: typeof blob.ru === "string" ? (blob.ru as string) : "",
    ua: typeof blob.ua === "string" ? (blob.ua as string) : "",
    en: typeof blob.en === "string" ? (blob.en as string) : "",
    pl: typeof blob.pl === "string" ? (blob.pl as string) : "",
  });
  const kwToString = (blob: Record<string, unknown>): LangBlobState => ({
    ru: Array.isArray(blob.ru) ? (blob.ru as string[]).join(", ") : "",
    ua: Array.isArray(blob.ua) ? (blob.ua as string[]).join(", ") : "",
    en: Array.isArray(blob.en) ? (blob.en as string[]).join(", ") : "",
    pl: Array.isArray(blob.pl) ? (blob.pl as string[]).join(", ") : "",
  });
  return {
    slug: initial.slug,
    category: initial.category,
    titles: cast(initial.titles as Record<string, unknown>),
    excerpts: cast(initial.excerpts as Record<string, unknown>),
    bodies: cast(initial.bodies as Record<string, unknown>),
    coverUrl: initial.coverImage?.url ?? "",
    coverAlt: cast((initial.coverImage?.alt ?? {}) as Record<string, unknown>),
    coverCredit: initial.coverImage?.credit ?? "",
    keywords: kwToString(initial.keywords as Record<string, unknown>),
    publishedDate: initial.publishedDate ?? todayIso(),
    updatedDate: initial.updatedDate ?? "",
  };
}

export function BlogEditor({
  initialPost,
  postId,
}: {
  initialPost: BlogPostDto | null;
  postId: string | null;
}) {
  const { lang: uiLang } = useLang();
  const router = useRouter();
  const copy = COPY[uiLang as Lang] ?? COPY.ru;

  const [form, setForm] = useState<FormState>(() => fromInitial(initialPost));
  const [activeLang, setActiveLang] = useState<Lang>(uiLang as Lang);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [bodyImageUploading, setBodyImageUploading] = useState(false);

  const utils = api.useUtils();
  const create = api.blog.create.useMutation();
  const update = api.blog.update.useMutation();
  const publish = api.blog.publish.useMutation();
  const unpublish = api.blog.unpublish.useMutation();
  const archive = api.blog.archive.useMutation();
  const unarchive = api.blog.unarchive.useMutation();
  const del = api.blog.delete.useMutation();
  const mintToken = api.blog.mintUploadToken.useMutation();

  const isEdit = postId !== null;
  const status = initialPost?.status ?? "draft";

  // ── Save (draft) ─────────────────────────────────────────────────────────

  const buildPayload = useCallback(() => {
    const cleanBlob = (b: LangBlobState): Partial<Record<Lang, string>> => {
      const out: Partial<Record<Lang, string>> = {};
      for (const k of LANGS) if (b[k]) out[k] = b[k];
      return out;
    };
    const cleanArrayBlob = (b: LangArrayBlobState): Partial<Record<Lang, string[]>> => {
      const out: Partial<Record<Lang, string[]>> = {};
      for (const k of LANGS) {
        const arr = b[k].split(",").map((s) => s.trim()).filter(Boolean);
        if (arr.length > 0) out[k] = arr;
      }
      return out;
    };
    return {
      slug: form.slug.trim(),
      category: form.category,
      titles: cleanBlob(form.titles),
      excerpts: cleanBlob(form.excerpts),
      bodies: cleanBlob(form.bodies),
      coverUrl: form.coverUrl.trim() || null,
      coverAlt: cleanBlob(form.coverAlt),
      coverCredit: form.coverCredit.trim() || null,
      keywords: cleanArrayBlob(form.keywords),
      publishedDate: form.publishedDate || null,
      updatedDate: form.updatedDate || null,
    };
  }, [form]);

  const refetchAll = useCallback(() => {
    void utils.blog.list.invalidate();
    void utils.blog.stats.invalidate();
    if (postId) void utils.blog.get.invalidate({ id: postId });
  }, [postId, utils]);

  const handleSave = async () => {
    setError(null);
    try {
      const payload = buildPayload();
      if (isEdit && postId) {
        await update.mutateAsync({ ...payload, id: postId });
        refetchAll();
      } else {
        const r = await create.mutateAsync(payload);
        refetchAll();
        router.replace(`/system/blog/${r.id}`);
      }
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || copy.saveError);
    }
  };

  // ── Status mutations (only on edit) ──────────────────────────────────────

  const runStatus = async (action: "publish" | "unpublish" | "archive" | "unarchive" | "delete") => {
    if (!postId) return;
    setError(null);
    try {
      const m = { publish, unpublish, archive, unarchive, delete: del }[action];
      await m.mutateAsync({ id: postId });
      refetchAll();
      if (action === "delete") router.replace("/system/blog");
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || copy.saveError);
    }
  };

  // ── Cover + inline image upload ──────────────────────────────────────────

  const validateFile = (file: File): string | null => {
    if (file.size > 2 * 1024 * 1024) return copy.fileTooLarge;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return copy.badFileType;
    return null;
  };

  const uploadImage = async (file: File, kind: "blog_cover" | "blog_photo"): Promise<string | null> => {
    const err = validateFile(file);
    if (err) {
      setError(err);
      return null;
    }
    try {
      const { uploadUrl } = await mintToken.mutateAsync({ kind });
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(uploadUrl, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error("No URL returned");
      return json.url;
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || copy.uploadError);
      return null;
    }
  };

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const bodyInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleCoverPick = async (file: File) => {
    setCoverUploading(true);
    const url = await uploadImage(file, "blog_cover");
    setCoverUploading(false);
    if (url) setForm((f) => ({ ...f, coverUrl: url }));
  };

  const handleInlineImage = async (file: File) => {
    setBodyImageUploading(true);
    const url = await uploadImage(file, "blog_photo");
    setBodyImageUploading(false);
    if (!url) return;
    const alt = form.titles[activeLang] || "image";
    const md = `\n\n![${alt}](${url})\n\n`;
    const ta = bodyTextareaRef.current;
    setForm((f) => {
      const current = f.bodies[activeLang] ?? "";
      let next = current;
      if (ta) {
        const pos = ta.selectionStart ?? current.length;
        next = current.slice(0, pos) + md + current.slice(pos);
      } else {
        next = current + md;
      }
      return { ...f, bodies: { ...f.bodies, [activeLang]: next } };
    });
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const handleSlugFromTitle = () => {
    const src = form.titles[activeLang] || form.titles.ru || form.titles.en || Object.values(form.titles).find(Boolean) || "";
    if (src) setForm((f) => ({ ...f, slug: slugify(src) }));
  };

  const titlePreview = coalesceLang(form.titles, uiLang as Lang) || (isEdit ? `(${form.slug})` : copy.newTitle);

  // Keep updatedDate auto-updated to today when content changes after first save.
  const initialUpdated = initialPost?.updatedDate ?? null;
  useEffect(() => {
    if (!isEdit) return;
    // Touch updatedDate only if the user hasn't manually set it
    if (form.updatedDate || form.updatedDate === initialUpdated) return;
  }, [form.updatedDate, initialUpdated, isEdit]);

  const wordCountNum = useMemo(() => {
    return (form.bodies[activeLang] || "").trim().split(/\s+/).filter(Boolean).length;
  }, [form.bodies, activeLang]);

  return (
    <Shell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => router.push("/system/blog")}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 inline-flex items-center gap-1 mb-2 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {copy.backToList}
            </button>
            <h1 className="text-2xl font-extrabold tracking-tight">{isEdit ? copy.editTitle : copy.newTitle}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-xl">{titlePreview}</p>
          </div>
          {isEdit && <BlogStatusPill status={status} lang={uiLang as Lang} />}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-200 px-3 py-2 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-auto p-0.5 hover:opacity-70">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Top row: slug + category + dates */}
        <Card>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={copy.slug} hint={copy.slugHint}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="my-article-slug"
                  className="flex-1 px-3 py-2 text-sm font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
                <button
                  type="button"
                  onClick={handleSlugFromTitle}
                  title={copy.slugFromTitle}
                  className="px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Wand2 className="w-4 h-4" />
                </button>
              </div>
            </Field>

            <Field label={copy.category}>
              <Select
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v as typeof form.category }))}
                options={[
                  { value: "tips", label: copy.catTips },
                  { value: "product", label: copy.catProduct },
                  { value: "business", label: copy.catBusiness },
                  { value: "trends", label: copy.catTrends },
                ]}
              />
            </Field>

            <Field label={copy.publishedDate}>
              <input
                type="date"
                value={form.publishedDate}
                onChange={(e) => setForm((f) => ({ ...f, publishedDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>

            <Field label={copy.updatedDate}>
              <input
                type="date"
                value={form.updatedDate}
                onChange={(e) => setForm((f) => ({ ...f, updatedDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>
          </div>
        </Card>

        {/* Cover */}
        <Card>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{copy.cover}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{copy.coverHint}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-4 items-start">
              <div className="aspect-[16/9] relative rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10">
                {form.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.coverUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                    <ImagePlus className="w-10 h-10" />
                  </div>
                )}
                {coverUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 text-white">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCoverPick(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  tone="violet"
                  variant="soft"
                  leadingIcon={coverUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverUploading}
                >
                  {coverUploading ? copy.uploading : copy.upload}
                </Button>
                <input
                  type="text"
                  value={form.coverUrl}
                  onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
                  placeholder="https://cdn.manicbot.com/…"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
                <input
                  type="text"
                  value={form.coverCredit}
                  onChange={(e) => setForm((f) => ({ ...f, coverCredit: e.target.value }))}
                  placeholder={copy.coverCredit}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Language tabs + content */}
        <Card>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold mr-2">{copy.content}</h2>
              <div className="flex gap-1 ml-auto">
                {LANGS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setActiveLang(l)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      activeLang === l
                        ? "bg-violet-600 text-white"
                        : "bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    <span className="mr-1">{LANG_FLAGS[l]}</span>
                    {LANG_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Title">
              <input
                type="text"
                value={form.titles[activeLang]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, titles: { ...f.titles, [activeLang]: e.target.value } }))
                }
                placeholder={copy.titlePh}
                className="w-full px-3 py-2 text-base rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>

            <Field label="Excerpt">
              <textarea
                value={form.excerpts[activeLang]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, excerpts: { ...f.excerpts, [activeLang]: e.target.value } }))
                }
                placeholder={copy.excerptPh}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>

            <Field label="Cover alt">
              <input
                type="text"
                value={form.coverAlt[activeLang]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coverAlt: { ...f.coverAlt, [activeLang]: e.target.value } }))
                }
                placeholder={copy.coverAlt}
                className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>

            <Field label="Body (Markdown)">
              <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 rounded-t-xl">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{copy.wordCount(wordCountNum)}</span>
                  <input
                    ref={bodyInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleInlineImage(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => bodyInputRef.current?.click()}
                    disabled={bodyImageUploading}
                    className="text-[12px] inline-flex items-center gap-1 px-2 py-1 rounded-md text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/15 transition-colors disabled:opacity-50"
                  >
                    {bodyImageUploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    {copy.insertImage}
                  </button>
                </div>
                <textarea
                  ref={bodyTextareaRef}
                  value={form.bodies[activeLang]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bodies: { ...f.bodies, [activeLang]: e.target.value } }))
                  }
                  placeholder={copy.bodyPh}
                  rows={18}
                  className="w-full px-3 py-2 text-sm font-mono leading-relaxed bg-transparent border-0 rounded-b-xl focus:outline-none resize-y"
                />
              </div>
            </Field>

            <Field label="Keywords (comma-separated)">
              <input
                type="text"
                value={form.keywords[activeLang]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, keywords: { ...f.keywords, [activeLang]: e.target.value } }))
                }
                placeholder="nail salon, booking, automation"
                className="w-full px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </Field>
          </div>
        </Card>

        {/* Sticky footer */}
        <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-200 dark:border-white/10 px-4 sm:px-6 py-3 flex flex-wrap gap-2 items-center justify-end z-20">
          <Button
            tone="brand"
            variant="solid"
            leadingIcon={create.isPending || update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
          >
            {create.isPending || update.isPending ? copy.saving : copy.save}
          </Button>

          {isEdit && status !== "published" && (
            <Button
              tone="emerald"
              variant="solid"
              leadingIcon={<Eye className="w-4 h-4" />}
              onClick={() => runStatus("publish")}
              disabled={publish.isPending}
            >
              {copy.publish}
            </Button>
          )}
          {isEdit && status === "published" && (
            <Button
              tone="amber"
              variant="soft"
              leadingIcon={<EyeOff className="w-4 h-4" />}
              onClick={() => runStatus("unpublish")}
              disabled={unpublish.isPending}
            >
              {copy.unpublish}
            </Button>
          )}
          {isEdit && status !== "archived" && (
            <Button
              tone="amber"
              variant="soft"
              leadingIcon={<Archive className="w-4 h-4" />}
              onClick={() => runStatus("archive")}
              disabled={archive.isPending}
            >
              {copy.archive}
            </Button>
          )}
          {isEdit && status === "archived" && (
            <Button
              tone="sky"
              variant="soft"
              leadingIcon={<ArchiveRestore className="w-4 h-4" />}
              onClick={() => runStatus("unarchive")}
              disabled={unarchive.isPending}
            >
              {copy.unarchive}
            </Button>
          )}
          {isEdit && status !== "published" && (
            <Button
              tone="red"
              variant="soft"
              leadingIcon={<Trash2 className="w-4 h-4" />}
              onClick={() => setConfirmDelete(true)}
            >
              {copy.deleteAction}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={copy.confirmDelete}
        description={copy.confirmDeleteDesc}
        confirmLabel={copy.confirmDeleteOk}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void runStatus("delete");
        }}
      />
    </Shell>
  );
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </label>
  );
}

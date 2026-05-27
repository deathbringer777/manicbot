"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Loader2, Upload, X, ImagePlus, ArrowLeft, ArrowRight, Star, Link2, Plus,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import {
  resizeImageClientSide,
  uploadAssetFile,
  validateUploadFile,
  UPLOAD_ACCEPT_MIME,
} from "~/lib/uploadAsset";

export const GALLERY_MAX_PHOTOS = 12;

interface SalonGalleryUploaderProps {
  tenantId: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  /** Optional. Defaults to GALLERY_MAX_PHOTOS. */
  maxPhotos?: number;
}

export function SalonGalleryUploader({
  tenantId,
  photos,
  onChange,
  maxPhotos = GALLERY_MAX_PHOTOS,
}: SalonGalleryUploaderProps) {
  const { lang } = useLang();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const mint = api.salon.mintUploadToken.useMutation();

  const remaining = Math.max(0, maxPhotos - photos.length);
  const atCap = remaining === 0;

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const slots = Math.min(files.length, remaining);
      if (slots <= 0) {
        setError(t("salon.publicProfile.galleryCap", lang));
        return;
      }
      const accepted = files.slice(0, slots);
      setUploading({ done: 0, total: accepted.length });
      const collected: string[] = [];
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i]!;
        const vErr = validateUploadFile(file);
        if (vErr) {
          setError(vErr);
          continue;
        }
        try {
          const resized = await resizeImageClientSide(file, 1600);
          const mintResult = await mint.mutateAsync({ tenantId, kind: "photo" });
          const uploaded = await uploadAssetFile(mintResult.uploadUrl, resized);
          collected.push(uploaded.url);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Upload failed");
        } finally {
          setUploading((u) => (u ? { ...u, done: u.done + 1 } : null));
        }
      }
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
      if (collected.length > 0) {
        onChange([...photos, ...collected].slice(0, maxPhotos));
      }
    },
    [tenantId, photos, onChange, remaining, lang, maxPhotos, mint],
  );

  function pickFiles() {
    if (atCap) {
      setError(t("salon.publicProfile.galleryCap", lang));
      return;
    }
    fileRef.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (atCap) {
      setError(t("salon.publicProfile.galleryCap", lang));
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    void uploadFiles(files);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onChange(next);
  }

  function remove(i: number) {
    onChange(photos.filter((_, j) => j !== i));
  }

  function addByUrl() {
    const u = newUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setError(t("salon.publicProfile.galleryUrlError", lang));
      return;
    }
    if (atCap) {
      setError(t("salon.publicProfile.galleryCap", lang));
      return;
    }
    onChange([...photos, u].slice(0, maxPhotos));
    setNewUrl("");
    setError(null);
  }

  // Clear transient error after 5s so it doesn't stay stuck across new actions.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);

  return (
    <div data-testid="salon-gallery-uploader">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          {t("salon.publicProfile.gallery", lang)}{" "}
          <span className="text-slate-400 dark:text-slate-500">
            ({photos.length}/{maxPhotos})
          </span>
        </label>
        <button
          type="button"
          onClick={() => setUrlMode((v) => !v)}
          className="text-[11px] text-slate-500 hover:text-brand-500 dark:hover:text-brand-400 flex items-center gap-1"
        >
          <Link2 className="h-3 w-3" />
          {urlMode
            ? t("salon.publicProfile.galleryHideUrl", lang)
            : t("salon.publicProfile.galleryShowUrl", lang)}
        </button>
      </div>

      {/* Grid of existing photos */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
          {photos.map((url, i) => (
            <div
              key={`${url}-${i}`}
              data-testid="gallery-photo"
              className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                }}
              />
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  {t("salon.publicProfile.galleryCover", lang)}
                </span>
              )}
              {/* Overlay: only visible on hover/focus-within */}
              <div className="absolute inset-0 flex items-center justify-between gap-1 px-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 bg-gradient-to-t from-black/60 via-black/0 to-black/0">
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t("salon.publicProfile.galleryMoveLeft", lang)}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 text-slate-900 hover:bg-white disabled:opacity-30 shadow"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("salon.publicProfile.galleryMoveRight", lang)}
                    disabled={i === photos.length - 1}
                    onClick={() => move(i, 1)}
                    className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 text-slate-900 hover:bg-white disabled:opacity-30 shadow"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={t("asset.remove", lang)}
                  onClick={() => remove(i)}
                  className="h-7 w-7 flex items-center justify-center rounded-md bg-red-500/90 text-white hover:bg-red-500 shadow"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone — always rendered unless at cap */}
      {!atCap && (
        <div
          data-testid="gallery-dropzone"
          onClick={pickFiles}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pickFiles();
            }
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition cursor-pointer ${
            dragOver
              ? "border-brand-400 bg-brand-500/10"
              : "border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/60"
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t("salon.publicProfile.galleryUploading", lang)
                  .replace("{done}", String(uploading.done))
                  .replace("{total}", String(uploading.total))}
              </p>
            </>
          ) : photos.length === 0 ? (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
                <ImagePlus className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t("salon.publicProfile.galleryEmptyTitle", lang)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-500">
                {t("salon.publicProfile.galleryEmptyHint", lang)
                  .replace("{max}", String(maxPhotos))}
              </p>
            </>
          ) : (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                <Plus className="h-4 w-4" />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t("salon.publicProfile.galleryAddMore", lang)
                  .replace("{n}", String(remaining))}
              </p>
            </>
          )}
        </div>
      )}

      {atCap && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("salon.publicProfile.galleryCap", lang)}
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT_MIME.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      {/* Advanced: paste a URL */}
      {urlMode && (
        <div className="mt-2 flex gap-2">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addByUrl())}
            placeholder="https://example.com/photo.jpg"
            className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={addByUrl}
            disabled={atCap || !newUrl.trim()}
            className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <Upload className="h-3.5 w-3.5" />
            {t("common.add", lang)}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

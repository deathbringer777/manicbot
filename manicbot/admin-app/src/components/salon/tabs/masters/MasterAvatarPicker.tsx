"use client";

/**
 * MasterAvatarPicker — modal opened by clicking a master's avatar circle
 * in MasterDetailModal.
 *
 * Two tabs:
 *   * "Эмодзи" (default) — grid of {@link MASTER_AVATAR_EMOJIS}.
 *   * "Фото"             — file upload, square-center-cropped to 512×512 WebP.
 *
 * Saves via `api.salon.updateMasterAvatar` (no origin gating — the avatar
 * is the salon's visual label for the master, same as `publicHidden`).
 *
 * Stacking: sits at z-[110] over the parent MasterDetailModal (z-[100]).
 */

import { useRef, useState } from "react";
import { Loader2, Smile, Image as ImageIcon, Upload, Trash2, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import {
  MASTER_AVATAR_EMOJIS,
  DEFAULT_MASTER_EMOJI,
  resolveMasterAvatarEmoji,
} from "~/lib/masterAvatar";
import {
  uploadAssetFile,
  validateUploadFile,
  resizeImageClientSide,
  UPLOAD_ACCEPT_MIME,
} from "~/lib/uploadAsset";
import { AvatarCropper } from "~/components/ui/AvatarCropper";

interface Props {
  tenantId: string;
  chatId: number;
  currentEmoji: string | null;
  currentUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MasterAvatarPicker({
  tenantId,
  chatId,
  currentEmoji,
  currentUrl,
  onClose,
  onSaved,
}: Props) {
  const { lang } = useLang();
  const [tab, setTab] = useState<"emoji" | "photo">("emoji");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mintToken = api.salon.mintUploadToken.useMutation();
  const updateAvatar = api.salon.updateMasterAvatar.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => {
      setError(e.message);
      setBusy(false);
    },
  });

  function pickEmoji(emoji: string) {
    setError(null);
    setBusy(true);
    updateAvatar.mutate({ tenantId, chatId, avatarEmoji: emoji, avatarUrl: null });
  }

  function clearAll() {
    setError(null);
    setBusy(true);
    updateAvatar.mutate({ tenantId, chatId, avatarEmoji: null, avatarUrl: null });
  }

  async function handleFile(file: File) {
    setError(null);
    // Phone photos are often 5–12 MB and would trip the 2 MB guard before the
    // cropper ever opened. Downscale on-device first (the avatar is cropped to
    // 512px anyway), then validate the prepared file.
    const prepared = await resizeImageClientSide(file, 1280);
    const v = validateUploadFile(prepared);
    if (v) { setError(v); return; }
    setPendingFile(prepared); // Cropper takes over from here.
  }

  async function handleCropped(cropped: File) {
    setPendingFile(null);
    setBusy(true);
    try {
      const { uploadUrl } = await mintToken.mutateAsync({ tenantId, kind: "master_avatar" });
      const uploaded = await uploadAssetFile(uploadUrl, cropped);
      updateAvatar.mutate({ tenantId, chatId, avatarUrl: uploaded.url, avatarEmoji: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }

  const previewEmoji = resolveMasterAvatarEmoji(currentEmoji);
  const hasPhoto = !!currentUrl;
  const hasCustomEmoji = !!currentEmoji && currentEmoji !== DEFAULT_MASTER_EMOJI;
  const canClear = hasPhoto || hasCustomEmoji;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={(e) => { e.stopPropagation(); if (!busy) onClose(); }}
      data-testid="master-avatar-picker-overlay"
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t("master.avatar.title", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-white/5 dark:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500/15 to-brand-500/15 text-4xl ring-1 ring-purple-500/20">
            {hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl!} alt="" className="h-full w-full object-cover" />
            ) : (
              <span data-testid="master-avatar-picker-current-emoji">{previewEmoji}</span>
            )}
          </div>
        </div>

        <div className="mb-4 flex gap-1.5">
          <button
            type="button"
            onClick={() => setTab("emoji")}
            data-testid="master-avatar-tab-emoji"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              tab === "emoji"
                ? "border border-brand-500/30 bg-brand-500/20 text-brand-400"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            <Smile className="h-3.5 w-3.5" />
            {t("master.avatar.tabEmoji", lang)}
          </button>
          <button
            type="button"
            onClick={() => setTab("photo")}
            data-testid="master-avatar-tab-photo"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              tab === "photo"
                ? "border border-brand-500/30 bg-brand-500/20 text-brand-400"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t("master.avatar.tabPhoto", lang)}
          </button>
        </div>

        {tab === "emoji" && (
          <div className="grid grid-cols-8 gap-1">
            {MASTER_AVATAR_EMOJIS.map((e) => {
              const selected = e === (currentEmoji ?? DEFAULT_MASTER_EMOJI) && !hasPhoto;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => pickEmoji(e)}
                  disabled={busy}
                  data-testid={`master-avatar-emoji-${e}`}
                  className={`flex h-10 items-center justify-center rounded-lg text-xl transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/10 ${
                    selected ? "bg-brand-500/15 ring-1 ring-brand-500/40" : ""
                  }`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        )}

        {tab === "photo" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              data-testid="master-avatar-upload-btn"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {hasPhoto
                ? t("master.avatar.replacePhoto", lang)
                : t("master.avatar.uploadPhoto", lang)}
            </button>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("master.avatar.photoHint", lang)}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT_MIME.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {canClear && (
          <button
            type="button"
            onClick={clearAll}
            disabled={busy}
            data-testid="master-avatar-clear-btn"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("master.avatar.resetDefault", lang)}
          </button>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </div>

      {pendingFile && (
        <AvatarCropper
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onCropped={handleCropped}
        />
      )}
    </div>
  );
}

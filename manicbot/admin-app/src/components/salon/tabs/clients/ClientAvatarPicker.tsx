"use client";

/**
 * ClientAvatarPicker — modal opened by clicking a client's avatar circle.
 *
 * Two tabs:
 *   * "Эмодзи" (default)  — grid of {@link CLIENT_AVATAR_EMOJIS}, click to
 *                            apply. Tap the current selection again to clear
 *                            back to the default ({@link DEFAULT_CLIENT_EMOJI}).
 *   * "Фото"              — file upload. We square-center-crop on the
 *                            client before sending so the saved image fits
 *                            the circular avatar without zoom artefacts.
 *
 * Nested over ClientDetailModal / ClientFormModal — those use z-[100] for
 * the overlay, so the picker uses z-[110] and stops the overlay click from
 * bubbling up to the parent modal's close handler.
 *
 * Saves via `api.clients.update` (router PR companion). The parent passes
 * the current `chatId` + `tenantId`; this component is fire-and-forget
 * once the user picks — the parent invalidates its own queries via the
 * tRPC utils proxy on `onSaved`.
 */

import { useRef, useState } from "react";
import { Loader2, Smile, Image as ImageIcon, Upload, Trash2, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import {
  CLIENT_AVATAR_EMOJIS,
  DEFAULT_CLIENT_EMOJI,
  resolveAvatarEmoji,
} from "~/lib/clientAvatar";
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
  /** Current emoji on the client row, or null when never customised. */
  currentEmoji: string | null;
  /** Current uploaded photo URL on the client row, or null. */
  currentUrl: string | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refetch. */
  onSaved: () => void;
}

export function ClientAvatarPicker({
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
  const update = api.clients.update.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => {
      setError(e.message);
      setBusy(false);
    },
  });

  async function pickEmoji(emoji: string) {
    setError(null);
    setBusy(true);
    // Picking any emoji always clears the photo. The mental model is
    // "avatar = either an emoji or a photo, never both".
    update.mutate({
      tenantId,
      chatId,
      patch: { avatarEmoji: emoji, avatarUrl: null },
    });
  }

  async function clearAll() {
    setError(null);
    setBusy(true);
    update.mutate({
      tenantId,
      chatId,
      patch: { avatarEmoji: null, avatarUrl: null },
    });
  }

  async function handleFile(file: File) {
    setError(null);
    // Phone photos are often 5–12 MB and would trip the 2 MB guard before the
    // cropper ever opened. Downscale on-device first (the avatar is cropped to
    // 512px anyway), then validate the prepared file.
    const prepared = await resizeImageClientSide(file, 1280);
    const v = validateUploadFile(prepared);
    if (v) {
      setError(v);
      return;
    }
    setPendingFile(prepared); // Cropper takes over from here.
  }

  async function handleCropped(cropped: File) {
    setPendingFile(null);
    setBusy(true);
    try {
      const { uploadUrl } = await mintToken.mutateAsync({ tenantId, kind: "client_avatar" });
      const uploaded = await uploadAssetFile(uploadUrl, cropped);
      // Picking a photo always clears the emoji — see same rule above.
      update.mutate({
        tenantId,
        chatId,
        patch: { avatarUrl: uploaded.url, avatarEmoji: null },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }

  const previewEmoji = resolveAvatarEmoji(currentEmoji);
  const hasPhoto = !!currentUrl;
  const hasCustomEmoji = !!currentEmoji && currentEmoji !== DEFAULT_CLIENT_EMOJI;
  const canClear = hasPhoto || hasCustomEmoji;

  return (
    <div
      // z-[110] sits above the parent modal's z-[100] overlay, and the
      // overlay onClick is *not* propagated so it never reaches the parent.
      className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
      data-testid="avatar-picker-overlay"
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t("clients.avatar.title", lang)}
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

        {/* Big circular preview at the top so the operator sees what's
            saved right now without having to scroll. */}
        <div className="mb-4 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500/15 to-violet-500/15 text-4xl ring-1 ring-brand-500/20">
            {hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span data-testid="avatar-picker-current-emoji">{previewEmoji}</span>
            )}
          </div>
        </div>

        {/* Tab pills */}
        <div className="mb-4 flex gap-1.5">
          <button
            type="button"
            onClick={() => setTab("emoji")}
            data-testid="avatar-tab-emoji"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              tab === "emoji"
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            <Smile className="h-3.5 w-3.5" />
            {t("clients.avatar.tabEmoji", lang)}
          </button>
          <button
            type="button"
            onClick={() => setTab("photo")}
            data-testid="avatar-tab-photo"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              tab === "photo"
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t("clients.avatar.tabPhoto", lang)}
          </button>
        </div>

        {tab === "emoji" && (
          <div className="grid grid-cols-8 gap-1">
            {CLIENT_AVATAR_EMOJIS.map((e) => {
              const selected = e === (currentEmoji ?? DEFAULT_CLIENT_EMOJI) && !hasPhoto;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => pickEmoji(e)}
                  disabled={busy}
                  data-testid={`avatar-emoji-${e}`}
                  className={`flex h-10 items-center justify-center rounded-lg text-xl transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/10 ${
                    selected
                      ? "bg-brand-500/15 ring-1 ring-brand-500/40"
                      : ""
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
              data-testid="avatar-upload-btn"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {hasPhoto
                ? t("clients.avatar.replacePhoto", lang)
                : t("clients.avatar.uploadPhoto", lang)}
            </button>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("clients.avatar.photoHint", lang)}
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
            data-testid="avatar-clear-btn"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("clients.avatar.resetDefault", lang)}
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

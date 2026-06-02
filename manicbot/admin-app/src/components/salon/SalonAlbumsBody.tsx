"use client";

import { useState } from "react";
import { Save, Loader2, FolderPlus, Trash2, Pencil } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import { SalonGalleryUploader } from "~/components/salon/SalonGalleryUploader";

/**
 * Body of the "Альбомы" chip — gallery folders. Lists albums, lets the owner
 * create/rename/delete them, and manage each album's photos with the same
 * drag-reorder `SalonGalleryUploader` the flat gallery uses. Persists via the
 * `salon.{listAlbums,createAlbum,renameAlbum,deleteAlbum,setAlbumPhotos}`
 * procedures. The flat `tenants.photos` gallery stays as the implicit "All"
 * album on the public page — this only manages the named folders.
 */

interface AlbumPhoto { url: string; r2Key: string | null; caption: string | null }
interface Album { id: string; name: string; coverUrl: string | null; sortOrder: number; photos: AlbumPhoto[] }

function AlbumEditor({ tenantId, album, onChanged }: { tenantId: string; album: Album; onChanged: () => void }) {
  const { lang } = useLang();
  const [photos, setPhotos] = useState<string[]>(album.photos.map((p) => p.url));

  const save = api.salon.setAlbumPhotos.useMutation({
    onSuccess: () => { toast.success(t("common.saved", lang)); onChanged(); },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });
  const rename = api.salon.renameAlbum.useMutation({
    onSuccess: () => { toast.success(t("common.saved", lang)); onChanged(); },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });
  const del = api.salon.deleteAlbum.useMutation({
    onSuccess: () => { onChanged(); },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-900 dark:text-white">{album.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const next = window.prompt(t("salon.albums.namePrompt", lang), album.name);
              if (next && next.trim() && next.trim() !== album.name) {
                rename.mutate({ tenantId, id: album.id, newName: next.trim() });
              }
            }}
            className="rounded-lg p-1.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
            aria-label={t("salon.albums.rename", lang)}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("salon.albums.deleteConfirm", lang))) del.mutate({ tenantId, id: album.id });
            }}
            className="rounded-lg p-1.5 text-rose-400 transition hover:text-rose-600"
            aria-label={t("salon.albums.deleteConfirm", lang)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <SalonGalleryUploader tenantId={tenantId} photos={photos} onChange={setPhotos} />
      <Btn
        onClick={() => save.mutate({ tenantId, albumId: album.id, photos: photos.map((url) => ({ url })) })}
        disabled={save.isPending}
        className="w-full justify-center py-2"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}

export function SalonAlbumsBody({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const albumsQ = api.salon.listAlbums.useQuery({ tenantId });
  const refresh = () => { void utils.salon.listAlbums.invalidate(); };

  const create = api.salon.createAlbum.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  const albums = (albumsQ.data ?? []) as Album[];

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("salon.albums.desc", lang)}</p>
      <Btn
        onClick={() => {
          const name = window.prompt(t("salon.albums.namePrompt", lang));
          if (name && name.trim()) create.mutate({ tenantId, name: name.trim() });
        }}
        disabled={create.isPending}
        className="w-full justify-center py-2"
      >
        {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
        {t("salon.albums.create", lang)}
      </Btn>
      {albumsQ.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : albums.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{t("salon.albums.empty", lang)}</p>
      ) : (
        <div className="space-y-3">
          {albums.map((a) => (
            <AlbumEditor key={a.id} tenantId={tenantId} album={a} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

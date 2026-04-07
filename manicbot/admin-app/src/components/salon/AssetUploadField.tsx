"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { api } from "~/trpc/react";
import {
  resizeImageClientSide,
  uploadAssetFile,
  validateUploadFile,
  UPLOAD_ACCEPT_MIME,
  type UploadKind,
} from "~/lib/uploadAsset";

type PreviewShape = "square" | "cover";

interface AssetUploadFieldProps {
  label: string;
  tenantId: string;
  kind: UploadKind;
  /** Current URL (rendered as preview). */
  value: string;
  /** Called with the new public URL and R2 key after a successful upload, or with "" when cleared. */
  onChange: (value: { url: string; key: string } | { url: ""; key: "" }) => void;
  /** Square preview (logo) or 16:5 banner preview (cover). */
  preview?: PreviewShape;
  /** Hint text shown under the control. */
  hint?: string;
  /** Longest-edge pixel target for client-side resize. Default 1024 (logos 512). */
  maxDimPx?: number;
}

export function AssetUploadField({
  label,
  tenantId,
  kind,
  value,
  onChange,
  preview = "square",
  hint,
  maxDimPx = preview === "square" ? 512 : 1600,
}: AssetUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mint = api.salon.mintUploadToken.useMutation();

  async function handleFile(file: File) {
    setError(null);
    const validationError = validateUploadFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      const resized = await resizeImageClientSide(file, maxDimPx);
      const mintResult = await mint.mutateAsync({ tenantId, kind });
      const uploaded = await uploadAssetFile(mintResult.uploadUrl, resized);
      onChange({ url: uploaded.url, key: uploaded.key });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clear() {
    onChange({ url: "", key: "" });
    setError(null);
  }

  const previewClasses =
    preview === "square"
      ? "h-16 w-16 rounded-xl object-cover"
      : "h-20 w-full rounded-xl object-cover";

  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className={`${previewClasses} border border-slate-200 dark:border-slate-700`}
          />
        ) : (
          <div
            className={`${previewClasses} border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400`}
          >
            <Upload className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-xl px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {busy ? "Загрузка…" : value ? "Заменить" : "Загрузить"}
          </button>
          {value && !busy && (
            <button
              type="button"
              onClick={clear}
              className="rounded-xl px-2 py-2 text-xs text-slate-500 hover:text-red-500 border border-slate-200 dark:border-slate-700"
              aria-label="Убрать"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT_MIME.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {hint && !error && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{hint}</p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

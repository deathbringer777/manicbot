"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import { SalonGalleryUploader } from "~/components/salon/SalonGalleryUploader";

/**
 * Body of the "Фотогалерея" chip — the OLX-style photo grid. Reuses
 * `SalonGalleryUploader` (drag-and-drop reorder, cover badge, upload/URL) and
 * persists the ordered `photos` array via `salon.updateSalonProfile`.
 */
export function SalonGalleryBody({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [photos, setPhotos] = useState<string[]>(Array.isArray(profile?.photos) ? profile.photos : []);

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      toast.success(t("common.saved", lang));
    },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("salon.chip.galleryDesc", lang)}
      </p>
      <SalonGalleryUploader tenantId={tenantId} photos={photos} onChange={setPhotos} />
      <Btn
        onClick={() => update.mutate({ tenantId, photos })}
        disabled={update.isPending}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}

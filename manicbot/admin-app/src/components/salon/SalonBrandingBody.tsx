"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import { AssetUploadField } from "~/components/salon/AssetUploadField";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_BRAND = "#EC4899";

/**
 * Body of the "Брендинг" chip: logo + cover uploads (via the R2 mint-token
 * `AssetUploadField`) and the brand primary colour. Saves logo/cover URLs +
 * R2 keys + `brandPalette` via `salon.updateSalonProfile`.
 */
export function SalonBrandingBody({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [logo, setLogo] = useState<string>(profile?.logo ?? "");
  const [logoR2Key, setLogoR2Key] = useState<string>(profile?.logoR2Key ?? "");
  const [coverPhoto, setCoverPhoto] = useState<string>(profile?.coverPhoto ?? "");
  const [coverR2Key, setCoverR2Key] = useState<string>(profile?.coverR2Key ?? "");
  const [bgImage, setBgImage] = useState<string>(profile?.bgImage ?? "");
  const [bgR2Key, setBgR2Key] = useState<string>(profile?.bgR2Key ?? "");
  const [brandPrimary, setBrandPrimary] = useState<string>(
    (profile?.brandPalette && typeof profile.brandPalette === "object" && profile.brandPalette.primary) ||
      DEFAULT_BRAND,
  );

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      toast.success(t("common.saved", lang));
    },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  const isValidHex = HEX_RE.test(brandPrimary);

  return (
    <div className="space-y-3">
      <AssetUploadField
        label={t("salon.branding.logo", lang)}
        tenantId={tenantId}
        kind="logo"
        value={logo}
        onChange={({ url, key }) => { setLogo(url); setLogoR2Key(key); }}
        preview="square"
        hint={t("salon.branding.logoHint", lang)}
      />
      <AssetUploadField
        label={t("salon.branding.cover", lang)}
        tenantId={tenantId}
        kind="cover"
        value={coverPhoto}
        onChange={({ url, key }) => { setCoverPhoto(url); setCoverR2Key(key); }}
        preview="cover"
        hint={t("salon.branding.coverHint", lang)}
      />
      <AssetUploadField
        label={t("salon.branding.background", lang)}
        tenantId={tenantId}
        kind="background"
        value={bgImage}
        onChange={({ url, key }) => { setBgImage(url); setBgR2Key(key); }}
        preview="cover"
        hint={t("salon.branding.backgroundHint", lang)}
      />
      <div>
        <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
          {t("salon.branding.brandColor", lang)}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={isValidHex ? brandPrimary : DEFAULT_BRAND}
            onChange={(e) => setBrandPrimary(e.target.value)}
            className="h-10 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
            aria-label="Brand primary color"
          />
          <input
            value={brandPrimary}
            onChange={(e) => setBrandPrimary(e.target.value)}
            placeholder={DEFAULT_BRAND}
            className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 font-mono uppercase"
          />
        </div>
      </div>
      <Btn
        onClick={() =>
          update.mutate({
            tenantId,
            logo: logo || "",
            coverPhoto: coverPhoto || "",
            logoR2Key: logoR2Key || "",
            coverR2Key: coverR2Key || "",
            bgImage: bgImage || "",
            bgR2Key: bgR2Key || "",
            brandPalette: isValidHex ? { primary: brandPrimary } : null,
          })
        }
        disabled={update.isPending}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}

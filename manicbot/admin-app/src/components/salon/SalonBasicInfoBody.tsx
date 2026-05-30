"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn, Input } from "~/components/salon/SalonShared";

/**
 * Body of the "Основная информация" chip: salon name, optional display name,
 * address, phone. Saves only these fields via the all-optional
 * `salon.updateSalonProfile`. Local state is initialised from the loaded
 * profile (parent gates on loading/error before rendering).
 */
export function SalonBasicInfoBody({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [name, setName] = useState<string>(profile?.name ?? "");
  const [displayName, setDisplayName] = useState<string>(profile?.displayName ?? "");
  const [address, setAddress] = useState<string>(profile?.salon?.address ?? "");
  const [phone, setPhone] = useState<string>(profile?.salon?.phone ?? "");

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      toast.success(t("common.saved", lang));
    },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  return (
    <div className="space-y-3">
      <Input label={t("salon.name", lang)} value={name} onChange={setName} />
      <Input
        label={t("salon.branding.displayNameOptional", lang)}
        value={displayName}
        onChange={setDisplayName}
        placeholder={t("salon.branding.displayNameHint", lang)}
      />
      <Input label={t("salon.address", lang)} value={address} onChange={setAddress} />
      <Input label={t("salon.phone", lang)} value={phone} onChange={setPhone} />
      <Btn
        onClick={() => update.mutate({ tenantId, name, displayName: displayName || "", address, phone })}
        disabled={update.isPending}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}

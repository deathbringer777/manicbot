import type { Lang } from "~/lib/i18n";

export interface ServiceTemplate {
  emoji: string;
  names: Record<Lang, string>;
  price: number;
  duration: number;
}

export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = [
  { emoji: "💅", names: { ru: "Классический маникюр",  en: "Classic manicure",       ua: "Класичний манікюр",     pl: "Klasyczny manicure"       }, price: 80,  duration: 60  },
  { emoji: "💅", names: { ru: "Маникюр с гель-лаком",  en: "Gel polish manicure",    ua: "Манікюр з гель-лаком",  pl: "Manicure z lakierem hyb." }, price: 120, duration: 90  },
  { emoji: "✂️", names: { ru: "Снятие гель-лака",       en: "Gel polish removal",     ua: "Зняття гель-лаку",      pl: "Usunięcie lakieru hyb."   }, price: 40,  duration: 30  },
  { emoji: "✨", names: { ru: "Укрепление ногтей",      en: "Nail strengthening",     ua: "Зміцнення нігтів",      pl: "Wzmocnienie paznokci"     }, price: 80,  duration: 45  },
  { emoji: "🦶", names: { ru: "Педикюр классический",   en: "Classic pedicure",       ua: "Класичний педикюр",     pl: "Klasyczny pedicure"       }, price: 100, duration: 60  },
  { emoji: "🦶", names: { ru: "Педикюр с гель-лаком",   en: "Gel polish pedicure",    ua: "Педикюр з гель-лаком",  pl: "Pedicure z lakierem hyb." }, price: 150, duration: 90  },
  { emoji: "💎", names: { ru: "Наращивание ногтей",     en: "Nail extensions",        ua: "Нарощування нігтів",    pl: "Przedłużanie paznokci"    }, price: 200, duration: 120 },
  { emoji: "🎨", names: { ru: "Дизайн ногтей",          en: "Nail art",               ua: "Дизайн нігтів",         pl: "Zdobienie paznokci"       }, price: 50,  duration: 30  },
  { emoji: "🌸", names: { ru: "Парафинотерапия рук",    en: "Hand paraffin therapy",  ua: "Парафінотерапія рук",   pl: "Parafina na dłonie"       }, price: 60,  duration: 20  },
  { emoji: "🫧", names: { ru: "СПА-маникюр",           en: "SPA manicure",           ua: "СПА-манікюр",           pl: "Manicure SPA"             }, price: 130, duration: 90  },
  { emoji: "🧴", names: { ru: "Уход за кутикулой",      en: "Cuticle care",           ua: "Догляд за кутикулою",   pl: "Pielęgnacja skórek"       }, price: 40,  duration: 20  },
  { emoji: "💜", names: { ru: "Французский маникюр",    en: "French manicure",        ua: "Французький манікюр",   pl: "Manicure francuski"       }, price: 100, duration: 75  },
];

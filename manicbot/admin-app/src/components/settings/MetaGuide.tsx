"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Step {
  title: string;
  description: string;
  chat?: { from: string; text: string }[];
}

type ChannelType = "instagram" | "whatsapp";

const GUIDE_TITLE: Record<ChannelType, Record<Lang, string>> = {
  instagram: {
    ru: "Как подключить Instagram",
    ua: "Як підключити Instagram",
    en: "How to connect Instagram",
    pl: "Jak podłączyć Instagram",
  },
  whatsapp: {
    ru: "Как подключить WhatsApp",
    ua: "Як підключити WhatsApp",
    en: "How to connect WhatsApp",
    pl: "Jak podłączyć WhatsApp",
  },
};

const IG_STEPS: Record<Lang, Step[]> = {
  ru: [
    {
      title: "Создайте приложение в Meta for Developers",
      description: "Перейдите на developers.facebook.com → «Мои приложения» → «Создать приложение». Выберите тип «Business».",
      chat: [
        { from: "you", text: "Создать приложение → Business" },
        { from: "bot", text: "Приложение создано. Добавьте продукт Instagram." },
      ],
    },
    {
      title: "Привяжите страницу Facebook и Instagram-аккаунт",
      description: "В настройках приложения добавьте Facebook-страницу вашего бизнеса и свяжите с ней Instagram Business-аккаунт.",
    },
    {
      title: "Получите Page Access Token",
      description: "В Graph API Explorer выберите ваше приложение и страницу, запросите долгоживущий токен доступа к странице (Page Access Token).",
      chat: [
        { from: "you", text: "Generate Token → pages_manage_metadata, instagram_basic" },
        { from: "bot", text: "EAAxxxxxxxx... (скопируйте токен)" },
      ],
    },
    {
      title: "Найдите Page ID и Instagram Business ID",
      description: "Page ID — в URL страницы Facebook или через Graph API: /me?fields=id. Instagram Business ID — через /me/accounts → instagram_business_account.",
    },
    {
      title: "Вставьте данные в форму ниже",
      description: "Введите токен, Page ID и Instagram Business Account ID в поля ниже и нажмите «Подключить».",
    },
  ],
  ua: [
    {
      title: "Створіть додаток у Meta for Developers",
      description: "Перейдіть на developers.facebook.com → «Мої додатки» → «Створити додаток». Оберіть тип «Business».",
    },
    {
      title: "Прив'яжіть сторінку Facebook та Instagram-акаунт",
      description: "У налаштуваннях додатку додайте Facebook-сторінку вашого бізнесу та пов'яжіть з нею Instagram Business-акаунт.",
    },
    {
      title: "Отримайте Page Access Token",
      description: "У Graph API Explorer оберіть ваш додаток і сторінку, запросіть довготривалий токен доступу до сторінки.",
      chat: [
        { from: "you", text: "Generate Token → pages_manage_metadata, instagram_basic" },
        { from: "bot", text: "EAAxxxxxxxx... (скопіюйте токен)" },
      ],
    },
    {
      title: "Знайдіть Page ID та Instagram Business ID",
      description: "Page ID — в URL сторінки Facebook. Instagram Business ID — через /me/accounts → instagram_business_account.",
    },
    {
      title: "Вставте дані у форму нижче",
      description: "Введіть токен, Page ID та Instagram Business Account ID і натисніть «Підключити».",
    },
  ],
  en: [
    {
      title: "Create an app in Meta for Developers",
      description: "Go to developers.facebook.com → My Apps → Create App. Choose Business type.",
      chat: [
        { from: "you", text: "Create App → Business" },
        { from: "bot", text: "App created. Add Instagram product." },
      ],
    },
    {
      title: "Link your Facebook Page and Instagram account",
      description: "In app settings, add your business Facebook Page and connect your Instagram Business account to it.",
    },
    {
      title: "Get a Page Access Token",
      description: "In Graph API Explorer, select your app and page, then generate a long-lived Page Access Token with pages_manage_metadata and instagram_basic permissions.",
      chat: [
        { from: "you", text: "Generate Token → pages_manage_metadata, instagram_basic" },
        { from: "bot", text: "EAAxxxxxxxx... (copy this token)" },
      ],
    },
    {
      title: "Find your Page ID and Instagram Business ID",
      description: "Page ID is in your Facebook page URL. Instagram Business ID via /me/accounts → instagram_business_account field.",
    },
    {
      title: "Enter the details in the form below",
      description: "Paste the token, Page ID, and Instagram Business Account ID in the fields below and click Connect.",
    },
  ],
  pl: [
    {
      title: "Utwórz aplikację w Meta for Developers",
      description: "Przejdź do developers.facebook.com → Moje aplikacje → Utwórz aplikację. Wybierz typ Business.",
    },
    {
      title: "Połącz stronę Facebook i konto Instagram",
      description: "W ustawieniach aplikacji dodaj stronę biznesową Facebook i połącz z nią konto Instagram Business.",
    },
    {
      title: "Pobierz Page Access Token",
      description: "W Graph API Explorer wybierz aplikację i stronę, wygeneruj długotrwały token dostępu do strony.",
      chat: [
        { from: "you", text: "Generate Token → pages_manage_metadata, instagram_basic" },
        { from: "bot", text: "EAAxxxxxxxx... (skopiuj token)" },
      ],
    },
    {
      title: "Znajdź Page ID i Instagram Business ID",
      description: "Page ID jest w adresie URL strony Facebook. Instagram Business ID przez /me/accounts → instagram_business_account.",
    },
    {
      title: "Wklej dane do formularza poniżej",
      description: "Wpisz token, Page ID i Instagram Business Account ID w pola poniżej i kliknij Podłącz.",
    },
  ],
};

const WA_STEPS: Record<Lang, Step[]> = {
  ru: [
    {
      title: "Создайте WhatsApp Business App в Meta",
      description: "Перейдите на developers.facebook.com → Создать приложение → Business. Добавьте продукт WhatsApp.",
    },
    {
      title: "Пройдите верификацию бизнеса",
      description: "Meta требует верификации бизнеса для WhatsApp API. Это занимает 1–3 рабочих дня.",
    },
    {
      title: "Настройте номер телефона",
      description: "В разделе WhatsApp → Getting Started добавьте или зарегистрируйте номер телефона для API.",
      chat: [
        { from: "you", text: "Add phone number → верификация кода" },
        { from: "bot", text: "Phone Number ID: 115234xxx" },
      ],
    },
    {
      title: "Скопируйте Webhook URL и Verify Token",
      description: "Скопируйте данные ниже и вставьте в настройки Webhooks вашего Meta-приложения.",
    },
    {
      title: "Получите постоянный Access Token",
      description: "Создайте System User в Business Settings с правами на WhatsApp Business Account, сгенерируйте токен.",
    },
  ],
  ua: [
    {
      title: "Створіть WhatsApp Business App у Meta",
      description: "Перейдіть на developers.facebook.com → Створити додаток → Business. Додайте продукт WhatsApp.",
    },
    {
      title: "Пройдіть верифікацію бізнесу",
      description: "Meta вимагає верифікацію бізнесу для WhatsApp API. Це займає 1–3 робочих дні.",
    },
    {
      title: "Налаштуйте номер телефону",
      description: "У розділі WhatsApp → Getting Started додайте або зареєструйте номер телефону для API.",
    },
    {
      title: "Скопіюйте Webhook URL та Verify Token",
      description: "Скопіюйте дані нижче та вставте у налаштування Webhooks вашого Meta-додатку.",
    },
    {
      title: "Отримайте постійний Access Token",
      description: "Створіть System User у Business Settings з правами на WhatsApp Business Account, згенеруйте токен.",
    },
  ],
  en: [
    {
      title: "Create a WhatsApp Business App in Meta",
      description: "Go to developers.facebook.com → Create App → Business. Add the WhatsApp product.",
    },
    {
      title: "Complete business verification",
      description: "Meta requires business verification for WhatsApp API access. This takes 1–3 business days.",
    },
    {
      title: "Set up your phone number",
      description: "In WhatsApp → Getting Started, add and verify a phone number for the API.",
      chat: [
        { from: "you", text: "Add phone number → verify with code" },
        { from: "bot", text: "Phone Number ID: 115234xxx" },
      ],
    },
    {
      title: "Copy the Webhook URL and Verify Token",
      description: "Copy the values below and paste them into your Meta app's Webhooks configuration.",
    },
    {
      title: "Get a permanent System User Access Token",
      description: "Create a System User in Business Settings with WhatsApp Business Account permissions and generate a token.",
    },
  ],
  pl: [
    {
      title: "Utwórz WhatsApp Business App w Meta",
      description: "Przejdź do developers.facebook.com → Utwórz aplikację → Business. Dodaj produkt WhatsApp.",
    },
    {
      title: "Przejdź weryfikację biznesu",
      description: "Meta wymaga weryfikacji biznesu dla WhatsApp API. Zajmuje to 1–3 dni robocze.",
    },
    {
      title: "Skonfiguruj numer telefonu",
      description: "W sekcji WhatsApp → Getting Started dodaj i zweryfikuj numer telefonu dla API.",
    },
    {
      title: "Skopiuj Webhook URL i Verify Token",
      description: "Skopiuj poniższe wartości i wklej je w konfiguracji Webhooks aplikacji Meta.",
    },
    {
      title: "Pobierz stały System User Access Token",
      description: "Utwórz System User w Business Settings z uprawnieniami do WhatsApp Business Account i wygeneruj token.",
    },
  ],
};

function ChatBubble({ from, text }: { from: string; text: string }) {
  const isUser = from === "you";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs ${
          isUser
            ? "bg-brand-500/15 text-brand-600 dark:bg-brand-500/20 dark:text-brand-200 rounded-br-md"
            : "bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200 rounded-bl-md"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

const DEV_LINK: Record<ChannelType, string> = {
  instagram: "https://developers.facebook.com/apps",
  whatsapp: "https://developers.facebook.com/apps",
};

const DEV_LABEL: Record<ChannelType, Record<Lang, string>> = {
  instagram: { ru: "Meta for Developers", ua: "Meta for Developers", en: "Meta for Developers", pl: "Meta for Developers" },
  whatsapp: { ru: "Meta for Developers", ua: "Meta for Developers", en: "Meta for Developers", pl: "Meta for Developers" },
};

export function MetaGuide({ channel }: { channel: ChannelType }) {
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);
  const steps = channel === "instagram" ? (IG_STEPS[lang] ?? IG_STEPS.en) : (WA_STEPS[lang] ?? WA_STEPS.en);

  return (
    <section className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900 dark:text-white">{GUIDE_TITLE[channel][lang]}</span>
          <a
            href={DEV_LINK[channel]}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-0.5"
          >
            {DEV_LABEL[channel][lang]} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="h-6 w-6 rounded-full bg-brand-500/20 flex items-center justify-center text-[10px] font-bold text-brand-400">
                  {i + 1}
                </div>
                {i < steps.length - 1 && <div className="w-px flex-1 bg-slate-300 dark:bg-slate-700/40 mt-1" />}
              </div>
              <div className="flex-1 min-w-0 pb-3">
                <p className="text-xs font-semibold text-slate-900 dark:text-white mb-0.5">{step.title}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">{step.description}</p>
                {step.chat && (
                  <div className="bg-slate-100 dark:bg-slate-900/50 rounded-xl p-2.5 space-y-1.5 border border-slate-200 dark:border-slate-800/50">
                    {step.chat.map((msg, j) => (
                      <ChatBubble key={j} from={msg.from} text={msg.text} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

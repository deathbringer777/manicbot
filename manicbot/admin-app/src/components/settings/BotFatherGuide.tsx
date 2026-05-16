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

const GUIDE_TITLE: Record<Lang, string> = {
  ru: "Как создать бота",
  ua: "Як створити бота",
  en: "How to create a bot",
  pl: "Jak stworzyć bota",
};

const STEPS: Record<Lang, Step[]> = {
  ru: [
    {
      title: "Откройте @BotFather в Telegram",
      description: "Это официальный бот Telegram для создания и управления ботами.",
      chat: [{ from: "you", text: "/start" }],
    },
    {
      title: "Отправьте /newbot",
      description: "BotFather попросит вас ввести имя и юзернейм для бота.",
      chat: [
        { from: "you", text: "/newbot" },
        { from: "bot", text: "Отлично! Введите имя для вашего бота." },
      ],
    },
    {
      title: "Введите название салона",
      description: "Это имя бота, которое увидят клиенты.",
      chat: [
        { from: "you", text: "Мой Салон Красоты" },
        { from: "bot", text: "Хорошо. Теперь выберите юзернейм. Он должен заканчиваться на «bot»." },
      ],
    },
    {
      title: "Выберите юзернейм",
      description: "Юзернейм должен заканчиваться на «bot», например: my_salon_bot.",
      chat: [
        { from: "you", text: "my_salon_bot" },
        { from: "bot", text: "Готово! Ваш бот создан. Вот токен: 7284..." },
      ],
    },
    {
      title: "Скопируйте токен",
      description: "Скопируйте строку вида 7284028834:AAH... и вставьте в поле ниже.",
    },
  ],
  ua: [
    {
      title: "Відкрийте @BotFather у Telegram",
      description: "Це офіційний бот Telegram для створення та управління ботами.",
      chat: [{ from: "you", text: "/start" }],
    },
    {
      title: "Надішліть /newbot",
      description: "BotFather попросить ввести ім'я та юзернейм для бота.",
      chat: [
        { from: "you", text: "/newbot" },
        { from: "bot", text: "Чудово! Введіть ім'я для вашого бота." },
      ],
    },
    {
      title: "Введіть назву салону",
      description: "Це ім'я бота, яке побачать клієнти.",
      chat: [
        { from: "you", text: "Мій Салон Краси" },
        { from: "bot", text: "Добре. Тепер оберіть юзернейм. Він має закінчуватися на «bot»." },
      ],
    },
    {
      title: "Оберіть юзернейм",
      description: "Юзернейм має закінчуватися на «bot», наприклад: my_salon_bot.",
      chat: [
        { from: "you", text: "my_salon_bot" },
        { from: "bot", text: "Готово! Ваш бот створено. Ось токен: 7284..." },
      ],
    },
    {
      title: "Скопіюйте токен",
      description: "Скопіюйте рядок виду 7284028834:AAH... та вставте у поле нижче.",
    },
  ],
  en: [
    {
      title: "Open @BotFather in Telegram",
      description: "This is the official Telegram bot for creating and managing bots.",
      chat: [{ from: "you", text: "/start" }],
    },
    {
      title: "Send /newbot",
      description: "BotFather will ask you to choose a name and username for your bot.",
      chat: [
        { from: "you", text: "/newbot" },
        { from: "bot", text: "Alright! Please enter a name for your bot." },
      ],
    },
    {
      title: "Enter your salon name",
      description: "This is the display name your clients will see.",
      chat: [
        { from: "you", text: "My Beauty Salon" },
        { from: "bot", text: "Good. Now pick a username. It must end in 'bot'." },
      ],
    },
    {
      title: "Choose a username",
      description: "Username must end with 'bot', e.g. my_salon_bot.",
      chat: [
        { from: "you", text: "my_salon_bot" },
        { from: "bot", text: "Done! Your bot is created. Here's the token: 7284..." },
      ],
    },
    {
      title: "Copy the token",
      description: "Copy the string like 7284028834:AAH... and paste it below.",
    },
  ],
  pl: [
    {
      title: "Otwórz @BotFather w Telegram",
      description: "To oficjalny bot Telegram do tworzenia i zarządzania botami.",
      chat: [{ from: "you", text: "/start" }],
    },
    {
      title: "Wyślij /newbot",
      description: "BotFather poprosi o podanie nazwy i nazwy użytkownika bota.",
      chat: [
        { from: "you", text: "/newbot" },
        { from: "bot", text: "Świetnie! Podaj nazwę dla bota." },
      ],
    },
    {
      title: "Wpisz nazwę salonu",
      description: "To nazwa, którą zobaczą klienci.",
      chat: [
        { from: "you", text: "Mój Salon Urody" },
        { from: "bot", text: "Dobrze. Teraz wybierz nazwę użytkownika. Musi kończyć się na 'bot'." },
      ],
    },
    {
      title: "Wybierz nazwę użytkownika",
      description: "Nazwa musi kończyć się na 'bot', np. my_salon_bot.",
      chat: [
        { from: "you", text: "my_salon_bot" },
        { from: "bot", text: "Gotowe! Bot stworzony. Oto token: 7284..." },
      ],
    },
    {
      title: "Skopiuj token",
      description: "Skopiuj ciąg znaków 7284028834:AAH... i wklej poniżej.",
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

export function BotFatherGuide() {
  const { lang } = useLang();
  // Default collapsed — the guide now sits below the connect form,
  // so the salon owner sees the form first and expands the guide on demand.
  const [expanded, setExpanded] = useState(false);
  const steps = STEPS[lang] ?? STEPS.en;

  return (
    <section className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900 dark:text-white">{GUIDE_TITLE[lang]}</span>
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-0.5"
          >
            @BotFather <ExternalLink className="h-2.5 w-2.5" />
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

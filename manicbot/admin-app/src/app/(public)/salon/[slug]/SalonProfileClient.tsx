"use client";

import { useState } from "react";
import {
  MapPin, Phone, Clock, Instagram, Send, Star, ChevronDown, ChevronUp,
  ExternalLink, Scissors, User, CalendarDays, Image as ImageIcon,
} from "lucide-react";

type WorkHours = { from?: number; to?: number } | string | null;

interface ServiceItem {
  svcId: string;
  emoji: string | null;
  name: string;
  names: Record<string, string>;
  description: string | null;
  duration: number;
  price: number;
  photos: string[];
}

interface MasterItem {
  chatId: number;
  name: string | null;
  tgUsername: string | null;
  onVacation: boolean;
  services: string[];
  workHours: WorkHours;
  workDays: number[] | null;
}

interface SalonProfile {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  phone: string | null;
  workHours: WorkHours;
  photos: string[];
  mapsUrl: string | null;
  instagramUrl: string | null;
  botUsername: string | null;
  services: ServiceItem[];
  masters: MasterItem[];
}

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function formatHours(wh: WorkHours): string {
  if (!wh) return "Уточните у салона";
  if (typeof wh === "string") return wh;
  if (typeof wh === "object" && wh !== null) {
    const { from, to } = wh as { from?: number; to?: number };
    if (from !== undefined && to !== undefined) return `${from}:00 – ${to}:00`;
  }
  return "Уточните у салона";
}

function ServiceCard({ svc, botUsername }: { svc: ServiceItem; botUsername: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const bookUrl = botUsername ? `https://t.me/${botUsername}` : null;
  return (
    <div className="group rounded-xl border border-slate-200/80 bg-white p-4 transition hover:border-violet-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-brand-500/40 dark:hover:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {svc.emoji && <span className="text-lg">{svc.emoji}</span>}
            <span className="font-semibold text-slate-900 dark:text-white">{svc.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {svc.duration} мин
            </span>
            <span className="font-semibold text-violet-600 dark:text-brand-400">{svc.price > 0 ? `${svc.price} ₽` : "По договорённости"}</span>
          </div>
          {svc.description && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Скрыть" : "Подробнее"}
            </button>
          )}
          {expanded && svc.description && (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{svc.description}</p>
          )}
        </div>
        {bookUrl && (
          <a
            href={bookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 dark:bg-brand-500 dark:hover:bg-brand-600"
          >
            Записаться
          </a>
        )}
      </div>
    </div>
  );
}

function MasterCard({ master, services }: { master: MasterItem; services: ServiceItem[] }) {
  const masterServices = services.filter((s) => master.services.includes(s.svcId));
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xl font-bold text-violet-600 dark:bg-brand-500/20 dark:text-brand-400">
          {master.name?.[0]?.toUpperCase() ?? <User className="h-5 w-5" />}
        </div>
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{master.name ?? "Мастер"}</p>
          {master.tgUsername && (
            <p className="text-xs text-slate-500">@{master.tgUsername}</p>
          )}
          {master.onVacation && (
            <span className="mt-1 inline-block rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-400">
              В отпуске
            </span>
          )}
        </div>
      </div>
      {masterServices.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {masterServices.map((s) => (
            <span key={s.svcId} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {s.emoji} {s.name}
            </span>
          ))}
        </div>
      )}
      {master.workHours && (
        <p className="mt-2 text-xs text-slate-500">
          <Clock className="mr-1 inline h-3 w-3" />
          {formatHours(master.workHours)}
          {master.workDays && (
            <span className="ml-2">
              {master.workDays.map((d) => DAY_NAMES[d] ?? d).join(", ")}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function SalonProfileClient({ profile }: { profile: SalonProfile }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const bookUrl = profile.botUsername ? `https://t.me/${profile.botUsername}` : null;

  const coverPhoto = profile.photos[photoIdx] ?? null;

  return (
    <div className="pb-20">
      {/* Hero */}
      <div className="relative h-64 w-full overflow-hidden bg-slate-100 md:h-80 dark:bg-slate-900">
        {coverPhoto ? (
          <img src={coverPhoto} alt={profile.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-16 w-16 text-slate-300 dark:text-slate-700" />
          </div>
        )}
        {/* gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-50 via-slate-50/40 to-transparent dark:from-slate-950 dark:via-slate-950/40 dark:to-transparent" />

        {/* Photo strip */}
        {profile.photos.length > 1 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
            {profile.photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setPhotoIdx(i)}
                className={`h-1.5 rounded-full transition-all ${i === photoIdx ? "w-5 bg-white" : "w-1.5 bg-white/40"}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Profile header */}
      <div className="mx-auto max-w-6xl px-4">
        <div className="-mt-10 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:flex md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 md:text-3xl dark:text-white">{profile.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              {profile.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4 text-violet-600 dark:text-brand-400" />
                  {profile.city}
                </span>
              )}
              {profile.address && (
                <span className="text-slate-400 dark:text-slate-500">{profile.address}</span>
              )}
              {/* Rating placeholder */}
              <span className="flex items-center gap-1 text-yellow-500 dark:text-yellow-400">
                <Star className="h-4 w-4 fill-yellow-500 dark:fill-yellow-400" />
                <span className="font-semibold">5.0</span>
                <span className="text-slate-400 dark:text-slate-500">(новый)</span>
              </span>
            </div>
            {profile.description && (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{profile.description}</p>
            )}
          </div>

          {/* CTA + links */}
          <div className="mt-4 flex flex-wrap gap-2 md:mt-0 md:shrink-0 md:flex-col md:items-end">
            {bookUrl && (
              <a
                href={bookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:bg-violet-700 dark:bg-brand-500 dark:shadow-brand-500/25 dark:hover:bg-brand-600"
              >
                <Send className="h-4 w-4" />
                Записаться в Telegram
              </a>
            )}
            <div className="flex gap-2">
              {profile.phone && (
                <a
                  href={`tel:${profile.phone}`}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                >
                  <Phone className="h-4 w-4" />
                  {profile.phone}
                </a>
              )}
              {profile.instagramUrl && (
                <a
                  href={profile.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 transition hover:border-pink-300 hover:text-pink-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-pink-500/50 dark:hover:text-pink-400"
                >
                  <Instagram className="h-4 w-4" />
                  Instagram
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Photo gallery */}
        {profile.photos.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <ImageIcon className="h-5 w-5 text-violet-600 dark:text-brand-400" />
              Фотографии
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {profile.photos.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIdx(i)}
                  className={`aspect-square overflow-hidden rounded-xl border-2 transition ${photoIdx === i ? "border-violet-500 dark:border-brand-500" : "border-transparent"}`}
                >
                  <img src={url} alt={`Фото ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Layout: 2 columns on wide */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Left — services + masters */}
          <div className="lg:col-span-2 space-y-8">

            {/* Services */}
            {profile.services.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                  <Scissors className="h-5 w-5 text-violet-600 dark:text-brand-400" />
                  Услуги
                </h2>
                <div className="space-y-2">
                  {profile.services.map((svc) => (
                    <ServiceCard key={svc.svcId} svc={svc} botUsername={profile.botUsername} />
                  ))}
                </div>
              </section>
            )}

            {/* Masters */}
            {profile.masters.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                  <User className="h-5 w-5 text-violet-600 dark:text-brand-400" />
                  Мастера
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {profile.masters.map((m) => (
                    <MasterCard key={m.chatId} master={m} services={profile.services} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right — info sidebar */}
          <div className="space-y-4">

            {/* Hours */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                <CalendarDays className="h-4 w-4 text-violet-600 dark:text-brand-400" />
                Режим работы
              </h3>
              {profile.workHours ? (
                <div className="space-y-1 text-sm">
                  {["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"].map((day, i) => (
                    <div key={day} className="flex justify-between">
                      <span className={`text-slate-500 dark:text-slate-400 ${i >= 5 ? "text-slate-400 dark:text-slate-500" : ""}`}>{day}</span>
                      <span className={`font-medium ${i >= 5 ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
                        {i < 5 ? formatHours(profile.workHours) : i === 5 ? formatHours(profile.workHours) : "Выходной"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Уточните режим работы по телефону</p>
              )}
            </div>

            {/* Location */}
            {(profile.address || profile.mapsUrl) && (
              <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                  <MapPin className="h-4 w-4 text-violet-600 dark:text-brand-400" />
                  Адрес
                </h3>
                {profile.address && (
                  <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{profile.address}</p>
                )}
                {profile.city && (
                  <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">{profile.city}</p>
                )}
                {profile.mapsUrl && (
                  <a
                    href={profile.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Открыть на карте
                  </a>
                )}
              </div>
            )}

            {/* Booking CTA sidebar */}
            {bookUrl && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center dark:border-brand-500/30 dark:bg-brand-500/10">
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                  Запись через Telegram — быстро и без звонков
                </p>
                <a
                  href={bookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 dark:bg-brand-500 dark:hover:bg-brand-600"
                >
                  <Send className="h-4 w-4" />
                  Записаться
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  MapPin, Phone, Clock, Instagram, Send, Star, ChevronDown, ChevronUp,
  ExternalLink, Scissors, User, CalendarDays, Image as ImageIcon, Camera, MessageCircle,
} from "lucide-react";
import { TestBadge } from "~/components/ui/TestBadge";
import { decodePerDayWorkHours } from "~/lib/workHours";
import { encodeStartPayload, type TrackingPayload } from "~/lib/trackingPayload";

const ANON_ID_KEY = "manicbot.anon";

function readOrMintAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(ANON_ID_KEY);
    if (existing && /^[0-9a-fA-F-]{8,64}$/.test(existing)) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(16).slice(2).padEnd(32, "0");
    window.sessionStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    return Math.random().toString(16).slice(2).padEnd(32, "0");
  }
}

function buildBookUrl(
  botUsername: string | null | undefined,
  attribution?: TrackingPayload | null,
): string | null {
  if (!botUsername) return null;
  const base = `https://t.me/${botUsername}`;
  if (!attribution?.source) return base;
  try {
    const token = encodeStartPayload({
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      content: attribution.content,
    });
    return `${base}?start=${token}`;
  } catch {
    return base;
  }
}

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
  onVacation: boolean;
  vacationUntil: number | null;
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
  isTest?: boolean;
}

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function formatHours(wh: WorkHours): string {
  if (!wh) return "Уточните у салона";
  if (typeof wh === "string") {
    // If it's the per-day JSON, render a compact summary of weekdays vs weekend.
    const perDay = decodePerDayWorkHours(wh);
    if (perDay) {
      const mon = perDay[0];
      return mon ? `${mon.open} – ${mon.close}` : "Выходной";
    }
    return wh;
  }
  if (typeof wh === "object" && wh !== null) {
    const { from, to } = wh as { from?: number | string; to?: number | string };
    if (from !== undefined && to !== undefined) {
      // from/to can be strings ("10:00") or numbers (10); guard null/undefined just in case
      const fmtTime = (v: number | string | null | undefined) => typeof v === "string" ? v : v != null ? `${v}:00` : "";
      return `${fmtTime(from)} – ${fmtTime(to)}`;
    }
  }
  return "Уточните у салона";
}

function ServicePhotoCarousel({ photos, onValidCountChange }: { photos: string[]; onValidCountChange?: (count: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [brokenSet, setBrokenSet] = useState<Set<number>>(new Set());

  const validEntries = photos
    .map((url, i) => ({ url, i }))
    .filter(({ i }) => !brokenSet.has(i));

  useEffect(() => {
    onValidCountChange?.(validEntries.length);
  }, [validEntries.length, onValidCountChange]);

  useEffect(() => {
    if (activeIdx >= validEntries.length && validEntries.length > 0) {
      setActiveIdx(validEntries.length - 1);
    }
  }, [validEntries.length, activeIdx]);

  const handleImageError = useCallback((originalIdx: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = "none";
    setBrokenSet((prev) => {
      const next = new Set(prev);
      next.add(originalIdx);
      return next;
    });
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveIdx(idx);
  };

  const scrollTo = (idx: number) => {
    scrollRef.current?.scrollTo({ left: idx * (scrollRef.current?.offsetWidth ?? 0), behavior: "smooth" });
  };

  if (!validEntries.length) return null;
  return (
    <div className="mt-3">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {validEntries.map(({ url, i }) => (
          <div key={i} className="w-full shrink-0 snap-center sm:w-[calc(50%-4px)]">
            <img
              src={url}
              alt={`Фото ${validEntries.findIndex((v) => v.i === i) + 1}`}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-lg object-cover"
              onError={(e) => handleImageError(i, e)}
            />
          </div>
        ))}
      </div>
      {validEntries.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {validEntries.map((_, vi) => (
            <button
              key={vi}
              onClick={() => scrollTo(vi)}
              className={`h-1.5 rounded-full transition-all ${vi === activeIdx ? "w-4 bg-violet-500 dark:bg-brand-400" : "w-1.5 bg-slate-300 dark:bg-slate-600"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ svc, bookUrl }: { svc: ServiceItem; bookUrl: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [validPhotoCount, setValidPhotoCount] = useState(svc.photos.length);
  const hasDetails = svc.description || svc.photos.length > 0;

  return (
    <div
      className={`group rounded-xl border bg-white p-4 transition ${expanded ? "border-violet-300 shadow-sm dark:border-brand-500/40" : "border-slate-200/80 hover:border-violet-300 hover:shadow-sm dark:border-slate-800 dark:hover:border-brand-500/40"} dark:bg-slate-900/60 dark:hover:bg-slate-900`}
    >
      <div
        className={`flex items-start justify-between gap-3 ${hasDetails ? "cursor-pointer" : ""}`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
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
            <span className="font-semibold text-violet-600 dark:text-brand-400">{svc.price > 0 ? `${svc.price}\u00a0zł` : "По договорённости"}</span>
            {!expanded && validPhotoCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                <Camera className="h-3 w-3" />
                {validPhotoCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {bookUrl && (
            <a
              href={bookUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 dark:bg-brand-500 dark:hover:bg-brand-600"
            >
              Записаться
            </a>
          )}
          {hasDetails && (
            <button className="text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {svc.description && (
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{svc.description}</p>
          )}
          <ServicePhotoCarousel photos={svc.photos} onValidCountChange={setValidPhotoCount} />
        </div>
      )}
    </div>
  );
}

function MasterCard({ master, services }: { master: MasterItem; services: ServiceItem[] }) {
  const masterServices = services.filter((s) => master.services.includes(s.svcId));
  const vacationLabel = (() => {
    if (!master.onVacation) return null;
    if (!master.vacationUntil) return "В отпуске";
    const until = new Date(master.vacationUntil * 1000);
    const day = String(until.getDate()).padStart(2, "0");
    const month = String(until.getMonth() + 1).padStart(2, "0");
    return `В отпуске до ${day}.${month}`;
  })();
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xl font-bold text-violet-600 dark:bg-brand-500/20 dark:text-brand-400">
          {master.name?.[0]?.toUpperCase() ?? <User className="h-5 w-5" />}
        </div>
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{master.name ?? "Мастер"}</p>
          {vacationLabel && (
            <span className="mt-1 inline-block rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-400">
              {vacationLabel}
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

export function SalonProfileClient({
  profile,
  attribution,
}: {
  profile: SalonProfile;
  attribution?: TrackingPayload | null;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const bookUrl = useMemo(
    () => buildBookUrl(profile.botUsername, attribution),
    [profile.botUsername, attribution?.source, attribution?.medium, attribution?.campaign, attribution?.content],
  );
  const chatUrl = profile.slug ? `/salon/${profile.slug}/chat` : null;

  useEffect(() => {
    if (!attribution?.source) return;
    const anonymousId = readOrMintAnonId();
    if (!anonymousId) return;
    try {
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonymousId,
          event: "salon_view",
          properties: {
            slug: profile.slug ?? null,
            source: attribution.source,
            campaign: attribution.campaign ?? null,
            medium: attribution.medium ?? null,
            content: attribution.content ?? null,
          },
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* swallow — analytics is best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 md:text-3xl dark:text-white">{profile.name}</h1>
              {profile.isTest ? <TestBadge /> : null}
            </div>
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
            {chatUrl && (
              <a
                href={chatUrl}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-600 bg-white px-5 py-2.5 font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-brand-500 dark:bg-transparent dark:text-brand-400 dark:hover:bg-brand-500/10"
              >
                <MessageCircle className="h-4 w-4" />
                Открыть чат
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
                  <img src={url} alt={`Фото ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
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
                    <ServiceCard key={svc.svcId} svc={svc} bookUrl={bookUrl} />
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
              {profile.workHours ? (() => {
                // Prefer per-day shape when present so each row reflects the
                // actual schedule the salon owner configured. Fall back to the
                // legacy "same hours Mon-Sat, Sun off" rendering otherwise.
                const perDay = typeof profile.workHours === "string"
                  ? decodePerDayWorkHours(profile.workHours)
                  : null;
                const FULL_DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
                return (
                  <div className="space-y-1 text-sm">
                    {FULL_DAY_NAMES.map((day, i) => {
                      const slot = perDay ? perDay[i] : null;
                      const display = perDay
                        ? (slot ? `${slot.open} – ${slot.close}` : "Выходной")
                        : (i < 6 ? formatHours(profile.workHours) : "Выходной");
                      const dim = perDay ? slot === null : i >= 6;
                      return (
                        <div key={day} className="flex justify-between">
                          <span className={`text-slate-500 dark:text-slate-400 ${dim ? "text-slate-400 dark:text-slate-500" : ""}`}>{day}</span>
                          <span className={`font-medium ${dim ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
                            {display}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
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
            {(bookUrl || chatUrl) && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center dark:border-brand-500/30 dark:bg-brand-500/10">
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                  Быстрая запись — без звонков
                </p>
                <div className="flex flex-col items-stretch gap-2">
                  {bookUrl && (
                    <a
                      href={bookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 dark:bg-brand-500 dark:hover:bg-brand-600"
                    >
                      <Send className="h-4 w-4" />
                      Записаться в Telegram
                    </a>
                  )}
                  {chatUrl && (
                    <a
                      href={chatUrl}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-600 bg-white px-5 py-2.5 text-sm font-semibold text-violet-600 transition hover:bg-violet-100 dark:border-brand-500 dark:bg-transparent dark:text-brand-400 dark:hover:bg-brand-500/20"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Открыть чат на сайте
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

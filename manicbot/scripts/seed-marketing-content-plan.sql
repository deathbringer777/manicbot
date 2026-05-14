-- seed-marketing-content-plan.sql — Week 1 of @manicbot_com IG autopilot.
--
-- Seeds 21 slots (3 per day × 7 days) starting Fri 2026-05-15.
-- Slots are scheduled in UTC; Worker cron converts to Europe/Warsaw timing.
--   09:00 Warsaw (CEST=UTC+2) → 07:00 UTC
--   13:00 Warsaw              → 11:00 UTC
--   19:00 Warsaw              → 17:00 UTC
--
-- IDs are deterministic (slot_YYYYMMDD_HHMM) so re-runs are idempotent
-- via INSERT OR IGNORE (also covered by idx_mcp_unique_slot).
--
-- tenant_id is NULL — @manicbot_com publishes as system_admin without
-- a tenant. Other tenants will get their own rows when the marketing
-- module graduates into a plugin.
--
-- Themes follow the 09/13/19 cadence from BRAND_VOICE.md §7:
--   09:00 — inspiration  (Inspiration / Tips)
--   13:00 — product      (Product Features / Comparison)
--   19:00 — social_proof (Social Proof / CTA)
--
-- Topics for Day 1 (Fri 15 May) reuse the 3 Manus-generated posts
-- already in /manicbot manus/posts/today/ (warmup / news / expert)
-- so we can publish them as the first day's content. Day 2-7 topics
-- come from the 30-day weekly strategy in content_plan_30days.md.

INSERT OR IGNORE INTO marketing_content_plan
  (id, tenant_id, scheduled_at, theme, topic, key_message, status, created_at, updated_at)
VALUES
  -- Day 1: Fri 15 May 2026 (launch day — Manus's ready assets)
  ('slot_20260515_0900', NULL, CAST(strftime('%s','2026-05-15 07:00:00') AS INTEGER),
   'inspiration', 'Tracisz 30% rezerwacji bo nie odpowiadasz na czas',
   'AI odpowiada za 2 sek, nigdy nie traci klienta', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260515_1300', NULL, CAST(strftime('%s','2026-05-15 11:00:00') AS INTEGER),
   'product', 'Anthropic Claude dla małych firm — co to znaczy dla salonu',
   'ManicBot juz wykorzystuje najnowsze AI', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260515_1900', NULL, CAST(strftime('%s','2026-05-15 17:00:00') AS INTEGER),
   'social_proof', '3 znaki ze Twoj salon jest gotowy na AI',
   'Brak odpowiedzi, 2+ godz dziennie na rezerwacjach, chcesz rosnac bez admina', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 2: Sat 16 May 2026 (weekend lifestyle)
  ('slot_20260516_0900', NULL, CAST(strftime('%s','2026-05-16 07:00:00') AS INTEGER),
   'inspiration', 'Spisz, a Twoj salon zarabia',
   'AI-asystent dziala 24/7, nawet w sobote rano', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260516_1300', NULL, CAST(strftime('%s','2026-05-16 11:00:00') AS INTEGER),
   'product', 'Obsluga w 4 jezykach automatycznie',
   'PL / EN / UA / RU bez ustawien — bot rozpoznaje sam', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260516_1900', NULL, CAST(strftime('%s','2026-05-16 17:00:00') AS INTEGER),
   'social_proof', 'Jak spedzic weekend gdy bot przyjmuje zapisy',
   'Twoj czas wraca do Ciebie', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 3: Sun 17 May 2026 (week prep)
  ('slot_20260517_0900', NULL, CAST(strftime('%s','2026-05-17 07:00:00') AS INTEGER),
   'inspiration', 'Jak przygotowac salon na napiety tydzien',
   'Lista kontrolna: kalendarz, materialy, automatyzacja', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260517_1300', NULL, CAST(strftime('%s','2026-05-17 11:00:00') AS INTEGER),
   'product', 'Web-widget dla Twojej strony',
   'Klient klika "Umow wizyte" i trafia do bota w 1 sekunde', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260517_1900', NULL, CAST(strftime('%s','2026-05-17 17:00:00') AS INTEGER),
   'social_proof', 'Sprawdz harmonogram na jutro w ManicBot',
   'Niedzielny rytual: 30 sek na podglad tygodnia', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 4: Mon 18 May 2026 (motivation kickoff)
  ('slot_20260518_0900', NULL, CAST(strftime('%s','2026-05-18 07:00:00') AS INTEGER),
   'inspiration', 'Poniedzialek mistrza paznokci — cytat na start',
   'Praca daje wolnosc, nie odwrotnie', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260518_1300', NULL, CAST(strftime('%s','2026-05-18 11:00:00') AS INTEGER),
   'product', 'Automatyzacja zapisow — krok po kroku',
   'Klient pisze → bot oferuje termin → potwierdza → Calendar', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260518_1900', NULL, CAST(strftime('%s','2026-05-18 17:00:00') AS INTEGER),
   'social_proof', 'Stracone wiadomosci w Direct — czesta bolaczka',
   '70% klientow nie wraca jesli nie odpowiesz w 5 min', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 5: Tue 19 May 2026 (education)
  ('slot_20260519_0900', NULL, CAST(strftime('%s','2026-05-19 07:00:00') AS INTEGER),
   'inspiration', 'Jak ustawic harmonogram salonu na maksymalny zysk',
   'Slot 30/45/60 min, bufor 10 min, przerwy w martwych godzinach', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260519_1300', NULL, CAST(strftime('%s','2026-05-19 11:00:00') AS INTEGER),
   'product', 'ManicBot vs Booksy — 0% prowizji vs 30%',
   '3x tansze, brak ukrytych oplat, pelna kontrola', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260519_1900', NULL, CAST(strftime('%s','2026-05-19 17:00:00') AS INTEGER),
   'social_proof', 'Reels: proces zapisu klienta w 3 sekundy',
   'Hook → wybor uslugi → potwierdzenie → got. Bez aplikacji', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 6: Wed 20 May 2026 (cases + numbers)
  ('slot_20260520_0900', NULL, CAST(strftime('%s','2026-05-20 07:00:00') AS INTEGER),
   'inspiration', 'Ile salony traca rocznie na prowizjach',
   '~5400 zl na salon przy srednim ruchu — wyplaty agregatorom', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260520_1300', NULL, CAST(strftime('%s','2026-05-20 11:00:00') AS INTEGER),
   'product', 'Synchronizacja z Google Calendar — jak to dziala',
   'Kazda nowa rezerwacja od razu w grafiku, bez podwojnych zapisow', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260520_1900', NULL, CAST(strftime('%s','2026-05-20 17:00:00') AS INTEGER),
   'social_proof', 'Kejs: salon w Warszawie zaoszczedzil 2 godz dziennie',
   'Wczesniej recznie, teraz bot — wiecej zabiegow, mniej stresu', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  -- Day 7: Thu 21 May 2026 (engagement)
  ('slot_20260521_0900', NULL, CAST(strftime('%s','2026-05-21 07:00:00') AS INTEGER),
   'inspiration', 'Ankieta: jaki messenger Twoje klientki uzywaja najczesciej',
   'IG / WA / TG — ManicBot dziala we wszystkich', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260521_1300', NULL, CAST(strftime('%s','2026-05-21 11:00:00') AS INTEGER),
   'product', 'AI-asystent 24/7 — co naprawde potrafi',
   'Konteksty, sleng, intencje — nie tylko skrypty', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),

  ('slot_20260521_1900', NULL, CAST(strftime('%s','2026-05-21 17:00:00') AS INTEGER),
   'social_proof', 'Reels: jak AI odpowiada w nocy — symulacja',
   '3 nocne pytania, 3 natychmiastowe odpowiedzi, 3 rezerwacje', 'pending',
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));

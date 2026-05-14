import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { tenants, services, masters, tenantConfig, bots, reviews } from "~/server/db/schema";
import { eq, and, like, or, isNotNull, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { buildFtsMatchExpression } from "~/server/api/publicSalon/publicSalonSearchLogic";

// Public salon directory: 120 req / 60 s per IP — prevents enumeration & scraping.
const RL_PUBLIC_MAX = 120;
const RL_PUBLIC_WINDOW = 60 * 1000;

function clientIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  return h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function assertNotRateLimited(
  ctx: Parameters<typeof checkRateLimit>[0],
  ip: string,
  action: string,
) {
  const rl = await checkRateLimit(ctx, ip, action, RL_PUBLIC_MAX, RL_PUBLIC_WINDOW);
  if (!rl.allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded. Try again soon." });
  }
}
import { hasCyrillic, cyrillicToLatin } from "~/lib/searchNormalize";
import { POPULAR_CITIES } from "~/lib/popularCities";

/** Build a LIKE condition that covers both Cyrillic input and its Latin transliteration. */
function searchLike(col: Parameters<typeof like>[0], raw: string) {
  const qLow = raw.toLowerCase();
  const qLatin = hasCyrillic(raw) ? cyrillicToLatin(qLow) : qLow;
  if (qLatin !== qLow) {
    return or(like(col, `%${qLow}%`), like(col, `%${qLatin}%`))!;
  }
  return like(col, `%${qLow}%`);
}

/** Static blog article list used in autocomplete suggestions. */
const BLOG_ARTICLES: Array<{ slug: string; titles: Record<string, string> }> = [
  {
    slug: "manicbot-telegram-booking",
    titles: {
      ru: "Онлайн-запись через Telegram: как это работает",
      en: "Online booking via Telegram: how it works",
      ua: "Онлайн-запис через Telegram: як це працює",
      pl: "Rezerwacje online przez Telegram: jak to działa",
    },
  },
  {
    slug: "ai-beauty-europe-poland",
    titles: {
      ru: "ИИ-ассистент для nail-студий в Европе",
      en: "AI assistant for nail studios in Europe",
      ua: "ШІ-асистент для нейл-студій у Європі",
      pl: "Asystent AI dla studiów paznokci w Europie",
    },
  },
  {
    slug: "gel-polish-care-guide",
    titles: {
      ru: "Уход за гель-лаком: советы от мастеров",
      en: "Gel polish care guide from nail masters",
      ua: "Догляд за гель-лаком: поради від майстрів",
      pl: "Poradnik pielęgnacji żelowego lakieru",
    },
  },
];

/** Public salon directory — no authentication required. */
export const publicSalonRouter = createTRPCRouter({

  /**
   * Get a public salon profile by slug (URL-friendly id).
   *
   * P0-2 — gate on `tenants.publicActive = 1`. Without this gate, any
   * unpublished / deactivated / personal tenant was readable to anyone who
   * guessed or scraped the slug, exposing phone, address, masters list,
   * services, photos, and bot username — i.e. a privacy leak. The sibling
   * procedures (search, searchMasters, autocomplete) already enforce it.
   */
  getProfile: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertNotRateLimited(ctx.db, clientIp(ctx), "publicSalon.getProfile");

      const tenantRows = await ctx.db
        .select()
        .from(tenants)
        .where(and(eq(tenants.slug, input.slug), eq(tenants.publicActive, 1)))
        .limit(1);

      const tenant = tenantRows[0];
      if (!tenant) return null;

      const [serviceRows, masterRows, configRows, botRows] = await Promise.all([
        ctx.db
          .select()
          .from(services)
          .where(
            and(
              eq(services.tenantId, tenant.id),
              eq(services.active, 1),
              eq(services.hidden, 0),
            ),
          )
          .orderBy(services.sortOrder),
        ctx.db
          .select()
          .from(masters)
          .where(and(
            eq(masters.tenantId, tenant.id),
            eq(masters.active, 1),
            eq(masters.publicHidden, 0),
          )),
        ctx.db
          .select()
          .from(tenantConfig)
          .where(eq(tenantConfig.tenantId, tenant.id)),
        ctx.db
          .select()
          .from(bots)
          .where(and(eq(bots.tenantId, tenant.id), eq(bots.active, 1)))
          .limit(1),
      ]);

      const cfg = Object.fromEntries(
        configRows.map((r: any) => [r.key, r.value]),
      );
      let salon: Record<string, unknown> = {};
      try {
        salon = tenant.salon ? JSON.parse(tenant.salon) : {};
      } catch { /* ignore */ }

      let photos: string[] = [];
      try {
        photos = tenant.photos ? JSON.parse(tenant.photos) : [];
      } catch { /* ignore */ }

      const botUsername = botRows[0]?.botUsername ?? null;

      // Rating (only if reviews_public is not explicitly false)
      const reviewsCfg = configRows.find((c: any) => c.key === "reviews_public");
      const reviewsPublic = !reviewsCfg || reviewsCfg.value !== "false";
      let rating: { avg: number; count: number } | null = null;
      if (reviewsPublic) {
        // Reviews are keyed on tenant.id (not slug). Earlier code paid an
        // extra round-trip with `input.slug` (always 0 rows because slug ≠
        // tenant.id) before re-querying with `tenant.id`. One round-trip now.
        const ratingRow = await ctx.db.select({
          avg: sql<number>`ROUND(AVG(rating), 1)`,
          count: sql<number>`count(*)`,
        }).from(reviews).where(and(
          eq(reviews.tenantId, tenant.id),
          inArray(reviews.status, ["active", "featured"]),
        ));
        const r = ratingRow[0];
        if (r && r.count > 0) rating = { avg: r.avg, count: r.count };
      }

      let brandPalette: Record<string, string> | null = null;
      try {
        brandPalette = tenant.brandPalette ? JSON.parse(tenant.brandPalette) : null;
      } catch { /* ignore */ }

      // P0-2 — `publicActive` is now informational only. The where-clause
      // above already guarantees publicActive=1, so this is always 1; we
      // still emit it as a literal so frontend code that branches on it
      // (e.g. SEO robots tags) keeps its type contract. Anyone reading this
      // value as authoritative for "is this salon public?" should instead
      // trust the presence of the payload itself.
      return {
        id: tenant.id,
        slug: tenant.slug,
        publicActive: 1 as const,
        isTest: !!tenant.isTest,
        name: tenant.name,
        displayName: tenant.displayName ?? null,
        logo: tenant.logo ?? null,
        coverPhoto: tenant.coverPhoto ?? null,
        brandPalette,
        description: tenant.description,
        city: tenant.city,
        lat: tenant.lat,
        lng: tenant.lng,
        address: (salon.address as string) ?? cfg.address ?? null,
        phone: (salon.phone as string) ?? cfg.phone ?? null,
        workHours: salon.workHours ?? cfg.work_hours ?? null,
        photos,
        mapsUrl: tenant.mapsUrl,
        instagramUrl: tenant.instagramUrl,
        botUsername,
        rating,
        services: serviceRows.map((s: any) => {
          let names: Record<string, string> = {};
          try { names = s.names ? JSON.parse(s.names) : {}; } catch { /* ignore */ }
          let svcPhotos: string[] = [];
          try { svcPhotos = s.photos ? JSON.parse(s.photos) : []; } catch { /* ignore */ }
          return {
            svcId: s.svcId,
            emoji: s.emoji,
            name: names.ru ?? names.en ?? names.pl ?? s.svcId,
            names,
            description: (() => {
              if (!s.description) return null;
              try {
                const parsed = JSON.parse(s.description);
                if (typeof parsed === 'string') return parsed;
                return parsed.ru ?? parsed.en ?? parsed.ua ?? parsed.pl ?? null;
              } catch {
                return s.description;
              }
            })(),
            duration: s.duration,
            price: s.price,
            photos: svcPhotos,
          };
        }),
        masters: masterRows.map((m: any) => {
          // Live vacation derivation: legacy boolean OR (now ∈ [from, until])
          const nowSec = Math.floor(Date.now() / 1000);
          const inRange =
            typeof m.vacationFrom === "number" &&
            typeof m.vacationUntil === "number" &&
            m.vacationFrom <= nowSec &&
            nowSec <= m.vacationUntil;
          const onVacation = !!m.onVacation || inRange;
          return {
            chatId: m.chatId,
            name: m.name,
            // tgUsername is intentionally NOT exposed — keep the public
            // page free of Telegram handles for either owner or masters.
            onVacation,
            vacationUntil: onVacation && typeof m.vacationUntil === "number" ? m.vacationUntil : null,
            services: (() => {
              try { return m.services ? JSON.parse(m.services) : []; } catch { return []; }
            })(),
            workHours: (() => {
              try { return m.workHours ? JSON.parse(m.workHours) : null; } catch { return null; }
            })(),
            workDays: (() => {
              try { return m.workDays ? JSON.parse(m.workDays) : null; } catch { return null; }
            })(),
          };
        }),
      };
    }),

  /** Search public salons by city, query, service type. */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().optional(),
        city: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        radiusKm: z.number().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertNotRateLimited(ctx.db, clientIp(ctx), "publicSalon.search");

      const { query, city, lat, lng, radiusKm, page, limit } = input;
      const offset = (page - 1) * limit;

      // FTS5 path — see relax.md §4 P0-5. Both the free-text `query` and
      // the `city` filter are converted into a single MATCH expression
      // against `tenant_fts` (FTS5, unicode61 + diacritic-fold) and
      // joined back to `tenants` for projection. Falls back to the old
      // LIKE behaviour automatically when sanitisation strips the input
      // to nothing — in that case the procedure returns an empty page.
      const ftsTerms: string[] = [];
      if (query) {
        const expr = buildFtsMatchExpression(query);
        if (expr) ftsTerms.push(expr);
        else return { items: [], hasMore: false, page, total: 0 };
      }
      if (city) {
        const cityExpr = buildFtsMatchExpression(city);
        if (cityExpr) ftsTerms.push(cityExpr);
        // No early-return on `city` mis-sanitise: city is a soft hint, an
        // empty MATCH for it should not silently empty the whole result.
      }

      // Require slug — salons without a slug cannot be opened via /salon/[slug],
      // so clicking their card would lead to "#". Hide them from the directory
      // until an owner sets one (also hides half-configured personal tenants).
      const conditions: any[] = [
        eq(tenants.publicActive, 1),
        isNotNull(tenants.slug),
      ];

      // When we have a free-text query/city we drive the SELECT via an
      // INNER JOIN against `tenant_fts` — that forces SQLite to start
      // with the FTS5 virtual table (an O(log N) MATCH lookup) and
      // then SEARCH tenants by PK, instead of SCAN tenants + post-
      // filter. Verified via `EXPLAIN QUERY PLAN`.
      //
      // Without an FTS join we keep the original full-table-list path
      // (browse mode); the limit + offset + order keep it cheap.
      const projection = {
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        description: tenants.description,
        city: tenants.city,
        lat: tenants.lat,
        lng: tenants.lng,
        photos: tenants.photos,
        salon: tenants.salon,
        mapsUrl: tenants.mapsUrl,
        instagramUrl: tenants.instagramUrl,
        isTest: tenants.isTest,
      } as const;

      const rows = ftsTerms.length > 0
        ? await ctx.db
            .select(projection)
            .from(tenants)
            .innerJoin(
              sql`tenant_fts`,
              sql`tenant_fts.tenant_id = ${tenants.id} AND tenant_fts MATCH ${ftsTerms.join(" ")}`,
            )
            .where(and(...conditions))
            .orderBy(tenants.name)
            .limit(limit + 1)
            .offset(offset)
        : await ctx.db
            .select(projection)
            .from(tenants)
            .where(and(...conditions))
            .orderBy(tenants.name)
            .limit(limit + 1)
            .offset(offset);

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((t) => {
        let photos: string[] = [];
        try { photos = t.photos ? JSON.parse(t.photos) : []; } catch { /* ignore */ }
        let salon: Record<string, unknown> = {};
        try { salon = t.salon ? JSON.parse(t.salon) : {}; } catch { /* ignore */ }

        let distanceKm: number | null = null;
        if (lat != null && lng != null && t.lat != null && t.lng != null) {
          // Haversine approximation (degrees → km)
          const R = 6371;
          const dLat = ((t.lat - lat) * Math.PI) / 180;
          const dLng = ((t.lng - lng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((lat * Math.PI) / 180) *
              Math.cos((t.lat * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2;
          distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          description: t.description,
          city: t.city,
          lat: t.lat,
          lng: t.lng,
          address: (salon.address as string) ?? null,
          coverPhoto: photos[0] ?? null,
          mapsUrl: t.mapsUrl,
          distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
          isTest: !!t.isTest,
        };
      });

      // Filter by radius if coordinates provided
      const filtered =
        lat != null && lng != null
          ? items.filter((i) => i.distanceKm == null || i.distanceKm <= radiusKm)
          : items;

      return { items: filtered, hasMore, page, total: filtered.length };
    }),

  /** Search public independent masters (personal tenants only). */
  searchMasters: publicProcedure
    .input(
      z.object({
        query: z.string().optional(),
        city: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertNotRateLimited(ctx.db, clientIp(ctx), "publicSalon.searchMasters");

      const { query, city, page, limit } = input;
      const offset = (page - 1) * limit;

      const conditions: any[] = [
        eq(tenants.isPersonal, 1),
        eq(tenants.publicActive, 1),
        isNotNull(tenants.slug),
      ];
      if (city) {
        conditions.push(or(like(tenants.city, `%${city}%`), searchLike(tenants.searchText, city))!);
      }
      if (query) {
        conditions.push(searchLike(tenants.searchText, query));
      }

      const rows = await ctx.db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          displayName: tenants.displayName,
          city: tenants.city,
          logo: tenants.logo,
          coverPhoto: tenants.coverPhoto,
          photos: tenants.photos,
          isTest: tenants.isTest,
        })
        .from(tenants)
        .where(and(...conditions))
        .orderBy(tenants.name)
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((t) => {
        let photos: string[] = [];
        try { photos = t.photos ? JSON.parse(t.photos) : []; } catch { /* ignore */ }
        return {
          id: t.id,
          slug: t.slug,
          name: t.displayName || t.name,
          city: t.city,
          photo: t.logo || t.coverPhoto || photos[0] || null,
          isTest: !!t.isTest,
        };
      });

      return { items, hasMore, page };
    }),

  /**
   * Pinned popular cities shown on the landing dropdown and on /search.
   *
   * The platform currently operates in Poland only — we deliberately do
   * NOT query the tenants table here. Querying would surface legacy /
   * test-account rows (e.g. "Київ") that contradict the marketing
   * promise. Keep in sync with `manicbot/src/lib/popularCities.js`.
   */
  getCities: publicProcedure.query(async () => {
    return [...POPULAR_CITIES];
  }),

  /** Autocomplete: returns top 5 salon suggestions + matched blog articles for the search dropdown. */
  autocomplete: publicProcedure
    .input(z.object({ q: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (q.length < 2) return { salons: [] as Array<{ slug: string | null; name: string; city: string | null; coverPhoto: string | null }>, articles: [] as Array<{ slug: string; title: string; lang: "ru" }> };

      // FTS5 path — see relax.md §4 P0-5. The autocomplete dropdown
      // fires on every keystroke; the previous `LIKE '%q%'` ran a full
      // table scan per call. `tenant_fts MATCH 'q*'` is O(log N) and
      // gives us prefix matching for free.
      const matchExpr = buildFtsMatchExpression(q);
      if (!matchExpr) {
        return { salons: [] as Array<{ slug: string | null; name: string; city: string | null; coverPhoto: string | null }>, articles: [] as Array<{ slug: string; title: string; lang: "ru" }> };
      }

      const rows = await ctx.db
        .select({
          slug: tenants.slug,
          name: tenants.name,
          city: tenants.city,
          photos: tenants.photos,
        })
        .from(tenants)
        .innerJoin(
          sql`tenant_fts`,
          sql`tenant_fts.tenant_id = ${tenants.id} AND tenant_fts MATCH ${matchExpr}`,
        )
        .where(eq(tenants.publicActive, 1))
        .limit(5);

      const salons = rows.map((t) => {
        let coverPhoto: string | null = null;
        try {
          const photos = t.photos ? JSON.parse(t.photos) : [];
          coverPhoto = photos[0] ?? null;
        } catch { /* ignore */ }
        return { slug: t.slug, name: t.name, city: t.city, coverPhoto };
      });

      // Match articles using simple substring match
      const qLow = q.toLowerCase();
      const articles = BLOG_ARTICLES.filter((a) =>
        Object.values(a.titles).some((title) =>
          title.toLowerCase().includes(qLow),
        ),
      ).map((a) => ({ slug: a.slug, title: a.titles["ru"] ?? a.titles["en"] ?? a.slug, lang: "ru" as const }));

      return { salons, articles };
    }),
});

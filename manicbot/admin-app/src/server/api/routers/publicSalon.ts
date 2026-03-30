import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { tenants, services, masters, tenantConfig, bots } from "~/server/db/schema";
import { eq, and, like, or, isNotNull, sql } from "drizzle-orm";

/** Public salon directory — no authentication required. */
export const publicSalonRouter = createTRPCRouter({

  /** Get a public salon profile by slug (URL-friendly id). */
  getProfile: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
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
          .where(and(eq(masters.tenantId, tenant.id), eq(masters.active, 1))),
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

      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
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
            description: s.description,
            duration: s.duration,
            price: s.price,
            photos: svcPhotos,
          };
        }),
        masters: masterRows.map((m: any) => ({
          chatId: m.chatId,
          name: m.name,
          tgUsername: m.tgUsername,
          onVacation: !!m.onVacation,
          services: (() => {
            try { return m.services ? JSON.parse(m.services) : []; } catch { return []; }
          })(),
          workHours: (() => {
            try { return m.workHours ? JSON.parse(m.workHours) : null; } catch { return null; }
          })(),
          workDays: (() => {
            try { return m.workDays ? JSON.parse(m.workDays) : null; } catch { return null; }
          })(),
        })),
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
      const { query, city, lat, lng, radiusKm, page, limit } = input;
      const offset = (page - 1) * limit;

      const conditions: any[] = [eq(tenants.publicActive, 1)];

      if (city) {
        conditions.push(like(tenants.city, `%${city}%`));
      }
      if (query) {
        conditions.push(
          or(
            like(tenants.name, `%${query}%`),
            like(tenants.description, `%${query}%`),
            like(tenants.city, `%${query}%`),
          ),
        );
      }

      const rows = await ctx.db
        .select({
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
        })
        .from(tenants)
        .where(and(...conditions))
        .orderBy(tenants.name)
        .limit(limit + 1) // +1 to detect hasMore
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
        };
      });

      // Filter by radius if coordinates provided
      const filtered =
        lat != null && lng != null
          ? items.filter((i) => i.distanceKm == null || i.distanceKm <= radiusKm)
          : items;

      return { items: filtered, hasMore, page, total: filtered.length };
    }),

  /** List distinct cities that have public salons (for search autocomplete). */
  getCities: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .selectDistinct({ city: tenants.city })
      .from(tenants)
      .where(and(eq(tenants.publicActive, 1), isNotNull(tenants.city)))
      .orderBy(tenants.city)
      .limit(100);
    return rows.map((r) => r.city).filter(Boolean) as string[];
  }),
});

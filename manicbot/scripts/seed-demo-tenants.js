/**
 * Seed 3 demo tenants for search visibility + marketing (Sprint 5).
 *
 * Usage:
 *   node scripts/seed-demo-tenants.js
 *
 * Or via admin key:
 *   curl -X POST https://manicbot.com/admin/seed-demo-tenants \
 *     -H "Authorization: Bearer $ADMIN_KEY"
 *
 * Tagged with industry + a `demo` prefix on the slug for easy filtering.
 * Safe to run multiple times — uses INSERT OR IGNORE semantics on the slug.
 */

export const DEMO_TENANTS = [
  {
    id: 't_demo_beauty',
    slug: 'studio-piekna-demo',
    industry: 'beauty',
    name: 'Studio Piękna Warszawa (demo)',
    city: 'Warszawa',
    services: [
      { svcId: 'manikiur_hybrydowy', name: 'Manikiur hybrydowy', price: 120, duration: 90, category: 'nails' },
      { svcId: 'pedikiur_klasyczny', name: 'Pedikiur klasyczny', price: 100, duration: 60, category: 'nails' },
      { svcId: 'stylizacja_brwi', name: 'Stylizacja brwi', price: 80, duration: 45, category: 'brows_lashes' },
      { svcId: 'strzyzenie_damskie', name: 'Strzyżenie damskie', price: 150, duration: 60, category: 'hair' },
      { svcId: 'koloryzacja', name: 'Koloryzacja', price: 250, duration: 120, category: 'hair' },
    ],
  },
  {
    id: 't_demo_cosmetology',
    slug: 'klinika-estetyki-demo',
    industry: 'cosmetology',
    name: 'Klinika Estetyki Warszawa (demo)',
    city: 'Warszawa',
    services: [
      { svcId: 'botox', name: 'Botox — zmarszczki mimiczne', price: 600, duration: 30, category: 'botox' },
      { svcId: 'usta_ha', name: 'Usta — kwas hialuronowy', price: 900, duration: 45, category: 'fillers' },
      { svcId: 'peeling', name: 'Peeling chemiczny', price: 350, duration: 60, category: 'peels' },
      { svcId: 'mezo', name: 'Mezoterapia igłowa', price: 400, duration: 60, category: 'mesotherapy' },
    ],
  },
  {
    id: 't_demo_auto',
    slug: 'autoservice-demo',
    industry: 'auto',
    name: 'AutoService Warszawa (demo)',
    city: 'Warszawa',
    services: [
      { svcId: 'wymiana_oleju', name: 'Wymiana oleju', price: 200, duration: 30, category: 'oil_change' },
      { svcId: 'wymiana_opon', name: 'Wymiana opon', price: 150, duration: 45, category: 'tires' },
      { svcId: 'diagnostyka', name: 'Diagnostyka OBD', price: 100, duration: 30, category: 'diagnostics' },
    ],
  },
];

/**
 * Seed demo tenants into D1. Safe to run multiple times.
 * @param {{ db: D1Database }} ctx
 */
export async function seedDemoTenants(ctx) {
  const now = Math.floor(Date.now() / 1000);
  const results = [];
  for (const tenant of DEMO_TENANTS) {
    try {
      await ctx.db.prepare(`
        INSERT OR IGNORE INTO tenants (id, name, slug, city, industry, active, public_active, plan, billing_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, 'max', 'active', ?, ?)
      `).bind(tenant.id, tenant.name, tenant.slug, tenant.city, tenant.industry, now, now).run();
      for (const s of tenant.services) {
        await ctx.db.prepare(`
          INSERT OR IGNORE INTO services (tenant_id, svc_id, names, duration, price, category, active, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0)
        `).bind(tenant.id, s.svcId, JSON.stringify({ pl: s.name, ru: s.name, en: s.name, ua: s.name }), s.duration, s.price, s.category).run();
      }
      results.push({ tenantId: tenant.id, ok: true });
    } catch (e) {
      results.push({ tenantId: tenant.id, ok: false, error: e?.message });
    }
  }
  return results;
}

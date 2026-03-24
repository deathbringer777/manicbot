import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenants, stripeCustomers } from "~/server/db/schema";
import { eq, desc } from "drizzle-orm";

export const stripeRouter = createTRPCRouter({
  getOverview: adminProcedure.query(async ({ ctx }) => {
    // In a full implementation, this might sync with Stripe API directly via stripe-node
    // For now, we query the local DB state updated via webhooks.
    
    const allTenants = await ctx.db
      .select({
        id: tenants.id,
        name: tenants.name,
        plan: tenants.plan,
        status: tenants.billingStatus,
        customerEmail: tenants.billingEmail,
        createdAt: tenants.createdAt
      })
      .from(tenants)
      .where(eq(tenants.billingStatus, 'active'))
      .orderBy(desc(tenants.createdAt))
      .limit(20);

    const metrics = {
      mrr: 4820, // Mock MRR
      activeSubscribers: allTenants.length, // Simplified
      churnRate: 1.2
    };

    return {
      metrics,
      recentSubscriptions: allTenants.map((t, idx) => ({
        id: t.id,
        name: t.name,
        plan: t.plan,
        email: t.customerEmail ?? `tenant_${idx}@example.com`,
        status: t.status,
        time: new Date(t.createdAt * 1000).toLocaleString()
      }))
    };
  }),
});

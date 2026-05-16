/**
 * Global search — cross-table fuzzy lookup for the command palette.
 *
 * adminProcedure only. Performs a LIKE sweep over tenants, web_users, leads,
 * and marketing_contacts. Row count is capped per table; caller-side Fuse
 * re-ranks across them.
 *
 * Returns a flat array of `SearchHit`s, each tagged with its source so the
 * UI can render the correct icon + navigation target.
 */

import { z } from "zod";
import { or, sql } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenants, webUsers, leads, marketingContacts } from "~/server/db/schema";

export interface SearchHit {
  kind: "tenant" | "user" | "lead" | "contact";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export const searchRouter = createTRPCRouter({
  global: adminProcedure
    .input(
      z.object({
        q: z.string().min(2).max(80),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }): Promise<SearchHit[]> => {
      const raw = input.q.trim().toLowerCase();
      const like = `%${raw.replace(/[%_]/g, "\\$&")}%`;
      const perTable = Math.max(3, Math.ceil(input.limit / 4));

      const [tenantsRows, usersRows, leadsRows, contactsRows] = await Promise.all([
        ctx.db
          .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
          .from(tenants)
          .where(
            or(
              sql`lower(${tenants.name}) like ${like}`,
              sql`lower(coalesce(${tenants.slug}, '')) like ${like}`,
              sql`${tenants.id} = ${raw}`,
            ),
          )
          .limit(perTable),
        ctx.db
          .select({
            id: webUsers.id,
            email: webUsers.email,
            role: webUsers.role,
            tenantId: webUsers.tenantId,
          })
          .from(webUsers)
          .where(sql`lower(${webUsers.email}) like ${like}`)
          .limit(perTable),
        ctx.db
          .select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            phone: leads.phone,
          })
          .from(leads)
          .where(
            or(
              sql`lower(coalesce(${leads.name}, '')) like ${like}`,
              sql`lower(coalesce(${leads.email}, '')) like ${like}`,
              sql`coalesce(${leads.phone}, '') like ${like}`,
            ),
          )
          .limit(perTable),
        ctx.db
          .select({
            id: marketingContacts.id,
            email: marketingContacts.email,
            phone: marketingContacts.phone,
            name: marketingContacts.name,
          })
          .from(marketingContacts)
          .where(
            or(
              sql`lower(coalesce(${marketingContacts.email}, '')) like ${like}`,
              sql`coalesce(${marketingContacts.phone}, '') like ${like}`,
              sql`lower(coalesce(${marketingContacts.name}, '')) like ${like}`,
            ),
          )
          .limit(perTable),
      ]);

      const hits: SearchHit[] = [];
      for (const t of tenantsRows) {
        hits.push({
          kind: "tenant",
          id: t.id,
          title: t.name,
          subtitle: t.slug ? `/${t.slug}` : t.id,
          href: `/tenants?focus=${encodeURIComponent(t.id)}`,
        });
      }
      for (const u of usersRows) {
        hits.push({
          kind: "user",
          id: u.id,
          title: u.email,
          subtitle: u.role ?? "",
          href: `/users?email=${encodeURIComponent(u.email)}`,
        });
      }
      for (const l of leadsRows) {
        hits.push({
          kind: "lead",
          id: String(l.id),
          title: l.name ?? l.email ?? `Lead ${l.id}`,
          subtitle: l.email ?? l.phone ?? null,
          href: `/leads?id=${encodeURIComponent(String(l.id))}`,
        });
      }
      for (const c of contactsRows) {
        // 0062: marketing_contacts.email is now nullable (phone-first
        // salon clients sync into the directory without an email). Fall
        // back to phone or contact-id label so the search result still
        // renders a usable title.
        hits.push({
          kind: "contact",
          id: String(c.id),
          title: c.name ?? c.email ?? c.phone ?? `Contact ${c.id}`,
          subtitle: c.email ?? c.phone ?? null,
          href: `/marketing/contacts?id=${encodeURIComponent(String(c.id))}`,
        });
      }
      return hits.slice(0, input.limit);
    }),
});

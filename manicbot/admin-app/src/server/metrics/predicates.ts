/**
 * Reusable Drizzle WHERE predicates for metric queries.
 *
 * These are the cheap SQL-level pre-filters. The authoritative bucket logic
 * lives in {@link ./status.classifyTenant}; these just keep test data out of
 * the rows we pull in the first place. Keep them in lock-step with status.ts.
 */

import { eq } from "drizzle-orm";
import { tenants } from "~/server/db/schema";

/** Exclude synthetic/test tenants from any business aggregation. */
export const notTestTenant = () => eq(tenants.isTest, 0);

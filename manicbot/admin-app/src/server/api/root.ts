import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { systemRouter } from "~/server/api/routers/system";
import { metricsRouter } from "~/server/api/routers/metrics";
import { usersRouter } from "~/server/api/routers/users";
import { billingRouter } from "~/server/api/routers/billing";
import { settingsRouter } from "~/server/api/routers/settings";
import { tenantsRouter } from "~/server/api/routers/tenants";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { exportRouter } from "~/server/api/routers/export";
import { provisioningRouter } from "~/server/api/routers/provisioning";

export const appRouter = createTRPCRouter({
  system: systemRouter,
  metrics: metricsRouter,
  users: usersRouter,
  billing: billingRouter,
  settings: settingsRouter,
  tenants: tenantsRouter,
  appointments: appointmentsRouter,
  export: exportRouter,
  provisioning: provisioningRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

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
import { authRouter } from "~/server/api/routers/auth";
import { salonRouter } from "~/server/api/routers/salon";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { supportRouter } from "~/server/api/routers/support";
import { channelRouter } from "~/server/api/routers/channels";
import { conversationsRouter } from "~/server/api/routers/conversations";
import { googleCalendarRouter } from "~/server/api/routers/googleCalendar";
import { publicSalonRouter } from "~/server/api/routers/publicSalon";
import { eventsRouter } from "~/server/api/routers/events";
import { webUsersRouter } from "~/server/api/routers/webUsers";
import { reviewsRouter } from "~/server/api/routers/reviews";
import { analyticsRouter } from "~/server/api/routers/analytics";
import { roleChangeRequestsRouter } from "~/server/api/routers/roleChangeRequests";
import { onboardingRouter } from "~/server/api/routers/onboarding";
import { promoCodesRouter } from "~/server/api/routers/promoCodes";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  salon: salonRouter,
  master: masterRouter,
  support: supportRouter,
  channels: channelRouter,
  conversations: conversationsRouter,
  googleCalendar: googleCalendarRouter,
  system: systemRouter,
  metrics: metricsRouter,
  users: usersRouter,
  billing: billingRouter,
  settings: settingsRouter,
  tenants: tenantsRouter,
  appointments: appointmentsRouter,
  export: exportRouter,
  provisioning: provisioningRouter,
  publicSalon: publicSalonRouter,
  events: eventsRouter,
  webUsers: webUsersRouter,
  reviews: reviewsRouter,
  analytics: analyticsRouter,
  roleChangeRequests: roleChangeRequestsRouter,
  onboarding: onboardingRouter,
  promoCodes: promoCodesRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

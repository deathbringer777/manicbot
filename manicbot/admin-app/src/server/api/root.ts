import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { systemRouter } from "~/server/api/routers/system";
import { metricsRouter } from "~/server/api/routers/metrics";
import { usersRouter } from "~/server/api/routers/users";
import { billingRouter } from "~/server/api/routers/billing";
import { settingsRouter } from "~/server/api/routers/settings";
import { tenantsRouter } from "~/server/api/routers/tenants";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { appointmentBlocksRouter } from "~/server/api/routers/appointmentBlocks";
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
import { stampCardRouter } from "~/server/api/routers/stampCard";
import { leadsRouter } from "~/server/api/routers/leads";
import { marketingRouter } from "~/server/api/routers/marketing";
import { marketingTenantRouter } from "~/server/api/routers/marketingTenant";
import { tenantStaffRouter } from "~/server/api/routers/tenantStaff";
import { pluginsRouter } from "~/server/api/routers/plugins";
import { searchRouter } from "~/server/api/routers/search";
import { consentRouter } from "~/server/api/routers/consent";
import { errorEventsRouter } from "~/server/api/routers/errorEvents";
import { marketingAutopilotRouter } from "~/server/api/routers/marketingAutopilot";
import { ownershipRouter } from "~/server/api/routers/ownership";
import { clientsRouter } from "~/server/api/routers/clients";
import { otpRouter } from "~/server/api/routers/otp";
import { referralsRouter } from "~/server/api/routers/referrals";
import { messengerRouter } from "~/server/api/routers/messenger";
import { platformMessengerRouter } from "~/server/api/routers/platformMessenger";
import { pluginRemindersRouter } from "~/server/api/routers/pluginReminders";
import { notificationsRouter } from "~/server/api/routers/notifications";
import { pushSubscriptionsRouter } from "~/server/api/routers/pushSubscriptions";
import { metaOAuthRouter } from "~/server/api/routers/metaOAuth";

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
  appointmentBlocks: appointmentBlocksRouter,
  export: exportRouter,
  provisioning: provisioningRouter,
  publicSalon: publicSalonRouter,
  events: eventsRouter,
  webUsers: webUsersRouter,
  reviews: reviewsRouter,
  analytics: analyticsRouter,
  roleChangeRequests: roleChangeRequestsRouter,
  ownership: ownershipRouter,
  onboarding: onboardingRouter,
  promoCodes: promoCodesRouter,
  stampCard: stampCardRouter,
  leads: leadsRouter,
  marketing: marketingRouter,
  marketingTenant: marketingTenantRouter,
  tenantStaff: tenantStaffRouter,
  plugins: pluginsRouter,
  search: searchRouter,
  consent: consentRouter,
  errorEvents: errorEventsRouter,
  marketingAutopilot: marketingAutopilotRouter,
  clients: clientsRouter,
  otp: otpRouter,
  referrals: referralsRouter,
  messenger: messengerRouter,
  platformMessenger: platformMessengerRouter,
  pluginReminders: pluginRemindersRouter,
  notifications: notificationsRouter,
  pushSubscriptions: pushSubscriptionsRouter,
  metaOAuth: metaOAuthRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

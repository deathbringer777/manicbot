import { uniqueIndex, index, sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  salon: text("salon"),
  photos: text("photos"),
  aboutPhotos: text("about_photos"),
  mapsUrl: text("maps_url"),
  instagramUrl: text("instagram_url"),
  plan: text("plan").default("start"),
  billingStatus: text("billing_status").default("trialing"),
  subscriptionStatus: text("subscription_status"),
  trialEndsAt: integer("trial_ends_at"),
  graceEndsAt: integer("grace_ends_at"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  currentPeriodEnd: integer("current_period_end"),
  nextPaymentDate: integer("next_payment_date"),
  billingEmail: text("billing_email"),
  cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
  slug: text("slug"),
  description: text("description"),
  lat: real("lat"),
  lng: real("lng"),
  city: text("city"),
  publicActive: integer("public_active").notNull().default(0),
  searchText: text("search_text"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const bots = sqliteTable("bots", {
  botId: text("bot_id").primaryKey(),
  tenantId: text("tenant_id"),
  botUsername: text("bot_username"),
  webhookSecret: text("webhook_secret"),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_bot_tenant").on(t.tenantId)]);

export const users = sqliteTable("users", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  name: text("name"),
  tgUsername: text("tg_username"),
  tgLang: text("tg_lang"),
  phone: text("phone"),
  registeredAt: integer("registered_at"),
}, (t) => [
  index("idx_user_username").on(t.tenantId, t.tgUsername),
  index("idx_user_phone").on(t.tenantId, t.phone),
]);

export const masters = sqliteTable("masters", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  name: text("name"),
  tgUsername: text("tg_username"),
  services: text("services"),
  workHours: text("work_hours"),
  workDays: text("work_days"),
  onVacation: integer("on_vacation").notNull().default(0),
  active: integer("active").notNull().default(1),
  addedAt: integer("added_at"),
  googleCalendarId: text("google_calendar_id"),
  calendarEnabled: integer("calendar_enabled").notNull().default(0),
  bio: text("bio"),
  photo: text("photo"),
}, (t) => [index("idx_master_tenant").on(t.tenantId)]);

export const tenantRoles = sqliteTable("tenant_roles", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  role: text("role").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("idx_tenant_role_unique").on(t.tenantId, t.chatId)]);

export const platformRoles = sqliteTable("platform_roles", {
  chatId: integer("chat_id").primaryKey(),
  role: text("role").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  svcId: text("svc_id").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  ts: integer("ts").notNull(),
  status: text("status").notNull().default("pending"),
  masterId: integer("master_id"),
  userName: text("user_name"),
  userPhone: text("user_phone"),
  userTg: text("user_tg"),
  confirmedBy: integer("confirmed_by"),
  counterTime: text("counter_time"),
  counterComment: text("counter_comment"),
  rejectComment: text("reject_comment"),
  cancelReason: text("cancel_reason"),
  cancelled: integer("cancelled").notNull().default(0),
  remH24: integer("rem_h24").notNull().default(0),
  remH2: integer("rem_h2").notNull().default(0),
  googleEventId: text("google_event_id"),
  googleCalendarId: text("google_calendar_id"),
  googleIntegrationId: text("google_integration_id"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_apt_tenant_date").on(t.tenantId, t.date),
  index("idx_apt_tenant_status").on(t.tenantId, t.status),
  index("idx_apt_tenant_ts").on(t.tenantId, t.ts),
]);

export const services = sqliteTable("services", {
  tenantId: text("tenant_id").notNull(),
  svcId: text("svc_id").notNull(),
  emoji: text("emoji"),
  duration: integer("duration").notNull(),
  price: real("price").notNull(),
  active: integer("active").notNull().default(1),
  hidden: integer("hidden").notNull().default(0),
  names: text("names"),
  description: text("description"),
  photos: text("photos"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const tenantConfig = sqliteTable("tenant_config", {
  tenantId: text("tenant_id").notNull(),
  key: text("key").notNull(),
  value: text("value"),
}, (t) => [uniqueIndex("idx_tenant_config_key").on(t.tenantId, t.key)]);

export const blockedUsers = sqliteTable("blocked_users", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
}, (t) => [uniqueIndex("idx_blocked_user_unique").on(t.tenantId, t.chatId)]);

export const stripeCustomers = sqliteTable("stripe_customers", {
  customerId: text("customer_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
});

export const localTickets = sqliteTable("local_tickets", {
  tenantId: text("tenant_id").notNull(),
  clientCid: integer("client_cid").notNull(),
  masterCid: integer("master_cid"),
  open: integer("open").notNull().default(1),
  data: text("data"),
});

export const humanRequests = sqliteTable("human_requests", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  count: integer("count").notNull().default(0),
});

export const platformTickets = sqliteTable("platform_tickets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  clientChatId: integer("client_chat_id").notNull(),
  clientBotId: text("client_bot_id"),
  clientName: text("client_name"),
  status: text("status").notNull().default("open"),
  claimedBy: integer("claimed_by"),
  claimedAt: integer("claimed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const platformTicketMessages = sqliteTable("platform_ticket_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: text("ticket_id").notNull(),
  sender: text("sender").notNull(),
  text: text("text"),
  createdAt: integer("created_at").notNull(),
});

export const supportAgents = sqliteTable("support_agents", {
  chatId: integer("chat_id").primaryKey(),
  type: text("type").notNull(),
});

export const tenantSupportAgents = sqliteTable("tenant_support_agents", {
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
});

// ─── Multi-channel tables ─────────────────────────────────────────────────────

export const channelConfigs = sqliteTable("channel_configs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  channelType: text("channel_type").notNull(),
  config: text("config"),
  tokenEncrypted: text("token_encrypted"),
  tokenExpiresAt: integer("token_expires_at"),
  webhookVerifyToken: text("webhook_verify_token"),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_cc_tenant").on(t.tenantId),
  index("idx_cc_type").on(t.channelType),
  uniqueIndex("idx_cc_tenant_type").on(t.tenantId, t.channelType),
]);

export const channelIdentities = sqliteTable("channel_identities", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  internalUserId: integer("internal_user_id"),
  channelType: text("channel_type").notNull(),
  channelUserId: text("channel_user_id").notNull(),
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  uniqueIndex("idx_ci_unique").on(t.tenantId, t.channelType, t.channelUserId),
  index("idx_ci_internal").on(t.tenantId, t.internalUserId),
]);

export const messageWindows = sqliteTable("message_windows", {
  tenantId: text("tenant_id").notNull(),
  channelType: text("channel_type").notNull(),
  channelUserId: text("channel_user_id").notNull(),
  lastUserMessageAt: integer("last_user_message_at").notNull(),
}, (t) => [
  uniqueIndex("idx_mw_pk").on(t.tenantId, t.channelType, t.channelUserId),
]);

export const templateUsage = sqliteTable("template_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  channelType: text("channel_type").notNull().default("whatsapp"),
  templateName: text("template_name").notNull(),
  sentAt: integer("sent_at").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
}, (t) => [
  index("idx_tu_tenant_sent").on(t.tenantId, t.sentAt),
]);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  channelType: text("channel_type").notNull(),
  channelUserId: text("channel_user_id").notNull(),
  internalUserId: integer("internal_user_id"),
  status: text("status").notNull().default("open"),
  lastMessageAt: integer("last_message_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_conv_tenant_msg").on(t.tenantId, t.lastMessageAt),
]);

// ─── Google Calendar integration ─────────────────────────────────────────────

export const googleIntegrations = sqliteTable("google_integrations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  scope: text("scope").notNull(),
  masterChatId: integer("master_chat_id"),
  providerAccountEmail: text("provider_account_email"),
  calendarId: text("calendar_id").notNull(),
  calendarSummary: text("calendar_summary"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  syncEnabled: integer("sync_enabled").notNull().default(1),
  syncDirection: text("sync_direction").notNull().default("two_way"),
  watchChannelId: text("watch_channel_id"),
  watchResourceId: text("watch_resource_id"),
  watchExpiration: integer("watch_expiration"),
  lastSyncAt: integer("last_sync_at"),
  lastSyncStatus: text("last_sync_status"),
  lastSyncError: text("last_sync_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_gcal_integration_scope").on(t.tenantId, t.scope, t.masterChatId),
]);

export const googleBusyBlocks = sqliteTable("google_busy_blocks", {
  id: text("id").primaryKey(),
  integrationId: text("integration_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  calendarId: text("calendar_id").notNull(),
  externalEventId: text("external_event_id").notNull(),
  summary: text("summary"),
  description: text("description"),
  location: text("location"),
  creator: text("creator"),
  startTs: integer("start_ts").notNull(),
  endTs: integer("end_ts").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_gcal_busy_lookup").on(t.integrationId, t.startTs, t.endTs),
]);

// ─── Web Auth (email/password login for tenant owners) ────────────────────────

export const webUsers = sqliteTable("web_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Tenant this web user belongs to (required for tenant_owner / master) */
  tenantId: text("tenant_id"),
  /** Role: tenant_owner | system_admin | support | technical_support */
  role: text("role").notNull().default("tenant_owner"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("idx_web_user_email").on(t.email),
  index("idx_web_user_tenant").on(t.tenantId),
]);

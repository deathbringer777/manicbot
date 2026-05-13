import { uniqueIndex, index, sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

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
  logo: text("logo"),
  coverPhoto: text("cover_photo"),
  displayName: text("display_name"),
  logoR2Key: text("logo_r2_key"),
  coverR2Key: text("cover_r2_key"),
  brandPalette: text("brand_palette"),
  isPersonal: integer("is_personal").notNull().default(0),
  industry: text("industry").notNull().default("beauty"),
  isTest: integer("is_test").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const bots = sqliteTable("bots", {
  botId: text("bot_id").primaryKey(),
  tenantId: text("tenant_id"),
  botUsername: text("bot_username"),
  webhookSecret: text("webhook_secret"),
  tokenEncrypted: text("token_encrypted"),
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
  tosAcceptedAt: integer("tos_accepted_at"),
  firstSource: text("first_source"),
  firstCampaign: text("first_campaign"),
  firstMedium: text("first_medium"),
  firstTouchAt: integer("first_touch_at"),
  dob: text("dob"),
}, (t) => [
  index("idx_user_username").on(t.tenantId, t.tgUsername),
  index("idx_users_tenant_dob").on(t.tenantId, t.dob),
  index("idx_user_phone").on(t.tenantId, t.phone),
]);

export const userOrigins = sqliteTable("user_origins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  chatId: integer("chat_id").notNull(),
  channel: text("channel").notNull(),
  source: text("source"),
  medium: text("medium"),
  campaign: text("campaign"),
  content: text("content"),
  landingUrl: text("landing_url"),
  referer: text("referer"),
  rawPayload: text("raw_payload"),
  capturedAt: integer("captured_at").notNull(),
  isFirstTouch: integer("is_first_touch").notNull().default(0),
}, (t) => [
  index("idx_uo_tenant_chat").on(t.tenantId, t.chatId),
  index("idx_uo_tenant_source").on(t.tenantId, t.source, t.capturedAt),
  index("idx_uo_tenant_campaign").on(t.tenantId, t.campaign, t.capturedAt),
  index("idx_uo_tenant_first").on(t.tenantId, t.isFirstTouch, t.capturedAt),
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
  portfolio: text("portfolio"),
  allowDelegation: integer("allow_delegation").notNull().default(0),
  webUserId: text("web_user_id"),
  calendarVisibility: text("calendar_visibility").notNull().default("salon_only"),
  isSynthetic: integer("is_synthetic").notNull().default(0),
}, (t) => [
  index("idx_master_tenant").on(t.tenantId),
  index("idx_master_web_user_id").on(t.webUserId),
  index("idx_master_tenant_web_user").on(t.tenantId, t.webUserId),
  index("idx_masters_calendar_visibility").on(t.tenantId, t.calendarVisibility),
]);

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
  cancelledBy: text("cancelled_by"),
  cancelledAt: integer("cancelled_at"),
  noShow: integer("no_show").default(0),
  noShowBy: text("no_show_by"),
  remH24: integer("rem_h24").notNull().default(0),
  remH2: integer("rem_h2").notNull().default(0),
  googleEventId: text("google_event_id"),
  googleCalendarId: text("google_calendar_id"),
  googleIntegrationId: text("google_integration_id"),
  syncRetries: integer("sync_retries").default(0),
  syncRetryAfter: integer("sync_retry_after"),
  syncLastError: text("sync_last_error"),
  reviewRequested: integer("review_requested").default(0),
  visitConfirmedAt: integer("visit_confirmed_at"),
  visitConfirmedBy: text("visit_confirmed_by"),
  reviewRequestedAt: integer("review_requested_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_apt_tenant_date").on(t.tenantId, t.date),
  index("idx_apt_tenant_status").on(t.tenantId, t.status),
  index("idx_apt_tenant_ts").on(t.tenantId, t.ts),
  // 0051: composite indexes for cron + analytics hot paths.
  index("idx_apt_master_date").on(t.tenantId, t.masterId, t.date),
  index("idx_apt_created").on(t.tenantId, t.createdAt),
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
  promo: text("promo"),
  sortOrder: integer("sort_order").notNull().default(0),
  category: text("category"),
  industrySpecificProps: text("industry_specific_props"),
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
  claimedByWebUserId: text("claimed_by_web_user_id"),
  claimedAt: integer("claimed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const platformTicketMessages = sqliteTable("platform_ticket_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: text("ticket_id").notNull(),
  sender: text("sender").notNull(),
  text: text("text"),
  attachmentUrl: text("attachment_url"),
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
  pageId: text("page_id"),
  phoneNumberId: text("phone_number_id"),
  igBusinessId: text("ig_business_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_cc_tenant").on(t.tenantId),
  index("idx_cc_type").on(t.channelType),
  uniqueIndex("idx_cc_tenant_type").on(t.tenantId, t.channelType),
  index("idx_cc_page_id").on(t.channelType, t.pageId),
  index("idx_cc_phone").on(t.channelType, t.phoneNumberId),
  index("idx_cc_ig_biz").on(t.channelType, t.igBusinessId),
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
  // 0051: enables "this user's history" lookups in unified inbox.
  index("idx_conv_user").on(t.tenantId, t.channelUserId),
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
  passwordHash: text("password_hash").notNull().default(""),
  /** Tenant this web user belongs to (required for tenant_owner / master) */
  tenantId: text("tenant_id"),
  /** Role: tenant_owner | system_admin | support | technical_support | master */
  role: text("role").notNull().default("tenant_owner"),
  name: text("name"),
  lang: text("lang").default("en"),
  referralSource: text("referral_source"),
  referralNote: text("referral_note"),
  emailVerified: integer("email_verified").notNull().default(0),
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: integer("verification_token_expires_at"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  newEmail: text("new_email"),
  emailChangeToken: text("email_change_token"),
  emailChangeTokenExpiresAt: integer("email_change_token_expires_at"),
  tosAcceptedAt: integer("tos_accepted_at"),
  loginAttempts: integer("login_attempts").notNull().default(0),
  lockedUntil: integer("locked_until"),
  lastLoginIp: text("last_login_ip"),
  lastLoginAt: integer("last_login_at"),
  passwordChangedAt: integer("password_changed_at").notNull().default(0),
  sessionsInvalidatedAt: integer("sessions_invalidated_at").notNull().default(0),
  /** SHA-256 of one-time post-verify login token (migration 0047). */
  loginTokenHash: text("login_token_hash"),
  loginTokenExpiresAt: integer("login_token_expires_at"),
  /**
   * 0053: hash-named companions for the three legacy plaintext-named columns
   * above. Writers populate both during the deprecation window; readers
   * prefer the *_hash column and fall back to the legacy column for any
   * tokens minted before the deploy.
   */
  passwordResetTokenHash: text("password_reset_token_hash"),
  verificationTokenHash: text("verification_token_hash"),
  emailChangeTokenHash: text("email_change_token_hash"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("idx_web_user_email").on(t.email),
  index("idx_web_user_tenant").on(t.tenantId),
  index("idx_web_users_login_token").on(t.loginTokenHash),
]);

// ─── Reviews & Ratings ──────────────────────────────────────────────────────

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  appointmentId: text("appointment_id"),
  masterId: text("master_id"),
  chatId: integer("chat_id").notNull(),
  channel: text("channel").default("telegram"),
  rating: integer("rating").notNull(),
  text: text("text"),
  photos: text("photos"),
  status: text("status").notNull().default("active"),
  replyText: text("reply_text"),
  replyAt: integer("reply_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_reviews_tenant").on(t.tenantId),
  index("idx_reviews_master").on(t.tenantId, t.masterId),
  index("idx_reviews_apt").on(t.appointmentId),
]);

// ─── Persistent Audit Log ───────────────────────────────────────────────────

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id"),
  actor: text("actor"),
  action: text("action").notNull(),
  detail: text("detail"),
  ip: text("ip"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_audit_log_tenant").on(t.tenantId, t.createdAt),
  index("idx_audit_log_action").on(t.action, t.createdAt),
  index("idx_audit_log_actor").on(t.actor, t.createdAt),
]);

// ─── Role Change Requests ───────────────────────────────────────────────────

export const roleChangeRequests = sqliteTable("role_change_requests", {
  id: text("id").primaryKey(),
  webUserId: text("web_user_id").notNull(),
  currentRole: text("current_role").notNull(),
  requestedRole: text("requested_role").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_rcr_user").on(t.webUserId, t.createdAt),
  index("idx_rcr_status").on(t.status, t.createdAt),
]);

// ─── D1-based rate limiting ─────────────────────────────────────────────────

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").notNull(),
  action: text("action").notNull(),
  count: integer("count").notNull().default(1),
  windowStart: integer("window_start").notNull(),
}, (t) => [
  index("idx_rl_window").on(t.windowStart),
  index("idx_rl_key_action_window").on(t.key, t.action, t.windowStart),
]);

// ─── Sprint 2-5 additions (migration 0029) ──────────────────────────────────

export const aiUsage = sqliteTable("ai_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  usageDate: text("usage_date").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  modelCalls: integer("model_calls").notNull().default(0),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
}, (t) => [
  index("idx_ai_usage_tenant_date").on(t.tenantId, t.usageDate),
]);

export const emailSuppressions = sqliteTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("resend"),
  suppressedAt: integer("suppressed_at").notNull(),
  detail: text("detail"),
});

export const stripeEvents = sqliteTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at").notNull(),
  processedAt: integer("processed_at"),
}, (t) => [
  index("idx_stripe_events_type").on(t.type, t.receivedAt),
]);

export const tenantOnboarding = sqliteTable("tenant_onboarding", {
  tenantId: text("tenant_id").primaryKey(),
  completedSteps: text("completed_steps").notNull().default("[]"),
  allCompletedAt: integer("all_completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const promoCodes = sqliteTable("promo_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  kind: text("kind").notNull(),
  discountType: text("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  maxUses: integer("max_uses"),
  maxUsesPerClient: integer("max_uses_per_client").notNull().default(1),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until"),
  minOrderPln: integer("min_order_pln"),
  clientId: text("client_id"),
  serviceIds: text("service_ids"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_promos_tenant_valid").on(t.tenantId, t.validUntil, t.validFrom),
]);

export const promoCodeUses = sqliteTable("promo_code_uses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  promoCodeId: integer("promo_code_id").notNull(),
  appointmentId: text("appointment_id").notNull(),
  clientId: text("client_id").notNull(),
  usedAt: integer("used_at").notNull(),
});

export const stampCardConfigs = sqliteTable("stamp_card_configs", {
  tenantId: text("tenant_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  visitsRequired: integer("visits_required").notNull().default(5),
  rewardType: text("reward_type").notNull().default("free_service"),
  rewardValue: integer("reward_value"),
  serviceIds: text("service_ids"),
  updatedAt: integer("updated_at").notNull(),
});

export const stampCardProgress = sqliteTable("stamp_card_progress", {
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  visitsCompleted: integer("visits_completed").notNull().default(0),
  rewardsEarned: integer("rewards_earned").notNull().default(0),
  rewardsRedeemed: integer("rewards_redeemed").notNull().default(0),
  lastVisitAt: integer("last_visit_at"),
});

export const analyticsEvents = sqliteTable("analytics_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id"),
  userId: text("user_id"),
  event: text("event").notNull(),
  properties: text("properties"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_analytics_tenant_event_time").on(t.tenantId, t.event, t.createdAt),
]);

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  salonType: text("salon_type"),
  mastersCount: integer("masters_count"),
  note: text("note"),
  source: text("source").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("new"),
  createdAt: integer("created_at").notNull(),
});

export const emailSubscribers = sqliteTable("email_subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  locale: text("locale").notNull().default("ru"),
  confirmed: integer("confirmed").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const marketingContacts = sqliteTable("marketing_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  name: text("name"),
  phone: text("phone"),
  source: text("source"),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  leadCount: integer("lead_count").notNull().default(1),
  unsubscribed: integer("unsubscribed").notNull().default(0),
  tenantId: text("tenant_id"),
  tags: text("tags"),
  customFields: text("custom_fields"),
  consentEmail: integer("consent_email").notNull().default(1),
  consentSms: integer("consent_sms").notNull().default(0),
  brevoContactId: text("brevo_contact_id"),
  unsubscribeToken: text("unsubscribe_token"),
  locale: text("locale"),
  lifecycleStage: text("lifecycle_stage"),
}, (t) => [
  uniqueIndex("idx_marketing_contacts_email").on(t.email),
  index("idx_marketing_contacts_phone").on(t.phone),
  index("idx_marketing_contacts_last_seen").on(t.lastSeenAt),
  index("idx_marketing_contacts_tenant").on(t.tenantId),
  uniqueIndex("idx_marketing_contacts_unsub_tok").on(t.unsubscribeToken),
]);

export const marketingSegments = sqliteTable("marketing_segments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  name: text("name").notNull(),
  description: text("description"),
  filterJson: text("filter_json").notNull(),
  contactCount: integer("contact_count").notNull().default(0),
  lastComputedAt: integer("last_computed_at"),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_mkt_segments_tenant").on(t.tenantId)]);

export const marketingTemplates = sqliteTable("marketing_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  variablesJson: text("variables_json"),
  locale: text("locale"),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_mkt_templates_tenant").on(t.tenantId),
  index("idx_mkt_templates_channel").on(t.channel),
]);

export const marketingCampaigns = sqliteTable("marketing_campaigns", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  segmentId: text("segment_id"),
  templateId: text("template_id"),
  provider: text("provider"),
  status: text("status").notNull().default("draft"),
  scheduledAt: integer("scheduled_at"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  statsJson: text("stats_json"),
  error: text("error"),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_mkt_campaigns_tenant").on(t.tenantId),
  index("idx_mkt_campaigns_status").on(t.status),
  index("idx_mkt_campaigns_scheduled").on(t.scheduledAt),
]);

export const marketingSends = sqliteTable("marketing_sends", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  contactId: integer("contact_id").notNull(),
  recipient: text("recipient").notNull(),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  queuedAt: integer("queued_at").notNull(),
  sentAt: integer("sent_at"),
  deliveredAt: integer("delivered_at"),
  openedAt: integer("opened_at"),
  clickedAt: integer("clicked_at"),
  bouncedAt: integer("bounced_at"),
}, (t) => [
  index("idx_mkt_sends_campaign").on(t.campaignId),
  index("idx_mkt_sends_contact").on(t.contactId),
  index("idx_mkt_sends_status").on(t.status),
  index("idx_mkt_sends_provider_msg").on(t.providerMessageId),
  // 0051: campaign progress page reads (campaign_id, status) together.
  index("idx_msend_campaign_status").on(t.campaignId, t.status),
]);

export const marketingAutomations = sqliteTable("marketing_automations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),
  triggerConfigJson: text("trigger_config_json"),
  stepsJson: text("steps_json").notNull(),
  enabled: integer("enabled").notNull().default(0),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_mkt_automations_tenant").on(t.tenantId),
  index("idx_mkt_automations_enabled").on(t.enabled),
]);

export const marketingProviders = sqliteTable("marketing_providers", {
  name: text("name").primaryKey(),
  type: text("type").notNull(),
  enabled: integer("enabled").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0),
  configJson: text("config_json"),
  healthStatus: text("health_status"),
  healthDetail: text("health_detail"),
  lastCheckAt: integer("last_check_at"),
  quotaUsed: integer("quota_used"),
  quotaLimit: integer("quota_limit"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const marketingConsentLog = sqliteTable("marketing_consent_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull(),
  event: text("event").notNull(),
  source: text("source"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_mkt_consent_contact").on(t.contactId),
  index("idx_mkt_consent_created").on(t.createdAt),
]);

export const industryConfigs = sqliteTable("industry_configs", {
  industry: text("industry").primaryKey(),
  displayName: text("display_name").notNull(),
  defaultServiceCategories: text("default_service_categories").notNull(),
  defaultFeatures: text("default_features").notNull(),
  aiPromptSuffix: text("ai_prompt_suffix"),
  createdAt: integer("created_at").notNull(),
});

// ─── Phase 2: tenant_manager role ──────────────────────────────────────────

export const tenantMemberPermissions = sqliteTable("tenant_member_permissions", {
  tenantId: text("tenant_id").notNull(),
  webUserId: text("web_user_id").notNull(),
  permission: text("permission").notNull(),
  grantedAt: integer("granted_at").notNull(),
  grantedBy: text("granted_by").notNull(),
}, (t) => [
  index("idx_tmp_user").on(t.webUserId),
  index("idx_tmp_tenant").on(t.tenantId),
]);

export const tenantActionRequests = sqliteTable("tenant_action_requests", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  requesterId: text("requester_id").notNull(),
  action: text("action").notNull(),
  payload: text("payload"),
  status: text("status").notNull().default("pending"),
  ownerNote: text("owner_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_tar_tenant_status").on(t.tenantId, t.status, t.createdAt),
  index("idx_tar_requester").on(t.requesterId, t.createdAt),
]);

export const permissionElevationCodes = sqliteTable("permission_elevation_codes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  targetUserId: text("target_user_id").notNull(),
  permissions: text("permissions").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_pec_owner").on(t.ownerUserId, t.expiresAt),
  index("idx_pec_tenant").on(t.tenantId, t.expiresAt),
]);

// ─── Plugin Marketplace (migration 0035) ───────────────────────────────────

export const pluginInstallations = sqliteTable("plugin_installations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  pluginSlug: text("plugin_slug").notNull(),
  enabled: integer("enabled").notNull().default(1),
  version: text("version").notNull(),
  installedBy: text("installed_by").notNull(),
  installedAt: integer("installed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  settingsJson: text("settings_json"),
  billingState: text("billing_state").notNull().default("not_applicable"),
  stripeSubscriptionItemId: text("stripe_subscription_item_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
}, (t) => [
  index("idx_plugin_inst_tenant").on(t.tenantId),
  index("idx_plugin_inst_slug").on(t.pluginSlug),
  index("idx_plugin_inst_billing").on(t.billingState),
]);

export const pluginEvents = sqliteTable("plugin_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  installationId: text("installation_id").notNull(),
  event: text("event").notNull(),
  actorWebUserId: text("actor_web_user_id"),
  detailJson: text("detail_json"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_plugin_events_inst").on(t.installationId, t.createdAt),
  index("idx_plugin_events_created").on(t.createdAt),
]);

// ─── Plugin Pins (migration 0036, FK added in 0037) ──────────────────────
// Per-user sidebar shortcuts. Independent of plugin_installations — a user may
// pin a platform-wide plugin without owning the install row.
// ON DELETE CASCADE: removing a web_user drops their pins automatically.
export const pluginPins = sqliteTable("plugin_pins", {
  webUserId: text("web_user_id").notNull().references(() => webUsers.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().default(""),
  pluginSlug: text("plugin_slug").notNull(),
  pinnedAt: integer("pinned_at").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.webUserId, t.tenantId, t.pluginSlug] }),
  index("idx_plugin_pins_user").on(t.webUserId, t.tenantId, t.sortOrder),
  index("idx_plugin_pins_user_at").on(t.webUserId, t.tenantId, t.pinnedAt),
]);

// ─── Error log (migration 0039) ──────────────────────────────────────────
// Sink for client-side React error boundaries and unhandled tRPC errors.
// Inserted by /api/error-report (POST from app/global-error.tsx and
// app/(dashboard)/error.tsx) and by the trpc errorFormatter when wrapping
// non-TRPCError throws.
export const errorLog = sqliteTable("error_log", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  source: text("source").notNull(),
  message: text("message").notNull(),
  digest: text("digest"),
  url: text("url"),
  userAgent: text("user_agent"),
  userId: text("user_id"),
  tenantId: text("tenant_id"),
  detailJson: text("detail_json"),
}, (t) => [
  index("idx_error_log_created_at").on(t.createdAt),
  index("idx_error_log_source").on(t.source, t.createdAt),
  index("idx_error_log_user").on(t.userId, t.createdAt),
]);

// ─── Cookie consent log (migration 0049) ─────────────────────────────────
// APPEND-ONLY audit trail of cookie banner decisions. The application never
// UPDATEs or DELETEs. Tracking activation MUST consult this table — never the
// localStorage cache alone — so a tampered client cannot enable analytics.
// Distinct from `marketing_consent_log` (email/SMS opt-ins keyed by contact_id).
export const cookieConsentLog = sqliteTable("cookie_consent_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  anonymousId: text("anonymous_id").notNull(),
  webUserId: text("web_user_id"),
  categories: text("categories").notNull(),
  policyVersion: text("policy_version").notNull(),
  source: text("source"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_cookie_consent_anon").on(t.anonymousId, t.createdAt),
  index("idx_cookie_consent_user").on(t.webUserId, t.createdAt),
  index("idx_cookie_consent_created").on(t.createdAt),
]);

// ─── Error events (custom error monitoring) ──────────────────────────────
// Custom in-house error tracking — replaces external services (Sentry etc.)
// Errors are deduplicated by `fingerprint` (stable hash of source+message+path);
// repeated occurrences bump `count` and `last_seen` rather than inserting new
// rows. `resolved_at` is set by an admin via the God Mode `/errors` page.
//
// The companion migration that creates this table lives in the Worker side
// (`manicbot/migrations/`). When that migration lands, this Drizzle definition
// must stay in lockstep with the SQL DDL (`schema.sql`).
export const errorEvents = sqliteTable("error_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fingerprint: text("fingerprint").notNull(),
  source: text("source").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  stack: text("stack"),
  path: text("path"),
  tenantId: text("tenant_id"),
  userId: text("user_id"),
  context: text("context"),
  count: integer("count").notNull().default(1),
  firstSeen: integer("first_seen").notNull(),
  lastSeen: integer("last_seen").notNull(),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_error_events_severity_seen").on(t.severity, t.lastSeen),
  index("idx_error_events_fingerprint").on(t.fingerprint),
  index("idx_error_events_tenant").on(t.tenantId, t.lastSeen),
  index("idx_error_events_unresolved").on(t.resolvedAt, t.lastSeen),
]);

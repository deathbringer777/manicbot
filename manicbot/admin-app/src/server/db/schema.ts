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
  chatEnabled: integer("chat_enabled").notNull().default(1),
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
  // 0062: clients tab overhaul — multi-channel contact, CRM fields, soft-delete.
  email: text("email"),
  igUsername: text("ig_username"),
  notes: text("notes"),
  tags: text("tags"),
  marketingContactId: integer("marketing_contact_id"),
  isBlockedGlobal: integer("is_blocked_global").notNull().default(0),
  blockedGlobalReason: text("blocked_global_reason"),
  blockedGlobalAt: integer("blocked_global_at"),
  updatedAt: integer("updated_at"),
  deletedAt: integer("deleted_at"),
  lifetimeVisits: integer("lifetime_visits").notNull().default(0),
  lastVisitAt: integer("last_visit_at"),
  // 0072: client avatar — emoji and/or uploaded photo. UI shows the photo
  // when avatarUrl is set, otherwise the saved emoji, otherwise '👩'.
  avatarEmoji: text("avatar_emoji"),
  avatarUrl: text("avatar_url"),
  avatarR2Key: text("avatar_r2_key"),
  // 0074: manual pin for "favorite master". NULL → derived from history.
  favoriteMasterId: integer("favorite_master_id"),
}, (t) => [
  index("idx_user_username").on(t.tenantId, t.tgUsername),
  index("idx_users_tenant_dob").on(t.tenantId, t.dob),
  index("idx_user_phone").on(t.tenantId, t.phone),
  index("idx_users_tenant_email").on(t.tenantId, t.email),
  index("idx_users_tenant_ig").on(t.tenantId, t.igUsername),
  index("idx_users_marketing_id").on(t.marketingContactId),
  index("idx_users_tenant_blocked").on(t.tenantId, t.isBlockedGlobal),
  index("idx_users_tenant_deleted").on(t.tenantId, t.deletedAt),
  index("idx_users_tenant_last_visit").on(t.tenantId, t.lastVisitAt),
  index("idx_users_tenant_favorite_master").on(t.tenantId, t.favoriteMasterId),
]);

// 0062: per-master client blacklist. A master can hide specific clients
// from their own booking flow (`tenant_id + master_chat_id + client_chat_id`
// row marks the client invisible to that master). Tenant_owner-level
// global blocks live on `users.is_blocked_global` instead.
export const masterClientBlocks = sqliteTable("master_client_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  masterChatId: integer("master_chat_id").notNull(),
  clientChatId: integer("client_chat_id").notNull(),
  reason: text("reason"),
  blockedBy: integer("blocked_by").notNull(),
  blockedAt: integer("blocked_at").notNull(),
}, (t) => [
  uniqueIndex("idx_mcb_uniq").on(t.tenantId, t.masterChatId, t.clientChatId),
  index("idx_mcb_client").on(t.tenantId, t.clientChatId),
  index("idx_mcb_master").on(t.tenantId, t.masterChatId),
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
  publicHidden: integer("public_hidden").notNull().default(0),
  vacationFrom: integer("vacation_from"),
  vacationUntil: integer("vacation_until"),
  /**
   * 0062: account-origin model. Distinguishes how this master arrived on the
   * tenant. Drives the salon vs master ownership of profile fields.
   *   - salon_created    : created via salon.createMasterAccount (salon owns
   *                        credentials, can peek/reset password via vault).
   *   - invited_email    : added via salon.sendMasterInvitation; master owns.
   *   - invited_telegram : added via salon.addMaster; master owns.
   *   - self_registered  : web-registered with role=master + personal tenant.
   */
  origin: text("origin").notNull().default("salon_created"),
  /** 0062: nullable soft-delete tombstone. NULL = active. */
  archivedAt: integer("archived_at"),
  /**
   * 0074: real Telegram chat_id for masters whose primary `chatId` is a
   *  synthetic 10B+ identity (web-created via `salon_created` / `invited_email`
   *  / `self_registered`). Set by `/start mst_<token>` consumption (Worker)
   *  or by salon-owner manual override (tRPC). Bot's `isMaster()` and
   *  `getMaster()` match against EITHER `chat_id` OR `telegram_chat_id`,
   *  so masters whose `chat_id` is already real (origin='invited_telegram'
   *  or pre-0023) keep working unchanged.
   */
  telegramChatId: integer("telegram_chat_id"),
  /**
   * 0075: master avatar (emoji + uploaded photo). No origin gating — the
   * avatar is the salon's visual label for the master on the public profile,
   * not the master's personal data. Updated by `salon.updateMasterAvatar`.
   * Photo wins over emoji when both are set (same rule as client avatars).
   */
  avatarEmoji: text("avatar_emoji"),
  avatarUrl: text("avatar_url"),
  avatarR2Key: text("avatar_r2_key"),
}, (t) => [
  index("idx_master_tenant").on(t.tenantId),
  index("idx_master_web_user_id").on(t.webUserId),
  index("idx_master_tenant_web_user").on(t.tenantId, t.webUserId),
  index("idx_masters_calendar_visibility").on(t.tenantId, t.calendarVisibility),
  index("idx_masters_vacation_until").on(t.vacationUntil),
  index("idx_masters_active").on(t.tenantId),
  index("idx_masters_tenant_origin").on(t.tenantId, t.origin),
  uniqueIndex("idx_masters_tenant_tg_chat").on(t.tenantId, t.telegramChatId),
]);

/**
 * 0072: One-shot deep-link tokens that bind a salon-employed master's
 * `masters.telegram_chat_id` to their real Telegram account. Minted by the
 * salon owner (`salon.createMasterPairingCode`) or by the master themselves
 * (`master.requestPairingCode`), redeemed via `/start mst_<raw_token>` on
 * the salon's TG bot.
 *
 * Token storage is hash-only — the raw token leaves the server exactly once
 * (in the deep-link URL response) and is then irrecoverable. Lookup is by
 * `SHA-256(raw_token)` so a DB compromise doesn't expose pending tokens.
 *
 * 7-day TTL is generous (matches `master_invitations`) — gives the master
 * a full week to open the link on a phone or copy-paste it.
 */
export const masterPairingCodes = sqliteTable("master_pairing_codes", {
  /** SHA-256 hex of the raw token (64 chars). Primary key for direct lookup. */
  tokenHash: text("token_hash").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  masterChatId: integer("master_chat_id").notNull(),
  createdByWebUserId: text("created_by_web_user_id"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  consumedChatId: integer("consumed_chat_id"),
}, (t) => [
  index("idx_mpc_tenant_master").on(t.tenantId, t.masterChatId),
  index("idx_mpc_unconsumed_exp").on(t.expiresAt),
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
  // epoch MILLISECONDS, UTC — Warsaw wall-clock via warsawToUtcMs (~/lib/time);
  // NOT seconds. Mirrors the Worker contract. See BUG-01 / BUG-05.
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

export const serviceCategories = sqliteTable("service_categories", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("idx_svc_cat_tenant_name").on(t.tenantId, t.name),
  index("idx_svc_cat_tenant_order").on(t.tenantId, t.sortOrder),
]);

export const tenantConfig = sqliteTable("tenant_config", {
  tenantId: text("tenant_id").notNull(),
  key: text("key").notNull(),
  value: text("value"),
}, (t) => [uniqueIndex("idx_tenant_config_key").on(t.tenantId, t.key)]);

// Migration 0083 — platform-level key/value config (no tenant scope).
// Currently powers /about (editable from God Mode); future uses include
// marketing banners and feature-flag defaults.
export const platformConfig = sqliteTable("platform_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

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
  /**
   * 0097: currently-selected salon for a multi-tenant user (an owner who also
   * holds a master role elsewhere). NULL = use the home `tenantId`. Flows into
   * the session via auth.ts `resolveActiveMembership`; membership is proven
   * authoritatively via `masters.web_user_id`.
   */
  activeTenantId: text("active_tenant_id"),
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
  /**
   * 0065: reversibly-encrypted plaintext password for salon-owned master
   * accounts. AES-GCM ciphertext (BOT_ENCRYPTION_KEY + HKDF label
   * 'master-password-v1'). NULL for accounts the master owns themselves.
   * Salon owners read this via salon.peekMasterPassword under OTP gate.
   */
  passwordEncrypted: text("password_encrypted"),
  /**
   * 0077: per-user notification preferences (JSON blob). NULL = defaults.
   * Shape lives in lib/notifications/prefs.ts; writers consult prefs at
   * fan-out time and skip the channel when the category is opted-out.
   */
  notificationPrefs: text("notification_prefs"),
  /**
   * 0082: bridges the web identity to the real Telegram chat_id. Populated
   * when the owner consumes a pairing code via `/start own_<token>` on
   * the salon's TG bot. NULL for accounts that never paired. See
   * `ownerPairingCodes` + `~/server/api/ownerPairing/tokenLogic.ts`.
   */
  telegramChatId: integer("telegram_chat_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("idx_web_user_email").on(t.email),
  index("idx_web_user_tenant").on(t.tenantId),
  index("idx_web_users_login_token").on(t.loginTokenHash),
  uniqueIndex("idx_web_users_tg_chat").on(t.telegramChatId),
]);

/**
 * Owner Telegram pairing codes — migration 0082. Symmetric to
 * `masterPairingCodes` but keyed on `webUserId` (the owner identity).
 *
 * Single-use, 7-day TTL deep-link tokens. Hash-only storage (raw token
 * leaves the server exactly once in the URL response).
 */
export const ownerPairingCodes = sqliteTable("owner_pairing_codes", {
  /** SHA-256 hex of the raw token. */
  tokenHash: text("token_hash").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  webUserId: text("web_user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  consumedChatId: integer("consumed_chat_id"),
}, (t) => [
  index("idx_opc_tenant_user").on(t.tenantId, t.webUserId),
  index("idx_opc_unconsumed_exp").on(t.expiresAt),
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

// ─── Ownership-transfer tokens ─────────────────────────────────────────────

export const ownershipTransferTokens = sqliteTable("ownership_transfer_tokens", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  cancelledAt: integer("cancelled_at"),
  createdAt: integer("created_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
}, (t) => [
  index("idx_ott_tenant_created").on(t.tenantId, t.createdAt),
  index("idx_ott_token_hash").on(t.tokenHash),
  index("idx_ott_user").on(t.fromUserId, t.createdAt),
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
  // 0062: email is now nullable so phone-first salon clients can sync into
  // the marketing directory. The platform-wide UNIQUE on `email` was also
  // dropped in favour of a per-tenant UNIQUE (idx_marketing_contacts_tenant_email).
  email: text("email"),
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
  linkedUserChatId: integer("linked_user_chat_id"),
}, (t) => [
  uniqueIndex("idx_marketing_contacts_tenant_email").on(t.tenantId, t.email),
  uniqueIndex("idx_marketing_contacts_tenant_phone").on(t.tenantId, t.phone),
  index("idx_marketing_contacts_phone").on(t.phone),
  index("idx_marketing_contacts_last_seen").on(t.lastSeenAt),
  index("idx_marketing_contacts_tenant").on(t.tenantId),
  uniqueIndex("idx_marketing_contacts_unsub_tok").on(t.unsubscribeToken),
  index("idx_mc_linked_user").on(t.tenantId, t.linkedUserChatId),
]);

export const marketingSegments = sqliteTable("marketing_segments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  name: text("name").notNull(),
  description: text("description"),
  filterJson: text("filter_json").notNull(),
  // 0072: 'filter' (existing — evaluates filter_json) or 'manual' (members
  // stored in marketing_segment_members). Brevo-style explicit lists.
  kind: text("kind").notNull().default("filter"),
  contactCount: integer("contact_count").notNull().default(0),
  lastComputedAt: integer("last_computed_at"),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_mkt_segments_tenant").on(t.tenantId)]);

// 0072: explicit list membership. (segment_id, contact_id) is the natural PK,
// so adding the same contact twice is a no-op.
export const marketingSegmentMembers = sqliteTable("marketing_segment_members", {
  segmentId: text("segment_id").notNull(),
  contactId: integer("contact_id").notNull(),
  addedAt: integer("added_at").notNull(),
  addedBy: text("added_by"),
}, (t) => [
  index("idx_msm_segment").on(t.segmentId),
  index("idx_msm_contact").on(t.contactId),
]);

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
  // Migration 0075 — spam complaints. Distinct from bounces because the
  // compliance / sender-reputation handling differs (reader-initiated vs
  // provider-rejected).
  complainedAt: integer("complained_at"),
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
  index("idx_tmp_tenant_user").on(t.tenantId, t.webUserId),
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
  // 0057 additions: status lifecycle, ownership, env/release, request context.
  status: text("status").notNull().default("open"),
  snoozeUntil: integer("snooze_until"),
  assigneeId: text("assignee_id"),
  resolvedBy: text("resolved_by"),
  tagsJson: text("tags_json"),
  environment: text("environment").notNull().default("production"),
  release: text("release"),
  errorType: text("error_type"),
  url: text("url"),
  method: text("method"),
  requestId: text("request_id"),
  sampleJson: text("sample_json"),
  usersAffected: integer("users_affected").notNull().default(1),
  title: text("title"),
}, (t) => [
  index("idx_error_events_severity_seen").on(t.severity, t.lastSeen),
  index("idx_error_events_fingerprint").on(t.fingerprint),
  index("idx_error_events_tenant").on(t.tenantId, t.lastSeen),
  index("idx_error_events_unresolved").on(t.resolvedAt, t.lastSeen),
  index("idx_error_events_status_last").on(t.status, t.lastSeen),
  index("idx_error_events_assignee").on(t.assigneeId, t.status, t.lastSeen),
]);

// ─── Marketing content plan (migration 0058) ─────────────────────────────
// Scheduled posts for the @manicbot_com IG autopilot. Replaces the
// markdown content_plan_30days.md. tenant_id is nullable: @manicbot_com
// posts as system_admin. Status lifecycle:
//   pending → generating → ready → publishing → posted | failed | paused
export const marketingContentPlan = sqliteTable("marketing_content_plan", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  scheduledAt: integer("scheduled_at").notNull(),
  theme: text("theme").notNull(),
  topic: text("topic").notNull(),
  keyMessage: text("key_message"),
  headlinePl: text("headline_pl"),
  captionPl: text("caption_pl"),
  hashtagsJson: text("hashtags_json"),
  imageUrl: text("image_url"),
  imagePrompt: text("image_prompt"),
  status: text("status").notNull().default("pending"),
  metaPostId: text("meta_post_id"),
  permalink: text("permalink"),
  errorMsg: text("error_msg"),
  errorCount: integer("error_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  publishedAt: integer("published_at"),
}, (t) => [
  index("idx_mcp_status_sched").on(t.status, t.scheduledAt),
  index("idx_mcp_tenant_sched").on(t.tenantId, t.scheduledAt),
]);

// ─── Marketing publish queue (migration 0059) ────────────────────────────
// Outbox for the two-step IG Feed publish flow (container → publish).
// One row per content_plan attempt; attempts++ on retry; cap at 5
// before marking content_plan as failed.
export const marketingPublishQueue = sqliteTable("marketing_publish_queue", {
  id: text("id").primaryKey(),
  contentPlanId: text("content_plan_id").notNull(),
  tenantId: text("tenant_id"),
  channelType: text("channel_type").notNull().default("instagram"),
  pageId: text("page_id").notNull(),
  metaContainerId: text("meta_container_id"),
  metaPostId: text("meta_post_id"),
  status: text("status").notNull().default("queued"),
  errorMsg: text("error_msg"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_mpq_status_attempt").on(t.status, t.lastAttemptAt),
  index("idx_mpq_content_plan").on(t.contentPlanId),
]);

// ─── Appointment blocks (migration 0061) ─────────────────────────────────
// Master-owned non-client occupancy. Two block types:
//   * reservation — "hold this slot for myself" (no client, no service)
//   * time_off    — break / day off / vacation; can span multiple days
//                   via end_date.
// Conflict semantics enforced in code (`slotsBusy()` helper) so booking
// flow refuses to overlap a block, and block creation refuses to overlap
// an existing booking.
export const appointmentBlocks = sqliteTable("appointment_blocks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  masterId: integer("master_id").notNull(),
  type: text("type").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  durationMin: integer("duration_min").notNull(),
  endDate: text("end_date"),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
  cancelled: integer("cancelled").notNull().default(0),
}, (t) => [
  index("idx_apt_blocks_master_date").on(t.tenantId, t.masterId, t.date),
  index("idx_apt_blocks_tenant_date").on(t.tenantId, t.date),
]);

// ─── Master invitations (migration 0064) ─────────────────────────────────────
// Pending invitations sent by salon owners to add a master by email. Two
// scenarios captured at send time: existing_user (web_user already exists,
// landed via /invitations/[id]) or new_user (magic link with token →
// /register?invite=<token>).
export const masterInvitations = sqliteTable("master_invitations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull(),
  inviterUserId: text("inviter_user_id").notNull(),
  invitedName: text("invited_name"),
  /** SHA-256 hash of the one-time invite token (raw token only stored in
   *  the email; never written to D1). Used by accept-by-token lookup. */
  tokenHash: text("token_hash").notNull(),
  tokenExpiresAt: integer("token_expires_at").notNull(),
  /** pending | accepted | revoked | expired (lazy-flipped by reads). */
  status: text("status").notNull().default("pending"),
  /** existing_user | new_user — snapshot at send time. */
  scenario: text("scenario").notNull(),
  acceptedAt: integer("accepted_at"),
  acceptedMasterId: integer("accepted_master_id"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  uniqueIndex("idx_master_invitations_unique_pending").on(t.tenantId, t.email),
  index("idx_master_invitations_token").on(t.tokenHash),
  index("idx_master_invitations_tenant_status").on(t.tenantId, t.status, t.createdAt),
]);

// ─── Global OTP codes (migration 0065) ───────────────────────────────────────
// Generic OTP store for destructive / role-escalation mutations. One row per
// (web_user_id, action, payload_hash). Caller emails a 6-digit code to the
// actor's own email, then verifies inline via requireOtpConfirmation().
export const globalOtpCodes = sqliteTable("global_otp_codes", {
  id: text("id").primaryKey(),
  webUserId: text("web_user_id").notNull(),
  /** Action name, e.g. 'archive_master', 'reset_master_password'. */
  action: text("action").notNull(),
  /** SHA-256 hex of canonicalized JSON payload — binds the code to a single
   *  operation so replay-with-different-args is impossible. */
  payloadHash: text("payload_hash").notNull(),
  /** SHA-256 hex of the 6-digit code. */
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_global_otp_user_action").on(t.webUserId, t.action, t.expiresAt),
]);

// ─── Internal messenger (migration 0067) ─────────────────────────────────────
// Unified inbox: staff DMs + groups + mirrored client channel conversations.
// See migrations/0067_messenger.sql for the design and the bridge to the
// existing `conversations` table via client_conversation_id.
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  /** staff_dm | staff_group | client_conv | system */
  kind: text("kind").notNull(),
  title: text("title"),
  /** FK to conversations.id when kind='client_conv'; NULL otherwise. */
  clientConversationId: text("client_conversation_id"),
  /** For kind='staff_dm': sorted "<minId>:<maxId>" of the two web_user ids.
   *  Powers the partial UNIQUE index that prevents duplicate DMs. */
  dmKey: text("dm_key"),
  createdByWebUserId: text("created_by_web_user_id"),
  createdAt: integer("created_at").notNull(),
  lastMessageAt: integer("last_message_at"),
  /** Denormalized excerpt of the most recent message body for inbox list
   *  rendering without a JOIN to thread_messages. ≤200 chars. */
  lastMessagePreview: text("last_message_preview"),
  archived: integer("archived").notNull().default(0),
  /** Migration 0093: marks the auto-seeded "Команда" group per tenant. Exactly
   *  one row per (tenant_id) may have this flag set, enforced by a partial
   *  UNIQUE index. New masters are auto-added to this group; the salon owner
   *  may remove them via `messenger.removeStaffMember`. */
  isDefaultGroup: integer("is_default_group").notNull().default(0),
}, (t) => [
  index("idx_threads_tenant_last").on(t.tenantId, t.lastMessageAt),
  index("idx_threads_tenant_kind_archived").on(t.tenantId, t.kind, t.archived, t.lastMessageAt),
  uniqueIndex("idx_threads_dm_unique").on(t.tenantId, t.dmKey),
  uniqueIndex("idx_threads_client_conv_unique").on(t.tenantId, t.clientConversationId),
  uniqueIndex("idx_threads_default_group_per_tenant").on(t.tenantId, t.isDefaultGroup),
]);

export const threadMembers = sqliteTable("thread_members", {
  threadId: text("thread_id").notNull(),
  /** web_user | master | external_client.
   *  - master: a salon master without a web_users row yet (Telegram-only or
   *    pending email invite). Promoted to web_user by
   *    `linkMasterPlaceholderToWebUser` once the master gains a web account. */
  memberKind: text("member_kind").notNull(),
  /** web_users.id for member_kind=web_user;
   *  String(masters.chat_id) for member_kind=master;
   *  '<channelType>:<channelUserId>' for member_kind=external_client. */
  memberRef: text("member_ref").notNull(),
  role: text("role").notNull().default("member"),
  joinedAt: integer("joined_at").notNull(),
  mutedUntil: integer("muted_until"),
  lastReadMessageId: text("last_read_message_id"),
  lastReadAt: integer("last_read_at"),
}, (t) => [
  primaryKey({ columns: [t.threadId, t.memberKind, t.memberRef] }),
  index("idx_thread_members_ref").on(t.memberKind, t.memberRef, t.lastReadAt),
]);

export const threadMessages = sqliteTable("thread_messages", {
  /** ULID — lexicographic order = chronological. Enables cursor pagination
   *  via (thread_id, id < cursor) without a separate created_at index. */
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  /** Denormalized for tenant isolation defense-in-depth on the largest table. */
  tenantId: text("tenant_id").notNull(),
  /** web_user | external_client | system */
  senderKind: text("sender_kind").notNull(),
  senderRef: text("sender_ref").notNull(),
  body: text("body").notNull(),
  attachmentsJson: text("attachments_json"),
  /** 1 = visible only to staff (not relayed to external channel). */
  isInternalNote: integer("is_internal_note").notNull().default(0),
  /** External-side message id (TG msg id / WA wamid / IG mid) for outbound
   *  delivery confirmation and inbound dedup. */
  externalMsgId: text("external_msg_id"),
  replyToMessageId: text("reply_to_message_id"),
  createdAt: integer("created_at").notNull(),
  editedAt: integer("edited_at"),
  deletedAt: integer("deleted_at"),
  /** Outbound delivery lifecycle (migration 0098). NULL = untracked. For
   *  client_conv outbound: 'pending' | 'sent' | 'delivered' | 'failed'. */
  deliveryState: text("delivery_state"),
  /** Channel error code when delivery_state = 'failed' (e.g. outside_message_window). */
  deliveryError: text("delivery_error"),
  /** migration 0095: ref_kind='booking_request', ref_id=appointments.id +
   *  meta_json snapshot, so a message can render as an actionable request card. */
  refKind: text("ref_kind"),
  refId: text("ref_id"),
  metaJson: text("meta_json"),
}, (t) => [
  index("idx_thread_messages_thread").on(t.threadId, t.id),
  index("idx_thread_messages_tenant_created").on(t.tenantId, t.createdAt),
  index("idx_thread_messages_ref").on(t.tenantId, t.refKind, t.refId),
]);

// ─── Referral Program (migration 0069) ─────────────────────────────────

export const referralCodes = sqliteTable("referral_codes", {
  code: text("code").primaryKey(),
  ownerWebUserId: text("owner_web_user_id").notNull(),
  ownerTenantId: text("owner_tenant_id").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  rotatedAt: integer("rotated_at"),
}, (t) => [
  index("idx_referral_codes_owner").on(t.ownerWebUserId, t.isActive),
  uniqueIndex("uq_referral_codes_active_one").on(t.ownerWebUserId),
]);

export const referrals = sqliteTable("referrals", {
  id: text("id").primaryKey(),
  referrerWebUserId: text("referrer_web_user_id").notNull(),
  referrerTenantId: text("referrer_tenant_id").notNull(),
  inviteeWebUserId: text("invitee_web_user_id").notNull(),
  inviteeTenantId: text("invitee_tenant_id").notNull(),
  code: text("code").notNull(),
  status: text("status").notNull(),
  inviteeDiscountKind: text("invitee_discount_kind"),
  inviteeDiscountAppliedAt: integer("invitee_discount_applied_at"),
  firstInvoicePaidAt: integer("first_invoice_paid_at"),
  rewardId: text("reward_id"),
  inviteePaymentMethodFp: text("invitee_payment_method_fp"),
  fraudFlags: text("fraud_flags"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("uq_ref_invitee_one_active").on(t.inviteeWebUserId),
  index("idx_ref_referrer").on(t.referrerWebUserId, t.status, t.createdAt),
  index("idx_ref_fingerprint").on(t.inviteePaymentMethodFp),
  index("idx_ref_status").on(t.status, t.createdAt),
  index("idx_ref_code").on(t.code),
]);

export const referralRewards = sqliteTable("referral_rewards", {
  id: text("id").primaryKey(),
  referrerWebUserId: text("referrer_web_user_id").notNull(),
  referrerTenantId: text("referrer_tenant_id").notNull(),
  referralId: text("referral_id"),
  kind: text("kind").notNull(),
  amountGrosz: integer("amount_grosz").notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeBalanceTransaction: text("stripe_balance_transaction"),
  appliedAt: integer("applied_at"),
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_rewards_referrer").on(t.referrerWebUserId, t.status),
  index("idx_rewards_expiry").on(t.status, t.expiresAt),
]);

export const referralEvents = sqliteTable("referral_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referralId: text("referral_id"),
  rewardId: text("reward_id"),
  event: text("event").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_ref_events_referral").on(t.referralId, t.createdAt),
]);

// ─── Reminders plugin (migration 0070) ──────────────────────────────────
// Definitions live here; expansion + delivery happen worker-side
// (plugins/reminders/cron.js + src/services/userNotify.js). Recurrence
// is stored as JSON validated by zod at the tRPC boundary; channelsJson
// is a subset of ['inapp', 'telegram'].
export const pluginReminders = sqliteTable("plugin_reminders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  createdByWebUserId: text("created_by_web_user_id").notNull(),
  targetMasterId: integer("target_master_id"),
  kind: text("kind").notNull().default("reminder"),
  title: text("title").notNull(),
  note: text("note"),
  startsOn: text("starts_on").notNull(),
  time: text("time").notNull(),
  recurrenceJson: text("recurrence_json").notNull(),
  channelsJson: text("channels_json").notNull().default('["inapp"]'),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_reminders_tenant_active").on(t.tenantId, t.startsOn),
  index("idx_reminders_target").on(t.tenantId, t.targetMasterId, t.startsOn),
]);

// Idempotent fire log. The UNIQUE (reminder_id, fires_at_epoch) is the
// contract — INSERT OR IGNORE in the cron handler short-circuits dupes.
export const pluginReminderFires = sqliteTable("plugin_reminder_fires", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reminderId: text("reminder_id").notNull().references(() => pluginReminders.id, { onDelete: "cascade" }),
  firesAtEpoch: integer("fires_at_epoch").notNull(),
  firedAtEpoch: integer("fired_at_epoch"),
  deliveryState: text("delivery_state").notNull().default("pending"),
  deliveryError: text("delivery_error"),
}, (t) => [
  uniqueIndex("uq_reminder_fires_occurrence").on(t.reminderId, t.firesAtEpoch),
]);

// ─── User notifications (migration 0070) ────────────────────────────────
// Platform-wide in-app feed driving the header bell. Generic by design —
// `kind` is the discriminator (e.g. 'reminder.fired', future: 'checklist.due').
// `(web_user_id, source_slug, source_id, kind)` partial unique index dedups
// on cron retry.
export const userNotifications = sqliteTable("user_notifications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  webUserId: text("web_user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  sourceSlug: text("source_slug"),
  sourceId: text("source_id"),
  readAt: integer("read_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_user_notifications_unread").on(t.webUserId, t.createdAt),
  index("idx_user_notifications_recent").on(t.webUserId, t.createdAt),
  uniqueIndex("uq_user_notifications_source").on(t.webUserId, t.sourceSlug, t.sourceId, t.kind),
]);

// Web Push (browser push notifications) — migration 0073. One row per
// (web_user_id, endpoint) pair; same browser issues a stable endpoint
// so re-subscribing from the same browser overwrites instead of
// duplicating. p256dh + auth are the ECDH keys the Worker uses to
// encrypt the payload per RFC 8291.
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  webUserId: text("web_user_id").notNull().references(() => webUsers.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id"),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  failureCount: integer("failure_count").notNull().default(0),
}, (t) => [
  uniqueIndex("uq_push_sub_user_endpoint").on(t.webUserId, t.endpoint),
  index("idx_push_sub_user").on(t.webUserId),
]);

// ─── Platform messenger (migration 0076) ────────────────────────────────
// Cross-tenant DM channel between the platform (any system_admin) and a
// single web_user (typically a tenant_owner). Intentionally separate from
// the 0067 `threads` family — those are tenant-scoped (tenant_id NOT NULL)
// and reusing them would weaken the tenant-isolation invariant the
// codebase relies on. Read state is two per-thread pointers; broadcasts
// are recorded once in `platform_broadcasts` and fan out via a
// `broadcast_id` stamp on every emitted message.
export const platformThreads = sqliteTable("platform_threads", {
  id: text("id").primaryKey(),
  recipientWebUserId: text("recipient_web_user_id").notNull(),
  recipientTenantId: text("recipient_tenant_id"),
  lastMessageAt: integer("last_message_at"),
  lastMessagePreview: text("last_message_preview"),
  lastSenderKind: text("last_sender_kind"),
  recipientLastReadAt: integer("recipient_last_read_at"),
  platformLastReadAt: integer("platform_last_read_at"),
  archived: integer("archived").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  uniqueIndex("idx_platform_threads_recipient").on(t.recipientWebUserId),
  index("idx_platform_threads_last").on(t.lastMessageAt),
  index("idx_platform_threads_archived").on(t.archived, t.lastMessageAt),
]);

export const platformThreadMessages = sqliteTable("platform_thread_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => platformThreads.id, { onDelete: "cascade" }),
  senderKind: text("sender_kind").notNull(),
  senderWebUserId: text("sender_web_user_id").notNull(),
  body: text("body").notNull(),
  attachmentsJson: text("attachments_json"),
  broadcastId: text("broadcast_id"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_ptm_thread_id").on(t.threadId, t.id),
  index("idx_ptm_thread_created").on(t.threadId, t.createdAt),
  index("idx_ptm_broadcast").on(t.broadcastId),
]);

export const platformBroadcasts = sqliteTable("platform_broadcasts", {
  id: text("id").primaryKey(),
  senderWebUserId: text("sender_web_user_id").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  audienceFilterJson: text("audience_filter_json").notNull(),
  recipientsCount: integer("recipients_count").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_platform_broadcasts_created").on(t.createdAt),
]);

// ─── Platform campaigns (migration 0100) ──────────────────────────────────
// Operator → tenant-owner scheduled / recurring / templated multi-channel
// messaging, authored in the God-Mode "Рассылки" panel. The Worker cron reads
// these rows to perform delivery + scheduling; the admin-app authors/configs,
// previews audience, and shows history. PLATFORM-scoped (no tenant_id), like
// platformBroadcasts. Only platformCampaignDeliveries carries tenant_id.
export const platformCampaigns = sqliteTable("platform_campaigns", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title"),
  body: text("body"),
  bodiesJson: text("bodies_json"),
  audienceFilterJson: text("audience_filter_json"),
  channelsJson: text("channels_json").notNull(),
  scheduleKind: text("schedule_kind").notNull().default("now"),
  scheduledAt: integer("scheduled_at"),
  recurrenceJson: text("recurrence_json"),
  templateId: text("template_id"),
  status: text("status").notNull().default("draft"),
  nextRunAt: integer("next_run_at"),
  lastRunAt: integer("last_run_at"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_platform_campaigns_status_next").on(t.status, t.nextRunAt),
  index("idx_platform_campaigns_kind").on(t.kind),
  // The singleton partial-UNIQUE (WHERE kind IN (...)) lives in migration 0100
  // / schema.sql only — the SQLite builder cannot express a partial WHERE on
  // uniqueIndex (same limitation as the newsletter confirm-token index).
]);

export const platformCampaignDeliveries = sqliteTable("platform_campaign_deliveries", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => platformCampaigns.id, { onDelete: "cascade" }),
  occurrenceKey: text("occurrence_key").notNull(),
  recipientWebUserId: text("recipient_web_user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  sentAt: integer("sent_at"),
}, (t) => [
  uniqueIndex("idx_pcd_claim").on(t.campaignId, t.occurrenceKey, t.recipientWebUserId, t.channel),
  index("idx_pcd_campaign").on(t.campaignId),
  index("idx_pcd_tenant").on(t.tenantId),
  index("idx_pcd_status").on(t.status),
]);

export const platformMessageTemplates = sqliteTable("platform_message_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  channelsJson: text("channels_json"),
  bodiesJson: text("bodies_json"),
  locale: text("locale").default("ru"),
  isBuiltin: integer("is_builtin").notNull().default(0),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("idx_pmt_category").on(t.category),
]);

// 0083: self-hosted marketing blog CMS. Drives admin CRUD at /system/blog +
// public /blog and /blog/[slug] pages. Multilingual content stored as JSON
// blobs keyed by Lang to match the existing static `BlogArticle` shape so
// the public renderer can be reused 1:1 (titlesJson → titles, etc.).
// status ∈ draft | published | archived; slug is globally unique.
export const blogPosts = sqliteTable("blog_posts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("draft"),
  category: text("category").notNull().default("tips"),

  coverUrl: text("cover_url"),
  coverAltJson: text("cover_alt_json"),
  coverCredit: text("cover_credit"),

  titlesJson: text("titles_json").notNull().default("{}"),
  excerptsJson: text("excerpts_json").notNull().default("{}"),
  bodiesJson: text("bodies_json").notNull().default("{}"),
  keywordsJson: text("keywords_json"),
  relatedSlugsJson: text("related_slugs_json"),

  publishedDate: text("published_date"),
  updatedDate: text("updated_date"),

  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  publishedAt: integer("published_at"),
  archivedAt: integer("archived_at"),

  createdByWebUserId: text("created_by_web_user_id"),
  updatedByWebUserId: text("updated_by_web_user_id"),
}, (t) => [
  uniqueIndex("idx_blog_posts_slug").on(t.slug),
  index("idx_blog_posts_status_pubdate").on(t.status, t.publishedDate),
  index("idx_blog_posts_status_created").on(t.status, t.createdAt),
  index("idx_blog_posts_category_status").on(t.category, t.status),
]);

// Migration 0085 — Google prefill token replay protection.
// One row per consumed jti. webUsers.register does INSERT OR IGNORE; if
// `changes = 0` (jti already present) the request is rejected.
export const googlePrefillConsumed = sqliteTable("google_prefill_consumed", {
  jti: text("jti").primaryKey(),
  email: text("email").notNull(),
  consumedAt: integer("consumed_at").notNull(),
  exp: integer("exp").notNull(),
}, (t) => [
  index("idx_gpc_exp").on(t.exp),
]);

// Migration 0086 — newsletter subscribers (landing "Stay in the loop" form).
// Platform-scoped (no tenant_id). UNIQUE on email + INSERT OR IGNORE in the
// Worker handler so a re-submit is a silent no-op and doesn't double-send
// the welcome email. `welcome_sent_at` / `welcome_send_error` are stamped
// by the admin-app /api/internal/newsletter-welcome route.
export const newsletterSubscribers = sqliteTable("newsletter_subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  source: text("source").notNull().default("landing"),
  lang: text("lang"),
  anonymousId: text("anonymous_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  confirmedAt: integer("confirmed_at"),
  unsubscribedAt: integer("unsubscribed_at"),
  welcomeSentAt: integer("welcome_sent_at"),
  welcomeSendError: text("welcome_send_error"),
  // Migration 0092 — double-opt-in confirm token (CSPRNG, 7-day TTL).
  confirmToken: text("confirm_token"),
  confirmTokenExpiresAt: integer("confirm_token_expires_at"),
  // Migration 0090 — 32-hex one-click unsub token. Stable across resub, partial UNIQUE.
  unsubscribeToken: text("unsubscribe_token"),
}, (t) => [
  uniqueIndex("idx_newsletter_subscribers_email").on(t.email),
  index("idx_newsletter_subscribers_created").on(t.createdAt),
  // Partial UNIQUE on token columns lives in the migrations (Drizzle's
  // SQLite builder doesn't expose `WHERE` on uniqueIndex). The token
  // columns are nullable, so SQLite's default UNIQUE-allows-NULLs
  // behaviour matches the partial-index intent at query time even
  // without the explicit predicate here.
  uniqueIndex("idx_newsletter_confirm_token").on(t.confirmToken),
  uniqueIndex("idx_newsletter_subscribers_unsub_tok").on(t.unsubscribeToken),
]);

// Migration 0087 — Cancellation retention flow audit trail.
// One row per cancel attempt (regardless of outcome). Drives offer-acceptance
// metrics + the 12-month cooldown that prevents abuse of the discount.
// `reason_tags` is a JSON-encoded array of enum slugs (zod-validated at the
// tRPC boundary; this layer is best-effort and the column is TEXT, not JSON).
export const subscriptionCancellations = sqliteTable("subscription_cancellations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  webUserId: text("web_user_id").notNull(),
  planAtCancel: text("plan_at_cancel"),
  intervalAtCancel: text("interval_at_cancel"),
  reasonTags: text("reason_tags").notNull().default("[]"),
  freeText: text("free_text"),
  photoUrl: text("photo_url"),
  retentionOfferShown: integer("retention_offer_shown").notNull().default(0),
  retentionOfferAccepted: integer("retention_offer_accepted").notNull().default(0),
  retentionCouponCode: text("retention_coupon_code"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_subscription_cancellations_tenant").on(t.tenantId),
  index("idx_subscription_cancellations_created").on(t.createdAt),
]);

// ─── D1 backup log (Migration 0088) ─────────────────────────────────────────
// Audit trail of D1 → R2 backup runs. Read by maybeRunD1Backup() to enforce
// the 6h idempotency window; surfaced to system_admin via a future
// `/system/backups` page (not in PR scope).
export const d1BackupLog = sqliteTable("d1_backup_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at").notNull(),
  bucketKey: text("bucket_key").notNull(),
  kind: text("kind").notNull(),
  tableCount: integer("table_count").notNull(),
  rowCount: integer("row_count").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
}, (t) => [
  index("idx_d1_backup_log_finished").on(t.finishedAt),
  index("idx_d1_backup_log_kind_status").on(t.kind, t.status, t.finishedAt),
]);

// ─── Webhook dedup (Migration 0089) ─────────────────────────────────────────
// Atomic claim store backing the D1 backend in src/utils/dedup.js. Read by
// no router today; cleanup cron in worker.scheduled does the DELETE pass.
export const webhookDedup = sqliteTable("webhook_dedup", {
  key: text("key").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  index("idx_webhook_dedup_expires").on(t.expiresAt),
]);

// ─── Upload token single-use nonce (Migration 0096) ─────────────────────────
// Atomic single-use store for /upload/asset token jtis (src/services/upload.js
// claimUploadNonce). No router reads it; cleanup cron in worker.scheduled does
// the DELETE pass.
export const uploadTokenUsed = sqliteTable("upload_token_used", {
  jti: text("jti").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  index("idx_upload_token_used_expires").on(t.expiresAt),
]);

/**
 * Server-side billing enforcement (audit 2026-06-12, finding CS-1 / H8).
 *
 * The trial/billing gate used to live ONLY in the client layout
 * ((dashboard)/layout.tsx render-swap → <BillingGate/>). A trial-expired or
 * churned tenant could keep using the product indefinitely by calling tRPC
 * directly (devtools / scripted client) — no procedure ever re-checked
 * billing on the server.
 *
 * Fix under test: `assertTenantBillingActive(ctx, tenantId)` in
 * tenantAccess.ts (reuses the shared `evaluateTrialState` so the server
 * verdict can never drift from the UI gate), wired into the high-value
 * product mutations:
 *   - appointments.createManual / rescheduleAppointment / update
 *   - marketingTenant.campaignSendNow / automationRunNow
 *   - messenger.sendMessage
 *
 * Reads stay open by design (the UI gate covers UX; reads carry no ongoing
 * product value), and billing/settings procedures must stay reachable so the
 * owner can actually pay.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
// IU-6 (audit 2026-06-12): messenger/support writes now consult a per-user
// rate limiter (one extra D1 SELECT). Neutralized here to keep the mock-db
// select queue stable; the limiter wiring is pinned in
// messenger-support-rate-limit.test.ts.
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));
vi.mock("~/server/api/slotsBusy", () => ({
  slotsBusy: vi.fn().mockResolvedValue({ busy: false }),
}));
// marketingTenant pulls providers/sender/audience that read env at import.
vi.mock("~/server/marketing/providers", () => ({
  listProviders: () => [],
  getProvider: () => null,
  pickProvider: () => null,
}));
const mockRunCampaignSend = vi.fn(async (_args: unknown) => ({
  ok: true,
  total: 0,
  sent: 0,
  failed: 0,
  deferred: 0,
  campaignStatus: "sent" as const,
}));
vi.mock("~/server/marketing/sender", () => ({
  runCampaignSend: (args: unknown) => mockRunCampaignSend(args),
}));
vi.mock("~/server/marketing/audience", () => ({
  resolveAudience: vi.fn(async () => ({ contacts: [], totalCount: 0 })),
}));

import { assertTenantBillingActive } from "~/server/api/tenantAccess";
import { createCallerFactory } from "~/server/api/trpc";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { marketingTenantRouter } from "~/server/api/routers/marketingTenant";
import { messengerRouter } from "~/server/api/routers/messenger";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeAdminCtx,
} from "./helpers/db-mock";

const TENANT = "t_billing";
const NOW = Math.floor(Date.now() / 1000);

/** tenants row shapes for the billing SELECT */
const lockedTenant = () => ({
  billingStatus: "inactive",
  trialEndsAt: NOW - 86400,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});
const expiredTrialNotFlipped = () => ({
  billingStatus: "trialing",
  trialEndsAt: NOW - 3600, // cron hasn't flipped yet — lazy evaluation must lock
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});
const activeTrial = () => ({
  billingStatus: "trialing",
  trialEndsAt: NOW + 86400,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});
const payingTenant = () => ({
  billingStatus: "active",
  trialEndsAt: null,
  stripeCustomerId: "cus_x",
  stripeSubscriptionId: "sub_x",
});
const compedTenant = () => ({
  billingStatus: "active",
  trialEndsAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});

describe("assertTenantBillingActive — unit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws FORBIDDEN billing_locked for an inactive (expired-trial) tenant", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "billing_locked",
    });
  });

  it("locks an expired trial even before the cron flip (lazy evaluation)", async () => {
    const { db } = createDbMock([[expiredTrialNotFlipped()]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "billing_locked",
    });
  });

  it("locks masters on a locked tenant too (BILLING_GATED_ROLES parity)", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const ctx = makeMasterCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "billing_locked",
    });
  });

  it("passes a running trial", async () => {
    const { db } = createDbMock([[activeTrial()]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).resolves.toBeUndefined();
  });

  it("passes a paying tenant", async () => {
    const { db } = createDbMock([[payingTenant()]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).resolves.toBeUndefined();
  });

  it("passes a complimentary grant (active, no subscription, no trial window)", async () => {
    const { db } = createDbMock([[compedTenant()]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).resolves.toBeUndefined();
  });

  it("skips the check entirely for system_admin (no DB read)", async () => {
    const { db } = createDbMock([]);
    const ctx = makeAdminCtx(db);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects an unknown tenant (fail closed)", async () => {
    const { db } = createDbMock([[]]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, TENANT)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects empty tenantId / missing session", async () => {
    const { db } = createDbMock([]);
    const ctx = makeTenantOwnerCtx(db, TENANT);
    await expect(assertTenantBillingActive(ctx as never, "")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      assertTenantBillingActive({ db, webUser: null } as never, TENANT),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("billing gate wired into high-value mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  const callAppointments = createCallerFactory(appointmentsRouter);
  const callMarketing = createCallerFactory(marketingTenantRouter);
  const callMessenger = createCallerFactory(messengerRouter);

  it("appointments.createManual → FORBIDDEN billing_locked on a locked tenant", async () => {
    // owner ctx: assertTenantOwner short-circuits without a DB read,
    // so select #1 is the billing check.
    const { db } = createDbMock([[lockedTenant()]]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.createManual({
        tenantId: TENANT,
        clientName: "A",
        clientPhone: "+48123123",
        serviceId: "svc1",
        date: "2026-06-15",
        time: "10:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("appointments.rescheduleAppointment → FORBIDDEN billing_locked on a locked tenant", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.rescheduleAppointment({
        tenantId: TENANT,
        appointmentId: "apt1",
        newDate: "2026-06-16",
        newTime: "11:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("appointments.update → FORBIDDEN billing_locked on a locked tenant", async () => {
    // select #1: load-by-id of the appointment row; select #2: billing check.
    const { db } = createDbMock([
      [{ id: "apt1", tenantId: TENANT, date: "2026-06-15", time: "10:00", masterId: 1, svcId: "svc1" }],
      [lockedTenant()],
    ]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.update({ id: "apt1", date: "2026-06-17" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("marketingTenant.campaignSendNow → FORBIDDEN billing_locked and the sender is never invoked", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const caller = callMarketing(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.campaignSendNow({ tenantId: TENANT, id: "camp1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
    expect(mockRunCampaignSend).not.toHaveBeenCalled();
  });

  it("marketingTenant.automationRunNow → FORBIDDEN billing_locked on a locked tenant", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const caller = callMarketing(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.automationRunNow({ tenantId: TENANT, id: "auto1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("V-1: marketingTenant.campaignCreate with scheduledAt → FORBIDDEN billing_locked (closes the scheduled-send bypass)", async () => {
    const { db } = createDbMock([[lockedTenant()]]);
    const caller = callMarketing(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.campaignCreate({
        tenantId: TENANT,
        name: "Promo",
        channel: "email",
        scheduledAt: NOW + 60,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("V-1: marketingTenant.campaignCreate as a plain DRAFT (no scheduledAt) is NOT billing-gated", async () => {
    // A draft can't send until campaignSendNow (gated) or a schedule is set,
    // so creating one on a locked tenant is allowed — only scheduling sends.
    const { db } = createDbMock([]); // no billing SELECT expected
    const caller = callMarketing(makeTenantOwnerCtx(db, TENANT) as never);
    const r = await caller.campaignCreate({ tenantId: TENANT, name: "Draft", channel: "email" });
    expect(r.id).toBeTypeOf("string");
  });

  it("messenger.sendMessage → FORBIDDEN billing_locked on a locked tenant", async () => {
    // select #1: thread; select #2: membership; select #3: billing check.
    const thread = {
      id: "th_dm",
      tenantId: TENANT,
      kind: "staff_dm",
      title: null,
      clientConversationId: null,
      dmKey: "w_owner:w_other",
      createdByWebUserId: "w_owner",
      createdAt: 1,
      lastMessageAt: 2,
      lastMessagePreview: null,
      archived: 0,
    };
    const member = {
      threadId: "th_dm",
      memberKind: "web_user",
      memberRef: "w_owner",
      role: "member",
      joinedAt: 1,
      mutedUntil: null,
      lastReadMessageId: null,
      lastReadAt: null,
    };
    const { db } = createDbMock([[thread], [member], [lockedTenant()]]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.sendMessage({ tenantId: TENANT, threadId: "th_dm", body: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "billing_locked" });
  });

  it("appointments.createManual proceeds past the billing check for an active trial", async () => {
    // Not asserting full success (deep insert chain) — only that the gate
    // does NOT fire: the failure, if any, must not be billing_locked.
    const { db } = createDbMock([[activeTrial()]]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    try {
      await caller.createManual({
        tenantId: TENANT,
        clientName: "A",
        clientPhone: "+48123123",
        serviceId: "svc1",
        date: "2026-06-15",
        time: "10:00",
      });
    } catch (e) {
      expect((e as { message?: string }).message).not.toBe("billing_locked");
    }
  });
});

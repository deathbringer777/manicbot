import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenantConfig } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
const GLOBAL_CONFIG_ID = "GLOBAL";

async function getConfig(db: any, tenantId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(tenantConfig)
    .where(eq(tenantConfig.tenantId, tenantId));
  return Object.fromEntries(rows.map((r: any) => [r.key, r.value ?? ""]));
}

async function setConfig(db: any, tenantId: string, key: string, value: string) {
  await db
    .insert(tenantConfig)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [tenantConfig.tenantId, tenantConfig.key],
      set: { value },
    });
}

export const settingsRouter = createTRPCRouter({
  getGlobalSettings: adminProcedure.query(async ({ ctx }) => {
    const cfg = await getConfig(ctx.db, GLOBAL_CONFIG_ID);
    return {
      botUsername: cfg["bot_username"] ?? "@ManicBotApp",
      supportUsername: cfg["support_username"] ?? "@AdminSupport",
      systemPrompt:
        cfg["system_prompt"] ??
        "You are ManicBot, a polite AI receptionist for beauty salons.",
      maintenanceMode: cfg["maintenance_mode"] === "true",
      registrationOpen: cfg["registration_open"] !== "false",
      maxAppointmentsPerUser: parseInt(cfg["max_appointments_per_user"] ?? "10"),
      aiEnabled: cfg["ai_enabled"] !== "false",
      workingHoursFrom: parseInt(cfg["working_hours_from"] ?? "9"),
      workingHoursTo: parseInt(cfg["working_hours_to"] ?? "20"),
      notifyOnNew: cfg["notify_on_new"] !== "false",
      notifyOnCancel: cfg["notify_on_cancel"] !== "false",
      timezone: cfg["timezone"] ?? "Europe/Warsaw",
    };
  }),

  updateGlobalSettings: adminProcedure
    .input(
      z.object({
        botUsername: z.string().optional(),
        supportUsername: z.string().optional(),
        systemPrompt: z.string().optional(),
        maintenanceMode: z.boolean().optional(),
        registrationOpen: z.boolean().optional(),
        maxAppointmentsPerUser: z.number().min(1).max(50).optional(),
        aiEnabled: z.boolean().optional(),
        workingHoursFrom: z.number().min(0).max(23).optional(),
        workingHoursTo: z.number().min(1).max(24).optional(),
        notifyOnNew: z.boolean().optional(),
        notifyOnCancel: z.boolean().optional(),
        timezone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: [string, string][] = [];
      if (input.botUsername !== undefined) updates.push(["bot_username", input.botUsername]);
      if (input.supportUsername !== undefined) updates.push(["support_username", input.supportUsername]);
      if (input.systemPrompt !== undefined) updates.push(["system_prompt", input.systemPrompt]);
      if (input.maintenanceMode !== undefined) updates.push(["maintenance_mode", String(input.maintenanceMode)]);
      if (input.registrationOpen !== undefined) updates.push(["registration_open", String(input.registrationOpen)]);
      if (input.maxAppointmentsPerUser !== undefined) updates.push(["max_appointments_per_user", String(input.maxAppointmentsPerUser)]);
      if (input.aiEnabled !== undefined) updates.push(["ai_enabled", String(input.aiEnabled)]);
      if (input.workingHoursFrom !== undefined) updates.push(["working_hours_from", String(input.workingHoursFrom)]);
      if (input.workingHoursTo !== undefined) updates.push(["working_hours_to", String(input.workingHoursTo)]);
      if (input.notifyOnNew !== undefined) updates.push(["notify_on_new", String(input.notifyOnNew)]);
      if (input.notifyOnCancel !== undefined) updates.push(["notify_on_cancel", String(input.notifyOnCancel)]);
      if (input.timezone !== undefined) updates.push(["timezone", input.timezone]);

      await Promise.all(
        updates.map(([k, v]) => setConfig(ctx.db, GLOBAL_CONFIG_ID, k, v))
      );
      return { success: true };
    }),
});

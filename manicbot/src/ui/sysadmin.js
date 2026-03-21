/**
 * Platform admin panel UI. Only for system_admin role.
 * Shows: all tenants, support agents, bot management.
 */

import { send } from '../telegram.js';
import { t, escHtml, fill } from '../utils/helpers.js';
import { getLang } from '../services/chat.js';
import { listTenantIds, getTenant, getBotIdsByTenantId } from '../tenant/storage.js';
import { getSupportAgents, getTechnicalSupportAgents } from '../roles/roles.js';
import { CB } from '../config.js';

function sysadmKb(lg) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lg, 'sysadm_tenants_btn'), callback_data: CB.SYSADM_TENANTS },
         { text: t(lg, 'sysadm_new_tenant_btn'), callback_data: CB.SYSADM_NEW_TENANT }],
        [{ text: t(lg, 'sysadm_bot_new_btn'), callback_data: CB.SYSADM_BOT_NEW },
         { text: t(lg, 'sysadm_grant_role_btn'), callback_data: CB.SYSADM_GRANT_ROLE }],
        [{ text: t(lg, 'sysadm_support_btn'), callback_data: CB.SYSADM_SUPPORT_LIST },
         { text: t(lg, 'sysadm_tech_support_btn'), callback_data: CB.SYSADM_TECH_SUPPORT_LIST }],
        [{ text: t(lg, 'sysadm_tenant_panel_btn'), callback_data: CB.ADM_MAIN },
         { text: t(lg, 'sysadm_links_btn'), callback_data: CB.SYSADM_LINKS }],
      ],
    },
  };
}

export async function showPlatformAdminPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  let tenantCount = 0;
  let agentCount = 0;
  try { tenantCount = (await listTenantIds(ctx)).length; } catch {}
  try { agentCount = (await getSupportAgents(ctx)).length; } catch {}
  const text =
    `🌐 <b>${t(lg, 'sysadm_title')}</b>\n\n` +
    `👤 ${escHtml(name)}\n` +
    `🏢 ${t(lg, 'sysadm_tenants_count')}: <b>${tenantCount}</b>\n` +
    `👥 ${t(lg, 'sysadm_agents_count')}: <b>${agentCount}</b>`;
  await send(ctx, cid, text, sysadmKb(lg));
}

export async function showPlatformTenantsList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.db) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let tenantIds = [];
  try { tenantIds = await listTenantIds(ctx); } catch {}
  if (!tenantIds.length) {
    return send(ctx, cid, t(lg, 'sysadm_no_tenants'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: t(lg, 'sysadm_new_tenant_btn'), callback_data: CB.SYSADM_NEW_TENANT }],
          [{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }],
        ],
      },
    });
  }
  const tenants = await Promise.all(tenantIds.map(id => getTenant(ctx, id).catch(() => null)));
  let text = `🏢 <b>${t(lg, 'sysadm_tenants_list')}</b>\n\n`;
  const rows = [];
  for (const ten of tenants) {
    if (!ten) continue;
    const plan = ten.plan || 'free';
    const status = ten.billingStatus || 'inactive';
    text += `• <b>${escHtml(ten.name || ten.id)}</b>\n  <code>${ten.id}</code> · ${plan} · ${status}\n`;
    rows.push([{ text: `🏢 ${escHtml((ten.name || ten.id).slice(0, 30))}`, callback_data: CB.SYSADM_TENANT_INFO + ten.id }]);
  }
  rows.push([{ text: t(lg, 'sysadm_new_tenant_btn'), callback_data: CB.SYSADM_NEW_TENANT }]);
  rows.push([{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]);
  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}

export async function showPlatformTenantInfo(ctx, cid, tenantId) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.db || !tenantId) return;
  let tenant = null;
  let botIds = [];
  try { tenant = await getTenant(ctx, tenantId); } catch {}
  try { botIds = await getBotIdsByTenantId(ctx, tenantId); } catch {}
  if (!tenant) {
    return send(ctx, cid, t(lg, 'sysadm_tenant_not_found'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TENANTS }]] },
    });
  }
  const botsText = botIds.length ? botIds.map(id => `<code>${id}</code>`).join(', ') : '—';
  const created = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('ru-RU') : '—';
  const trialInfo = tenant.billingStatus === 'trialing' && tenant.trialEndsAt
    ? `\n⏳ ${t(lg, 'billing_trial_ends')}: ${new Date(tenant.trialEndsAt).toLocaleDateString('ru-RU')}`
    : '';
  const graceInfo = tenant.billingStatus === 'grace_period' && tenant.graceEndsAt
    ? `\n⚠️ ${t(lg, 'billing_grace_ends')}: ${new Date(tenant.graceEndsAt).toLocaleDateString('ru-RU')}`
    : '';
  const text =
    `🏢 <b>${escHtml(tenant.name || tenant.id)}</b>\n\n` +
    `ID: <code>${tenant.id}</code>\n` +
    `${t(lg, 'billing_status')}: ${tenant.billingStatus || 'inactive'}${trialInfo}${graceInfo}\n` +
    `${t(lg, 'billing_plan')}: ${tenant.plan || 'free'}\n` +
    `🤖 ${t(lg, 'sysadm_bots')}: ${botsText}\n` +
    `📅 ${t(lg, 'sysadm_created')}: ${created}`;
  const botRow = botIds.length > 0
    ? [{ text: `✅ ${t(lg, 'sysadm_bot_already_assigned')}: ${botIds[0]}`, callback_data: CB.NOOP }]
    : [{ text: t(lg, 'sysadm_bot_new_btn'), callback_data: CB.SYSADM_BOT_NEW_FOR + tenantId }];
  await send(ctx, cid, text, {
    reply_markup: {
      inline_keyboard: [
        botRow,
        [{ text: t(lg, 'back'), callback_data: CB.SYSADM_TENANTS }],
      ],
    },
  });
}

/**
 * Общий рендер списка агентов для платформы.
 * Раньше showPlatformSupportList и showPlatformTechSupportList были ~идентичны.
 * @param {{ icon, titleKey, noAgentsKey, addBtn, addCb, removeBtn, removeCb }} cfg
 */
async function renderPlatformAgentList(ctx, cid, lg, agents, cfg) {
  const text = agents.length
    ? `${cfg.icon} <b>${t(lg, cfg.titleKey)}</b> (${agents.length})\n\n` +
      agents.map(id => `• <code>${id}</code>`).join('\n')
    : `${cfg.icon} <b>${t(lg, cfg.titleKey)}</b>\n\n${t(lg, cfg.noAgentsKey)}`;
  const rows = [];
  rows.push([{ text: t(lg, cfg.addBtn), callback_data: cfg.addCb }]);
  for (const agentId of agents) {
    rows.push([{ text: `${t(lg, cfg.removeBtn)} ${agentId}`, callback_data: cfg.removeCb + agentId }]);
  }
  rows.push([{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]);
  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}

export async function showPlatformSupportList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.db) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let agents = [];
  try { agents = await getSupportAgents(ctx); } catch {}
  await renderPlatformAgentList(ctx, cid, lg, agents, {
    icon: '👥',
    titleKey: 'sysadm_support_agents',
    noAgentsKey: 'sysadm_no_agents',
    addBtn: 'sysadm_support_add_btn',
    addCb: CB.SYSADM_SUPPORT_ADD,
    removeBtn: 'sysadm_support_remove_btn',
    removeCb: CB.SYSADM_SUPPORT_REMOVE,
  });
}

export async function showGrantRoleMenu(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, t(lg, 'sysadm_grant_role_msg'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lg, 'sysadm_grant_master_btn'), callback_data: CB.SYSADM_GRANT_MASTER }],
        [{ text: t(lg, 'sysadm_grant_owner_btn'), callback_data: CB.SYSADM_GRANT_OWNER }],
        [{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }],
      ],
    },
  });
}

export async function showPlatformTechSupportList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.db) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let agents = [];
  try { agents = await getTechnicalSupportAgents(ctx); } catch {}
  await renderPlatformAgentList(ctx, cid, lg, agents, {
    icon: '🔧',
    titleKey: 'sysadm_tech_support_agents',
    noAgentsKey: 'sysadm_tech_support_no_agents',
    addBtn: 'sysadm_tech_support_add_btn',
    addCb: CB.SYSADM_TECH_SUPPORT_ADD,
    removeBtn: 'sysadm_tech_support_remove_btn',
    removeCb: CB.SYSADM_TECH_SUPPORT_REMOVE,
  });
}

export async function showPlatformLinks(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const base = ctx.baseUrl || '';
  const adminUrl = base ? `${base}/admin` : '/admin';
  const billingUrl = base ? `${base}/admin/billing` : '/admin/billing';
  const text = fill(t(lg, 'sysadm_links_msg'), {
    admin: adminUrl,
    billing: billingUrl,
  });
  await send(ctx, cid, text, {
    reply_markup: {
      inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]],
    },
  });
}

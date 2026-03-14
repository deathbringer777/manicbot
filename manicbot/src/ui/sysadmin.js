/**
 * Platform admin panel UI. Only for system_admin role.
 * Shows: all tenants, support agents, bot management.
 */

import { send } from '../telegram.js';
import { t, escHtml, fill } from '../utils/helpers.js';
import { getLang } from '../services/chat.js';
import { listTenantIds, getTenant, getBotIdsByTenantId } from '../tenant/storage.js';
import { getSupportAgents } from '../roles/roles.js';
import { CB } from '../config.js';

function sysadmKb(lg) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lg, 'sysadm_tenants_btn'), callback_data: CB.SYSADM_TENANTS },
         { text: t(lg, 'sysadm_new_tenant_btn'), callback_data: CB.SYSADM_NEW_TENANT }],
        [{ text: t(lg, 'sysadm_bot_new_btn'), callback_data: CB.SYSADM_BOT_NEW },
         { text: t(lg, 'sysadm_grant_role_btn'), callback_data: CB.SYSADM_GRANT_ROLE }],
        [{ text: t(lg, 'sysadm_support_btn'), callback_data: CB.SYSADM_SUPPORT_LIST }],
        [{ text: t(lg, 'sysadm_tenant_panel_btn'), callback_data: CB.ADM_MAIN },
         { text: t(lg, 'sysadm_links_btn'), callback_data: CB.SYSADM_LINKS }],
      ],
    },
  };
}

export async function showPlatformAdminPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  const kv = ctx.globalKv || ctx.kv;
  let tenantCount = 0;
  let agentCount = 0;
  if (kv) {
    try { tenantCount = (await listTenantIds(kv)).length; } catch {}
    try { agentCount = (await getSupportAgents(kv)).length; } catch {}
  }
  const text =
    `🌐 <b>${t(lg, 'sysadm_title')}</b>\n\n` +
    `👤 ${escHtml(name)}\n` +
    `🏢 ${t(lg, 'sysadm_tenants_count')}: <b>${tenantCount}</b>\n` +
    `👥 ${t(lg, 'sysadm_agents_count')}: <b>${agentCount}</b>`;
  await send(ctx, cid, text, sysadmKb(lg));
}

export async function showPlatformTenantsList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const kv = ctx.globalKv || ctx.kv;
  if (!kv) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let tenantIds = [];
  try { tenantIds = await listTenantIds(kv); } catch {}
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
  const tenants = await Promise.all(tenantIds.map(id => getTenant(kv, id).catch(() => null)));
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
  const kv = ctx.globalKv || ctx.kv;
  if (!kv || !tenantId) return;
  let tenant = null;
  let botIds = [];
  try { tenant = await getTenant(kv, tenantId); } catch {}
  try { botIds = await getBotIdsByTenantId(kv, tenantId); } catch {}
  if (!tenant) {
    return send(ctx, cid, t(lg, 'sysadm_tenant_not_found'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TENANTS }]] },
    });
  }
  const botsText = botIds.length ? botIds.map(id => `<code>${id}</code>`).join(', ') : '—';
  const created = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('ru-RU') : '—';
  const text =
    `🏢 <b>${escHtml(tenant.name || tenant.id)}</b>\n\n` +
    `ID: <code>${tenant.id}</code>\n` +
    `${t(lg, 'billing_status')}: ${tenant.billingStatus || 'inactive'}\n` +
    `${t(lg, 'billing_plan')}: ${tenant.plan || 'free'}\n` +
    `🤖 ${t(lg, 'sysadm_bots')}: ${botsText}\n` +
    `📅 ${t(lg, 'sysadm_created')}: ${created}`;
  await send(ctx, cid, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lg, 'sysadm_bot_new_btn'), callback_data: CB.SYSADM_BOT_NEW_FOR + tenantId }],
        [{ text: t(lg, 'back'), callback_data: CB.SYSADM_TENANTS }],
      ],
    },
  });
}

export async function showPlatformSupportList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const kv = ctx.globalKv || ctx.kv;
  if (!kv) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let agents = [];
  try { agents = await getSupportAgents(kv); } catch {}
  const text = agents.length
    ? `👥 <b>${t(lg, 'sysadm_support_agents')}</b> (${agents.length})\n\n` +
      agents.map(id => `• <code>${id}</code>`).join('\n')
    : `👥 <b>${t(lg, 'sysadm_support_agents')}</b>\n\n${t(lg, 'sysadm_no_agents')}`;
  const rows = [];
  rows.push([{ text: t(lg, 'sysadm_support_add_btn'), callback_data: CB.SYSADM_SUPPORT_ADD }]);
  for (const agentId of agents) {
    rows.push([{ text: `${t(lg, 'sysadm_support_remove_btn')} ${agentId}`, callback_data: CB.SYSADM_SUPPORT_REMOVE + agentId }]);
  }
  rows.push([{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]);
  await send(ctx, cid, text, {
    reply_markup: { inline_keyboard: rows },
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

/** Показать ссылки на веб-админку и биллинг (для создателя/админа платформы). */
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

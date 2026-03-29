import { verifyMetaSignature, handleHubChallenge } from '../channels/meta-verify.js';
import {
  resolveTenantFromWhatsApp,
  resolveTenantFromInstagram,
  getChannelConfig,
  buildChannelCtx,
} from '../channels/resolver.js';
import { WhatsAppAdapter } from '../channels/whatsapp.js';
import { InstagramAdapter, parseInstagramIgnoreSenderIds } from '../channels/instagram.js';
import { handleInbound } from '../handlers/inbound.js';
import { initServices } from '../services/services.js';
import { envCtx } from './envCtx.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {any} [execCtx] Cloudflare `ExecutionContext` with waitUntil, or legacy ctx with optional waitUntil
 * @returns {Promise<Response | null>}
 */
function scheduleBackground(execCtx, task) {
  const wu = execCtx && typeof execCtx.waitUntil === 'function' ? execCtx.waitUntil.bind(execCtx) : null;
  if (wu) wu(task);
  else task.catch(e => console.error('[meta] background task:', e?.message || e));
}

export async function tryMetaWebhooks(request, env, url, execCtx) {
  if (request.method === 'GET' && url.pathname === '/webhook/wa') {
    return handleHubChallenge(url, env.META_VERIFY_TOKEN_WA || '');
  }

  if (request.method === 'POST' && url.pathname === '/webhook/wa') {
    const sig = request.headers.get('X-Hub-Signature-256') || '';
    let body;
    try {
      body = await request.text();
    } catch {
      return new Response('OK');
    }
    const valid = await verifyMetaSignature(body, sig, env.META_APP_SECRET || '');
    if (!valid) return new Response('Forbidden', { status: 403 });

    const ec = envCtx(env);
    const parsed = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })();
    if (parsed) {
      const processWA = async () => {
        try {
          const entries = parsed?.entry ?? [];
          for (const entry of entries) {
            const changes = entry.changes ?? [];
            for (const change of changes) {
              const phoneNumberId = change.value?.metadata?.phone_number_id;
              if (!phoneNumberId) continue;
              const resolved = await resolveTenantFromWhatsApp(ec, phoneNumberId);
              if (!resolved) {
                console.warn('[wa] unresolved phone_number_id:', phoneNumberId);
                continue;
              }
              const channelConfig = await getChannelConfig(ec, resolved.tenantId, 'whatsapp', env.BOT_ENCRYPTION_KEY || null);
              if (!channelConfig) continue;
              const adapter = new WhatsAppAdapter({ tenantId: resolved.tenantId, channelConfig });
              const ctx = await buildChannelCtx(env, resolved.tenantId, channelConfig, adapter);
              if (!ctx) continue;
              await initServices(ctx);
              const inbound = adapter.normalize(entry);
              if (inbound) await handleInbound(ctx, inbound);
            }
          }
        } catch (e) {
          console.error('[wa] process error:', e.message);
        }
      };
      scheduleBackground(execCtx, processWA());
    }
    return new Response('OK');
  }

  if (request.method === 'GET' && url.pathname === '/webhook/ig') {
    return handleHubChallenge(url, env.META_VERIFY_TOKEN_IG || '');
  }

  if (request.method === 'POST' && url.pathname === '/webhook/ig') {
    const sig = request.headers.get('X-Hub-Signature-256') || '';
    let body;
    try {
      body = await request.text();
    } catch {
      return new Response('OK');
    }
    const valid = await verifyMetaSignature(body, sig, env.META_APP_SECRET || '');
    if (!valid) return new Response('Forbidden', { status: 403 });

    const ec = envCtx(env);
    const parsed = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })();
    if (parsed) {
      const instagramIgnoreSenderIds = parseInstagramIgnoreSenderIds(env.INSTAGRAM_IGNORE_SENDER_IDS);
      const processIG = async () => {
        try {
          const entries = parsed.entry ?? [];
          for (const entry of entries) {
            const pageId = entry.id;
            if (!pageId) continue;
            const resolved = await resolveTenantFromInstagram(ec, pageId);
            if (!resolved) {
              console.warn('[ig] unresolved page_id:', pageId);
              continue;
            }
            const channelConfig = await getChannelConfig(ec, resolved.tenantId, 'instagram', env.BOT_ENCRYPTION_KEY || null);
            if (!channelConfig) continue;
            if (!channelConfig.token) {
              console.warn('[ig] no token after getChannelConfig — cannot send replies; tenant:', resolved.tenantId);
            }
            const adapter = new InstagramAdapter({
              tenantId: resolved.tenantId,
              channelConfig,
              instagramIgnoreSenderIds,
            });
            const ctx = await buildChannelCtx(env, resolved.tenantId, channelConfig, adapter);
            if (!ctx) continue;
            await initServices(ctx);
            for (const m of entry?.messaging ?? []) {
              const inbound = adapter.normalizeMessaging(m, entry);
              if (inbound) await handleInbound(ctx, inbound);
            }
          }
        } catch (e) {
          console.error('[ig] process error:', e.message);
        }
      };
      scheduleBackground(execCtx, processIG());
    }
    return new Response('OK');
  }

  return null;
}

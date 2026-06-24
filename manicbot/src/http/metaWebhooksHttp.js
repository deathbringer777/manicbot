import { verifyMetaSignature, handleHubChallenge } from '../channels/meta-verify.js';
import { log } from '../utils/logger.js';
import {
  resolveTenantFromWhatsApp,
  resolveTenantFromInstagram,
  getChannelConfig,
  buildChannelCtx,
} from '../channels/resolver.js';
import { WhatsAppAdapter } from '../channels/whatsapp.js';
import { InstagramAdapter, parseInstagramIgnoreSenderIds } from '../channels/instagram.js';
import { handleInbound } from '../handlers/inbound.js';
import { markOutboundDeliveryState } from '../services/messengerThreads.js';
import { initServices } from '../services/services.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';
import { claimMetaMessage, claimWAMessage } from '../utils/dedup.js';

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
  else task.catch(e => log.error('http.metaWebhooks', e instanceof Error ? e : new Error(String(e?.message || e)), { action: 'background_task' }));
}

export async function tryMetaWebhooks(request, env, url, execCtx) {
  if (request.method === 'GET' && url.pathname === '/webhook/wa') {
    return handleHubChallenge(url, env.META_VERIFY_TOKEN_WA || '');
  }

  if (request.method === 'POST' && url.pathname === '/webhook/wa') {
    // Fail-fast if META_APP_SECRET is not configured — otherwise any POST passes unverified
    // (verifyMetaSignature would return false without a secret, but we want explicit observability).
    if (!env.META_APP_SECRET) {
      log.error('http.metaWebhooks', new Error('META_APP_SECRET not configured — rejecting WA webhook'));
      return new Response('Meta webhook not configured', { status: 503 });
    }
    const sig = request.headers.get('X-Hub-Signature-256') || '';
    let rawBytes;
    let body;
    try {
      rawBytes = await request.arrayBuffer();
      body = new TextDecoder().decode(rawBytes);
    } catch {
      return new Response('OK');
    }
    const valid = await verifyMetaSignature(rawBytes, sig, env.META_APP_SECRET);
    if (!valid) return new Response('Forbidden', { status: 403 });

    const ec = envCtx(env);
    void logEvent(ec, 'webhook.meta', { message: 'Meta webhook: wa' });
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

              const messages = change.value?.messages ?? [];
              const statuses = change.value?.statuses ?? [];

              // Dedup by wamid — PER MESSAGE. Meta retries WA webhooks for up to
              // 24h on 5xx (without dedup every retry replays: duplicate AI
              // replies, bookings, analytics), AND a single change can batch
              // several inbound messages. Claim each independently and keep the
              // fresh ones, so a batched webhook never drops messages[1..]
              // (a claimed-but-unprocessed wamid can never be re-delivered).
              // Status updates (delivered/read receipts) carry no message id and
              // are never claimed.
              const freshMessages = [];
              for (const m of messages) {
                const wamid = m?.id;
                if (!wamid) { freshMessages.push(m); continue; } // no id → can't dedup, process once
                // Forward DB so the dual/D1 dedup backend can claim atomically (KV has no CAS).
                const fresh = await claimWAMessage(
                  { MANICBOT: env.MANICBOT, DB: env.DB }, String(phoneNumberId), String(wamid),
                );
                if (fresh) freshMessages.push(m);
              }
              // Pure replay AND no delivery receipts → nothing to do.
              if (!freshMessages.length && !statuses.length) continue;

              const resolved = await resolveTenantFromWhatsApp(ec, phoneNumberId);
              if (!resolved) {
                log.warn('http.metaWebhooks', { message: 'unresolved WA phone_number_id' });
                continue;
              }
              // Delivery receipts (statuses[]) carry the wamid of OUR outbound
              // message — advance its persisted delivery_state. Correlation works
              // now that the external_msg_id .data-hop bug is fixed (Phase 1).
              for (const st of statuses) {
                if (!st?.id) continue;
                if (st.status === 'delivered' || st.status === 'read') {
                  await markOutboundDeliveryState(ec, resolved.tenantId, String(st.id), 'delivered');
                } else if (st.status === 'failed') {
                  await markOutboundDeliveryState(
                    ec, resolved.tenantId, String(st.id), 'failed',
                    st?.errors?.[0]?.title ?? 'channel_failed',
                  );
                }
              }
              if (!freshMessages.length) continue; // status-only change — receipts handled above

              const channelConfig = await getChannelConfig(ec, resolved.tenantId, 'whatsapp', env.BOT_ENCRYPTION_KEY || null);
              if (!channelConfig) continue;
              const adapter = new WhatsAppAdapter({ tenantId: resolved.tenantId, channelConfig });
              const ctx = await buildChannelCtx(env, resolved.tenantId, channelConfig, adapter);
              if (!ctx) continue;
              adapter._ctx = ctx; // give adapter access to db for 24h window check
              await initServices(ctx);
              // Process EVERY fresh message in this change — not just messages[0].
              for (const m of freshMessages) {
                const inbound = adapter.normalizeOne(m, change.value, entry);
                if (inbound) await handleInbound(ctx, inbound);
              }
            }
          }
        } catch (e) {
          log.error('http.metaWebhooks', e instanceof Error ? e : new Error(String(e.message)), { channel: 'wa' });
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
    // Fail-fast if META_APP_SECRET is not configured (see wa handler above).
    if (!env.META_APP_SECRET) {
      log.error('http.metaWebhooks', new Error('META_APP_SECRET not configured — rejecting IG webhook'));
      return new Response('Meta webhook not configured', { status: 503 });
    }
    const sig = request.headers.get('X-Hub-Signature-256') || '';
    let rawBytes;
    let body;
    try {
      rawBytes = await request.arrayBuffer();
      body = new TextDecoder().decode(rawBytes);
    } catch {
      return new Response('OK');
    }
    // Try META_APP_SECRET first; fall back to META_INSTAGRAM_APP_SECRET
    // for the new Instagram Login product (post-Mar-2026), which signs with
    // its OWN App Secret separate from the parent FB App Secret.
    let valid = await verifyMetaSignature(rawBytes, sig, env.META_APP_SECRET);
    let usedIgSecret = false;
    if (!valid && env.META_INSTAGRAM_APP_SECRET) {
      valid = await verifyMetaSignature(rawBytes, sig, env.META_INSTAGRAM_APP_SECRET);
      if (valid) usedIgSecret = true;
    }
    if (!valid) {
      // Capture so we can see whether Meta IS delivering with a different
      // signing secret. Bodies stay private — only sig prefix + length.
      try {
        const { captureError } = await import('../utils/errorCapture.js');
        const { CHANNEL_ERROR_TYPE } = await import('../channels/error-types.js');
        await captureError(env, new Error('IG webhook signature mismatch — Meta may be using a different App Secret (Instagram product has its own)'), {
          source: 'webhook.ig',
          severity: 'error',
          path: '/webhook/ig',
          errorType: CHANNEL_ERROR_TYPE.META_WEBHOOK_SIGNATURE_MISMATCH,
          channelType: 'instagram',
          sigPrefix: sig.slice(0, 24),
          bodyLen: rawBytes.byteLength,
          hasMetaAppSecret: env.META_APP_SECRET ? 'yes' : 'no',
          hasInstagramAppSecret: env.META_INSTAGRAM_APP_SECRET ? 'yes' : 'no',
        });
      } catch { /* never throw from webhook hot path */ }
      return new Response('Forbidden', { status: 403 });
    }

    const ec = envCtx(env);
    if (usedIgSecret) log.info('http.metaWebhooks', { message: 'IG webhook verified via META_INSTAGRAM_APP_SECRET' });
    void logEvent(ec, 'webhook.meta', { message: 'Meta webhook: ig' });
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
            if (!pageId) { log.warn('http.metaWebhooks', { message: 'no pageId in IG entry' }); continue; }
            const resolved = await resolveTenantFromInstagram(ec, pageId);
            if (!resolved) {
              log.warn('http.metaWebhooks', { message: 'unresolved IG page_id' });
              continue;
            }
            const channelConfig = await getChannelConfig(ec, resolved.tenantId, 'instagram', env.BOT_ENCRYPTION_KEY || null);
            if (!channelConfig) {
              log.warn('http.metaWebhooks', { message: 'no channelConfig for IG tenant', tenantId: resolved.tenantId });
              continue;
            }
            if (!channelConfig.token) {
              log.error('http.metaWebhooks', new Error('no IG token for tenant — set via POST /admin/ig-token'), { tenantId: resolved.tenantId });
              continue;
            }
            const adapter = new InstagramAdapter({
              tenantId: resolved.tenantId,
              channelConfig,
              instagramIgnoreSenderIds,
            });
            const ctx = await buildChannelCtx(env, resolved.tenantId, channelConfig, adapter);
            if (!ctx) {
              log.warn('http.metaWebhooks', { message: 'IG buildChannelCtx returned null' });
              continue;
            }
            adapter._ctx = ctx; // give adapter access to db for 24h window check
            await initServices(ctx);
            for (const m of entry?.messaging ?? []) {
              // Sprint 2: dedup by message.mid. Meta retries deliveries for up
              // to 24h on 5xx — without dedup every retry replays the message.
              const mid = m?.message?.mid || m?.read?.mid || m?.delivery?.mids?.[0];
              if (mid) {
                // Forward DB so the dual/D1 dedup backend can claim atomically (KV has no CAS).
                const fresh = await claimMetaMessage({ MANICBOT: env.MANICBOT, DB: env.DB }, String(pageId), String(mid));
                if (!fresh) continue;
              }
              // Read/delivery receipts → advance our outbound message's state,
              // then skip (they're not inbound messages).
              if (m?.read?.mid || m?.delivery?.mids?.length) {
                const dmids = m?.delivery?.mids ?? (m?.read?.mid ? [m.read.mid] : []);
                for (const dmid of dmids) {
                  await markOutboundDeliveryState(ec, resolved.tenantId, String(dmid), 'delivered');
                }
                continue;
              }
              const inbound = adapter.normalizeMessaging(m, entry);
              if (inbound) await handleInbound(ctx, inbound);
            }
          }
        } catch (e) {
          log.error('http.metaWebhooks', e instanceof Error ? e : new Error(String(e.message)), { channel: 'ig' });
        }
      };
      scheduleBackground(execCtx, processIG());
    }
    return new Response('OK');
  }

  return null;
}

/* eslint-disable */
// @ts-nocheck
/**
 * ManicBot service worker — Web Push (browser push notifications).
 *
 * Responsibilities:
 *   1. `push` event — decrypt the incoming payload (browser already did
 *      the RFC 8291 unwrap before we see it), parse the JSON we sent
 *      from the Worker, and render a native OS notification.
 *   2. `notificationclick` event — focus the existing dashboard tab when
 *      possible (so the user lands on the bell without spawning a new
 *      tab), otherwise open the link.
 *
 * Payload contract (sent by manicbot/src/services/webpush.js):
 *   {
 *     title: string,           // notification title
 *     body?: string,           // body text
 *     link?: string,           // dashboard URL to focus / open on click
 *     tag?: string,            // dedup tag — repeat = replace
 *     kind?: string,           // for icon picking (future)
 *   }
 *
 * No tracking, no remote fetches beyond the standard SW install/activate.
 */

const SW_VERSION = "mb-push-v1";

self.addEventListener("install", (event) => {
  // Activate immediately so updates roll out without waiting for tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_e) {
    // Fall through with raw text — better a vague notification than none.
    try {
      payload = { title: "ManicBot", body: event.data?.text?.() ?? "" };
    } catch (_e2) {
      payload = { title: "ManicBot" };
    }
  }

  const title = String(payload.title ?? "ManicBot");
  const options = {
    body: payload.body ? String(payload.body) : undefined,
    tag: payload.tag ? String(payload.tag) : undefined,
    badge: "/favicon.ico",
    icon: "/favicon.ico",
    data: {
      link: payload.link ? String(payload.link) : "/notifications",
      kind: payload.kind ? String(payload.kind) : undefined,
    },
    // Replace previous notification with the same tag instead of stacking.
    renotify: !!payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notifications";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    // Prefer focusing an existing dashboard tab over spawning a new one.
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try { await client.navigate(link); } catch (_e) { /* navigation may be cross-origin */ }
          }
          return;
        }
      } catch (_e) { /* ignore */ }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(link);
    }
  })());
});

// PushManager occasionally renews a subscription out-of-band; mirror the
// new keys back to the server so the next push reaches the right endpoint.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const newSub = event.newSubscription;
      if (!newSub) return;
      const keys = newSub.toJSON().keys || {};
      await fetch("/api/push/resync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: newSub.endpoint,
          p256dh: keys.p256dh ?? null,
          auth: keys.auth ?? null,
        }),
      });
    } catch (_e) {
      // Best-effort — the next subscribe call from the UI will heal this.
    }
  })());
});

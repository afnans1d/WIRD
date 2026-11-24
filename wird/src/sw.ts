/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const OFFLINE_SHELL_CACHE = 'wird-offline-shell-v1';
const OFFLINE_CORE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/wird-logo-cropped.png',
  '/pwa-192x192.png',
  '/apple-touch-icon.png',
  '/assets/aistudio/__________________________7b238392.png',
  '/assets/aistudio/_________________________________80204d67.png',
  '/fonts/thmanyah/thmanyah-serif-display-Regular.woff2',
  '/fonts/thmanyah/thmanyah-serif-display-Medium.woff2',
  '/fonts/thmanyah/thmanyah-serif-display-Bold.woff2',
  '/fonts/thmanyah/thmanyah-serif-text-Regular.woff2',
  '/fonts/thmanyah/thmanyah-serif-text-Medium.woff2',
  '/fonts/thmanyah/thmanyah-serif-text-Bold.woff2',
];

async function warmOfflineShellCache(): Promise<void> {
  const cache = await caches.open(OFFLINE_SHELL_CACHE);
  await Promise.allSettled(
    OFFLINE_CORE_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) {
          await cache.put(url, res);
        }
      } catch {
        // Ignore single fetch failure when offline
      }
    })
  );
}

self.addEventListener('install', (event: ExtendableEvent) => {
  self.skipWaiting();
  event.waitUntil(warmOfflineShellCache());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Cache Google Fonts stylesheets & font files for full offline Arabic typography
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'wird-arabic-fonts-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// Cache same-origin images (logo, icons, morning/evening windows)
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'wird-images-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 }),
    ],
  })
);

// Cache same-origin scripts, stylesheets, and manifest so app runs offline even in dev/preview
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/@vite/client') &&
    (request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'font' ||
      request.destination === 'manifest'),
  new NetworkFirst({
    cacheName: 'wird-code-v1',
    networkTimeoutSeconds: 2,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

// Navigation fallback: NetworkFirst with cached '/' and precache fallback when offline
const navStrategy = new NetworkFirst({
  cacheName: 'wird-pages-v1',
  networkTimeoutSeconds: 3,
  plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
});

registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
  async ({ event, request, url }) => {
    try {
      const response = await navStrategy.handle({ event, request, url });
      if (response) return response;
    } catch {
      // Fall through to offline fallbacks
    }
    const precachedIndex = await matchPrecache('/index.html');
    if (precachedIndex) return precachedIndex;

    const cachedRoot = await caches.match('/');
    if (cachedRoot) return cachedRoot;

    return new Response(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>وِرد — وضع عدم الاتصال</title><body style="font-family:sans-serif;text-align:center;padding:3rem"><h1>وِرد</h1><p>يرجى فتح الصفحة مرة واحدة أثناء الاتصال لتخزينها للعمل بدون إنترنت.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
);

// Handle on-demand offline pre-warming & native local notifications from the app UI
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as
    | {
        type?: string;
        title?: string;
        body?: string;
        url?: string;
        period?: 'morning' | 'evening';
        tag?: string;
      }
    | undefined;

  if (data?.type === 'WIRD_WARM_OFFLINE') {
    event.waitUntil(
      warmOfflineShellCache().then(() => {
        event.ports?.[0]?.postMessage({ ok: true });
      })
    );
    return;
  }

  if (data?.type === 'WIRD_SHOW_NOTIFICATION') {
    const targetUrl = data.url || (data.period ? `/?session=${data.period}` : '/');
    event.waitUntil(
      self.registration.showNotification(data.title || 'WIRD | وِرد', {
        body: data.body || 'حان وقت أذكارك حفظك الله',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        dir: 'rtl',
        lang: 'ar',
        tag: data.tag || `wird-${data.period || 'general'}`,
        data: {
          url: targetUrl,
          period: data.period || null,
        },
      })
    );
  }
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  period?: 'morning' | 'evening';
  tag?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {
    title: 'WIRD | وِرد',
    body: 'حان وقت أذكارك حفظك الله',
    url: '/',
    tag: 'wird-reminder',
  };

  if (event.data) {
    try {
      const parsed = event.data.json() as PushPayload;
      payload = { ...payload, ...parsed };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  const targetUrl = payload.url || (payload.period ? `/?session=${payload.period}` : '/');

  event.waitUntil(
    self.registration.showNotification(payload.title || 'WIRD | وِرد', {
      body: payload.body || 'حان وقت أذكارك حفظك الله',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: payload.tag || `wird-${payload.period || 'general'}`,
      renotify: true,
      data: {
        url: targetUrl,
        period: payload.period || null,
      },
    } as NotificationOptions & { renotify?: boolean })
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = (event.notification.data || {}) as { url?: string; period?: string };
  const relativeTarget = data.url || (data.period ? `/?session=${data.period}` : '/');
  const targetUrl = new URL(relativeTarget, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch {
              client.postMessage({ type: 'WIRD_NAVIGATE', url: relativeTarget, period: data.period });
            }
          } else {
            client.postMessage({ type: 'WIRD_NAVIGATE', url: relativeTarget, period: data.period });
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

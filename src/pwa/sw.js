/**
 * UNCLAIMED — service worker.
 *
 * This is what makes the app real on both Android and iOS today, without a
 * store review, a signing certificate or a build step. Installed from the
 * browser, it runs offline with the whole dataset on device.
 *
 * Two caches, because they age differently:
 *   SHELL — the app itself. Cache-first; it only changes when we deploy.
 *   DATA  — the programme pools. Stale-while-revalidate: show the copy on
 *           device immediately, fetch a fresher one in the background. A
 *           benefits dataset that is a day old is still worth far more than
 *           a spinner on a train.
 *
 * The free check runs entirely in here — the matcher is bundled, so a user
 * with no signal still gets their number. That is not a nicety: the people
 * most likely to be owed money are the most likely to be on a poor
 * connection or a metered plan.
 */

const VERSION = 'v2';
const SHELL = `unclaimed-shell-${VERSION}`;
const DATA = `unclaimed-data-${VERSION}`;

/* Everything needed to open the app cold, offline. */
const SHELL_ASSETS = [
  'app/',
  'app/index.html',
  'app/app.css',
  'app/app.js',
  'theme.css',
  'engine/matcher.js',
  'engine/startup.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      /* addAll rejects the whole install if one asset 404s, which would leave
         the user with no app at all. Add them individually and tolerate a
         miss — a missing font matters less than a failed install. */
      await Promise.all(
        SHELL_ASSETS.map((a) => cache.add(a).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/* Programme data — the only API responses that may be cached, and only when
   the server says they are public. */
const isData = (url) => url.pathname.includes('/api/v1/');

/**
 * Anything per-user must never touch CacheStorage.
 *
 * This is the layer the HTTP cache headers do not reach. `cache-control:
 * private, no-store` on the response and `cache: 'no-store'` on the request
 * both stop the browser's HTTP cache and Cloudflare's edge — and neither has
 * any effect on `cache.put()`, which stores exactly what it is handed.
 *
 * The bug that was live: `isData` matched only `/api/v1/`, so `/api/me` fell
 * through to the cache-first branch at the bottom and was stored in the shell
 * cache. Consequences, in order of how bad they are:
 *
 *   - On a shared device, the next person to open the app was served the
 *     previous person's `/api/me` — their email address and their entitlement.
 *   - Someone who paid kept the pre-payment `entitled: false` answer, and the
 *     paywall stayed up with no way to clear it.
 *   - Someone who signed out stayed "signed in" until the cache version
 *     changed.
 *
 * So the rule is now an allow-list, not a deny-list. `/api/v1/` public data is
 * cacheable; every other `/api/` path and every `/auth/` path goes straight to
 * the network and is never stored.
 */
const isPrivatePath = (url) =>
  (url.pathname.startsWith('/api/') && !isData(url)) || url.pathname.startsWith('/auth/');

/** The server's own opinion. Belt and braces with the path rule above. */
const isPrivateResponse = (res) => /private|no-store/i.test(res.headers.get('cache-control') || '');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Never intercept a non-GET. `cache.put` rejects on a POST request, which
     turned every analytics beacon into an unhandled rejection in the SW. */
  if (request.method !== 'GET') return;

  /* Sessions, entitlement, the workspace, the admin figures. Network only,
     stored nowhere. Not even respondWith — letting it fall through to the
     browser is both correct and cheaper than proxying it. */
  if (isPrivatePath(url)) return;

  /* Programme data: serve from cache at once, refresh behind the user's back. */
  if (isData(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            /* An entitled user gets the UNSTRIPPED dataset at this same URL —
               same path, more data, marked private. Caching that would leave
               the paid directory in CacheStorage after sign-out, readable by
               anything on the origin. Only the public copy is stored. */
            if (res.ok && !isPrivateResponse(res)) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        /* And a cached PUBLIC copy must not be served to someone who has since
           paid — they would see stripped rows with blank names. When the
           network answers, prefer it. */
        const fresh = await Promise.race([network, new Promise((r) => setTimeout(() => r(null), 1500))]);
        return fresh || hit || (await network) || new Response('{"programmes":[]}', {
          headers: { 'content-type': 'application/json' },
        });
      })(),
    );
    return;
  }

  /* Navigations: network first so a deploy is picked up, falling back to the
     cached shell so the app still opens on a train. */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put(request, res.clone());
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match(request)) ||
            (await cache.match('app/index.html')) ||
            new Response('<h1>Offline</h1><p>Open the app once with a connection and it will work offline after that.</p>', {
              headers: { 'content-type': 'text/html' },
            })
          );
        }
      })(),
    );
    return;
  }

  /* Everything else: cache first. */
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && res.type === 'basic') {
          const cache = await caches.open(SHELL);
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});

/**
 * Deadline reminders.
 *
 * iOS only permits notifications from an installed PWA, and only after an
 * explicit grant — so this is best-effort by design and the app never relies
 * on it. Calendar export is the fallback that works everywhere.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || 'app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(target);
    }),
  );
});

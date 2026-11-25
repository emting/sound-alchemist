// Bump this version whenever the packed audio files or manifest change.
const PREFIX = 'sound-alchemist:' + self.registration.scope + ':';
const CACHE = PREFIX + 'v1';
const HOME = new URL('index.html', self.registration.scope).href;
const GAME = new URL('sound_alchemist.html', self.registration.scope).href;
const AUDIO = new URL('assets/audio/', self.registration.scope).href;
const TAILWIND = 'https://cdn.tailwindcss.com/3.4.17';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([HOME, GAME])));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function remember(cache, key, response) {
  try {
    await cache.put(key, response.clone());
  } catch (e) {
    // Cache storage can be unavailable or over quota.
  }
  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || (request.url === TAILWIND && response.type === 'opaque')) {
    return remember(cache, request, response);
  }
  return response;
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'warm-shell') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const game = await cache.match(GAME);
    const warmStyles = async () => {
      if (game && (await game.text()).includes(TAILWIND)) {
        await cacheFirst(new Request(TAILWIND, { mode: 'no-cors', priority: 'low' }));
      }
    };
    const warmAudio = async () => {
      for (const url of event.data.audio) {
        if (typeof url === 'string' && url.startsWith(AUDIO)) {
          await cacheFirst(new Request(url, { priority: 'low' })).catch(() => {});
        }
      }
    };
    await Promise.all([warmStyles(), warmAudio()]);
  })().catch(() => {}));
});

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) return remember(cache, key, response);
    if (response.status < 500) return response;
  } catch (e) {
    // Fall back to the installed page for offline navigation.
  }
  return (await cache.match(key)) || Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const path = url.origin + url.pathname;
  if (request.mode === 'navigate') {
    if (path === self.registration.scope || path === HOME) {
      event.respondWith(networkFirst(request, HOME));
    } else if (path === GAME) {
      event.respondWith(networkFirst(request, GAME));
    }
  } else if (request.url === TAILWIND || (path.startsWith(AUDIO) && !request.headers.has('Range'))) {
    event.respondWith(cacheFirst(request));
  }
});

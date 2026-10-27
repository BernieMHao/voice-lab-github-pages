// COOP/COEP response injection follows gzuidhof/coi-serviceworker (MIT).
// This worker is scoped to this Pages project, including its persistent model cache.
const SCOPE = self.registration.scope;
const PREFIX = new URL(SCOPE).pathname;
const MODEL_CACHE = 'voice-lab-models:' + PREFIX;
const APP_CACHE = 'voice-lab-app:' + PREFIX;
let catalogPromise;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function catalog() {
  if (!catalogPromise) catalogPromise = (async () => {
    const url = new URL('catalog.json', SCOPE).href;
    const cache = await caches.open(APP_CACHE);
    const response = await fetch(url).catch(() => cache.match(url));
    if (!response?.ok) throw new Error('Model catalog unavailable');
    return response.json();
  })().catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}
function isolated(response) {
  if (!response || response.type === 'opaque' || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  const path = decodeURIComponent(url.pathname.slice(PREFIX.length));
  event.respondWith((async () => {
    if (path.startsWith('models/')) {
      const data = await catalog();
      const file = Object.values(data.models).flatMap(model => model.files).find(file => file.path === path);
      if (!file) return isolated(new Response('Unknown model asset', { status:404 }));
      const key = new URL(file.path, SCOPE); key.searchParams.set('sha', file.sha256);
      const hit = await (await caches.open(MODEL_CACHE)).match(key.href);
      return isolated(hit || new Response('Model not downloaded. Use the download button first.', { status:404 }));
    }
    const cache = await caches.open(APP_CACHE);
    try {
      const response = isolated(await fetch(request));
      // Optional download data is stored only in MODEL_CACHE, never duplicated here.
      if (response.status === 200 && !request.headers.has('Range') && !path.startsWith('support/') && !path.startsWith('packs/') && !path.startsWith('__fixtures__/')) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return isolated(cached);
      return isolated(new Response('Offline resource unavailable', { status:503 }));
    }
  })());
});

/**
 * Loaded into the service worker (workbox.importScripts in vite.config.ts) for hosts
 * that can't send the cross-origin isolation headers, such as GitHub Pages. ONNX
 * Runtime's WebAssembly uses shared memory, which Firefox only allows in an isolated
 * page, so without them neither AI tool can run there. The values match public/_headers.
 */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

function isolate(response) {
  // Opaque and error responses (status 0) can't be rebuilt, and needn't be.
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Added before Workbox's own fetch listener, so whatever Workbox answers a same-origin
// request with (the page from the precache, the workers' scripts) gets the headers.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return;
  const respondWith = event.respondWith.bind(event);
  event.respondWith = (response) => respondWith(Promise.resolve(response).then(isolate));
});

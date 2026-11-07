/**
 * Loaded into the service worker (workbox.importScripts in vite.config.ts). Deletes
 * caches that earlier versions of the app filled and no longer use, so they stop
 * taking space on people's devices.
 *
 * 'ai-runtime' held a second copy of the AI runtime (about 27 MB unpacked).
 * Transformers.js keeps its own copy in its cache, which is the one it reads.
 */
const OLD_CACHES = ['ai-runtime'];

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(OLD_CACHES.map((name) => caches.delete(name))));
});

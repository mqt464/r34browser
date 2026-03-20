const CACHE_NAME = 'r34browser-shell-v3'
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './maskable-icon-512.png',
]

async function putInCache(request, response) {
  if (!response || !response.ok) {
    return response
  }

  const cache = await caches.open(CACHE_NAME)
  await cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    return await putInCache(request, response)
  } catch {
    return (await caches.match(request)) ?? (await caches.match('./index.html')) ?? Response.error()
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request)
  const networkPromise = fetch(request)
    .then((response) => putInCache(request, response))
    .catch(() => undefined)

  if (cached) {
    event.waitUntil(networkPromise)
    return cached
  }

  const response = await networkPromise
  return response ?? (await caches.match(request)) ?? Response.error()
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request))
    return
  }

  event.respondWith(staleWhileRevalidate(event.request, event))
})

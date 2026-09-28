const CACHE_NAME = 'taskgo-shell-v1';
const APP_SHELL = [
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/brand-logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

const isSameOrigin = (url) => url.origin === self.location.origin;

const isStaticAppAsset = (url) => (
  isSameOrigin(url)
  && (
    url.pathname === '/index.html'
    || url.pathname === '/offline.html'
    || url.pathname === '/manifest.webmanifest'
    || url.pathname === '/brand-logo.svg'
    || url.pathname === '/favicon.ico'
    || url.pathname.startsWith('/icons/')
    || url.pathname.startsWith('/assets/')
  )
);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => (name.startsWith('lixiang-shell-') || name.startsWith('taskgo-shell-')) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API, authentication, uploads, and all other user data always bypass Cache Storage.
  if (!isSameOrigin(url) || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch('/index.html')
        .then((response) => response.ok ? response : Promise.reject(new Error('App shell unavailable')))
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/offline.html'))),
    );
    return;
  }

  if (request.method !== 'GET' || !isStaticAppAsset(url)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok) {
        return response;
      }
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      return response;
    })),
  );
});

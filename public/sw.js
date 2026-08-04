// sw.js — minimal service worker for Web Push.
// Must be served from the site root (or the scope you register it with)
// so it can control the pages that need navigator.serviceWorker.ready.

self.addEventListener('install', (event) => {
  // Activate this SW as soon as it's finished installing, without waiting
  // for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any already-open clients immediately.
  event.waitUntil(self.clients.claim());
});

// Fires when a push message arrives from the push service.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback for pushes sent as plain text instead of JSON.
    data = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'New notification';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/badge-72.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Fires when the user clicks the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

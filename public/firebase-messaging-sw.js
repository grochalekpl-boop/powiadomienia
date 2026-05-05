// Service Worker dla powiadomień Push
importScripts('https://www.gstatic.com/firebasejs/10.12.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.1/firebase-messaging-compat.js');

const firebaseConfig = {
  "projectId": "gen-lang-client-0832123411",
  "appId": "1:990262083677:web:6091f9d2d5bccd56facdb4",
  "apiKey": "AIzaSyBsGXml9XXrED5kG_vPtLws7T8YhtmkJxc",
  "authDomain": "gen-lang-client-0832123411.firebaseapp.com",
  "storageBucket": "gen-lang-client-0832123411.firebasestorage.app",
  "messagingSenderId": "990262083677"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Obsługa komunikatów w tle (gdy karta jest zamknięta lub zminimalizowana)
messaging.onBackgroundMessage((payload) => {
  console.log('[sw] Otrzymano wiadomość w tle:', payload);

  const notificationTitle = payload.notification?.title || 'System Powiadomień';
  const notificationOptions = {
    body: payload.notification?.body || 'Masz nową wiadomość',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: {
      ...payload.data,
      url: payload.data?.url || '/'
    },
    tag: 'push-notification-tag',
    renotify: true,
    requireInteraction: true, // Powiadomienie nie zniknie dopóki użytkownik go nie zamknie
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Obsługa interakcji z powiadomieniem
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Jeśli jakaś karta jest już otwarta, skupiamy się na niej
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // W przeciwnym razie otwieramy nową kartę
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

/* global self, clients */
// Handlers de Web Push do service worker.
//
// Vive separado porque o SW principal (dist/sw.js) e GERADO pelo vite-plugin-pwa
// a cada build — qualquer coisa escrita la seria apagada. O plugin importa este
// arquivo via workbox.importScripts, entao ele roda dentro do mesmo SW.
//
// Este arquivo NAO passa pelo bundler: e servido cru de public/. Sem import,
// sem JSX, sem sintaxe que o navegador nao entenda direto.

// Chega quando o backend empurra uma notificacao. O payload e o JSON montado em
// lib/web_push.js: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    // Push sem payload ou com corpo invalido. Melhor uma notificacao generica do
    // que nenhuma: o usuario ainda sabe que algo aconteceu e pode abrir o app.
    data = {};
  }

  const title = data.title || 'Agendamentos Online';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    // O badge e o icone monocromatico da barra de status do Android.
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    // Sem isso, uma notificacao com o mesmo tag chega silenciosa — o usuario ve
    // o balao trocar mas nao percebe que e um agendamento novo.
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };

  // waitUntil segura o SW vivo ate a notificacao aparecer. Sem ele, o navegador
  // pode encerrar o worker antes e o push some.
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificacao: foca uma aba ja aberta do app em vez de abrir outra.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        // Mesma origem ja aberta: navega a aba existente e traz para frente.
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});

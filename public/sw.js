// Service worker: guarda as telas do sistema no aparelho para abrir sem internet.
// Estratégia "rede primeiro": online sempre pega a versão nova; offline usa a cópia guardada.
// Os dados (clientes, preços, pedidos) ficam no IndexedDB, não aqui.
const CACHE = 'pedidos-v3';
const ARQUIVOS = [
  '/', '/index.html', '/impressao.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/util.js', '/js/offline.js', '/js/vendedor.js', '/js/detalhe.js',
  '/js/operacao.js', '/js/expedicao.js', '/js/gestor.js', '/js/impressao.js',
  '/icones/icone.svg', '/icones/icone-192.png', '/icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
        || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())),
  );
});

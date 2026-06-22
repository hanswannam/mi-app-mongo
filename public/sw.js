const CACHE_NAME = "billetera-v4";
const APP_SHELL = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png"
];

// Rutas que cambian con cada deploy (HTML + lógica de la app). Estas SIEMPRE
// deben ir primero a la red: servirlas desde caché puede mezclar una versión
// vieja de index.html con una nueva de app.js (o viceversa) y romper la app
// de forma silenciosa entre una sesión y otra.
const RUTAS_DINAMICAS = ["/", "/app.js", "/admin", "/t", "/activar"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Las llamadas a la API siempre van a la red: son datos dinámicos del usuario.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML/JS de la app: red primero, caché solo como respaldo sin conexión.
  if (RUTAS_DINAMICAS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Resto de assets estáticos (iconos, manifest): caché primero, red de respaldo.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

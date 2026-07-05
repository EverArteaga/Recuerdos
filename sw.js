// sw.js — Service Worker: habilita instalación PWA + recibe push reales
const CACHE_NAME = "recuerdos-cache-v2";
const CORE_ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png"
];

// ── INSTALL: precachear lo básico para que abra rápido / offline ──
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

// ── ACTIVATE: limpiar caches viejos ──
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ── FETCH: network-first para el HTML (así siempre ves la versión más reciente
// sin depender de que cambie sw.js), cache-first para el resto de lo estático ──
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    // Solo interceptamos peticiones del mismo origen (no Supabase, no fonts CDN)
    if (url.origin !== location.origin) return;

    const isHTML = event.request.mode === "navigate" ||
        url.pathname.endsWith("/") ||
        url.pathname.endsWith("index.html");

    if (isHTML) {
        // Network-first: intenta traer la versión nueva; si no hay internet, usa la guardada
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
        );
        return;
    }

    // Cache-first para lo demás (íconos, manifest, etc.)
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return (
                cached ||
                fetch(event.request).catch(() => caches.match("./index.html"))
            );
        })
    );
});

// ── PUSH: llega una notificación real desde el servidor (Edge Function) ──
self.addEventListener("push", (event) => {
    let payload = { title: "💌 Nuestros Recuerdos", body: "Tienes algo nuevo", icon: "./icon-192.png" };
    try {
        if (event.data) payload = { ...payload, ...event.data.json() };
    } catch (e) {
        if (event.data) payload.body = event.data.text();
    }

    const options = {
        body: payload.body,
        icon: payload.icon || "./icon-192.png",
        badge: "./icon-192.png",
        vibrate: [100, 50, 100],
        data: { url: payload.url || "./" },
        tag: payload.tag || "recuerdos-notif"
    };

    event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ── CLICK en la notificación: abrir/enfocar la app ──
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || "./";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
            const existing = clientsArr.find((c) => c.url.includes(location.origin));
            if (existing) {
                existing.focus();
                return existing.navigate(targetUrl);
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});

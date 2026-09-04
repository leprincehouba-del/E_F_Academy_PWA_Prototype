const CACHE = "ef-academy-v35";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "supabase.js", "logo.png", "manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    (async () => {
      try {
        const response = await fetch(e.request);

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }

        return response;
      } catch {
        const cached = await caches.match(e.request);

        if (cached) {
          return cached;
        }

        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }

        return Response.error();
      }
    })()
  );
});
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      body: event.data ? event.data.text() : ""
    };
  }

  const title = data.title || "E. F Academy";

  const options = {
    body: data.body || "يوجد تحديث جديد",
    icon: "./logo.png",
    badge: "./logo.png",
    data: {
      url: data.url || "./"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./",
    self.registration.scope
  ).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if ("navigate" in client) {
          client.navigate(targetUrl);
        }

        if ("focus" in client) {
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});

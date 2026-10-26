const CACHE = "ef-academy-v55-visible-reader-upload";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "teacher-reader.js", "supabase.js", "logo.png", "manifest.webmanifest", "icons/brand-192.png", "icons/brand-512.png", "icons/brand-maskable-512.png"];
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
          const responseCopy = response.clone();
          e.waitUntil(
            caches
              .open(CACHE)
              .then(cache => cache.put(e.request, responseCopy))
              .catch(error => console.warn("Cache update failed:", error))
          );
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
// Persist displayed milestone IDs across worker restarts. Web Push itself is
// at-least-once; deterministic tags also replace an existing OS notification.
function milestoneReceiptDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ef-milestone-push", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("receipts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function displayParentPush(data) {
  const milestoneKey = typeof data.tag === "string" && data.tag.startsWith("milestone:") ? data.tag : null;
  let db, claimed = false;
  const receipt = async (mode) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("receipts", "readwrite");
      const store = tx.objectStore("receipts");
      const read = store.get(milestoneKey);
      read.onsuccess = () => {
        const value = read.result;
        if (mode === "claim") {
          if (value?.shown || (value?.claimedAt && Date.now() - value.claimedAt < 60000)) return;
          store.put({ claimedAt: Date.now() }, milestoneKey);
          claimed = true;
        } else if (mode === "shown") store.put({ shown: true }, milestoneKey);
        else store.delete(milestoneKey);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  try {
    if (milestoneKey) {
      try {
        db = await milestoneReceiptDb();
        await receipt("claim");
        if (!claimed) return;
      } catch (error) {
        db?.close();
        db = null;
        console.warn("Milestone display receipt unavailable; using notification tag", error);
      }
    }
    await self.registration.showNotification(data.title || "Mr Mohamed Mahmoud", {
      body: data.body || "يوجد تحديث جديد", icon: "./logo.png", badge: "./logo.png",
      ...(milestoneKey ? { tag: milestoneKey, renotify: false } : {}),
      data: { url: data.url || "./" }
    });
    if (db) await receipt("shown");
  } catch (error) {
    if (db && claimed) await receipt("release").catch(() => {});
    // Failed persistence/display must remain visible to browser diagnostics.
    console.warn("Parent push display deferred", error);
  } finally { db?.close(); }
}
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(displayParentPush(data));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const scope = new URL(self.registration.scope);
  let target = new URL(event.notification.data?.url || "./", scope);
  if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) target = scope;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin !== scope.origin || !current.pathname.startsWith(scope.pathname)) continue;
      if ("navigate" in client) await client.navigate(target.href);
      if ("focus" in client) return client.focus();
    }
    return clients.openWindow(target.href);
  })());
});

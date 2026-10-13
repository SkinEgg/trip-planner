/* Service Worker：讓 App 在沒有網路時也打得開。
   - App 本身的檔案：先上網拿最新版（3 秒內沒回應就用快取），所以更新後下次開啟就是新版。
   - 函式庫（Leaflet、Supabase）：用快取，版本號固定不會變。
   - 地圖圖磚：看過的區域會留在手機裡（最多約 1500 張），在日本沒網路時仍看得到看過的地圖。
   - Supabase 資料：一律走網路，不在這裡快取（離線時由 App 自己顯示上次的資料）。 */
const SHELL_CACHE = "tripapp-shell-v1";
const LIB_CACHE = "tripapp-lib-v1";
const TILE_CACHE = "tripapp-tiles-v1";
const TILE_LIMIT = 1500;
const PHOTO_CACHE = "tripapp-photos-v1";   // Commons 圖片（授權允許保存），看過就能離線看

const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/app.css", "js/config.js", "js/logic.js", "js/store.js", "js/app.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
// 只有本機模式才有；上線版（雲端模式）不上傳這個檔，所以抓不到也沒關係
const OPTIONAL = ["data/seed.js", "data/photos.js"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    await Promise.all(OPTIONAL.map(u => shell.add(u).catch(() => {})));
    const lib = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(u => lib.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, LIB_CACHE, TILE_CACHE, PHOTO_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  if (url.hostname.endsWith("tile.openstreetmap.org")) { e.respondWith(tile(req)); return; }
  if (url.hostname === "upload.wikimedia.org" || url.hostname === "thumb.wikimedia.org") { e.respondWith(cacheFirst(req, PHOTO_CACHE)); return; }
  if (url.hostname === "cdnjs.cloudflare.com" || url.hostname === "cdn.jsdelivr.net") { e.respondWith(cacheFirst(req, LIB_CACHE)); return; }
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // <img> 跨網域讀取是 opaque 回應（看不到狀態碼），也一併存起來
  if (res.ok || res.type === "opaque") (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  }
}

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > TILE_LIMIT) for (const k of keys.slice(0, keys.length - TILE_LIMIT)) await cache.delete(k);
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

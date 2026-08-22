const CACHE_NAME = "kana-shell-v1";
const CORE_PATHS = ["/", "/manifest.webmanifest", "/icon.svg"];

function sameOriginShellAsset(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return null;
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/icon.svg"
    ) {
      return url.pathname + url.search;
    }
  } catch {
    // Malformed attributes are ignored; the root response remains cached.
  }
  return null;
}

async function cacheCurrentShell() {
  const cache = await caches.open(CACHE_NAME);
  const root = await fetch("/", { cache: "reload" });
  if (!root.ok) throw new Error("Kana app shell could not be cached.");
  await cache.put("/", root.clone());
  const html = await root.text();
  const assets = new Set(CORE_PATHS.slice(1));
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const asset = sameOriginShellAsset(match[1]);
    if (asset) assets.add(asset);
  }
  await Promise.allSettled(
    [...assets].map(async (asset) => {
      const response = await fetch(asset, { cache: "reload" });
      if (response.ok) await cache.put(asset, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheCurrentShell().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("kana-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/", response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/");
          return cached ?? Response.error();
        }),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    CORE_PATHS.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});

// MōdRiff service worker.
//
// A single self-contained HTML file plus a fixed, immutable sample set is
// close to an ideal cache target, and a groovebox is exactly the thing you
// want on a home screen and working on a plane. It is also half the fix for
// sampled instruments substituting a synth while they download: cached, they
// are ready before the first note.
//
// Two strategies, because the two halves age differently. The app shell is
// network-first so a deploy reaches people on their next online launch
// without a hard refresh; samples and icons are cache-first and never
// revalidated, because samples/<kit>/<note>.mp3 is immutable — if a sample
// ever changes it changes name.

const VERSION   = 'modriff-2.0.0';   // bump on release: it invalidates the old caches
const SHELL     = VERSION + '-shell';
const ASSETS    = VERSION + '-assets';
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest',
                    './icon-192.png', './icon-512.png', './og-card.png'];

self.addEventListener('install', e => {
  // The shell only. Samples are large and many; they populate on first use so
  // a first visit is not held up downloading 3.4 MB it may never play.
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isImmutable = url => /\/samples\/|\/icon-|\/og-card\.png$/.test(url);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch anything off-origin: the analytics beacons and the Google
  // Fonts stylesheet are not ours to cache or to fail.
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      })
      // Offline: the cached shell, and for a navigation the app itself rather
      // than the browser's dinosaur.
      .catch(() => caches.match(req).then(hit =>
        hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

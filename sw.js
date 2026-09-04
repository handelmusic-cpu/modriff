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

// NOT a release label — that is MODRIFF_VERSION in index.html. This is a cache
// key, and bumping it is usually the wrong move. The shell is network-first, so
// a new index.html reaches everyone on their next online launch without it.
// What a bump actually does is make activate() below delete every cache that
// does not match, which evicts the ~3.4 MB of samples in ASSETS — files that
// never change, since a sample that changes changes name. Bump this only when
// an immutable asset really has changed (a sample, an icon, the OG card),
// because those are the only ones the network-first path cannot refresh.
// v2.1.0 changed none, so this stays where 2.0.1 left it.
const VERSION   = 'modriff-2.0.1';
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

  // Network-first, but not network-at-any-cost. The shell is a 1.4 MB HTML
  // file, and waiting for all of it before painting anything is the difference
  // between an app that opens and an app that hangs — on a phone, on a bad
  // connection, which is exactly where someone opens a groovebox. A plain
  // network-first only reaches the cache when the request FAILS, so a slow
  // network is worse than no network at all: an outright failure falls back in
  // milliseconds, a crawling one keeps the screen blank for as long as it
  // crawls.
  //
  // So the network still wins whenever it can answer promptly — a deploy
  // reaches people on their next online launch, which is the whole point of
  // network-first here and is unchanged. It just stops being allowed to hold
  // the app hostage: past the deadline the cached copy is served, and the
  // response still in flight is banked for next time.
  const NET_DEADLINE = 1500;
  const fromNet = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  });
  // Offline: the cached shell, and for a navigation the app itself rather than
  // the browser's dinosaur.
  const cached = () => caches.match(req).then(hit =>
    hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  const netThenCache = () => fromNet.catch(() => cached().then(hit => hit || Response.error()));

  // Only a navigation is worth racing. It is the request a person is actually
  // waiting on, and the only one where a slightly stale answer beats a late
  // one; everything else keeps plain network-first. A cache miss falls back to
  // whatever the network eventually says, so racing can never make a first
  // visit worse.
  e.respondWith(
    req.mode !== 'navigate' ? netThenCache() : Promise.race([
      netThenCache(),
      new Promise(resolve => setTimeout(resolve, NET_DEADLINE))
        .then(() => cached())
        .then(hit => hit || netThenCache())
    ])
  );
});

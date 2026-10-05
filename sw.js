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

// samples/user/manifest.json is the one thing under /samples/ that is NOT
// immutable: it is the list a developer edits when they deploy a new sample,
// so caching it forever would mean the sample ships and nobody's app ever
// learns it exists. The files it names still are immutable and still cache.
const isImmutable = url =>
  /\/samples\/|\/fonts\/|\/icon-|\/og-card\.png$/.test(url) && !/\/samples\/user\/manifest\.json$/.test(url);

// What version did the copy we just banked turn out to be? The page knows what
// IT is running, so it can decide whether the difference matters. Read it out of
// the cache rather than trusting ETag or Last-Modified: not every host sends
// them, and neither says anything about what actually changed.
async function announceShell(cache) {
  try {
    const r = await cache.match('./index.html');
    if (!r) return;
    const m = (await r.text()).match(/MODRIFF_VERSION\s*=\s*'([^']+)'/);
    if (!m) return;
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach(c => c.postMessage({ type: 'modriff-shell', version: m[1] }));
  } catch (err) {}
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch anything off-origin. There is nothing off-origin any more —
  // the analytics and the Google Fonts stylesheet are both gone — but a
  // request this worker did not make is still not its to cache or to fail.
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

  // ── Navigations: the cached shell first, the network behind it ──────────
  //
  // This used to race the network against a 1500ms deadline and serve the
  // cache if the network lost. That was meant to stop a slow connection
  // holding the app hostage, and it did — but it also meant that on a slow
  // connection you ALWAYS lost the race, so you always got the cached copy and
  // the fresh one was merely banked for next time. On a connection reliably
  // slower than the deadline that is not "one launch behind, once": it is one
  // launch behind forever, silently, because the next launch loses the race
  // too and serves the copy banked the time before.
  //
  // Measured: the shell is 2.1 MB, about 665 KB gzipped, which on a mediocre
  // LTE cell is comfortably past 1500ms — and it grows with every release, so
  // the deadline was going to be lost by more people over time, not fewer. It
  // surfaced as a bug report about a control that had moved three releases
  // earlier, with the giveaway sitting in the screenshot: a tab bar whose
  // icons had been removed in the version the reporter could not see.
  //
  // So: serve the cache at once when it is warm, which is what the deadline
  // was protecting; always revalidate behind it; and when the copy that lands
  // is a different build, SAY SO. A stale app you are told about is a
  // different thing from a stale app you are not.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match('./index.html');
      const bank = fetch(req).then(async res => {
        if (res.ok) {
          await cache.put('./index.html', res.clone());
          // Only worth announcing when something was already being served from
          // the cache — on a first visit the fresh copy IS what is running.
          if (hit) await announceShell(cache);
        }
        return res;
      });
      e.waitUntil(bank.catch(() => {}));
      if (hit) return hit;
      return bank.catch(() => cache.match('./index.html').then(h => h || Response.error()));
    })());
    return;
  }

  // Everything else of ours stays network-first with a cache fallback.
  const fromNet = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  });
  // Offline: the cached shell, and for a navigation the app itself rather than
  // the browser's dinosaur.
  const cached = () => caches.match(req).then(hit =>
    hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  e.respondWith(fromNet.catch(() => cached().then(hit => hit || Response.error())));
});

# The free web page (modriff.com/play)

The same `index.html` as the app, built for the browser with **no packs and no
recordings**. Its job is a try-it page: anyone can open it, school tablets and
Chromebooks included, and every locked thing points at the App Store.

## What it is

`npm run build:web` (`node build/build.mjs --web`) writes `dist-web/`:

| path | what |
|---|---|
| `dist-web/play/` | the app. Relative paths throughout, so it works under any prefix. |
| `dist-web/index.html` | a redirect to `/play/`, for the bare deployment URL |

Differences from the app build (`npm run build` -> `dist/`, which Capacitor still
packages and which is untouched):

- `window.__modFreeWeb = true` is the first script in `<head>` (plus `html.web-free`).
  The web billing provider then holds nothing and ignores the dev override, so no
  stored `modo-dev-tier` key, console call or purchase call unlocks anything.
- `samples/` is not shipped (3 MB site instead of 19). The free tier already plays
  synthesized voices and the Linn/808 kits are synthesized. The one free thing that
  was recorded was the Sampler's pad banks, so on the web the Sampler widget is a
  lock tile (`lvAllowed`), its sub-nav button is hidden, and `_psFactoryBuild` /
  `_psFetch` never run.
- The manifest `id` is `/play/` (the landing page owns `/`); the share-card tags
  point at `/play/og-card-3.png`.
- A locked thing opens the same sheet, but `webView()` replaces the buy buttons:
  the pack's bullets, "The app is free to download", and one link. No price, no
  Restore.

A local checkout served as-is (the tests, `python3 -m http.server`) is not flagged
and still holds everything.

## Wiring it into modriff.com

The landing page is its own repo. This repo's Vercel project now builds
`dist-web`; the landing project proxies `/play` to it. In the landing repo's
`vercel.json`:

```json
{
  "redirects": [{ "source": "/play", "destination": "/play/" }],
  "rewrites": [{ "source": "/play/:path*", "destination": "https://<this-project>.vercel.app/play/:path*" }]
}
```

- The redirect matters: without the trailing slash the relative asset paths
  resolve against `/` and the page loads blank.
- The Vercel project here must have **Deployment Protection off for Production**
  (it was password protected), or the rewrite returns Vercel's login page.
- Do not put the free page on `play.modriff.com`: school filters are likelier to
  block an unknown subdomain than a path on a domain they already allow.

## Open items

- `WEB_STORE.appleId` (in `index.html`, next to `modProducts`) is empty until the
  app has an Apple ID (App Store Connect > App Information). Until then the sheet
  links to `https://modriff.com`. Once set, iPhone, iPad and Mac go straight to
  `apps.apple.com/app/id<ID>`; one app record serves all three. Chromebooks and
  Windows always get the landing page.
- Not heard on a school Chromebook yet: the engine is tuned on iPhone-class chips.
- An Android app is a separate project (the C++ engine sits behind Apple's audio
  stack). Chromebooks run this page, installable from the address bar.

## Test

```
npm run build:web && npm run build
(cd dist-web && python3 -m http.server 8778 --bind 127.0.0.1 &)
node tests/webplay/probe.js
```

Asserts the build contents, that nothing unlocks it, zero requests to `samples/`
across Start, 21 Random rolls, every tab and playback, that the speakers still get
signal, and the sheet and lock tile.

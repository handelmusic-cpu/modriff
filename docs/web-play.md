# The free web page (modriff.com/play)

The same `index.html` as the app, built for the browser with **no packs and no
recordings**. Its job is a try-it page: anyone can open it, school tablets and
Chromebooks included, and every locked thing points at the App Store.

The custom domain is **not** deployed from this repo. Vercel previews build the
same free `/play/` page (`dist-web`), rather than exposing the full app bundle. modriff.com
is the `modriff-site` repo (plain static pages on GitHub Pages); the built page lives
there as `play/` and is published by committing it.

## Publish

One-time on the Mac: install Node, clone `modriff` and `modriff-site` side by side,
`npm ci` inside `modriff`. Then, from a Terminal inside the `modriff` folder:

```
npm run publish:web -- ../modriff-site
cd ../modriff-site && git status    # review, then commit and push to main
```

`publish:web` runs `npm run build:web` (writes `dist-web/play/`) and replaces
`modriff-site/play/` with it. Republish whenever the app's `index.html` changes in a
way the web page should have.

## What it is

Differences from the app build (`npm run build` -> `dist/`, which Capacitor still
packages and which is untouched):

- `window.__modFreeWeb = true` is the first script in `<head>` (plus `html.web-free`).
  The web billing provider then holds nothing and ignores the dev override, so no
  stored `modo-dev-tier` key, console call or purchase call unlocks anything.
- `samples/` is not shipped (3 MB instead of 19). The free tier already plays
  synthesized voices and the Digital 1 and Analog 1 kits are synthesized. The one free thing that
  was recorded was the Sampler's pad banks, so on the web the Sampler widget is a
  lock tile (`lvAllowed`), its sub-nav button is hidden, and `_psFactoryBuild` /
  `_psFetch` never run.
- Neither the source nor either build includes Vercel analytics tags. The app uses
  only Apple's built-in App Store Connect reports; the web page has no analytics.
- The manifest `id` is `/play/` (the landing page owns `/`); the share-card tags
  point at `/play/og-card-3.png`.
- Chords from outside the key are the Theory Pack's (`outsideChords`): the Modal and Secondary Dominant
  pads (Studio, and Live's More row), their catalog rows, and the song builder's Borrowed grid are
  locked; the key's own seven are free. `tests/webplay/outside.js` checks it.
- A locked thing opens the same sheet, but `webView()` replaces the buy buttons:
  the pack's bullets, "The app is free to download", and one link. No price, no
  Restore.

A local checkout served as-is (the tests, `python3 -m http.server`) is not flagged
and still holds everything. Keep `play/` on `/play/` of the site: school filters are
likelier to block an unknown subdomain than a path on a domain they already allow.

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

## Desktop layout

Mouse/trackpad browsers share the Mac app’s centered dialogs and two independently
scrolling Live work areas at 1000px and wider. Narrow windows return to a single
column. Touch devices keep their existing layout; desktop styling does not enable
native host features or unlock packs. Publish from current `origin/main` so the
web page includes the latest navigation, saving and export fixes.

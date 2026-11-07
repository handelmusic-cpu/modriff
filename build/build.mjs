// Deploy build: copies the app into dist/ with the comments taken out.
//
// The source keeps its comments — CLAUDE.md asks for the "why" at length, and
// that is what stops the next person undoing a fix. But they are about half of
// index.html (2.5 MB → 1.5 MB, 811 KB → 404 KB gzipped), and every visitor was
// downloading them. So they live in the repo and stop at the deploy.
//
// What changes in the output, and nothing else:
//   - inline <script> and <style>: esbuild with minifyWhitespace only. No
//     renaming — 436 onclick="…" attributes call globals by name, and
//     _psWsola.toString() rebuilds a worker from its own source.
//   - HTML comments outside them.
// Every other file is copied byte for byte. dist/ is also what a native
// wrapper (Capacitor) packages, so this is the one place both builds come from.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// `--web` builds the free page for modriff.com/play instead of the app bundle:
//   dist-web/play/   the app, free tier only, no recorded samples
//   dist-web/        a redirect to /play/, for the bare deployment URL
// Everything else about the build is the same, so the two cannot drift. The
// default build (dist/) is still what Capacitor packages and is untouched.
const WEB  = process.argv.includes('--web');
const ROOT_OUT = path.join(ROOT, WEB ? 'dist-web' : 'dist');
const OUT  = WEB ? path.join(ROOT_OUT, 'play') : ROOT_OUT;
// Repo furniture, never served.
// .claude is where Claude Code keeps launch.json and its session worktrees (each
// a full checkout with its own node_modules). It was being copied into dist/,
// and from there into the app: 300 MB, and iOS refused to install it because
// node_modules/.bin holds absolute symlinks ("absolute symlinks are
// forbidden"). .DS_Store is Finder's, and the same kind of stray.
const SKIP = new Set(['.git', '.github', '.vercel', '.claude', '.DS_Store', 'build', 'dist', 'dist-web', 'node_modules',
  'package.json', 'package-lock.json', 'vercel.json', 'check.sh', 'CLAUDE.md', '.gitignore',
  'tests', 'docs', 'ios', 'capacitor.config.json',
  // The C++ engine is compiled into the native app, not served to the web one.
  'native']);
// The free web page plays synthesized voices only (the free tier already does:
// FREE_LIMITS.samples is false), so the recordings are not shipped at all. That
// is 16 MB off the site, and it means a recorded sound cannot reach a visitor
// by some path the tier table missed: the file is not there to fetch.
if (WEB) SKIP.add('samples');

// macOS drops a .DS_Store into dist/ while it is being emptied, and rm then fails
// with ENOTEMPTY about one run in four. Retrying lets it finish.
fs.rmSync(ROOT_OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(OUT, { recursive: true });
for (const name of fs.readdirSync(ROOT)) {
  if (SKIP.has(name) || name === 'index.html') continue;
  fs.cpSync(path.join(ROOT, name), path.join(OUT, name), { recursive: true });
}

let src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (WEB) {
  // First thing in <head>, before any script that asks what is owned: the web
  // billing provider reads this flag to hold nothing (see window.modBilling).
  if (!/<head>/.test(src)) throw new Error('index.html has no <head> to flag as the free web build');
  src = src.replace('<head>', '<head>\n<script>window.__modFreeWeb=true;document.documentElement.classList.add("web-free");</script>');
  // og:image is root-relative so it follows the app to any domain, but here the
  // app lives under /play/ and the card is beside it, not at the site root.
  const og = src.split('content="/og-card-3.png"').length - 1;
  if (og !== 2) throw new Error(`expected 2 root-relative og-card-3.png tags, found ${og}`);
  src = src.split('content="/og-card-3.png"').join('content="/play/og-card-3.png"');
}
// One left-to-right pass, so a "<script>" written inside an HTML comment, or
// "<!--" written inside a script's string, is never mistaken for the other.
const re = /<!--[\s\S]*?-->|<(script|style)([^>]*)>([\s\S]*?)<\/\1>/g;
let out = '', last = 0, m;
const checks = [];
while ((m = re.exec(src))) {
  out += src.slice(last, m.index); last = re.lastIndex;
  const [whole, tag, attrs, body] = m;
  if (!tag) continue;                                   // an HTML comment: dropped
  const isJS = tag === 'script' && !/\bsrc=/.test(attrs) && !/type="(?!text\/javascript)/.test(attrs);
  if (tag === 'script' && !isJS) { out += whole; continue; }
  const r = await esbuild.transform(body, {
    loader: isJS ? 'js' : 'css', minifyWhitespace: true, legalComments: 'none', charset: 'utf8',
  });
  const code = r.code.trim();
  if (isJS) checks.push(code);
  out += `<${tag}${attrs}>${code}</${tag}>`;
}
out += src.slice(last);
// esbuild prints strings with double quotes; sw.js finds the version with
// /MODRIFF_VERSION\s*=\s*'([^']+)'/ to tell people an update is ready, and a
// service worker already installed on someone's phone keeps that pattern until
// it updates itself. So the one line it reads goes back to single quotes.
out = out.replace(/(MODRIFF_VERSION\s*=\s*)"([^"']+)"/, "$1'$2'");
fs.writeFileSync(path.join(OUT, 'index.html'), out);
if (WEB) {
  // The install identity is the URL path: left as "/" it would claim the whole
  // of modriff.com, which is the landing page's, not this app's.
  const mf = path.join(OUT, 'manifest.webmanifest');
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  man.id = '/play/';
  fs.writeFileSync(mf, JSON.stringify(man, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT_OUT, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>mõdRïff</title>' +
    '<meta http-equiv="refresh" content="0;url=/play/"><link rel="canonical" href="/play/">' +
    '<a href="/play/">Open mõdRïff</a>\n');
}

// Same guarantee check.sh gives the source: every script still parses. A
// broken build fails here rather than as a blank page on everyone's phone.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modriff-build-'));
checks.forEach((code, i) => {
  const f = path.join(tmp, `chunk${i}.js`); fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
});
// The version has to survive the build: the service worker reads it out of
// index.html to tell people an update is ready.
const ver = /MODRIFF_VERSION\s*=\s*'([^']+)'/.exec(out);
if (!ver) throw new Error('MODRIFF_VERSION missing from the built index.html');
// The release label is dotted numbers with at most one lowercase letter on the
// end (4.9.9.9.9.7.4, then 4.9.9.9.9.7.4a for a follow-up). Nothing compares
// versions with < or >: the service worker and the update toast only test them
// for equality, so a letter costs nothing, but a stray "v" or a space would
// ship as the label on every phone. The two labels people read have to say the
// same thing as the constant, which is also checked here.
if (!/^\d+(\.\d+)*[a-z]?$/.test(ver[1])) throw new Error(`MODRIFF_VERSION "${ver[1]}" is not dotted numbers plus an optional lowercase letter`);
for (const id of ['ft-ver', 'unlock-ver']) {
  const m = new RegExp(`id="${id}"[^>]*>v([^<]*)<`).exec(out);
  if (!m || m[1] !== ver[1]) throw new Error(`#${id} says "${m ? m[1] : 'nothing'}" but MODRIFF_VERSION is "${ver[1]}"`);
}

const kb = n => Math.round(n / 1024) + ' KB';
console.log(`index.html ${kb(src.length)} → ${kb(out.length)} · v${ver[1]} · ${checks.length} scripts checked`);

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
const OUT  = path.join(ROOT, 'dist');
// Repo furniture, never served.
// .claude is where Claude Code keeps launch.json and its session worktrees (each
// a full checkout with its own node_modules). It was being copied into dist/,
// and from there into the app: 300 MB, and iOS refused to install it because
// node_modules/.bin holds absolute symlinks ("absolute symlinks are
// forbidden"). .DS_Store is Finder's, and the same kind of stray.
const SKIP = new Set(['.git', '.github', '.vercel', '.claude', '.DS_Store', 'build', 'dist', 'node_modules',
  'package.json', 'package-lock.json', 'vercel.json', 'check.sh', 'CLAUDE.md', '.gitignore',
  'tests', 'docs', 'ios', 'capacitor.config.json',
  // The C++ engine is compiled into the native app, not served to the web one.
  'native']);

// macOS drops a .DS_Store into dist/ while it is being emptied, and rm then fails
// with ENOTEMPTY about one run in four. Retrying lets it finish.
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(OUT);
for (const name of fs.readdirSync(ROOT)) {
  if (SKIP.has(name) || name === 'index.html') continue;
  fs.cpSync(path.join(ROOT, name), path.join(OUT, name), { recursive: true });
}

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

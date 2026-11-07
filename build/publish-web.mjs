// Builds the free web page and puts it in the modriff.com site repo as play/.
//
//   npm run publish:web -- ../modriff-site
//
// The site repo is plain static pages on GitHub Pages; nothing here talks to a host.
// This only replaces <site>/play with a fresh build, so a file removed from the app
// is removed from the site too. Review `git status` there, then commit and push.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = process.argv[2] && path.resolve(process.argv[2]);
if (!site || !fs.existsSync(path.join(site, 'CNAME')) || !fs.existsSync(path.join(site, 'index.html'))) {
  console.error('usage: npm run publish:web -- <path to the modriff-site checkout>');
  process.exit(1);
}
execFileSync(process.execPath, [path.join(ROOT, 'build/build.mjs'), '--web'], { stdio: 'inherit' });
fs.rmSync(path.join(site, 'play'), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'dist-web/play'), path.join(site, 'play'), { recursive: true });
console.log('play/ replaced in ' + site);

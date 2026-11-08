// What a build was made from, so "is the phone running main?" has an answer.
//
// A build writes dist/build-info.json: the commit it was made at, whether the
// working tree had uncommitted changes, and a hash of the built page. `npm run ios`
// copies it into ios/App/App/public with the rest, About shows the short commit
// beside the version, and build/ios-check.mjs compares it with the checkout and
// with origin/main. The version label only moves once per batch; the commit
// changes with every merge, so it catches the small changes the label does not.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

export function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

export const pageHash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);

export function gitState(root) {
  return {
    commit: git(root, 'rev-parse', '--short=9', 'HEAD'),
    branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    // Tracked changes only: an untracked scratch file is not in the build's source of truth.
    dirty: git(root, 'status', '--porcelain', '--untracked-files=no') !== '',
  };
}

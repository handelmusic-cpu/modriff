// Is what Xcode will build (or has built) the same as main?
//
//   npm run ios:check          full report; exit 1 on any mismatch
//   node build/ios-check.mjs --pre   only the git part, run before a build
//
// Three things can be behind, and each hides the one before it:
//   1. this checkout, behind origin/main (a merge from another session or machine);
//   2. ios/App/App/public, the page Xcode packages, which is generated and only
//      as new as the last `npm run ios` (it is gitignored, so git cannot tell you);
//   3. the app on the phone, which is whatever Xcode last installed. About shows
//      the commit stamped into it; compare that with the first line printed here.
// Building a feature branch on purpose is allowed: MODRIFF_IOS_ANY=1 turns the
// "not main / behind main" failures into warnings.
import fs from 'node:fs';
import path from 'node:path';
import { git, gitState, pageHash } from './stamp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PRE = process.argv.includes('--pre');
const ANY = !!process.env.MODRIFF_IOS_ANY;
const problems = [], warnings = [];
// Things that mean "not main": a failure unless a feature build was asked for.
const offMain = msg => (ANY ? warnings : problems).push(msg);

git(ROOT, 'fetch', '--quiet', 'origin', 'main');
const here = gitState(ROOT);
const main = git(ROOT, 'rev-parse', '--short=9', 'origin/main');
const behind = Number(git(ROOT, 'rev-list', '--count', 'HEAD..origin/main')) || 0;
const ahead = Number(git(ROOT, 'rev-list', '--count', 'origin/main..HEAD')) || 0;

console.log(`origin/main  ${main || '(unknown: offline?)'}`);
console.log(`checkout     ${here.commit}  ${here.branch}${here.dirty ? '  + uncommitted changes' : ''}`);
if (!main) warnings.push('could not reach origin, so "behind main" is unchecked');
if (here.branch !== 'main') offMain(`checkout is on ${here.branch}, not main`);
if (behind) offMain(`checkout is ${behind} commit${behind > 1 ? 's' : ''} behind origin/main: git pull first`);
if (ahead && here.branch === 'main') warnings.push(`main is ${ahead} commit${ahead > 1 ? 's' : ''} ahead of origin/main (not pushed)`);
if (here.dirty) warnings.push('uncommitted changes: the build will include them');

if (!PRE) {
  const pub = path.join(ROOT, 'ios/App/App/public');
  const infoFile = path.join(pub, 'build-info.json');
  if (!fs.existsSync(infoFile)) {
    problems.push('ios/App/App/public has no build-info.json: run npm run ios (or ios:device) to build and sync');
  } else {
    const b = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    console.log(`Xcode bundle ${b.commit}  ${b.branch}${b.dirty ? '  + uncommitted changes' : ''}  v${b.version}  built ${b.builtAt}`);
    if (b.commit !== here.commit) problems.push(`the bundle was built at ${b.commit}, the checkout is at ${here.commit}: run npm run ios`);
    if (b.dirty) warnings.push('the bundle was built from uncommitted changes');
    // The recorded hash against the file actually sitting there: catches a sync that
    // stopped half way, or a hand edit of the generated copy.
    const actual = pageHash(path.join(pub, 'index.html'));
    if (actual !== b.page) problems.push(`ios/App/App/public/index.html (${actual}) is not the page the build recorded (${b.page}): run npm run ios`);
  }
}

warnings.forEach(w => console.log('warn  ' + w));
problems.forEach(p => console.log('FAIL  ' + p));
if (problems.length) {
  if (!ANY) console.log('(to build a feature branch on purpose: MODRIFF_IOS_ANY=1 npm run ios)');
  process.exit(1);
}
console.log(PRE ? 'ok    checkout is main and current' : 'ok    the Xcode bundle is this checkout');

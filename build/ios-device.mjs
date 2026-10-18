// Build the iOS app, install it on the attached iPhone and launch it.
//
// `npm run ios:device` after a `git pull` is the whole round trip from a
// change made anywhere — a cloud session editing index.html, or an edit here
// — to that change running on the phone. npm run build and cap sync have
// already happened by the time this runs (see package.json); this is the
// part that needs Xcode and a cable.
//
// It deliberately does not open Xcode. Opening Xcode to press Run is the
// slow path, and the thing that makes a web change feel native-adjacent is
// that this takes one command and no clicks.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PROJECT = 'ios/App/App.xcodeproj';
const SCHEME = 'App';
const BUNDLE = 'com.handelmusic.modriff';
// Kept out of the repo's build directory so a stray clean cannot take the
// whole DerivedData tree with it, and so two configurations share one cache.
const DD = process.env.MODRIFF_DD || '/tmp/modriff-dd';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// Which iPhone is plugged in? devicectl lists simulators too; a real one is
// the row that says `physical` and `connected`.
let udid = process.env.MODRIFF_DEVICE || '';
if (!udid) {
  let out = '';
  try { out = sh('xcrun', ['devicectl', 'list', 'devices']); } catch { out = ''; }
  const row = out.split('\n').find(l => /\bphysical\b/.test(l) && /\bconnected\b/.test(l));
  const m = row && row.match(/([0-9A-F]{8}-[0-9A-F]{16})/i);
  udid = m ? m[1] : '';
  if (!udid) {
    const any = out.split('\n').find(l => /\bphysical\b/.test(l));
    console.error(any
      ? 'iPhone found but not connected — unlock it and check the cable carries data:\n  ' + any.trim()
      : 'No iPhone found. Plug one in (a data cable), unlock it, and trust this Mac.');
    process.exit(1);
  }
}

console.log('device ' + udid);
console.log('building…');
try {
  execSync([
    'xcodebuild', '-project', PROJECT, '-scheme', SCHEME, '-configuration',
    process.env.MODRIFF_CONFIG || 'Debug',
    '-destination', `'id=${udid}'`, '-derivedDataPath', DD,
    '-allowProvisioningUpdates', 'build',
  ].join(' '), { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  // xcodebuild buries the one useful line in a few hundred; show those.
  const log = ((e.stdout || '') + (e.stderr || '')).toString();
  const errs = log.split('\n').filter(l => /error:/.test(l)).slice(0, 10);
  console.error(errs.length ? errs.join('\n') : log.split('\n').slice(-25).join('\n'));
  process.exit(1);
}

const app = `${DD}/Build/Products/${process.env.MODRIFF_CONFIG || 'Debug'}-iphoneos/App.app`;
if (!existsSync(app)) { console.error('built, but no App.app at ' + app); process.exit(1); }

// devicectl reports a locked phone, a revoked trust and a full disk as the
// same kind of failure: a page of nested JSON with the one English sentence
// in the middle. Node then prints its own stack on top of that, which says
// nothing at all. Find the sentence.
function devicectl(what, args) {
  try {
    return sh('xcrun', ['devicectl', ...args]);
  } catch (e) {
    const log = ((e.stdout || '') + (e.stderr || '')).toString();
    const reason = (log.match(/NSLocalizedFailureReason = ([^\n\\]+)/) ||
                    log.match(/The operation couldn.t be completed\. ([^\n\\]+)/) || [])[1];
    console.error(`could not ${what}: ${(reason || '').trim() || 'see below'}`);
    if (/unlock/i.test(log)) console.error('  → unlock the iPhone and run this again.');
    else if (/trust/i.test(log)) console.error('  → tap Trust on the iPhone and run this again.');
    else if (!reason) console.error(log.split('\n').slice(0, 12).join('\n'));
    process.exit(1);
  }
}

console.log('installing…');
devicectl('install', ['device', 'install', 'app', '--device', udid, app]);
console.log('launching…');
devicectl('launch', ['device', 'process', 'launch', '--terminate-existing', '--device', udid, BUNDLE]);
console.log('running on the phone.');

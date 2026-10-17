/* Builds dist/_miditest.html: the shipping app with a stand-in for the
   ModMidi native plugin injected ahead of its own script.

     npm run build && node tests/midi/make-fixture.mjs
     python3 -m http.server 8777 --bind 127.0.0.1 --directory dist
     # then drive http://127.0.0.1:8777/_miditest.html from a browser probe

   Why this exists: the Swift half (ios/App/App/ModMidi/ModMidi.swift) needs a
   Mac and a device to run, but the web half — the navigator.requestMIDIAccess
   shim in the platform layer, and everything downstream of it — is ordinary
   JavaScript and can be driven here. The shim is the part with the subtle
   behaviour (port identity across a hot-plug, scheduled sends, the Map-like
   port collections), so it is worth being able to test without a build.

   Two traps are baked in, both of which cost real time the first time:

   1. THE PAGE RUNS IN CHROMIUM, WHICH HAS WEB MIDI. The shim deliberately
      declines to install over a real implementation, so the code under test
      is unreachable until navigator.requestMIDIAccess is removed. The
      fixture deletes it, which is what WebKit looks like.

   2. THE SERVICE WORKER SERVES index.html FOR EVERY NAVIGATION. Left alone it
      quietly replaces this fixture with the real page, and the test then
      passes against code that was never loaded — the worst kind of green.
      The fixture stops sw registration, and a probe should still clear any
      existing registration and caches before navigating.

   The stand-in answers exactly the contract ModMidi.swift implements: start,
   list, send, openBluetooth, and the midimessage/statechange listeners. Keep
   the two in step — if the Swift side's payload changes, change it here, or
   this tests a plugin that no longer exists. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8');

// The app's own script is the big one. Anchor on the platform layer's shim
// rather than a byte offset, so this keeps working as the file grows.
const anchor = src.indexOf('modMidiBluetooth');
if (anchor < 0) throw new Error('the MIDI shim is not in dist/index.html — run npm run build first');
const starts = [...src.matchAll(/<script>/g)].map(m => m.index);
const target = Math.max(...starts.filter(i => i < anchor));

const STAND_IN = `<script>
window.__diag = {};
(function(){
 // (2) above — no service worker on the test page.
 try{ if(navigator.serviceWorker) navigator.serviceWorker.register = function(){ return Promise.reject(new Error('disabled for test')); }; }catch(e){}
 // (1) above — look like WebKit.
 window.__diag.atStart = typeof navigator.requestMIDIAccess;
 try{ window.__diag.del = delete Navigator.prototype.requestMIDIAccess; }catch(e){ window.__diag.delErr = String(e); }
 window.__diag.afterDel = typeof navigator.requestMIDIAccess;

 var L = {};
 var INPUTS = [
  {id:'101', name:'Launchkey Mini MK3 MIDI Port', manufacturer:'Focusrite A.E. Ltd', state:'connected', connection:'open'},
  {id:'102', name:'IAC Driver Bus 1', manufacturer:'Apple Inc.', state:'connected', connection:'open'}
 ];
 var OUTPUTS = [{id:'201', name:'IAC Driver Bus 1', manufacturer:'Apple Inc.', state:'connected', connection:'open'}];
 window.__sent = [];          // every send() the shim made, in order
 window.__btOpened = 0;       // how many times the pairing sheet was asked for

 window.Capacitor = { Plugins: { ModMidi: {
  start: function(){ return Promise.resolve({ok:true, inputs:INPUTS, outputs:OUTPUTS}); },
  list:  function(){ return Promise.resolve({ok:true, inputs:INPUTS, outputs:OUTPUTS}); },
  send:  function(o){ window.__sent.push(o); return Promise.resolve({ok:true}); },
  openBluetooth: function(){ window.__btOpened++; return Promise.resolve({ok:true}); },
  addListener: function(ev, fn){ (L[ev]=L[ev]||[]).push(fn); return {remove:function(){}}; }
 }}};

 // What a probe drives the fake device with.
 //   __emit('midimessage', {portId:'101', data:[0x90,60,100]})
 //   __emit('statechange', {inputs:[...], outputs:[...]})
 window.__emit = function(ev, data){ (L[ev]||[]).forEach(function(f){ f(data); }); };
 window.__setPorts = function(ins, outs){ INPUTS = ins; if(outs) OUTPUTS = outs; };
 window.__diag.atEnd = typeof navigator.requestMIDIAccess;
})();
</script>
`;

writeFileSync(join(root, 'dist', '_miditest.html'), src.slice(0, target) + STAND_IN + src.slice(target));
console.log('dist/_miditest.html written — stand-in injected before the app script');

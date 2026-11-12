/* Background permission follows one completed native transport claim, as one function that runs inside the real page.
   probe.js loads it into Chromium; it can also be pasted into any console on the served page. Resolves a list of
   [ok, what, detail]. It leaves the page as it found it (the switch key removed, the fake bridge taken away). */
window.__bgprobe = async function(){
  const out = [], chk = (ok, what, d) => out.push([!!ok, what, d === undefined ? '' : String(d)]);
  const run = () => new Promise(r => setTimeout(r, 30));
  const calls = [], owner=window._nativeTransport, hadCap=window.Capacitor, wasOn=MODGRAPH.on;
  window._nativeTransport={state:'page',claim:function(){return this.state!=='page';},suppresses:function(){return this.state!=='page';},stop:function(){this.state='page';}};
  const fakeApp = () => {
    window.Capacitor = { isNativePlatform: () => true, nativePromise: (p, m, o) => { calls.push([m, o]); return Promise.resolve({}); } };
    MODNAT.plugin = null;
  };
  try {
    localStorage.removeItem('modo-bgtest');
    // 1. off unless asked, and the old key means nothing
    localStorage.setItem('modo-bgplay', '1');
    chk(_bgKeepPlaying() === false, 'a saved modo-bgplay does not turn background play on');
    localStorage.removeItem('modo-bgplay');
    // 2. the new switch alone is not enough: it needs the app and the native sound
    localStorage.setItem('modo-bgtest', '1');
    chk(_bgKeepPlaying() === false, 'the switch in a browser (not the app) does nothing', _inNativeApp());

    fakeApp();
    MODGRAPH.on = false;
    chk(_bgKeepPlaying() === false, 'in the app but with the native sound off, still no');
    MODGRAPH.on = true;
    chk(_bgKeepPlaying() === false, 'native sound and an old debug flag cannot grant page-owned background play');
    window._nativeTransport.state='native';localStorage.removeItem('modo-bgtest');
    chk(_bgKeepPlaying() === true, 'a completed native owner grants background play without a debug flag');
    // 3. the engine is told, once per change
    _bgNativeSent = null; calls.length = 0;
    _bgSyncNative(); await run();
    const a = calls.filter(c => c[0] === 'setBackgroundPlay');
    chk(a.length === 1 && a[0][1].on === true, 'the engine is told on=true', JSON.stringify(a));
    _bgSyncNative(); await run();
    chk(calls.filter(c => c[0] === 'setBackgroundPlay').length === 1, 'and not told again while nothing changed');
    window._nativeTransport.state='page';
    _bgSyncNative(); await run();
    const b = calls.filter(c => c[0] === 'setBackgroundPlay');
    chk(b.length === 2 && b[1][1].on === false, 'page fallback tells the engine on=false', JSON.stringify(b[1]));
    // 4. leaving the app with the switch off changes nothing about the look-ahead or the log
    const look0 = LOOK_AHEAD, page0 = _bgPage;
    window.dispatchEvent(new Event('modriff-background'));
    chk(!_bgFast && LOOK_AHEAD === look0 && _bgPage === page0, 'switch off: leaving starts neither the long look-ahead nor the log');
    window.dispatchEvent(new Event('modriff-foreground'));
    // 5. switch on: leaving starts both, and returning puts them back
    window._nativeTransport.state='native';
    window.dispatchEvent(new Event('modriff-background'));
    chk(_bgFast && LOOK_AHEAD === 3, 'switch on: leaving starts the 3 s look-ahead', LOOK_AHEAD);
    chk(_bgPage && _bgPage.away === true, 'and the page log');
    _bgPageNote(); _bgPageNote(); _bgPageNote();
    chk(_bgPage.ticks === 3 && _bgPage.ctx !== undefined, 'three ticks are logged with the context state', JSON.stringify({ t: _bgPage.ticks, ctx: _bgPage.ctx }));
    window.dispatchEvent(new Event('modriff-foreground'));
    chk(!_bgFast && LOOK_AHEAD !== 3 && _bgPage.away === false && typeof _bgPage.secs === 'number', 'returning ends the log and puts the look-ahead back', LOOK_AHEAD);
    MODGRAPH.on = wasOn; window.Capacitor = hadCap; MODNAT.plugin = null;window._nativeTransport=owner;
    localStorage.removeItem('modo-bgtest'); _bgNativeSent = null; _bgPage = null;
  } catch (e) { chk(false, 'threw', e && (e.stack || e)); } finally {MODGRAPH.on=wasOn;window.Capacitor=hadCap;window._nativeTransport=owner;MODNAT.plugin=null;}
  return out;
};

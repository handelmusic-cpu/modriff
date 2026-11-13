/* Exercise permission and lifecycle handlers in the real page. The bridge and
   transport counters stand in for iOS; physical lock-screen listening stays on
   the phone checklist. Restore every replaced function and saved preference. */
window.__bgprobe = async function(){
  const out = [], chk = (ok, what, d) => out.push([!!ok, what, d === undefined ? '' : String(d)]);
  const run = () => new Promise(r => setTimeout(r, 30));
  const calls = [], saved = {owner:window._nativeTransport, cap:window.Capacitor,
    graph:MODGRAPH.on, plugin:MODNAT.plugin, on:_bgPlayOn, sent:_bgNativeSent,
    key:localStorage.getItem('modo-bgplay'), debug:localStorage.getItem('modo-bgtest'),
    playing:isAnythingPlaying, stop:stopEverything, start:startEverything, running:_audioRunning};
  let playing = true, stops = 0, starts = 0;
  try {
    window._nativeTransport={state:'page'};
    _bgPlayOn = true;
    localStorage.setItem('modo-bgtest', '1');
    chk(_bgKeepPlaying() === false, 'a browser cannot grant background permission');
    window.Capacitor = {isNativePlatform:()=>true, nativePromise:(p,m,o)=>{calls.push([m,o]);return Promise.resolve({});}};
    MODNAT.plugin = null;
    MODGRAPH.on = true;
    chk(_bgKeepPlaying() === false, 'native sound and an old debug flag cannot grant page-owned background play');
    for (const state of ['preparing','starting','failed']) {
      window._nativeTransport.state=state;
      chk(_bgKeepPlaying() === false, state+' transport cannot grant background permission');
    }
    window._nativeTransport.state='native';
    localStorage.removeItem('modo-bgtest');
    chk(_bgKeepPlaying() === true, 'enabled preference and a completed native owner grant permission');
    MODGRAPH.on=false;
    chk(_bgKeepPlaying() === false, 'Native sound off denies permission');
    MODGRAPH.on=true;
    _bgNativeSent=null;calls.length=0;
    _bgSyncNative();await run();
    _bgSyncNative();await run();
    let sent=calls.filter(c=>c[0]==='setBackgroundPlay');
    chk(sent.length===1 && sent[0][1].on===true, 'engine receives on=true once per change');

    document.getElementById('background-audio-toggle').click();await run();
    sent=calls.filter(c=>c[0]==='setBackgroundPlay');
    chk(!_bgKeepPlaying() && localStorage.getItem('modo-bgplay')==='0', 'user toggle saves OFF and revokes permission during native playback');
    chk(sent.length===2 && sent[1][1].on===false, 'OFF reaches the native host immediately');
    chk(document.getElementById('background-audio-toggle').getAttribute('aria-pressed')==='false', 'OFF is exposed to assistive technology');

    isAnythingPlaying=()=>playing;
    stopEverything=()=>{stops++;playing=false;};
    startEverything=()=>{starts++;playing=true;};
    _audioRunning=()=>true;
    const look0=LOOK_AHEAD, page0=_bgPage;
    window.dispatchEvent(new Event('modriff-background'));
    window.dispatchEvent(new Event('modriff-background'));
    chk(stops===1 && !playing && _bgPaused, 'OFF: repeated leave signals pause the band exactly once', stops);
    chk(!_bgFast && LOOK_AHEAD===look0 && _bgPage===page0, 'OFF: no background look-ahead or log starts');
    window.dispatchEvent(new Event('modriff-foreground'));
    window.dispatchEvent(new Event('modriff-foreground'));
    chk(starts===1 && playing && !_bgPaused, 'OFF: repeated return signals resume exactly once', starts);

    document.getElementById('background-audio-toggle').click();await run();
    chk(_bgKeepPlaying() && localStorage.getItem('modo-bgplay')==='1', 'user toggle saves ON and restores permission without restarting playback');
    sent=calls.filter(c=>c[0]==='setBackgroundPlay');
    chk(sent.length===3 && sent[2][1].on===true, 'ON reaches the native host immediately');
    window.dispatchEvent(new Event('modriff-background'));
    chk(stops===1 && starts===1 && playing && !_bgPaused, 'ON: leaving does not stop or restart the band');
    chk(_bgFast && LOOK_AHEAD===3 && _bgPage && _bgPage.away, 'ON: background diagnostics start');
    _bgPageNote();_bgPageNote();_bgPageNote();
    chk(_bgPage.ticks===3 && _bgPage.ctx!==undefined, 'three background ticks counted', _bgPage.ticks);
    window.dispatchEvent(new Event('modriff-foreground'));
    chk(stops===1 && starts===1 && !_bgFast && !_bgPage.away && LOOK_AHEAD!==3, 'ON: return leaves playback alone and ends diagnostics');
    window._nativeTransport.state='page';_bgSyncNative();await run();
    sent=calls.filter(c=>c[0]==='setBackgroundPlay');
    chk(sent.length===4 && sent[3][1].on===false, 'page fallback revokes permission even with the preference ON');
  } catch(e) { chk(false,'threw',e && (e.stack || e)); }
  finally {
    isAnythingPlaying=saved.playing;stopEverything=saved.stop;startEverything=saved.start;_audioRunning=saved.running;
    MODGRAPH.on=saved.graph;window.Capacitor=saved.cap;window._nativeTransport=saved.owner;MODNAT.plugin=saved.plugin;
    _bgPlayOn=saved.on;_bgNativeSent=saved.sent;_bgPaused=false;_bgPage=null;
    if(saved.key===null)localStorage.removeItem('modo-bgplay');else localStorage.setItem('modo-bgplay',saved.key);
    if(saved.debug===null)localStorage.removeItem('modo-bgtest');else localStorage.setItem('modo-bgtest',saved.debug);
    _syncBackgroundAudio();
  }
  return out;
};

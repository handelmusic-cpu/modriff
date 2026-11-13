/* The rating card is asked for only when it is due and the app is at rest. One function that runs inside the real
   served page (paste it into a console, or load it and call window.__reviewprobe()). Resolves a list of
   [ok, what, detail]. It leaves the page as it found it (the key restored, the fake bridge taken away). */
window.__reviewprobe = async function(){
  const out = [], chk = (ok, what, d) => out.push([!!ok, what, d === undefined ? '' : String(d)]);
  const hadCap = window.Capacitor, saved = localStorage.getItem(REVIEW.key), played0 = _reviewPlayed, touch0 = _reviewTouchAt;
  const calls = []; let answer = { asked:true };
  const fakeApp = () => { window.Capacitor = { isNativePlatform: () => true, nativePromise: (p, m) => { if(p+'.'+m === 'ModBilling.requestReview'){ calls.push(m); return Promise.resolve(answer); } return Promise.resolve({}); } }; };
  const tick = async () => { _reviewTick(); await new Promise(r => setTimeout(r, 20)); };
  const day = 864e5, now = Date.now();
  try {
    _reviewStop(); localStorage.removeItem(REVIEW.key);
    // 1. who is due
    chk(_reviewDue({ b:5, d:9 }, now) === false, 'a browser (the free web page) is never due');
    fakeApp();
    chk(_reviewDue({}, now) === false, 'a new user is not due');
    chk(_reviewDue({ b:1, d:3 }, now) === false, 'one bounce and three days is not enough');
    chk(_reviewDue({ b:2 }, now) === true, 'a second clean bounce makes it due');
    chk(_reviewDue({ d:4 }, now) === true, 'a fourth day of use makes it due');
    chk(_reviewDue({ b:9, ver:MODRIFF_VERSION }, now) === false, 'not twice in one version');
    chk(_reviewDue({ b:9, ver:'old', at:now - 30*day }, now) === false, 'not within the gap of the last ask');
    chk(_reviewDue({ b:9, ver:'old', at:now - 121*day }, now) === true, 'due again in a new version after the gap');
    // 2. counting
    let s = _reviewNote('day'); const d1 = s.d;
    s = _reviewNote('day'); chk(s.d === d1 && d1 === 1, 'the same day counts once', s.d);
    s = _reviewNote('bounce'); s = _reviewNote('bounce'); chk(s.b === 2 && s.d === 1, 'bounces count each time', JSON.stringify(s));
    // 3. the moment: each rule holds it back by name, and nothing is asked
    _reviewPlayed = false; _reviewTouchAt = 0;
    chk(_reviewBusy(Date.now()) === 'nothing played yet', 'not before any music this session', _reviewBusy(Date.now()));
    await tick(); chk(calls.length === 0, 'so nothing is asked', calls.length);
    _reviewPlayed = true; _reviewTouchAt = Date.now();
    chk(_reviewBusy(Date.now()) === 'touching', 'not while the screen is being touched', _reviewBusy(Date.now()));
    _reviewTouchAt = 0;
    const wasMet = metronomeOn; metronomeOn = true;
    chk(_reviewBusy(Date.now()) === 'playing', 'not while anything plays', _reviewBusy(Date.now()));
    await tick(); chk(calls.length === 0, 'so nothing is asked while playing', calls.length);
    metronomeOn = wasMet;
    const wasRec = _isRecording; _isRecording = true;
    chk(_reviewBusy(Date.now()) === 'recording', 'not during a take', _reviewBusy(Date.now()));
    _isRecording = wasRec;
    const sheet = document.createElement('div'); sheet.className = 'modal-sheet'; sheet.textContent = 'x'; document.body.appendChild(sheet);
    chk(_reviewBusy(Date.now()) === 'sheet', 'not over a sheet', _reviewBusy(Date.now()));
    sheet.remove();
    chk(_reviewBusy(Date.now()) === '', 'at rest it is a good moment', _reviewBusy(Date.now()));
    // 4. the host is busy (its share sheet is up): the ask is not spent
    answer = { asked:false };
    await tick(); chk(calls.length === 1 && !_reviewState().at, 'host busy: called once, not recorded as asked', calls.length+' '+JSON.stringify(_reviewState()));
    chk(!!_reviewTimer, 'and the timer is armed again');
    // 5. the host takes it: recorded, and never asked again this version
    answer = { asked:true };
    await tick(); s = _reviewState();
    chk(calls.length === 2 && s.ver === MODRIFF_VERSION && s.at > 0, 'asked once and recorded', calls.join(',')+' '+JSON.stringify(s));
    await tick(); await tick(); _reviewArm(true);
    chk(calls.length === 2 && !_reviewTimer, 'no second ask, no timer left running', calls.length);
  } catch(e){ chk(false, 'threw', e && e.stack || e); }
  finally {
    _reviewStop(); window.Capacitor = hadCap; _reviewPlayed = played0; _reviewTouchAt = touch0;
    if(saved == null) localStorage.removeItem(REVIEW.key); else localStorage.setItem(REVIEW.key, saved);
  }
  return out;
};

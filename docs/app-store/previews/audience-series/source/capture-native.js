// Runs in a disposable Simulator install after the production app page loads.
(async function captureSocialAds() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await wait(2200);
  const file = 'social.jsonl';
  const plugin = modNativePlugin();
  const started = performance.now();
  const errors = [];
  const log = (event, details = {}) => plugin.fileAppend({
    name: file, folder: 'SocialCapture', first: event === 'boot',
    data: modPlatform.b64Of(new TextEncoder().encode(JSON.stringify({event, ...details}) + '\n')),
  });
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw Error('Missing ' + selector);
    return node;
  };
  const center = selector => element(selector).scrollIntoView({block: 'center', behavior: 'instant'});
  const freshPage = () => { element('.tab-page.active').scrollTop = 0; };

  window.addEventListener('error', e => errors.push(e.message));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  const slate = document.createElement('div');
  slate.style.cssText = 'position:fixed;inset:0;z-index:999999;pointer-events:none';
  const mark = async color => {
    slate.style.background = color;
    if (!slate.isConnected) document.body.appendChild(slate);
    await wait(420);
  };
  let zero = 0;
  let activeShot = '';
  const shot = async (name, selector, setup, actions = []) => {
    activeShot = name;
    try {
      await setup();
      await wait(550);
      const node = element(selector);
      const {x, y, width, height} = node.getBoundingClientRect();
      if (!width || !height || y + height <= 0 || y >= innerHeight) throw Error('Offscreen ' + selector);
      await mark('white');
      slate.remove();
      const start = (performance.now() - zero) / 1000;
      await log('shot', {
        name, selector, start, rect: [x, y, width, height].map(Math.round),
        viewport: [innerWidth, innerHeight], page: element('.tab-page.active').id,
        text: (node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 260),
      });
      const states = [];
      const actionStart = performance.now();
      for (const [ms, action] of actions) {
        await wait(Math.max(0, ms - (performance.now() - actionStart)));
        await action();
        states.push((node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 180));
      }
      await wait(Math.max(0, 4300 - (performance.now() - actionStart)));
      await mark('#00ff00');
      if (states.length) await log('states', {name, states});
    } catch (error) {
      errors.push(name + ': ' + String(error));
      await log('shot-error', {name, error: String(error), stack: error.stack});
    }
  };
  const chordPanel = '#chord-diagram-panel';
  const fingerPanel = '#fingering-panel';
  const drawChord = (degree, extension = 'triad') => {
    const md = MODES.major;
    lastTriggeredDegree = degree;
    _triggerChordImmediate(rootMidi()+md.steps[degree], md.triadQ[degree], md.seventh[degree],
      md.func[degree], .6, extension, true);
    renderChordDiagram();
  };
  const showChord = (instrument, degree, extension) => {
    studioShow('chords');
    setChordDiagramInst(instrument);
    togglePanelFold(chordPanel.slice(1), false);
    drawChord(degree, extension);
    center(chordPanel);
  };
  const showFinger = (instrument, note) => {
    studioShow('melody');
    setFingeringVisible(true, {silent: true});
    setFingerInst(instrument);
    togglePanelFold(fingerPanel.slice(1), false);
    renderFingering(note);
    studioCardReveal(element(fingerPanel));
    center(fingerPanel);
  };
  const performSong = () => {
    switchTab('songs');
    setSongsMode('perform');
    songsPerformViewSet('tiles');
    freshPage();
  };
  const noteChanges = notes => notes.map((note, i) => [1050 * (i + 1), () => renderFingering(note)]);

  try {
    await log('boot', {version: MODRIFF_VERSION});
    await log('setup', {step:'boot resolved'});
    localStorage.setItem('modo-tour-ch1', '1');
    setModTier('pro');
    unlockAudio('blank');
    await log('setup', {step:'unlock called'});
    await wait(4500);
    await log('setup', {step:'before synth library'});
    await Promise.race([msxLoadLib(), wait(6500).then(() => { if (!window.MS?.UI) throw Error('Synth library timed out'); })]);
    await log('setup', {step:'synth library available'});
    const chart = parseChordSheet('[Verse]\nDm7 G7 Cmaj7 Am7\n[Chorus]\nFmaj7 G7 Cmaj7 Am7\n[Bridge]\nEm7 Am7 Dm7 G7\n');
    const built = songFromChordSheet(chart, {len: 1});
    sections = built.song.sections.map(s => ({...s, follow: 'next', plays: 1}));
    root = 0;
    setMode('major');
    await log('setup', {step:'song arranged'});
    onBpmInput(124);
    element('#chart-title').value = 'In Motion';
    buildSectionTabs();
    renderChartSeq();
    window._sqSetMach('MOD');
    const groove = RHYTHMS.findIndex(r => /funk/i.test(r.name));
    if (groove < 0) throw Error('Missing funk groove');
    sqLoadGroove(groove);
    setDrumsEnabled(true);
    const bass = starterList('bass').find(x => /funk|groove/i.test(x.label));
    if (!bass) throw Error('Missing bass starter');
    starterApply('bass', bass);
    if (!blEnabled) ftBassClick();
    setWave('piano');
    setBlWave('saw');
    setMlWave('modsynth');
    psFactoryEnsure();
    saveToSetlist();
    await wait(3000);
    await log('setup', {step:'band arranged'});

    zero = performance.now();
    await log('begin', {version: MODRIFF_VERSION, scaleCount: Object.keys(MODES).length,
      viewport: [innerWidth, innerHeight], elapsedFromScriptStart: (zero - started) / 1000});

    await shot('jazz-forms', chordPanel, () => showChord('piano', 1, '7th'), [
      [1250, () => drawChord(4, '7th')], [2550, () => drawChord(0, '7th')],
    ]);
    await shot('piano-forms', chordPanel, () => showChord('piano', 0));
    await shot('piano-more', chordPanel, () => showChord('piano', 3), [
      [1250, () => drawChord(5)], [2600, () => drawChord(4)],
    ]);
    await shot('guitar-forms', chordPanel, () => showChord('guitar', 0), [
      [1250, () => element('#chord-diagram-body .cd-alt-arr:last-child').click()],
      [2650, () => drawChord(4)],
    ]);
    for (const instrument of ['guitar', 'flute', 'trumpet', 'alto']) {
      await shot(instrument+'-fingering', fingerPanel, () => showFinger(instrument, 60), noteChanges([62,64,67]));
    }
    setFingeringVisible(false, {silent: true});
    await shot('live', '#pf-chords-panel', () => {
      liveTab();
      lvSet(['chords', 'melody', 'fx']);
      freshPage();
      startEverything();
    }, [[750, () => drawChord(0)], [1700, () => drawChord(3)], [2700, () => drawChord(4)]]);
    await shot('song', '#songs-perform-panel', () => {
      performSong();
      if (!_transportRunning()) startEverything();
      globalSongMode = true;
      startSongLoop();
    });
    await shot('practice', '#songs-practice-row', () => {
      performSong();
      center('#songs-practice-row');
    }, [[650, () => element('#prac-loop-btn').click()], [1850, () => element('#prac-ramp-btn').click()],
      [3150, () => element('#prac-key-btn').click()]]);
    await shot('drums', '.sq-grid-wrap', () => {
      studioShow('drums');
      dismissSeqRotatePopup(true);
      freshPage();
    }, [[1250, () => {
      const cell = element('#sq-gInner .sq-grow .sq-step:nth-child(2)');
      cell.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:1}));
      cell.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:1}));
    }]]);
    await shot('bass', '#bl-pr', () => { studioShow('bass'); freshPage(); });
    await shot('sampler', '#ps-grid', () => { studioShow('smp'); psSetBank(4); freshPage(); }, [[1300, () => {
      const pad = element('#ps-grid .ps-pad');
      pad.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:1}));
      setTimeout(() => pad.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:1})), 250);
    }]]);
    await shot('synth', '#synth-ed canvas.msx-wt.big', async () => {
      studioShow('melseq');
      MSX_UI.page = 'osc';
      msxOpenEditor('melgen');
      await wait(500);
      center('#synth-ed canvas.msx-wt.big');
    }, [[1450, () => element('#synth-ed .mu-subtab[data-title="Oscillator 2"]').click()],
      [2850, () => element('#synth-ed .mu-subtab[data-title="Oscillator 1"]').click()]]);
    await shot('scales', '#mode-pick-pop', () => {
      msxCloseEditor();
      liveTab();
      freshPage();
      ftKeyModeOpen(element('#ft-key-mode'));
    }, [[1400, () => element('#mode-pick-pop').scrollBy({top: 160, behavior: 'smooth'})]]);
    await shot('export', '#rec-w', () => {
      cpClose();
      lvSet(['mixer', 'rec']);
      center('#rec-w');
    }, [[1300, () => element('#rec-w [data-stemtoggle]').click()]]);
    slate.remove();
    stopEverything();
    await log('done', {errors});
  } catch (error) {
    await log('error', {name: activeShot, error: String(error), stack: error.stack});
  }
})();

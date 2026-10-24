/* The free/Pro table: every row has an explicit rule, the numbers hold at their
   edges, Pro allows everything, and every name the table uses is a real thing
   in the app (a typo in a kit or groove id would lock a free feature for good
   and nothing would say so).
   Run: node tests/tier/registry.test.js */
'use strict';
const load = require('./load');
const T = load();
const html = load.html;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w), m + '  want ' + JSON.stringify(w) + ' got ' + JSON.stringify(g));

// ── 1. every row is an explicit rule: true, false, or a list
Object.keys(T.FREE_LIMITS).forEach(k => {
  const v = T.FREE_LIMITS[k];
  ok(typeof v === 'boolean' || Array.isArray(v), 'FREE_LIMITS.' + k + ' is not a boolean or a list');
});

// ── 2. numbers at the edge (free)
T.setTier('free');
eq([11,12,16,24,32,33,36,48,64].map(T.freeAllowsSteps), [false,true,true,true,true,false,false,false,false], 'step counts');
eq([40,33,13,5].map(T.freeClampSteps), [32,32,12,16], 'a refused step count clamps to the nearest allowed below');
eq(T.FREE_NUMBERS.saveSlots, 5, 'save slots');
const songs = n => Array.from({ length: n }, (_, i) => ({ id: i }));
eq([4,5,6].map(n => T.slCanAdd(songs(n))), [true,false,false], 'a 5th song fits, a 6th does not');
eq(T.slCanAdd(songs(5).concat([{ id: 'd', isDemo: true }])), false, 'the demo song is not one of the five');
eq(T.slCanAdd(songs(4).concat([{ id: 'd', isDemo: true }])), true, 'demo plus four still has room');
eq(T.FREE_NUMBERS.audioExportSeconds, 90, 'audio export seconds');
eq(T.FREE_NUMBERS.midiExportBars, 4, 'MIDI export bars');
eq(T.FREE_NUMBERS.padCount, 9, 'sampler pads');
eq(T.EMBED_LIMITS, { sampleSeconds: 12, sampleBytes: 2 * 1024 * 1024, fileBytes: 15 * 1024 * 1024 }, 'embed caps');
eq([['4','4'],['3','4'],['12','8'],['6','8'],['5','4'],['7','8'],['2','4']].map(m => T.freeAllowsMeter(+m[0], +m[1])),
   [true,true,true,false,false,false,false], 'meters');
eq(['PA','PB','PC','PD','A','B','C','D'].map(b => T.freeAllowsPad(b, 0)), [true,true,true,true,false,false,false,false], 'pad banks');
eq([0,8,9,15].map(i => T.freeAllowsPad('PA', i)), [true,true,false,false], 'pads 1-9 only');

// ── 3. content (free)
eq(['808','606','LIN','JAZZ','MOD','PERC','909','ACU'].map(T.freeAllowsKit), [true,true,true,true,false,false,false,false], 'kits');
eq(['rock','jazz','funk','latin','motown','pedal','acid','halftime','reggae'].map(s => T.freeAllowsStyle(s)),
   [true,true,true,true,false,false,false,false,false], 'bass styles');
eq(['hook','rock','jazz','funk','latin','arpeggio','scalerun','riff','callresponse','motown','acid'].map(s => T.freeAllowsStyle(s, 'ml')),
   [true,true,true,true,true,false,false,false,false,false,false], 'melody styles');
eq(['major','minor','dorian','phrygian','lydian','mixolydian','locrian','minor_pent',
    'major_pent','blues','harmonic_minor','hijaz','whole_tone','pelog','user:mine'].map(T.freeAllowsMode),
   [true,true,true,true,true,true,true,true,false,false,false,false,false,false,false], 'scales');
eq(['pianoreal','upright_real','vibes','upright2','bass_motown','bass_hofner','bass_picked','jazzgtr','modsynth','sine','saw','square'].map(T.freeAllowsVoice),
   [true,true,false,false,false,false,false,false,false,true,true,true], 'voices');
eq(['Filter Sweep','Tape Stop','Dub Delay','Riser','HP Riser','Lo-Fi'].map(T.freeAllowsFxPatch), [true,true,true,true,false,false], 'mõdFX patches');
eq(['4/4 Basic','Shuffle','Half-Time Rock','4/4 Funk','House','Bossa Nova','3/4 Waltz','12/8 Slow','Trap','6/8 Feel','4/4 Rock'].map(T.freeAllowsGroove),
   [true,true,true,true,true,true,true,true,false,false,false], 'grooves');
eq(['stemExport','fullAudioExport','fullMidiExport','sampler','modsynth','gridEditors','chordExtensions','samples'].map(f => T.modAllows(f)),
   [false,false,false,false,false,false,false,false], 'Pro-only features are off for free');
ok(T.modAllows('modfx') === true, 'the mõdFX pad itself is free (four patches of it)');

// ── 4. Pro allows everything the table restricts
T.setTier('pro');
ok([11,33,48,64].every(T.freeAllowsSteps), 'pro: any step count');
ok(T.slCanAdd(songs(50)), 'pro: unlimited songs');
ok(['MOD','PERC','909'].every(T.freeAllowsKit), 'pro: every kit');
ok(['hijaz','user:mine','pelog'].every(T.freeAllowsMode), 'pro: every scale');
ok(['vibes','upright2','modsynth'].every(T.freeAllowsVoice), 'pro: every voice');
ok(T.freeAllowsMeter(7, 8) && T.freeAllowsGroove('Trap') && T.freeAllowsFxPatch('Lo-Fi') && T.freeAllowsPad('A', 15), 'pro: meters, grooves, patches, pads');
ok(['stemExport','fullAudioExport','fullMidiExport','sampler','modsynth'].every(f => T.modAllows(f)), 'pro: gated features on');

// ── 5. every name the table uses exists in the app
const has = (re, what) => ok(re.test(html), what);
T.FREE_LIMITS.drumKits.forEach(k => has(new RegExp("\\n  '" + k + "':\\{label:"), 'drum kit ' + k + ' is defined in SQM'));
T.FREE_LIMITS.drumGrooves.forEach(g => has(new RegExp("name:'" + g.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + "'"), 'groove "' + g + '" is in RHYTHMS'));
T.FREE_LIMITS.bassStyles.forEach(s => has(new RegExp('data-blstyle="' + s.toLowerCase() + '"'), 'bass style ' + s + ' has a button'));
T.FREE_LIMITS.melodyStyles.forEach(s => has(new RegExp('data-mlstyle="' + s.toLowerCase() + '"'), 'melody style ' + s + ' has a button'));
T.FREE_LIMITS.fxPatches.forEach(p => has(new RegExp("\\{name:'" + p + "',"), 'mõdFX patch ' + p + ' is in FX_FACTORY_PRESETS'));
T.FREE_LIMITS.freeModes.forEach(m => has(new RegExp("\\n ?" + m + ": \\{|\\n ?'?" + m + "'?:\\s*\\{|id:'" + m + "'"), 'scale ' + m + ' exists'));
T.FREE_LIMITS.padBanks.forEach(b => has(new RegExp("PS_BANKS = \\[[^\\]]*'" + b + "'"), 'pad bank ' + b + ' is in PS_BANKS'));
T.FREE_LIMITS.freeVoices.forEach(v => has(new RegExp("\\b" + v + "\\b"), 'free voice ' + v + ' is referenced'));
// fresh-start defaults are free ones
has(/var sqSwing=0, sqMach='LIN'/, 'the default drum kit is the Linn');
has(/var sqLayers = \[ \{mach:'LIN'[^\]]*\{mach:'606'/, 'the default layers are Linn and 606');
ok(T.FREE_LIMITS.drumKits.indexOf('LIN') >= 0 && T.FREE_LIMITS.drumKits.indexOf('606') >= 0, 'both default kits are free');
ok(T.FREE_LIMITS.bassStyles.indexOf('Funk') >= 0, 'the default bass style (funk) is free');
ok(T.FREE_LIMITS.melodyStyles.indexOf('Hook') >= 0, 'the default melody style (hook) is free');

// ── 6. The Free/Pro test switch exists only in a debug build or on a local page
T.window.__modDebug = undefined;
eq(['modriff.vercel.app','www.modriff.com','localhost.evil.com','127.0.0.1.evil.com','evil-localhost','10.0.0.5'].map(h => T.devTierAvailable(h)),
   [false,false,false,false,false,false], 'a deployed or look-alike host never gets the switch');
eq(['localhost','127.0.0.1','[::1]'].map(h => T.devTierAvailable(h)), [true,true,true], 'a page served from this machine does');
T.window.__modDebug = true;
ok(T.devTierAvailable('modriff.vercel.app') === true, 'a debug build gets it whatever the host');
T.window.__modDebug = 'true';
ok(T.devTierAvailable('modriff.vercel.app') === false, 'only the boolean the host sets counts, not a string');
T.window.__modDebug = undefined;
T.location.hostname = 'modriff.vercel.app';
ok(T.devTierAvailable() === false, 'with no argument it reads the page host: a deployed release build has none');

console.log(fail ? ('\n' + fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);

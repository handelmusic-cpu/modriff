/* The module table: every locked row belongs to exactly one module, each module
   unlocks what it should and nothing else, the bundle offer is the right one for
   how many modules are owned, the numbers hold at their edges, and every name the
   table uses is a real thing in the app (a typo in a kit or groove id would lock a
   free feature for good and nothing would say so).
   Run: node tests/tier/registry.test.js */
'use strict';
const load = require('./load');
const T = load();
const html = load.html;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w), m + '  want ' + JSON.stringify(w) + ' got ' + JSON.stringify(g));
const MODS = T.MODULE_ORDER;

// ── 1. every row is an explicit rule: true, false, or a list
Object.keys(T.FREE_LIMITS).forEach(k => {
  const v = T.FREE_LIMITS[k];
  ok(typeof v === 'boolean' || Array.isArray(v), 'FREE_LIMITS.' + k + ' is not a boolean or a list');
});

// ── 2. every locked row belongs to exactly one module, and none is orphaned
eq(MODS.slice().sort(), ['groove','practice','sampler','sounds','studio','synth','theory'], 'the seven modules');
Object.keys(T.FREE_LIMITS).forEach(k => ok(MODS.indexOf(T.FEATURE_MODULE[k]) >= 0, 'FREE_LIMITS.' + k + ' belongs to no module'));
Object.keys(T.FEATURE_MODULE).forEach(k => ok(k in T.FREE_LIMITS, 'FEATURE_MODULE.' + k + ' names a row FREE_LIMITS does not have'));
Object.keys(T.FREE_NUMBERS).forEach(k => ok(MODS.indexOf(T.NUMBER_MODULE[k]) >= 0, 'FREE_NUMBERS.' + k + ' belongs to no module'));
Object.keys(T.NUMBER_MODULE).forEach(k => ok(k in T.FREE_NUMBERS, 'NUMBER_MODULE.' + k + ' names a number FREE_NUMBERS does not have'));
eq(T.STORE_ORDER.slice().sort(), MODS.slice().sort(), 'the store lists every module once');
eq(T.BUNDLE_KEYS, ['fullstudio','from1','from2','from3plus'], 'the four bundle products');

// ── 3. the copy: every module has some, and it fits App Store Connect (name 30, description 45)
MODS.forEach(m => {
  const c = T.MODULE_COPY[m];
  ok(!!c, 'no copy for ' + m);
  if (!c) return;
  ok(c.name.length <= 30, m + ' name is ' + c.name.length + ' characters, the limit is 30');
  ok(c.line.length <= 45, m + ' line is ' + c.line.length + ' characters, the limit is 45: ' + c.line);
  ok(c.bullets.length >= 2, m + ' lists fewer than two things');
  ok(!/\b(Rhodes|Motown|Hofner|Höfner)\b/i.test(JSON.stringify(c)), m + ' copy names a trademark');
});
['full','complete'].forEach(k => {
  ok(T.BUNDLE_COPY[k].name.length <= 30, k + ' bundle name fits 30');
  ok(T.BUNDLE_COPY[k].line.length <= 45, k + ' bundle line fits 45');
});
// Not yet built, so not in the copy (brief 5b): tempo ramp, looping, transpose, custom scales, EQ, cloud sync, themes.
ok(!/tempo ramp|section loop|transpose|custom scale|cloud|intonation|3-band/i.test(JSON.stringify(T.MODULE_COPY)), 'the copy lists something that is not built');

// ── 4. numbers at the edge (nothing owned)
T.setOwned([]);
eq([11,12,16,24,32,33,36,48,64].map(T.freeAllowsSteps), [false,true,true,true,false,false,false,false,false], 'step counts');
eq([40,33,13,5].map(T.freeClampSteps), [24,24,12,16], 'a refused step count clamps to the nearest allowed below');
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
eq(['PA','PB','PC','PD','A','B','C','D'].map(b => T.freeAllowsPad(b, 0)), [true,true,false,false,false,false,false,false], 'pad banks: the first two presets');
eq([0,8,9,15].map(i => T.freeAllowsPad('PA', i)), [true,true,false,false], 'pads 1-9 only');

// ── 5. content (nothing owned)
eq(['808','606','LIN','JAZZ','MOD','PERC','909','ACU'].map(T.freeAllowsKit), [true,false,true,false,false,false,false,false], 'kits: Linn and 808');
eq(['rock','jazz','funk','latin','motown','pedal','acid','halftime','reggae'].map(s => T.freeAllowsStyle(s)),
   [true,false,true,false,false,false,false,false,false], 'bass styles: Rock and Funk');
eq(['hook','rock','jazz','funk','latin','arpeggio','scalerun','riff','callresponse','motown','acid'].map(s => T.freeAllowsStyle(s, 'ml')),
   [true,true,false,false,false,false,false,false,false,false,false], 'melody styles: Hook and Rock');
eq(['major','minor','minor_pent','blues','dorian','phrygian','lydian','mixolydian','locrian',
    'major_pent','harmonic_minor','hijaz','whole_tone','pelog','user:mine'].map(T.freeAllowsMode),
   [true,true,true,true,false,false,false,false,false,false,false,false,false,false,false], 'scales: major, minor, minor pentatonic, blues');
eq(['close','open','drop2','drop3','rnb','neosoul'].map(T.freeAllowsVoicing), [true,true,false,false,false,false], 'voicings: Close and Spread');
eq(['Filter Sweep','Tape Stop','Dub Delay','Riser','HP Riser','Lo-Fi'].map(T.freeAllowsFxPatch), [true,true,true,false,false,false], 'mõdFX patches: three');
eq(['4/4 Basic','Shuffle','Half-Time Rock','4/4 Funk','House','3/4 Waltz','12/8 Slow','Bossa Nova','Trap','6/8 Feel','4/4 Rock'].map(T.freeAllowsGroove),
   [true,true,true,true,true,true,true,false,false,false,false], 'grooves');
eq(['sine','sawtooth','square','supersaw','triangle','upright','electric','acid303','sampler'].map(T.freeAllowsVoice),
   [true,true,true,true,true,true,true,true,true], 'the plain waves and the basses no pack names are free');
eq(['piano','rhodes','organ','pad','vibes','bass_motown','bass_hofner'].map(T.freeAllowsVoice),
   [false,false,false,false,false,false,false], "the Sounds Pack's voices are locked");
eq(['pianoreal2','upright_real','upright2','bass_picked','marimba','xylo','kalimba','jazzgtr','nylongtr','tenorsax','mutetpt','violin','clarinet','flute','modsynth'].map(T.freeAllowsVoice),
   Array(15).fill(false), "the recorded voices and mõdSynth are locked");
eq(['stemExport','fullAudioExport','fullMidiExport','sampler','modsynth','chordExtensions','keyColours','liveLayout','arrange','stepsUnlinked','auxLayer','iRealBatch','samples'].map(f => T.modAllows(f)),
   Array(13).fill(false), 'module-only features are off with nothing owned');
ok(T.modAllows('modfx') === true, 'the mõdFX pad itself is free (three patches of it)');
ok(T.modAllows('somethingNoTableNames') === true, 'a feature no table names is free');

// ── 6. each module unlocks its own things and nothing else
const songs50 = songs(50);
const probes = {
  groove: [() => T.freeAllowsKit('909'), () => T.freeAllowsKit('606'), () => T.freeAllowsGroove('Trap'), () => T.freeAllowsMeter(7, 8),
           () => T.freeAllowsSteps(48), () => T.freeAllowsStyle('motown'), () => T.freeAllowsStyle('hook', 'ml') && T.freeAllowsStyle('arpeggio', 'ml'),
           () => T.freeAllowsArpRate('1/32'), () => T.modAllows('arrange'), () => T.modAllows('auxLayer'), () => T.modAllows('stepsUnlinked')],
  theory: [() => T.freeAllowsMode('hijaz'), () => T.freeAllowsMode('dorian'), () => T.freeAllowsVoicing('drop2'),
           () => T.modAllows('chordExtensions'), () => T.modAllows('keyColours')],
  sampler: [() => T.freeAllowsVoice('pianoreal2'), () => T.freeAllowsVoice('upright_real'), () => T.freeAllowsPad('PC', 0),
            () => T.freeAllowsPad('A', 0), () => T.freeAllowsPad('PA', 12), () => T.modAllows('sampler'), () => T.modAllows('samples')],
  synth: [() => T.freeAllowsVoice('modsynth'), () => T.freeAllowsFxPatch('Lo-Fi'), () => T.freeAllowsFxPatch('Riser'), () => T.modAllows('modsynth')],
  sounds: ['piano','rhodes','organ','pad','vibes','bass_motown','bass_hofner'].map(v => () => T.freeAllowsVoice(v)),
  studio: [() => T.modAllows('stemExport'), () => T.modAllows('fullAudioExport'), () => T.modAllows('fullMidiExport'),
           () => T.modAllows('liveLayout'), () => T.slCanAdd(songs50)],
  practice: [() => T.modAllows('iRealBatch')]
};
MODS.forEach(owner => {
  T.setOwned([owner]);
  MODS.forEach(m => probes[m].forEach((p, i) => {
    const got = !!p();
    ok(got === (m === owner), 'owning only ' + owner + ': ' + m + ' probe #' + i + ' should be ' + (m === owner ? 'unlocked' : 'locked') + ' and is ' + (got ? 'unlocked' : 'locked'));
  }));
  eq([T.modHas(owner), MODS.filter(T.modHas).length, T.modOwnedCount()], [true, 1, 1], owner + ' alone: one module held');
});
// Full Studio, under any of its four product keys, is everything.
T.BUNDLE_KEYS.forEach(k => {
  T.setOwned([k]);
  ok(MODS.every(T.modHas) && T.modHasAll(), k + ' unlocks every module');
  ok(MODS.every(m => probes[m].every(p => p())), k + ' unlocks every probe');
  eq(T.modOwnedCount(), 0, k + ' is not counted as modules bought one at a time');
});
// The practice library is outside the slots: without the pack, charts count against them.
T.setOwned([]);
T.sandbox._irealList = () => songs(3);
eq([1,2,3].map(n => T.slCanAdd(songs(n))), [true,false,false], 'three charts leave room for one more song of five');
T.setOwned(['practice']);
eq([4,5].map(n => T.slCanAdd(songs(n))), [true,false], 'with the Practice Pack the charts are not counted');
T.setOwned(['studio']);
ok(T.slCanAdd(songs(40)), 'with the Studio Pack the slots are unlimited');
delete T.sandbox._irealList;

// ── 7. before ownership is known nothing is locked: a gate hit during boot cannot lock a payer out
T.unknown();
ok(T.freeAllowsKit('909') && T.freeAllowsVoice('piano') && T.modAllows('stemExport') && T.freeAllowsMode('hijaz') && T.slCanAdd(songs(99)),
   'unknown ownership allows everything');

// ── 8. the bundle offer: which product, by how many modules are owned
const PRICE = { sampler:5.99, synth:4.99, groove:3.99, theory:3.99, practice:3.99, studio:4.99, sounds:1.99,
                fullstudio:12.99, from1:10.99, from2:6.99, from3plus:3.99 };
const prods = {}; Object.keys(PRICE).forEach(k => { prods[k] = { price: '$' + PRICE[k], value: PRICE[k] }; });
const ownedMap = list => { const o = {}; MODS.forEach(m => { o[m] = list.indexOf(m) >= 0; }); return o; };
const offer = (list, full, p) => T.bundleOfferFor(ownedMap(list), !!full, p === undefined ? prods : p);
eq(offer([]).key, 'fullstudio', 'owns none: Full Studio');
ok(offer([]).fresh === true, 'owns none: labelled Full Studio, not Complete Your Studio');
eq(offer(['sampler']).key, 'from1', 'owns one: the one-module upgrade');
ok(offer(['sampler']).fresh === false, 'owns one: Complete Your Studio');
eq(offer(['sampler','synth']).key, 'from2', 'owns two: the two-module upgrade');
eq(offer(['sampler','synth','groove']).key, 'from3plus', 'owns three: the 3+ upgrade');
eq(offer(['sampler','synth','groove','theory','practice']).key, 'from3plus', 'owns five: the 3+ upgrade');
eq(offer(MODS.slice(0, 6)), null, 'owns all but Sounds: the one left ($1.99) is cheaper than the $3.99 upgrade, so none is offered');
eq(offer(['sampler','synth','groove','theory','practice','sounds']).key, 'from3plus', 'owns all but Studio: the one left ($4.99) costs more than the upgrade ($3.99)');
eq(offer(['sampler','synth','groove','theory','sounds','studio']).key, 'from3plus', 'owns all but Practice: the one left ($3.99) is not cheaper than the upgrade ($3.99)');
eq(offer(MODS), null, 'owns all seven: nothing to sell');
eq(offer([], true), null, 'owns Full Studio: nothing to sell');
eq(offer(['groove'], true), null, 'owns Full Studio and a module: nothing to sell');
// The upgrade is shown with the modules it would add and the ones already held.
eq(offer(['sampler']).owned, ['sampler'], 'what you already own, for the sheet');
eq(offer(['sampler','groove']).get, ['sounds','synth','theory','practice','studio'], 'what the upgrade adds, in store order');
// A price change in App Store Connect that makes the pieces cheaper than the bundle hides the bundle...
const cheap = Object.assign({}, prods, { fullstudio: { price: '$40.00', value: 40 } });
eq(offer([], false, cheap), null, 'bundle dearer than the seven pieces: not offered');
// ...and one the store has not answered for yet does not hide it.
eq(offer(['sampler'], false, { from1: { price: '$10.99', value: 10.99 } }).key, 'from1', 'prices of the other modules unknown: the offer is still shown');
eq(offer(['sampler'], false, {}).price, null, 'no price from the store yet: the offer carries none (the sheet says Unlock)');
eq(T.modNameOf('from2'), 'Complete Your Studio', 'every Complete Your Studio product has the one name');

// ── 9. voices: which module each belongs to, and what a free build plays instead
eq(['piano','rhodes','organ','pad','vibes','bass_motown','bass_hofner'].map(T.voiceModule), Array(7).fill('sounds'), "the Sounds Pack's voices");
eq(['pianoreal2','upright_real','upright2','bass_picked','marimba','xylo','kalimba','jazzgtr','nylongtr','tenorsax','mutetpt','violin','clarinet','flute'].map(T.voiceModule),
   Array(14).fill('sampler'), "the Sampler Engine's voices");
eq(T.voiceModule('modsynth'), 'synth', 'mõdSynth');
eq(['sine','sawtooth','square','supersaw','triangle','upright','electric','acid303','sampler'].map(T.voiceModule), Array(9).fill(null), 'free voices');
T.setOwned([]);
Object.keys(T.FREE_VOICE_FALLBACK).forEach(k => ok(T.freeAllowsVoice(T.FREE_VOICE_FALLBACK[k]), 'the free stand-in for ' + k + ' (' + T.FREE_VOICE_FALLBACK[k] + ') is itself free'));
// each voice in SOUNDS_VOICES exists in the app
T.SOUNDS_VOICES.forEach(v => ok(new RegExp("\\['" + v + "','|\\b" + v + ":\\s*\\{lib:|\\b" + v + "\\b").test(html), 'Sounds voice ' + v + ' is referenced in the app'));

// ── 10. every name the table uses exists in the app
const has = (re, what) => ok(re.test(html), what);
T.FREE_LIMITS.drumKits.forEach(k => has(new RegExp("\\n  '" + k + "':\\{label:"), 'drum kit ' + k + ' is defined in SQM'));
T.FREE_LIMITS.drumGrooves.forEach(g => has(new RegExp("name:'" + g.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + "'"), 'groove "' + g + '" is in RHYTHMS'));
T.FREE_LIMITS.bassStyles.forEach(s => has(new RegExp('data-blstyle="' + s.toLowerCase() + '"'), 'bass style ' + s + ' has a button'));
T.FREE_LIMITS.melodyStyles.forEach(s => has(new RegExp('data-mlstyle="' + s.toLowerCase() + '"'), 'melody style ' + s + ' has a button'));
T.FREE_LIMITS.fxPatches.forEach(p => has(new RegExp("\\{name:'" + p + "',"), 'mõdFX patch ' + p + ' is in FX_FACTORY_PRESETS'));
T.FREE_LIMITS.freeModes.forEach(m => has(new RegExp("\\n ?" + m + ": \\{|\\n ?'?" + m + "'?:\\s*\\{|id:'" + m + "'"), 'scale ' + m + ' exists'));
T.FREE_LIMITS.padBanks.forEach(b => has(new RegExp("PS_BANKS = \\[[^\\]]*'" + b + "'"), 'pad bank ' + b + ' is in PS_BANKS'));
T.FREE_LIMITS.voicings.forEach(v => has(new RegExp('data-voicing="' + v + '"'), 'voicing ' + v + ' has a button'));
// fresh-start defaults: the bass and drum defaults are free ones; the chord voice is not (see FREE_VOICE_FALLBACK)
has(/var blWave = 'upright';/, 'the default bass voice is Upright (the synth one)');
has(/var sqSwing=0, sqMach='LIN'/, 'the default drum kit is the Linn');
ok(T.FREE_LIMITS.drumKits.indexOf('LIN') >= 0, 'the default kit is free');
ok(T.FREE_LIMITS.bassStyles.indexOf('Funk') >= 0, 'the default bass style (funk) is free');
ok(T.FREE_LIMITS.melodyStyles.indexOf('Hook') >= 0, 'the default melody style (hook) is free');
ok(T.freeAllowsVoice('upright'), 'the default bass voice is free');
ok(T.freeAllowsMode('major'), 'the default scale is free');

// ── 10b. Piano 1 is gone, and nothing still points at it
{
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..', '..');
  ok(!fs.existsSync(path.join(root, 'samples', 'piano')), 'samples/piano (Piano 1, no recorded licence) is removed');
  ok(!html.split('\n').some(l => !/^\s*\/\//.test(l) && /samples\/piano\//.test(l)), 'no code in index.html reads samples/piano/ (comments may still name it)');
  ok(!/pianoreal(?!2)['"]\s*:\s*\{dir/.test(html), 'SAMPLE_LIBS has no pianoreal entry');
  ok(/var WAVE_RENAMED = \{ pianoreal:'pianoreal2' \};/.test(html), 'a saved pianoreal is renamed to pianoreal2');
  ok((html.match(/if\(WAVE_RENAMED\[w\]\) w = WAVE_RENAMED\[w\];/g) || []).length === 4, 'the chord, arp, melody and Melody Seq setters apply WAVE_RENAMED');
  const lib = /pianoreal2:\{dir:'(samples\/piano2)'/.exec(html);
  ok(!!lib, 'the recorded Piano (pianoreal2) is still a recorded voice');
  if (lib) ok(fs.readdirSync(path.join(root, 'samples', 'piano2')).filter(f => /\.mp3$/.test(f)).length >= 40, 'the recorded Piano files are all present');
}

// ── 11. the Free/Pro test switch exists only in a debug build or on a local page
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
eq([T.devOwnedFromString('free'), T.devOwnedFromString('pro'), T.devOwnedFromString('groove,theory'), T.devOwnedFromString('nonsense,groove'), T.devOwnedFromString('nonsense'), T.devOwnedFromString(null)],
   [[], ['fullstudio'], ['groove','theory'], ['groove'], null, null], 'the remembered test choice parses to a list, and junk to nothing');

// ── 12. the words on a lock
eq(['Custom samples','Stems','Key colours','More than 5 saved songs','Time signatures'].map(T._modPlural), [true,true,true,true,true], 'plural phrases');
eq(['Arrange','That sound','This drum kit','Moving or swapping Live widgets','Choosing your own axes','The Aux channel','Bossa Nova groove','Stem export'].map(T._modPlural),
   [false,false,false,false,false,false,false,false], 'singular phrases, gerunds and a trailing noun');
eq(T.modPartOf('Custom samples', 'sampler'), 'Custom samples are part of the Sampler Engine', 'the brief’s own example');
eq(T.modPartOf('Arrange', 'groove'), 'Arrange is part of the Groove Pack', 'singular');
eq(T.modPartOf('That', null), 'That is part of a paid pack', 'no module named: generic wording');

// ── 12b. the StoreKit test file says what the page says: the same eleven products, the same names, the same words
{
  const sk = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../ios/App/ModRiffPacks.storekit'), 'utf8'));
  const byId = {}; sk.products.forEach(p => { byId[p.productID] = p; });
  const idOf = k => 'Handel.modRiff.' + (k === 'from1' || k === 'from2' || k === 'from3plus' ? 'fullstudio.' + k : k);
  eq(sk.products.length, 11, 'the StoreKit file has eleven products');
  ok(sk.products.every(p => p.type === 'NonConsumable' && p.familyShareable === true), 'all non-consumable, all Family Sharing on');
  T.MODULE_ORDER.forEach(m => {
    const p = byId[idOf(m)];
    ok(!!p, 'StoreKit file has ' + idOf(m));
    if (p) eq([p.localizations[0].displayName, p.localizations[0].description], [T.MODULE_COPY[m].name, T.MODULE_COPY[m].line], m + ' StoreKit name and description match the copy');
  });
  T.BUNDLE_KEYS.forEach(k => {
    const p = byId[idOf(k)], c = k === 'fullstudio' ? T.BUNDLE_COPY.full : T.BUNDLE_COPY.complete;
    ok(!!p, 'StoreKit file has ' + idOf(k));
    if (p) eq([p.localizations[0].displayName, p.localizations[0].description], [c.name, c.line], k + ' StoreKit name and description match the copy');
  });
  eq(['fullstudio','from1','from2','from3plus'].map(k => byId[idOf(k)].displayPrice), ['12.99','10.99','6.99','3.99'], 'the bundle prices');
  eq(T.MODULE_ORDER.map(m => byId[idOf(m)].displayPrice), ['5.99','4.99','3.99','3.99','3.99','4.99','1.99'], 'the module prices');
  // ModBilling.swift builds the same product IDs
  const swift = require('fs').readFileSync(require('path').join(__dirname, '../../ios/App/App/ModBilling/ModBilling.swift'), 'utf8');
  ok(swift.indexOf('"Handel.modRiff"') >= 0 && /fullstudio\.from1/.test(swift) && /fullstudio\.from2/.test(swift) && /fullstudio\.from3plus/.test(swift), 'ModBilling.swift builds the same product IDs');
}

// ── 13. lints on the page itself
{
  // The old single flag is gone for good.
  const code = html.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  ok(!/\bmodTier\s*\(/.test(code) && !/\b_modTier\b/.test(code), 'nothing calls modTier any more');
  ok(!/\.isPro\s*\(|__modProCached/.test(code), 'nothing asks modBilling.isPro or reads __modProCached');
  // Every freeBlocked(...) call says which module would lift it, or the toast has nothing to name.
  let at = 0, calls = 0, bare = [];
  while ((at = code.indexOf('freeBlocked(', at)) >= 0) {
    const before = code.slice(Math.max(0, at - 9), at);
    let i = at + 'freeBlocked('.length, depth = 1, commas = 0, inStr = null;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
      if (c === "'" || c === '"' || c === '`') inStr = c;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 1) commas++;
    }
    if (!/function $/.test(before) && !/typeof $/.test(before)) { calls++; if (commas < 1) bare.push(code.slice(at, at + 60).replace(/\n/g, ' ')); }
    at = i;
  }
  ok(calls >= 35, 'the lint found the freeBlocked calls (' + calls + ')');
  eq(bare, [], 'every freeBlocked call names its module');
  // Every .mod-<id> class in the markup is hidden by a rule for that module.
  const used = {}; (html.match(/\bmod-(sampler|synth|groove|theory|practice|studio|sounds)\b/g) || []).forEach(c => { used[c.slice(4)] = 1; });
  Object.keys(used).forEach(m => ok(new RegExp('body\\.lock-' + m + ' \\.mod-' + m).test(html), 'a .mod-' + m + ' element has a lock-' + m + ' rule'));
  ok(!/class="[^"]*\bpro-only\b/.test(html), 'no element still says pro-only');
  // The Swift side lists the same eleven products the page speaks in.
  const swift = require('fs').readFileSync(require('path').join(__dirname, '../../ios/App/App/ModBilling/ModBilling.swift'), 'utf8');
  T.MODULE_ORDER.concat(T.BUNDLE_KEYS).forEach(k => ok(swift.indexOf('"' + k + '"') >= 0, 'ModBilling.swift knows the product key ' + k));
}

console.log(fail ? ('\n' + fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);

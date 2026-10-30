/* Lifts the module table, the entitlement logic and the helpers that read them
   out of index.html and runs them in a sandbox, so the tests exercise the exact
   code the app ships. What is owned is a list the test sets: setOwned(['groove'])
   for one module, setOwned(['fullstudio']) for the bundle, setOwned([]) for free.
   The part lifted is the one between "<<tier-core:start>>" and "<<tier-core:end>>"
   in index.html, which has no DOM in it; everything else is picked by name. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function between(startMarker, endMarker){
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + startMarker + ' .. ' + endMarker);
  return html.slice(a, b);
}
function fn(name){
  const m = new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n').exec(html);
  if (!m) throw new Error(name + ' not found');
  return m[0];
}

module.exports = function load(){
  // window and location are stand-ins the test can change: T.window, T.location.
  const src =
    between('// <<tier-core:start>>', '// <<tier-core:end>>') +
    fn('_slCount') + fn('_slUsed') + fn('slCanAdd') + fn('devTierAvailable') + fn('devOwnedFromString') +
    fn('_modPlural') + fn('modPartOf') +
    '\n;({ MODULE_ORDER, BUNDLE_KEYS, STORE_ORDER, MODULE_COPY, BUNDLE_COPY, FREE_LIMITS, FEATURE_MODULE, NUMBER_MODULE,' +
    ' SOUNDS_VOICES, FREE_VOICE_FALLBACK, FREE_NUMBERS, EMBED_LIMITS,' +
    ' modHas, modHasAll, modOwnedCount, modFor, modAllows, bundleOfferFor, modBundleOffer, voiceModule, modNameOf,' +
    ' freeAllowsKit, freeAllowsStyle, freeAllowsSteps, freeClampSteps, freeAllowsMeter, freeAllowsGroove,' +
    ' freeAllowsFxPatch, freeAllowsPad, freeAllowsMode, freeAllowsVoice, freeAllowsVoicing, freeAllowsArpRate,' +
    ' slCanAdd, _slCount, _slUsed, devTierAvailable, devOwnedFromString, _modPlural, modPartOf,' +
    // What _applyTier does with a provider's list, without the DOM.
    ' setOwned: function(keys){' +
    '   _modFull = keys.some(function(k){ return BUNDLE_KEYS.indexOf(k) >= 0; });' +
    '   var o = {}; MODULE_ORDER.forEach(function(m){ o[m] = keys.indexOf(m) >= 0; }); _modOwned = o; },' +
    ' unknown: function(){ _modOwned = undefined; _modFull = false; } });';
  // The real voice lists, read out of the page: a hand-written stand-in let a
  // wrong id ("upright_real2" for upright2) pass a test about locked bass voices.
  const keysOf = (head, re) => {
    const a = html.indexOf(head), b = html.indexOf('};', a);
    if (a < 0 || b < 0) throw new Error(head + ' not found');
    const out = {}; let m;
    while ((m = re.exec(html.slice(a, b)))) out[m[1]] = 1;
    return out;
  };
  const sandbox = {
    SAMPLED_WAVES: keysOf('const SAMPLED_WAVES = {', /(?:^|[{,\s])(\w+):'/g),
    BASS_SAMPLED:  keysOf('var BASS_SAMPLED = {', /\n (\w+):\s*\{lib:/g),
    window: {}, location: { hostname: 'modriff.example' },
    console,
  };
  vm.createContext(sandbox);
  // _irealList is the library's; a test that wants charts defines it on T.sandbox.
  const T = vm.runInContext(src, sandbox);
  T.window = sandbox.window; T.location = sandbox.location; T.sandbox = sandbox;
  return T;
};
module.exports.html = html;

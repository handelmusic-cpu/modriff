/* Lifts the free/Pro table and the helpers that read it out of index.html and
   runs them in a sandbox, so the tests exercise the exact code the app ships.
   The tier is a variable the test flips: setTier('free'|'pro'). */
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
    between('const FREE_LIMITS = {', '// The entitlement is ASKED FOR') +
    between('function _freeList(key)', '// One message, so the ceiling') +
    fn('modAllows') + fn('_slCount') + fn('slCanAdd') + fn('devTierAvailable') +
    '\n;({ FREE_LIMITS, FREE_NUMBERS, EMBED_LIMITS, modAllows, freeAllowsKit, freeAllowsStyle,' +
    ' freeAllowsSteps, freeClampSteps, freeAllowsMeter, freeAllowsGroove, freeAllowsFxPatch,' +
    ' freeAllowsPad, freeAllowsMode, freeAllowsVoice, freeAllowsArpRate, slCanAdd, _slCount, devTierAvailable,' +
    ' setTier: function(t){ _modTier = t; } });';
  // The real voice lists, read out of the page: a hand-written stand-in let a
  // wrong id ("upright_real2" for upright2) pass a test about Pro bass voices.
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
  // modTier / _modTier the way the app has them: a var and a reader.
  vm.createContext(sandbox);
  vm.runInContext('var _modTier = "free"; function modTier(){ return _modTier; }', sandbox);
  const T = vm.runInContext(src, sandbox);
  T.window = sandbox.window; T.location = sandbox.location;
  return T;
};
module.exports.html = html;

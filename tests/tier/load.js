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
  const src =
    between('const FREE_LIMITS = {', '// The entitlement is ASKED FOR') +
    between('function _freeList(key)', '// One message, so the ceiling') +
    fn('modAllows') + fn('_slCount') + fn('slCanAdd') +
    '\n;({ FREE_LIMITS, FREE_NUMBERS, EMBED_LIMITS, modAllows, freeAllowsKit, freeAllowsStyle,' +
    ' freeAllowsSteps, freeClampSteps, freeAllowsMeter, freeAllowsGroove, freeAllowsFxPatch,' +
    ' freeAllowsPad, freeAllowsMode, freeAllowsVoice, freeAllowsArpRate, slCanAdd, _slCount,' +
    ' setTier: function(t){ _modTier = t; } });';
  const sandbox = {
    SAMPLED_WAVES: { pianoreal:1, vibes:1, rhodes_real:1 },
    BASS_SAMPLED:  { upright_real:1, upright_real2:1 },
    console,
  };
  // modTier / _modTier the way the app has them: a var and a reader.
  vm.createContext(sandbox);
  vm.runInContext('var _modTier = "free"; function modTier(){ return _modTier; }', sandbox);
  return vm.runInContext(src, sandbox);
};
module.exports.html = html;

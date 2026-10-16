// Writes params_gen.h: the DSP parameter indices and defaults from
// modsynth/params.js, so the C++ engine and the JS one cannot disagree about
// which slot is which.
'use strict';
const path = require('path'), fs = require('fs');
const MS = require(path.resolve((require.main === module && process.argv[2]) || path.join(__dirname, '..', '..', 'modsynth', 'params.js')));
const out = [];
out.push('// Generated from modsynth/params.js by gen-params.js. Do not edit.');
out.push('#pragma once');
out.push('namespace modsynth {');
out.push('constexpr int PARAM_COUNT = ' + MS.DSP_PARAMS.length + ';');
out.push('struct ParamInfo { const char* id; int index; float def; };');
out.push('static const ParamInfo PARAM_INFO[PARAM_COUNT] = {');
MS.DSP_PARAMS.forEach(p => {
  const d = Math.fround(MS.toNumber(p, p.def));
  out.push('  {"' + p.id + '", ' + p.dspIndex + ', ' + (Object.is(d, -0) ? '-0.0f' : d.toPrecision(9) + 'f') + '},');
});
out.push('};');
out.push('}  // namespace modsynth');
const text = out.join('\n') + '\n';
if (require.main === module) fs.writeFileSync(process.argv[3] || path.join(__dirname, 'params_gen.h'), text);
module.exports = text;

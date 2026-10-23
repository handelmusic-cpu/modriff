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
// The host-side parameters the effects rack reads (fx.* and master.*, bar the
// crusher, which lives in the worklet). Order is MS.HOST_PARAMS' order with the
// same filter, which the page applies too (modNativeHostIndex), so an index
// means the same parameter on both sides. kind: 0 float, 1 enum, 2 bool.
const HX = MS.HOST_PARAMS.filter(p => /^(fx|master)\./.test(p.id));
out.push('constexpr int HOST_FX_COUNT = ' + HX.length + ';');
out.push('struct HostFxInfo { const char* id; float def, min, max; int kind; };');
out.push('static const HostFxInfo HOST_FX[HOST_FX_COUNT] = {');
HX.forEach(p => {
  const kind = p.type === 'enum' ? 1 : p.type === 'bool' ? 2 : 0;
  const d = p.type === 'enum' ? p.defIndex : +MS.toNumber(p, p.def);
  out.push('  {"' + p.id + '", ' + Math.fround(d).toPrecision(9) + 'f, ' + Math.fround(p.min).toPrecision(9) + 'f, ' + Math.fround(p.max).toPrecision(9) + 'f, ' + kind + '},');
});
out.push('};');
// Delay division in beats, by enum index — the rack cannot look a string up.
const DB = MS.DIVS.map(d => d[2] * 4);
out.push('constexpr int DIV_COUNT = ' + DB.length + ';');
out.push('static const double DIV_BEATS[DIV_COUNT] = {' + DB.map(x => x.toPrecision(17)).join(', ') + '};');
out.push('}  // namespace modsynth');
const text = out.join('\n') + '\n';
if (require.main === module) fs.writeFileSync(process.argv[3] || path.join(__dirname, 'params_gen.h'), text);
module.exports = text;

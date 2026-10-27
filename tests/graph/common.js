// Shared by the graph tests.
'use strict';
const fs = require('fs');

// The audio a recorded program names, in the file native/modsynth/graphrender
// reads: [n, then per buffer id, sampleRate, nCh, len, ch0..., ch1...] as
// doubles. (The app sends the same audio to the host as typed arrays.)
function writeBuffers(file, bufs) {
  const out = [bufs.length];
  for (const b of bufs) {
    out.push(b.id, b.sampleRate, b.channels.length, b.channels[0].length);
    for (const ch of b.channels) for (let i = 0; i < ch.length; i++) out.push(ch[i]);
  }
  fs.writeFileSync(file, Buffer.from(Float64Array.from(out).buffer));
}

module.exports = { writeBuffers };

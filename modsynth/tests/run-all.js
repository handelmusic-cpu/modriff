/* Runs every suite in order: the cheap contract checks first so a schema slip
   is reported before spending a minute in a browser. */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['parameter contracts', 'params.test.js'],
  ['DSP core', 'dsp.test.js'],
  ['patch bank', 'patches.test.js'],
  ['browser end-to-end', 'browser.test.js'],
  ['single-file build', 'standalone.test.js'],
];

let failed = 0;
for (const [label, file] of SUITES) {
  process.stdout.write('\n\x1b[1m── ' + label + ' ─────────────────────────────\x1b[0m\n');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, file)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..'),
    });
    process.stdout.write(out.split('\n').filter(l => !/^  ok /.test(l)).join('\n').trim() + '\n');
  } catch (e) {
    failed++;
    process.stdout.write((e.stdout || '') + (e.stderr || ''));
    process.stdout.write('\x1b[31m  suite failed\x1b[0m\n');
  }
}
process.stdout.write(failed ? `\n\x1b[31m${failed} suite(s) failed\x1b[0m\n` : '\n\x1b[32mAll suites passed\x1b[0m\n');
process.exit(failed ? 1 : 0);

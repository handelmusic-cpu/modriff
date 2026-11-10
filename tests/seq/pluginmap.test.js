/* Every engine method the host declares must be in the page's plugin map (index.html, MODNAT.plugin = { ... call('name') }).
   The map is explicit: a method that Swift declares and the map leaves out is a method the page cannot see -- _nsSong.arm and .hold were declared in the host and used by the page and were
   never listed, so on a device an armed ending did not reach the engine and a Hold threw. This compares the two lists by name, no browser needed.

   Run: node tests/seq/pluginmap.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const swift = fs.readFileSync(path.join(root, 'ios/App/App/ModEngine/ModEngine.swift'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const declared = [...swift.matchAll(/CAPPluginMethod\(name: "(seq[A-Za-z]+)"/g)].map(m => m[1]);
const mapped = new Set([...html.matchAll(/call\('(seq[A-Za-z]+)'\)/g)].map(m => m[1]));
const missing = declared.filter(n => !mapped.has(n)), extra = [...mapped].filter(n => !declared.includes(n));
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
ok(declared.length > 25, declared.length + ' engine sequencer methods are declared in ModEngine.swift', declared.length);
ok(!missing.length, 'every one is in the page\'s plugin map', 'missing from the map: ' + missing.join(', '));
ok(!extra.length, 'and the map names none the host does not declare', 'not declared in Swift: ' + extra.join(', '));
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);

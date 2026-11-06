// Renders promo.html to one 1024 x 1024 PNG per in-app purchase, next to this file.
//   python3 -m http.server 8777 --bind 127.0.0.1        (from the repo root)
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//       --remote-debugging-port=9222 --user-data-dir=/tmp/promo-chrome about:blank &
//   node docs/app-store/promo/render.mjs
// No dependencies: Node's own WebSocket talking to Chrome's debugging port.
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const PRODUCTS = {
  'Handel.modRiff.sounds': 'sounds',
  'Handel.modRiff.sampler': 'sampler',
  'Handel.modRiff.synth': 'synth',
  'Handel.modRiff.groove': 'groove',
  'Handel.modRiff.theory': 'theory',
  'Handel.modRiff.practice': 'practice',
  'Handel.modRiff.studio': 'studio',
  'Handel.modRiff.fullstudio': 'fullstudio',
  'Handel.modRiff.fullstudio.from1': 'from1',
  'Handel.modRiff.fullstudio.from2': 'from2',
  'Handel.modRiff.fullstudio.from3plus': 'from3plus',
};

const page = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let n = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++n; pending.set(id, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
for (const [pid, key] of Object.entries(PRODUCTS)) {
  await send('Page.navigate', { url: `http://127.0.0.1:8777/docs/app-store/promo/promo.html?id=${key}` });
  // The template fills itself in from the query string; wait until it has, then for the fonts.
  for (let i = 0; i < 50 && !(await ev(`location.search === '?id=${key}' && !!(document.getElementById('h1') && document.getElementById('h1').innerHTML && document.querySelector('li'))`)); i++) await new Promise(r => setTimeout(r, 100));
  await ev('document.fonts.ready.then(() => true)');
  // Anything running past the bottom bar or off the sides is a layout bug, not a style choice.
  const fit = await ev(`(function(){var u=document.getElementById('ul').getBoundingClientRect(),b=document.getElementById('bar').getBoundingClientRect(),h=document.getElementById('h1');return JSON.stringify({listEnd:Math.round(u.bottom),barTop:Math.round(b.top),h1w:Math.round(h.getBoundingClientRect().width),h1box:864});})()`);
  const f = JSON.parse(fit);
  if (f.listEnd > f.barTop - 20 || f.h1w > f.h1box) console.error('LAYOUT PROBLEM', pid, fit);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1024, height: 1024, scale: 1 } });
  writeFileSync(`${OUT}/${pid}.png`, Buffer.from(shot.data, 'base64'));
  console.log(pid, fit);
}
ws.close();

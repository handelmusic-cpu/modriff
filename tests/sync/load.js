/* Lifts the sync engine out of index.html (between its two markers) and runs it
   in a sandbox, so the tests exercise the code the app ships. Also provides a
   fake CloudKit and a fake device (a key/value store plus an engine), which is
   everything the tests need: no network, no account, no phone. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const a = html.indexOf('// ── SYNC ENGINE ──');
const b = html.indexOf('// ── END SYNC ENGINE ──');
if (a < 0 || b < a) throw new Error('sync engine markers not found in index.html');
const E = vm.runInNewContext(html.slice(a, b) + '\n;({modSyncCreate, syncHash, syncRid, SYNC_META_KEY});', {});

// What the page passes in as its collections (index.html's SYNC_COLLECTIONS);
// the test reads that table out of the page too, so a change there is tested.
function pageCollections() {
  const m = /var SYNC_COLLECTIONS = (\[[\s\S]*?\n\]);\n/.exec(html);
  if (!m) throw new Error('SYNC_COLLECTIONS not found in index.html');
  return vm.runInNewContext('(' + m[1] + ')', {});
}

// A CloudKit that keeps records, a change log and a change token per device,
// and refuses a save whose base version is not the one on the server.
function fakeCloud() {
  const recs = new Map(); let seq = 0; const log = [];       // log: {seq, rid, deleted}
  const srv = {
    recs, log, failNext: 0, calls: 0,
    device() {
      let tok = 0;
      return {
        push(req) {
          srv.calls++;
          if (srv.failNext > 0) { srv.failNext--; return Promise.reject(new Error('network down')); }
          const saved = [], deleted = [], conflicts = [];
          req.records.forEach(r => {
            const ex = recs.get(r.rid);
            if (ex && ex.modified !== r.base && !req.force) { conflicts.push({ rid: r.rid, payload: ex.payload, modified: ex.modified }); return; }
            recs.set(r.rid, { payload: r.payload, modified: r.modified }); log.push({ seq: ++seq, rid: r.rid }); saved.push(r.rid);
          });
          req.deletes.forEach(rid => { if (recs.delete(rid)) log.push({ seq: ++seq, rid, deleted: true }); deleted.push(rid); });
          return Promise.resolve({ saved, deleted, conflicts });
        },
        pull() {
          srv.calls++;
          if (srv.failNext > 0) { srv.failNext--; return Promise.reject(new Error('network down')); }
          const changes = [], del = [], last = new Map();
          log.filter(l => l.seq > tok).forEach(l => last.set(l.rid, l));
          last.forEach((l, rid) => { if (l.deleted) del.push(rid); else if (recs.has(rid)) changes.push({ rid, payload: recs.get(rid).payload, modified: recs.get(rid).modified }); });
          tok = seq;
          return Promise.resolve({ changes, deleted: del });
        },
      };
    },
  };
  return srv;
}

// A device: its own storage, its own clock, an engine on both.
function device(cloud, clock, colls) {
  const kv = new Map();
  const store = { getItem: k => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => { kv.set(k, String(v)); } };
  const applied = [];
  const eng = E.modSyncCreate({ store, plugin: cloud.device(), collections: colls || pageCollections(), now: () => clock.t, onApplied: n => applied.push(n) });
  return {
    store, eng, applied,
    list(key) { return JSON.parse(store.getItem(key) || '[]'); },
    put(key, arr) { store.setItem(key, JSON.stringify(arr)); },
  };
}
module.exports = { E, pageCollections, fakeCloud, device };

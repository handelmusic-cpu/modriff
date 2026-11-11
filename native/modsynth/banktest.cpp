// The voice bank (voicebank.h) against the voices the page records fresh: for each case the page's own program for a hit
// (recorded at that hit's time, begun at frame 0 as the app sends it today) and the bank's patched program for the same
// hit (begun on the grid, a lead before the onset) are played through a GraphPool each and nulled. The patching is the
// engine's C++, the reference programs come from the page (window._nsBank), so what is held is both halves together.
//   banktest <cases.f64> [bass|arp|mel]
// With `bass`, each case also carries the note's length and the note it glides from (and the pitch is the MIDI note):
//   part, kit, lane, vel, accent, note, dur, from (-1 for none), onsetFrame, len, program.
// With `arp`, each case carries the note's length and the arp's dynamic level instead of the glide: part, kit, lane, vel, accent, note, dur, level, onsetFrame, len, program.
// With `mel` (the melody generator), each case carries the note's length, the note it slides from (-1: it does not) and the slide's time: part, kit, lane (0 plain, 1 slide), vel, accent,
//   note, dur, from, gtime, onsetFrame, len, program.
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles (voicebank.h) ; nCases, per case: part, kit, lane, vel, accent,
//   pitch, onsetFrame, len, the page's fresh program (times absolute, onset at onsetFrame / 48000 s)]
// After the cases, the choke cases (the closing hat shutting an open one): [nChoke, per case: part, kit, lane, vel, accent, pitch,
//   onsetFrame, chokeFrame, len, the page's fresh program, nInc, the page's own edit records for the choke it ran at chokeFrame
//   on that voice (six doubles each, times absolute)]. The engine side is the bank's patch plus ChokeGroup::cut; the reference
//   is the fresh program with the page's edits. Printed as "choke <index> <depth> <peak> <tail peak after 200 ms> <voices cut> <the same tail with no cut>".
// Prints per case: index, null depth in dB (999 = bit-identical), the loudest sample of the fresh render, the best depth
// within 2 frames of alignment and the offset that gave it, and "miss" for a hit the bank has no voice for.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
#include "arpplay.h"
#include "melplay.h"
#include "graphpool.h"
#include "voicebank.h"

static const double SR = 48000;

static bool render(modsynth::GraphPool &pool, long total, std::vector<float> &out) {
  const int B = modsynth::GraphPool::kBuses;
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  for (int i = 0; i < B; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); }
  out.clear(); out.reserve((size_t)total * 2);
  for (long done = 0; done < total;) {
    const int nf = (int)std::min<long>(128, total - done);
    for (int i = 0; i < B; i++) { std::fill(bl[i].begin(), bl[i].end(), 0.f); std::fill(br[i].begin(), br[i].end(), 0.f); }
    pool.render((uint64_t)done, nf, pl, pr);
    for (int i = 0; i < nf; i++) {
      float l = 0, r = 0;
      for (int q = 0; q < B; q++) { l += bl[q][i]; r += br[q][i]; }
      out.push_back(l); out.push_back(r);
    }
    done += nf;
  }
  return true;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: banktest cases.f64\n"); return 2; }
  const bool bass = argc > 2 && std::string(argv[2]) == "bass";
  const bool arp = argc > 2 && std::string(argv[2]) == "arp";
  const bool mel = argc > 2 && std::string(argv[2]) == "mel";
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  struct Buf { int id, nch, len; double sr; std::vector<float> c[2]; };
  std::vector<Buf> bufs;
  const int nb = (int)d[k++];
  for (int i = 0; i < nb; i++) {
    Buf b; b.id = (int)d[k++]; b.sr = d[k++]; b.nch = (int)d[k++]; b.len = (int)d[k++];
    for (int c = 0; c < b.nch; c++) { b.c[c].resize((size_t)b.len); for (int j = 0; j < b.len; j++) b.c[c][(size_t)j] = (float)d[k++]; }
    bufs.push_back(std::move(b));
  }
  modsynth::DrumBank bank;
  const int ne = (int)d[k++];
  for (int i = 0; i < ne; i++) {
    const size_t len = (size_t)d[k++];
    if (!bank.put(d.data() + k, len)) { fprintf(stderr, "entry %d refused\n", i); return 2; }
    k += len;
  }
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const int part = (int)d[k++], kit = (int)d[k++], lane = (int)d[k++];
    const double vel = d[k++]; const bool acc = d[k++] != 0; const double pitch = d[k++];
    const double durSec = (bass || arp || mel) ? d[k++] : -1, second = (bass || arp || mel) ? d[k++] : -1;   // the bass's and melody's glide source, the arp's level
    const double gtime = mel ? d[k++] : 0;
    const double fromMidi = (bass || mel) ? second : -1, level = arp ? second : 1, pan = arp ? (lane == 1 ? 0.75 : -0.75) : 0;
    // The arp's block is several tones struck 12 ms (576 frames) apart; a note is one.
    std::vector<double> tones; if (arp) { const int nt = (int)d[k++]; for (int t = 0; t < nt; t++) tones.push_back(d[k++]); }
    const long onset = (long)d[k++];
    const size_t len = (size_t)d[k++];
    std::vector<double> fresh(d.begin() + k, d.begin() + k + len); k += len;
    // The arp's lane is chosen by its length as the player does: the case says 0 left, 1 right, 2 block.
    const modsynth::BankEntry *e = arp ? modsynth::ArpPlayer::pick(bank, kit, lane == 2, durSec) : (mel ? modsynth::MelPlayer::pick(bank, kit, lane == 1, durSec, (int)pitch) : bank.find(part, kit, lane));
    if (!e) { printf("%d miss 0 0 0 0\n", c); continue; }
    modsynth::PatchedVoice pv;
    bank.patch(*e, vel, acc, pitch, onset, SR, 0, pv, durSec, fromMidi, level, pan, gtime);
    const long total = onset + (long)(1.5 * SR) + (long)tones.size() * 576;
    modsynth::GraphPool a, b;
    for (auto &bf : bufs) for (auto *p : {&a, &b}) p->buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
    const int ha = a.begin(fresh.data(), fresh.size(), 0.0, 0);
    if (ha < 0) { printf("%d refused-fresh(%d) 0 0 0 0\n", c, ha); continue; }
    int hb = b.begin(pv.prog.data(), pv.prog.size(), pv.timeBase, pv.startFrame);
    for (size_t t = 1; hb >= 0 && t < tones.size(); t++) {
      modsynth::PatchedVoice pt;
      bank.patch(*e, vel, acc, tones[t], onset + (long)t * 576, SR, 0, pt, durSec, fromMidi, level, pan);
      hb = b.begin(pt.prog.data(), pt.prog.size(), pt.timeBase, pt.startFrame);
    }
    if (hb < 0) { printf("%d refused-patched(%d) 0 0 0 0\n", c, hb); continue; }
    std::vector<float> ra, rb;
    render(a, total, ra); render(b, total, rb);
    auto depthAt = [&](long extra, double &pa) {
      double se = 0, sa = 0; pa = 0;
      for (long i = onset * 2; i < (long)ra.size(); i++) {
        const long j = i + extra * 2;
        if (j < 0 || j >= (long)rb.size()) continue;
        const double df = (double)ra[i] - (double)rb[j];
        se += df * df; sa += (double)ra[i] * ra[i];
        pa = std::max(pa, (double)std::fabs(ra[i]));
      }
      if (se == 0) return 999.0;
      if (sa == 0) return -999.0;
      return -20.0 * std::log10(std::sqrt(se / sa));
    };
    double pa, pa2;
    const double depth = depthAt(0, pa);
    double best = depth; long bestOff = 0;
    for (long o = -2; o <= 2; o++) { if (!o) continue; const double dd = depthAt(o, pa2); if (dd > best) { best = dd; bestOff = o; } }
    printf("%d %.2f %.6f %.2f %ld\n", c, depth, pa, best, bestOff);
  }
  if (k >= d.size()) return 0;
  const int ncc = (int)d[k++];
  for (int c = 0; c < ncc; c++) {
    const int part = (int)d[k++], kit = (int)d[k++], lane = (int)d[k++];
    const double vel = d[k++]; const bool acc = d[k++] != 0; const double pitch = d[k++];
    const long onset = (long)d[k++], chokeAt = (long)d[k++];
    const size_t len = (size_t)d[k++];
    std::vector<double> fresh(d.begin() + k, d.begin() + k + len); k += len;
    const size_t ninc = (size_t)d[k++];
    std::vector<double> inc(d.begin() + k, d.begin() + k + ninc); k += ninc;
    const modsynth::BankEntry *e = bank.find(part, kit, lane);
    if (!e) { printf("choke %d miss 0 0 0\n", c); continue; }
    modsynth::PatchedVoice pv;
    bank.patch(*e, vel, acc, pitch, onset, SR, 0, pv);
    const long total = chokeAt + (long)(1.0 * SR);
    modsynth::GraphPool a, b;
    for (auto &bf : bufs) for (auto *p : {&a, &b}) p->buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
    const int ha = a.begin(fresh.data(), fresh.size(), 0.0, 0);
    const int hb = b.begin(pv.prog.data(), pv.prog.size(), pv.timeBase, pv.startFrame);
    if (ha < 0 || hb < 0) { printf("choke %d refused 0 0 0\n", c); continue; }
    if (ninc && !a.edit(ha, inc.data(), ninc)) { printf("choke %d refused-edit 0 0 0\n", c); continue; }
    modsynth::ChokeGroup grp;
    grp.add(hb, pv.startFrame, onset, *e, SR);
    int sent = 0;
    // the closing hat's own onset is the choke: its voice is not in the group yet, as in the host
    sent = grp.cut(chokeAt, SR, [&](int h, const double *o, size_t n) { return b.edit(h, o, n); });
    // The same voice left alone, to say how much the cut took away.
    modsynth::GraphPool u;
    for (auto &bf : bufs) u.buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
    u.begin(pv.prog.data(), pv.prog.size(), pv.timeBase, pv.startFrame);
    std::vector<float> ra, rb, ru;
    render(a, total, ra); render(b, total, rb); render(u, total, ru);
    double uncut = 0;
    for (long i = (chokeAt + (long)(0.2 * SR)) * 2; i < (long)ru.size(); i++) uncut = std::max(uncut, (double)std::fabs(ru[i]));
    double se = 0, sa = 0, pk = 0, tailPeak = 0;
    for (long i = onset * 2; i < (long)ra.size() && i < (long)rb.size(); i++) {
      const double df = (double)ra[i] - (double)rb[i];
      se += df * df; sa += (double)ra[i] * ra[i]; pk = std::max(pk, (double)std::fabs(ra[i]));
      if (i >= (chokeAt + (long)(0.2 * SR)) * 2) tailPeak = std::max(tailPeak, (double)std::fabs(ra[i]));
    }
    const double depth = se == 0 ? 999.0 : (sa == 0 ? -999.0 : -20.0 * std::log10(std::sqrt(se / sa)));
    printf("choke %d %.2f %.6f %.6f %d %.6f\n", c, depth, pk, tailPeak, sent, uncut);
  }
  return 0;
}

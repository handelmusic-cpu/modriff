// The production players' Processor messages against msxVoice in the real page.
#include <cstdio>
#include <cstring>
#include <set>
#include <vector>
#include "bassplay.h"
#include "arpplay.h"
#include "melplay.h"
#include "chordplay.h"
int main(int argc, char **argv) {
  if (argc == 2 && std::strcmp(argv[1], "--self-test") == 0) {
    modsynth::SynthLane lane; int messages = 0, stopped = 0; std::set<double> ids;
    lane.send = [&](const modsynth::SynthEvent &e) {
      if (e.kind == modsynth::SynthEvent::StopChoke) {
        messages++; stopped += e.count;
        if (e.count > 64) return false;
        for (int i = 0; i < e.count; i++) ids.insert(e.group[2*i+1]);
      }
      return true;
    };
    for (int i = 0; i < 600; i++) lane.play(60, i * 48, 60, 0);
    const double next = lane.nextId;
    lane.stop(0, true); lane.reset();
    const bool batched = messages == 8 && stopped == 512 && ids.size() == 512 && lane.held.empty() && lane.nextId == next;
    printf("%s 600 scheduled notes: Stop packs 512 retained IDs into %d messages; restart IDs do not rewind\n", batched ? "ok  " : "FAIL", messages);
    modsynth::DrumBank bank;
    const double chord[] = {2,3,7,-1,1}, truncated[] = {2,2,7,-1};
    bool valid = !bank.put(chord,5) && !bank.put(truncated,4);
    for (int p : {2,5,6}) { const double d[] = {2,(double)p,7,-1,1}; valid = bank.put(d,5) && valid; }
    printf("%s descriptor validation accepts three supported parts and refuses an incomplete entry or chord sub omission\n", valid ? "ok  " : "FAIL");
    return batched && valid ? 0 : 1;
  }
  if (argc != 2) return 2;
  FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
  std::vector<double> d; double x; while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x); fclose(f);
  size_t k = 0; const int cases = (int)d[k++];
  for (int c = 0; c < cases; c++) {
    const int part = (int)d[k++], count = (int)d[k++];
    modsynth::DrumBank bank; std::vector<double> entry = {2, (double)part, 7, -1, 1};
    if (part == 3) entry.push_back(0.025);
    if (!bank.put(entry.data(), entry.size())) return 2;
    modsynth::BassPlayer bass; modsynth::ArpPlayer arp; modsynth::MelPlayer mel; modsynth::ChordPlayer chord;
    bass.bank = arp.bank = mel.bank = chord.bank = &bank; bass.kit = arp.kit = mel.kit = chord.kit = 7;
    chord.begin = [](const double *,size_t,double,uint64_t){return 1;};
    auto send = [](const modsynth::SynthEvent &e) {
      if (e.kind == modsynth::SynthEvent::StopChoke || e.kind == modsynth::SynthEvent::StopRelease) {
        for (int i = 0; i < e.count; i++) printf("%c %.17g %.17g %.17g 0\n", e.kind == modsynth::SynthEvent::StopChoke ? 'C' : 'R', e.frame, e.group[2*i+1], e.group[2*i]);
      } else if (e.kind == modsynth::SynthEvent::Note) {
        printf("N %.17g %.17g %.17g %.17g\n", e.frame, e.id, e.note, e.vel);
        printf("R %.17g %.17g %.17g 0\n", e.end, e.id, e.note);
      } else printf("%c %.17g %.17g %.17g 0\n", e.kind == modsynth::SynthEvent::Release ? 'R' : 'C', e.frame, e.id, e.note);
      return true;
    };
    bass.synth.send = arp.synth.send = mel.synth.send = chord.synth.send = send;
    printf("CASE %d\n", c);
    for (int i = 0; i < count; i++) {
      const double at = d[k++], midi = d[k++], dur = d[k++], vel = d[k++];
      const bool accent = d[k++] != 0, slide = d[k++] != 0; const double source = d[k++]; const int from = (int)source;
      const int nn = (int)d[k++]; std::vector<int> tones; for (int j = 0; j < nn; j++) tones.push_back((int)d[k++]);
      if (part == 2) {
        modsynth::BassEvent e; e.frameExact = at; e.frame = (int64_t)std::llround(at); e.midi = (int)midi; e.durFrames = dur; e.vel = vel; e.accent = accent; e.slide = slide; e.from = from;
        bass.play(e, 0);
      } else if (part == 5) {
        modsynth::ArpEvent e; e.frameExact = at; e.frame = (int64_t)std::llround(at); e.midi = (int)midi; e.durSec = dur / 48000; e.vel = vel; e.level = 0.55; e.pan = -0.75; e.notes = tones;
        arp.play(e, 0);
      } else if (part == 3) {
        modsynth::ChordEvent e; e.notes = tones; e.subNote = (int)midi; e.vel = vel; e.durSec = dur / 48000; e.onsetExact = at;
        e.hold = slide; e.holdSec = source; e.settings.sub = false; e.settings.strum = accent; e.settings.spread = 0.12;
        chord.play(e, 0);
      } else {
        modsynth::MelEvent e; e.frameExact = at; e.frame = (int64_t)std::llround(at); e.midi = (int)midi; e.durFrames = dur; e.vel = vel; e.accent = accent; e.glideFrom = from; e.glideFrames = 0.08 * 48000;
        mel.play(e, 0);
      }
    }
  }
}

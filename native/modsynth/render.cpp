// Replays a worklet message script into the C++ engine and writes the audio.
// One command per line, as tests/modsynth/null.test.js records them:
//   p <i> <v> | on <note> <vel> <id> <at> | off <note> <id> <at> | choke <note> <id> <at>
//   matrix <n> (<s> <d> <a> <u> <v>)×n | motion <lane> <n> <v>×n | macro <i> <v>
//   mw|bend|at <v> | cc <n> <v> | sustain <0|1> | tempo <bpm> <beat> | cap <uni> <poly>
//   panic | allOff | render <blocks>
// An id or at of "-" is absent (undefined), "null" is null. Output: per block,
// 128 float32 of L then 128 of R, little-endian, to stdout.
#include "modsynth.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
using namespace modsynth;
static NoteId parseId(const std::string& t) {
  if (t == "-") return NoteId();
  if (t == "null") return NoteId::nul();
  return NoteId::num(strtod(t.c_str(), nullptr));
}
int main(int argc, char** argv) {
  double sr = argc > 1 ? atof(argv[1]) : 48000;
  Processor P(sr);
  std::string line; std::vector<float> L(128), R(128);
  while (std::getline(std::cin, line)) {
    std::istringstream in(line); std::string c; in >> c;
    if (c == "p") { int i; std::string v; in >> i >> v; P.setParam(i, strtod(v.c_str(), nullptr)); }
    else if (c == "on" || c == "off" || c == "choke") {
      std::string note, vel, id, at; in >> note;
      if (c == "on") in >> vel; in >> id >> at;
      bool hasAt = at != "-" && at != "null";
      double atv = hasAt ? strtod(at.c_str(), nullptr) : 0, n = strtod(note.c_str(), nullptr);
      if (c == "on") P.noteOnMsg(n, strtod(vel.c_str(), nullptr), parseId(id), hasAt, atv);
      else if (c == "off") P.noteOffMsg(n, parseId(id), hasAt, atv);
      else P.chokeMsg(n, parseId(id), hasAt, atv);
    }
    else if (c == "matrix") { int n; in >> n; std::vector<MatrixRow> rows(n);
      for (auto& r : rows) { std::string a, b, cc, d, e; in >> a >> b >> cc >> d >> e;
        r.s = strtod(a.c_str(), 0); r.d = strtod(b.c_str(), 0); r.a = strtod(cc.c_str(), 0); r.u = strtod(d.c_str(), 0); r.v = strtod(e.c_str(), 0); }
      P.setMatrix(rows); }
    else if (c == "motion") { int lane, n; in >> lane >> n; std::vector<float> v(n); for (auto& x : v) { std::string t; in >> t; x = (float)strtod(t.c_str(), 0); } P.setMotion(lane, v.data(), n); }
    else if (c == "macro") { int i; std::string v; in >> i >> v; P.setMacro(i, strtod(v.c_str(), 0)); }
    else if (c == "mw" || c == "bend" || c == "at") { std::string v; in >> v; double x = strtod(v.c_str(), 0); if (c == "mw") P.setMw(x); else if (c == "bend") P.setBend(x); else P.setAt(x); }
    else if (c == "cc") { int n; std::string v; in >> n >> v; P.setCC(n, strtod(v.c_str(), 0)); }
    else if (c == "sustain") { int v; in >> v; P.setSustain(v != 0); }
    else if (c == "tempo") { std::string b, bt; in >> b >> bt; P.setTempo(strtod(b.c_str(), 0), bt != "-", strtod(bt.c_str(), 0)); }
    else if (c == "cap") { std::string u, p; in >> u >> p; P.setCap(strtod(u.c_str(), 0), strtod(p.c_str(), 0)); }
    else if (c == "panic") P.panic();
    else if (c == "allOff") P.allNotesOff();
    else if (c == "render") { int n; in >> n; for (int b = 0; b < n; b++) { P.process(L.data(), R.data(), 128); fwrite(L.data(), 4, 128, stdout); fwrite(R.data(), 4, 128, stdout); } }
  }
  return 0;
}

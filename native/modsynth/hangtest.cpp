// A note released before it has begun must never begin. The page sends each
// note's on and off together, the on a little ahead; Stop (or the next chord's
// choke) can land in between. Before the fix the queued on played anyway, with
// its scheduled off already thrown away, and rang until something else stopped it.
#include "modsynth.h"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace modsynth;
// Peak over the last second of a 3 s render, after the scenario's messages.
static double lastPeak(void (*scenario)(Processor&)) {
  Processor P(48000); scenario(P);
  std::vector<float> L(128), R(128); double pk = 0;
  for (int b = 0; b < 1125; b++) { P.process(L.data(), R.data(), 128); if (b > 750) for (float x : L) pk = std::max(pk, (double)std::fabs(x)); }
  return pk;
}
int main() {
  int fails = 0;
  auto check = [&](const char* what, double pk, bool wantSilent) {
    const bool ok = wantSilent ? pk < 1e-4 : pk > 1e-3;
    printf("  %s: %s (last-second peak %.5f)\n", ok ? "ok  " : "FAIL", what, pk); if (!ok) fails++; };
  // on 100 ms ahead, then the release arrives immediately (Stop)
  check("released before it began, release immediate", lastPeak([](Processor& P) {
    P.noteOnMsg(60, 0.8, NoteId::num(1), true, 4800); P.noteOffMsg(60, NoteId::num(1), false, 0); }), true);
  // the same, with the release scheduled earlier than the on
  check("released before it began, release scheduled earlier", lastPeak([](Processor& P) {
    P.noteOnMsg(60, 0.8, NoteId::num(2), true, 9600); P.noteOffMsg(60, NoteId::num(2), true, 4800); }), true);
  // choked before it began
  check("choked before it began", lastPeak([](Processor& P) {
    P.noteOnMsg(60, 0.8, NoteId::num(3), true, 4800); P.chokeMsg(60, NoteId::num(3), false, 0); }), true);
  // an ordinary note: on ahead, off after it — must sound, then end
  check("ordinary note ends after its off", lastPeak([](Processor& P) {
    P.noteOnMsg(60, 0.8, NoteId::num(4), true, 4800); P.noteOffMsg(60, NoteId::num(4), true, 24000); }), true);
  // a note being released later than it begins is still heard (peak over the whole render, not the last second)
  { Processor P(48000); P.noteOnMsg(60, 0.8, NoteId::num(5), true, 4800); P.noteOffMsg(60, NoteId::num(5), true, 24000);
    std::vector<float> L(128), R(128); double pk = 0;
    for (int b = 0; b < 300; b++) { P.process(L.data(), R.data(), 128); for (float x : L) pk = std::max(pk, (double)std::fabs(x)); }
    check("ordinary note is heard while it lasts", pk, false); }
  // another note's id is untouched
  check("a different id keeps playing (sanity: the held note must NOT be silent)", lastPeak([](Processor& P) {
    P.noteOnMsg(60, 0.8, NoteId::num(6), true, 4800); P.noteOffMsg(62, NoteId::num(7), false, 0); }), false);
  printf("%s\n", fails ? "FAILED" : "all passed");
  return fails ? 1 : 0;
}

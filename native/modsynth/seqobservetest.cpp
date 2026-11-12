#include "seqobserve.h"
#include <cstdio>
int main() {
  modsynth::SeqObserver ring; uint64_t next=0,lost=0;
  ring.note(2,60,85,48000.25,52800.5); ring.note(6,64,70,48000.75,60000); ring.cut(2,50000);
  auto a=ring.read(0,2,next,lost); const uint64_t cursor=next;
  bool ok=a.size()==14 && a[5]==48000.25 && a[6]==52800.5 && a[7]==2 && next==2 && lost==0;
  auto again=ring.read(0,2,next,lost); ok=ok && a==again;
  auto b=ring.read(cursor,100,next,lost); ok=ok && b.size()==7 && b[0]==3 && b[1]==2 && b[2]==2 && next==3;
  for(size_t i=0;i<modsynth::SeqObserver::kCapacity+9;i++) ring.note(5,67,90,i,i+100);
  auto c=ring.read(3,modsynth::SeqObserver::kCapacity,next,lost);
  ok=ok && lost==9 && c.size()==modsynth::SeqObserver::kCapacity*7 && next==ring.cursor();
  auto d=ring.read(next,100,next,lost); ok=ok && d.empty() && lost==0;
  printf("%s retained fractional-frame notes, paged retry, cuts, exact overflow count and empty tail\n",ok?"ok  ":"FAIL");
  return ok?0:1;
}

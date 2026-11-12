// Bar revisions exercise the production song core and retained lock tables.
#include "songcore.h"
#include <cstdio>
static int failed=0;
#define CHECK(c,label) do{printf("%s %s\n",(c)?"ok  ":"FAIL",label);if(!(c))failed++;}while(0)
int main(){
  using namespace modsynth; TempoMap tm(48000,120);
  auto score=[](int root,int bars=1){ SongScore s;s.clocked=false;SongSlot c;c.rootM=root;c.bars=bars;c.ivs={0,4,7};SongSection sec;sec.slots={c};s.sections={sec};return s;};
  auto chorus=[](const ChorusEvent&){};auto ending=[](const EndingEvent&){};
  {
    SongSequencer q;q.setTempoMap(&tm);q.setScore(score(60,4));q.start(0,0,0,3);
    std::vector<SongChord> notes;auto emit=[&](const SongChord&c){notes.push_back(c);};q.run(96000,false,emit);
    auto revised=score(65,2);const int result=q.reviseAt(revised,96000,chorus,ending);q.run(96001,false,emit);
    CHECK(result==1 && notes.size()==2 && notes[0].w.rootPc==0 && notes[1].w.rootPc==5 && notes[1].w.t==96000 && notes[1].pass==3,"mid-slot edit begins the revised slot at the bar and retains the pass");
  }
  {
    auto old=score(60);old.sections[0].slots.push_back(old.sections[0].slots[0]);old.sections[0].slots[1].rootM=65;
    auto revised=old;revised.sections[0].slots[0].rootM=72;revised.sections[0].slots[1].rootM=77;
    SongSequencer q;q.setTempoMap(&tm);q.setScore(old);q.start(0,0,0);std::vector<SongChord> out;auto emit=[&](const SongChord&c){out.push_back(c);};q.run(96000,false,emit);
    q.reviseAt(revised,96000,chorus,ending);q.run(96001,false,emit);
    CHECK(out.size()==2 && out[1].slot==1 && out[1].s.rootM==77,"natural boundary advances the old position before applying edited notes");
  }
  {
    auto old=score(60);old.sections.push_back(old.sections[0]);auto revised=old;revised.sections[1].slots[0].rootM=69;
    SongSequencer q;q.setTempoMap(&tm);q.setScore(old);q.start(0,0,0,2);q.run(1,false,[](const SongChord&){});q.queueMove(1);
    q.reviseAt(revised,96000,chorus,ending);std::vector<SongChord> out;q.run(96001,false,[&](const SongChord&c){out.push_back(c);});
    CHECK(out.size()==1 && out[0].section==1 && out[0].s.rootM==69 && q.queuedMove()==0,"queued Next survives and applies once at the edited boundary");
  }
  {
    SongSequencer q;q.setTempoMap(&tm);q.setScore(score(60));q.start(0,0,0);q.run(1,false,[](const SongChord&){});q.arm(kEndCold);int ends=0;
    int r=q.reviseAt(score(65),96000,chorus,[&](const EndingEvent&){ends++;});int extra=q.run(96001,false,[](const SongChord&){});
    CHECK(r==0 && ends==1 && !q.running() && extra==0,"an armed ending wins at the same bar without an edited extra chord");
  }
  {
    auto old=score(60);old.sections[0].plays=1;old.trainer.keyOn=true;old.trainer.keyEvery=1;old.trainer.keyBy=7;
    SongSequencer q;q.setTempoMap(&tm);q.setScore(old);q.start(0,0,0);q.run(1,false,[](const SongChord&){});int choruses=0;
    q.reviseAt(score(65),96000,[&](const ChorusEvent&){choruses++;},ending);SongChord last;q.run(96001,false,[&](const SongChord&c){last=c;});
    CHECK(choruses==1 && q.keyShift()==-5 && last.capo==-5 && last.w.rootPc==0,"practice key state and the boundary chorus survive a chart edit");
  }
  {
    ChordTimeline t;PhraseLock a,b;a.rootPc=0;b.rootPc=5;MelLock ma,mb;ma.rootPc=0;mb.rootPc=5;
    t.setLocks({a});t.setMelLocks({ma});ChordWindow w;w.t=0;w.end=96000;w.lock=w.melLock=0;t.push(w);
    auto base=t.reviseLocks({b},{mb});w.t=96000;w.end=192000;w.lock=base.first;w.melLock=base.second;t.push(w);
    const auto *before=t.windowFor(95900),*after=t.windowFor(96100);
    CHECK(before && after && t.lockFor(*before)->rootPc==0 && t.lockFor(*after)->rootPc==5 && t.melLockFor(*before)->rootPc==0 && t.melLockFor(*after)->rootPc==5,"old and new bass/melody locks remain distinct across humanized boundary notes");
    bool bounded=true;for(int i=0;i<1000;i++){base=t.reviseLocks({b},{mb});bounded=bounded && base.first<=64 && base.second<=64;}
    CHECK(bounded,"repeated revisions compact retained phrase locks");
  }
  return failed?1:0;
}

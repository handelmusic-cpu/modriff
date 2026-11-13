// Small repeating event lanes share the band's tempo map and graph bank. Their
// next event lives here, so click and pads never depend on a foreground timer.
#pragma once
#include <map>
#include <functional>
#include <set>
#include "voicebank.h"
#include "tempomap.h"

namespace modsynth {
struct ExtraVoice {
  int key=0, group=0, midi=-1;
  double duration=0;
  BankEntry bank;
  std::vector<double> release;
};
struct ExtraEvent { double beat=0; int key=0; bool on=true; int id=0,skip=-1; };
struct ExtraScore {
  double beats=4;
  int pattern=0;
  std::map<int,ExtraVoice> voices;
  std::vector<ExtraEvent> events;
  bool read(const double *d,size_t n,size_t &k,bool extended=false) {
    auto take=[&](double &v){if(k>=n||!std::isfinite(d[k]))return false;v=d[k++];return true;};
    auto count=[&](int &v,int max){double x;if(!take(x)||x<0||x>max||x!=std::floor(x))return false;v=(int)x;return true;};
    if(!take(beats)||beats<=0||beats>1024||!count(pattern,1000000))return false;
    int nv;if(!count(nv,256))return false;
    while(nv--) {
      ExtraVoice v;int midi,nb,nr;
      if(!count(v.key,1000000)||!count(v.group,256)||!count(midi,128)||!take(v.duration)||v.duration<0||!count(nb,1000000)||k+(size_t)nb>n)return false;
      v.midi=midi-1;
      if(!v.bank.fromDoubles(d+k,nb))return false;k+=nb;
      if(!count(nr,100000)||nr%6||k+(size_t)nr>n)return false;
      v.release.assign(d+k,d+k+nr);k+=nr;voices[v.key]=std::move(v);
    }
    int ne;if(!count(ne,4096))return false;
    while(ne--) { ExtraEvent e;int on;
      if(!take(e.beat)||e.beat<0||e.beat>=beats||!count(e.key,1000000)||!count(on,1)||!count(e.id,1000000)||!voices.count(e.key))return false;
      if(extended){double skip;if(!take(skip)||skip<-1||skip>1000000000||skip!=std::floor(skip))return false;e.skip=(int)skip;}
      e.on=on!=0;events.push_back(e);
    }
    std::stable_sort(events.begin(),events.end(),[](const ExtraEvent&a,const ExtraEvent&b){return a.beat<b.beat;});return true;
  }
};
class ExtraSequencer {
 public:
  double sr=48000;
  const TempoMap *tempo=nullptr;
  std::function<int(const double*,size_t,double,uint64_t)> begin;
  std::function<bool(int,const double*,size_t)> edit;
  std::function<void(int,int,double,double)> note;
  std::function<void(int,double)> cutNote;
  uint64_t hits=0,misses=0,cuts=0,loops=0;
  int pattern=0;
  std::vector<int> erased;
  bool running=false;
  ExtraScore score;
  void set(ExtraScore s,ExtraScore next,bool haveNext,double now) {
    // Keep the committed prefix. Edits replace only events beyond the horizon;
    // queued pad patterns are adopted by this clock at the loop boundary.
    if(running && score.pattern==s.pattern) {
      score=std::move(s);index=0;
      while(index<score.events.size() && time(score.events[index])<committed+1e-6)index++;
    } else if(running) { pending=std::move(s);queued=true; }
    else {score=std::move(s);pattern=score.pattern;}
    if(haveNext){pending=std::move(next);queued=true;}
    else if(!running || score.pattern==s.pattern)queued=false;
    (void)now;
  }
  void start(double first) { if(running)return;running=true;originBeat=tempo->beatAt(first);index=0;committed=first;loops=0;pattern=score.pattern; }
  void stop(double at) {for(auto &p:active)release(p.second,at);active.clear();running=false;queued=false;held.clear();}
  double originFrame()const{return tempo?tempo->frameAt(originBeat):0;}
  double nextFrame()const{return tempo?tempo->frameAt(originBeat+std::ceil(std::max(0.,tempo->beatAt(committed)-originBeat)*4.)/4.):0;}
  int step()const{return tempo?(int)std::ceil(std::max(0.,tempo->beatAt(committed)-originBeat)*4.):0;}
  void hold(int key,bool on){if(on)held[key]=score.pattern;else held.erase(key);}
  void touchRelease(int key,double at) {
    int group=score.voices.count(key)?score.voices.at(key).group:0;
    releaseKey(key,at);
    if(group){for(auto i=active.begin();i!=active.end();){if(i->second.group==group){release(i->second,at);i=active.erase(i);}else ++i;}}
  }
  void releaseKey(int key,double at){auto i=active.find(key);if(i!=active.end()){release(i->second,at);active.erase(i);}}
  void run(double horizon,double now) {
    int guard=0;
    while(running&&guard++<8192) {
      const double end=tempo->frameAt(originBeat+score.beats);
      if(index>=score.events.size()) {
        if(end>=horizon)break;
        originBeat+=score.beats;index=0;loops++;
        if(queued){score=std::move(pending);pattern=score.pattern;queued=false;}
        continue;
      }
      const auto e=score.events[index];const double at=time(e);
      if(at>=horizon)break;index++;
      const auto i=score.voices.find(e.key);if(i==score.voices.end()){misses++;continue;}
      const ExtraVoice &v=i->second;
      if(e.on&&held.count(e.key)&&held[e.key]==score.pattern) {
        erased.push_back(e.id);if(erased.size()>4096)erased.erase(erased.begin());
        // Erasure persists for later loops, even before the UI has polled.
        score.events.erase(score.events.begin()+(long)--index);continue;
      }
      if(e.skip==(int)loops)continue;
      releaseKey(e.key,at);
      if(!e.on)continue;
      if(v.group)for(auto it=active.begin();it!=active.end();) {
        if(it->second.group==v.group){release(it->second,at);it=active.erase(it);}else ++it;
      }
      PatchedVoice p;DrumBank bank;bank.patch(v.bank,1,false,0,(int64_t)std::llround(at),sr,(uint64_t)now,p);
      const int handle=begin?begin(p.prog.data(),p.prog.size(),p.timeBase,p.startFrame):-1;
      if(handle<0){misses++;continue;}hits++;
      const double endAt=v.duration>0?at+v.duration*sr:at+3600*sr;
      if(v.midi>=0&&note)note(e.key,v.midi,at,endAt);
      if(!v.release.empty())active[e.key]={handle,v.group,v.midi,(double)p.startFrame,endAt,v.release};
    }
    committed=horizon;
    for(auto i=active.begin();i!=active.end();)if(i->second.end<now)i=active.erase(i);else ++i;
  }
 private:
  struct Active {int handle,group,midi;double start,end;std::vector<double>ops;};
  std::map<int,Active>active;
  std::map<int,int>held;
  ExtraScore pending;bool queued=false;
  double originBeat=0,committed=0;
  size_t index=0;
  double time(const ExtraEvent&e)const{return tempo->frameAt(originBeat+e.beat);}
  void release(const Active &v,double at) {
    if(at>=v.end)return;
    auto ops=v.ops;for(size_t k=4;k<ops.size();k+=6)ops[k]+=(at-v.start-1e-6)/sr;
    if(edit&&edit(v.handle,ops.data(),ops.size()))cuts++;
    if(v.midi>=0&&cutNote)cutNote(v.midi,at);
  }
};
}

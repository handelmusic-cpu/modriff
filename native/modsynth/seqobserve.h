// Retained musical events, independent of diagnostic recording and mirror polls.
// Caller holds the sequencer lock. Sequence numbers never rewind on transport
// restart, so a delayed/retried reader cannot silently skip or duplicate notes.
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <vector>
namespace modsynth {
struct SeqObserved {
  uint64_t seq=0;
  int kind=0, part=0, note=0, vel=0;
  double frame=0, end=0;
};
class SeqObserver {
 public:
  static constexpr size_t kCapacity=32768;
  static constexpr int kWidth=7;
  uint64_t cursor() const { return next_-1; }
  uint64_t oldest() const { return next_>kCapacity ? next_-kCapacity : 1; }
  void note(int part,int note,int vel,double frame,double end) {
    append({0,1,part,std::clamp(note,0,127),std::clamp(vel,1,127),frame,end});
  }
  void cutNote(int part,int note,double frame) { append({0,3,part,note,0,frame,frame}); }
  void cut(int part,double frame) { append({0,2,part,0,0,frame,frame}); }
  std::vector<double> read(uint64_t after,size_t limit,uint64_t &cursor,uint64_t &lost) const {
    after=std::min(after,next_-1);
    const uint64_t first=oldest();
    lost=after+1<first ? first-after-1 : 0;
    cursor=std::min(after,next_-1);
    const uint64_t begin=std::max(after+1,first), end=std::min(next_,begin+std::min(limit,kCapacity));
    std::vector<double> out; out.reserve((end-begin)*kWidth);
    for(uint64_t i=begin;i<end;i++) {
      const auto &e=ring_[(i-1)%kCapacity];
      out.insert(out.end(),{(double)e.seq,(double)e.kind,(double)e.part,(double)e.note,(double)e.vel,e.frame,e.end}); cursor=i;
    }
    return out;
  }
 private:
  uint64_t next_=1;
  std::array<SeqObserved,kCapacity> ring_{};
  void append(SeqObserved e) { e.seq=next_++; ring_[(e.seq-1)%kCapacity]=e; }
};
}

#include "modsynth.h"
#include "fxrack.h"
#include <algorithm>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
struct Event { long frame; double note,vel; int id; bool on; };
int main(){
 using namespace modsynth;
 const double sr=48000;Processor p(sr);FxRack fx(sr);std::vector<Event> ev;
 for(int i=0;i<HOST_FX_COUNT;i++)fx.set(i,HOST_FX[i].def);
 std::string line;long total=0;
 while(std::getline(std::cin,line)){
  std::istringstream in(line);std::string cmd,key;double v;in>>cmd;
  if(cmd=="p"){in>>key>>v;for(int i=0;i<PARAM_COUNT;i++)if(key==PARAM_INFO[i].id)p.setParam(PARAM_INFO[i].index,v);}
  else if(cmd=="fx"){in>>key>>v;for(int i=0;i<HOST_FX_COUNT;i++)if(key==HOST_FX[i].id)fx.set(i,v);}
  else if(cmd=="tempo"){in>>v;p.setTempo(v,true,0);fx.setTempo(v);}
  else if(cmd=="matrix"){int n;in>>n;std::vector<MatrixRow> rows(n);for(auto&r:rows)in>>r.s>>r.d>>r.a>>r.u>>r.v;p.setMatrix(rows);}
  else if(cmd=="motion"){int lane,n;in>>lane>>n;std::vector<float> a(n);for(auto&x:a)in>>x;p.setMotion(lane,a.data(),n);}
  else if(cmd=="note"){long frame,dur;double note,vel;int id;in>>frame>>note>>vel>>dur>>id;ev.push_back({frame,note,vel,id,true});ev.push_back({frame+dur,note,0,id,false});}
  else if(cmd=="frames")in>>total;
 }
 std::stable_sort(ev.begin(),ev.end(),[](const Event&a,const Event&b){return a.frame<b.frame;});
 float l[128],r[128],interleaved[256];size_t next=0;
 for(long cursor=0;cursor<total;cursor+=128){
  while(next<ev.size()&&ev[next].frame<cursor+256){auto&e=ev[next++];if(e.on)p.noteOnMsg(e.note,e.vel,NoteId::num(e.id),true,e.frame);else p.noteOffMsg(e.note,NoteId::num(e.id),true,e.frame);}
  const int n=(int)std::min<long>(128,total-cursor);p.process(l,r,n);double mods[5];p.fxMods(mods);fx.setMods(mods);fx.process(l,r,n);
  for(int i=0;i<n;i++){interleaved[2*i]=l[i];interleaved[2*i+1]=r[i];}fwrite(interleaved,sizeof(float),n*2,stdout);
 }
}

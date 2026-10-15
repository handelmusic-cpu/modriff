#!/usr/bin/env python3
# Builds the recorded drum kits (4.9.9.1) — samples/rock2, studio, latin,
# hand, orch and samples/808/hitom.mp3 — from source recordings, and prints
# each lane's calibrated gain (the numbers in SQM's sqLayerTrack calls).
#
#   VCSL (CC0):  git clone --filter=blob:none https://github.com/sgossner/VCSL
#                then list every .wav into an index file, one path a line:
#                find VCSL -name '*.wav' > index.txt
#   TR-808:      npm pack @fluid-music/tr-808, untar; HT50.WAV is the hi tom
#
#   python3 -I build/drum-kits.py index.txt samples <path>/TR808WAV/HT/HT50.WAV [kit,kit…]
#
# With a kit list, only those kits are built (and the 808 is left alone), so
# adding a kit does not re-encode the ones already shipped.
#
# Needs ffmpeg and numpy. Every take is: mono, the kit's EQ/compression,
# lead-in trimmed to 1 ms before the attack, the tail cut where it falls 60 dB
# under the peak (or at the lane's cap, with a longer fade), peak-normalised
# to -1 dBFS, mp3 VBR q5. Normalising every take means a layer carries the
# stroke's timbre and the step's velocity carries its level — see
# sqLayerTrack. Gains are A-weighted loudness of each lane's hardest layer
# against the 4.2.2 Rock snare at its 0.75, offset by the usual kit balance
# (closed hat -6 dB, open hat 0, ride +2, crash +4, toms level), capped at
# 1.25 in SQM so a boomy lane cannot push the drum bus past about +1 dBFS.
import sys, os, re, json, subprocess, numpy as np, tempfile
IDX=[l.strip() for l in open(sys.argv[1])]
OUT=sys.argv[2]; HT808=sys.argv[3]
ONLY=set(sys.argv[4].split(',')) if len(sys.argv)>4 else None
SR=44100
def find(name):
    m=[p for p in IDX if os.path.basename(p)==name]
    if not m: raise SystemExit('missing '+name)
    return m[0]
def decode(path, filt):
    cmd=['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR)]
    if filt: cmd+=['-af',filt]
    cmd+=['-f','f32le','-']
    return np.frombuffer(subprocess.run(cmd,capture_output=True,check=True).stdout,dtype=np.float32).copy()
def shape(x, maxlen):
    pk=np.max(np.abs(x))
    on=int(np.argmax(np.abs(x)>pk*10**(-40/20))); on=max(0,on-int(.001*SR))
    x=x[on:]
    above=np.where(np.abs(x)>pk*10**(-60/20))[0]
    end=min(len(x), (above[-1] if len(above) else len(x))+int(.02*SR), int(maxlen*SR))
    x=x[:end].copy()
    fo=min(int(.03*SR) if end<int(maxlen*SR) else int(.08*SR), len(x)//2)
    if fo>0: x[-fo:]*=np.linspace(1,0,fo)**2
    fi=int(.001*SR); x[:fi]*=np.linspace(0,1,fi)
    return x/ (np.max(np.abs(x))+1e-9) * 10**(-1/20)
def encode(x, dst):
    os.makedirs(os.path.dirname(dst),exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.f32',delete=False) as t: t.write(x.astype(np.float32).tobytes()); tn=t.name
    subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i',tn,'-codec:a','libmp3lame','-q:a','5',dst],check=True)
    os.unlink(tn)
def aweight_db(x, seconds=.3):
    seg=x[:int(seconds*SR)]
    sp=np.abs(np.fft.rfft(seg,n=1<<15))**2; f=np.fft.rfftfreq(1<<15,1/SR)
    f2=f**2; ra=(12194**2*f2**2)/((f2+20.6**2)*np.sqrt((f2+107.7**2)*(f2+737.9**2))*(f2+12194**2)+1e-30)
    return 10*np.log10((sp*ra**2).sum()/len(seg)+1e-30)

T_HP='highpass=f=30'
T={
 'rk_kick':'highpass=f=30,equalizer=f=400:t=q:w=1:g=-5,equalizer=f=3500:t=q:w=1:g=4,acompressor=threshold=-18dB:ratio=3:attack=5:release=80',
 'rk_snare':'highpass=f=60,acompressor=threshold=-18dB:ratio=2.5:attack=3:release=100',
 'rk_tom':'highpass=f=40,acompressor=threshold=-18dB:ratio=2:attack=5:release=120',
 'hat':'highpass=f=300', 'cym':'highpass=f=180',
 'st_kick':'highpass=f=35,equalizer=f=350:t=q:w=1.2:g=-7,equalizer=f=60:t=q:w=1:g=3,equalizer=f=5000:t=q:w=1:g=5,acompressor=threshold=-20dB:ratio=4:attack=2:release=60',
 'st_snare':'highpass=f=80,equalizer=f=220:t=q:w=1:g=2,equalizer=f=6000:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=2:release=80',
 'st_tom':'highpass=f=50,equalizer=f=400:t=q:w=1:g=-3,acompressor=threshold=-20dB:ratio=3:attack=3:release=90',
 'nat':T_HP,
}
def rr(fmt, layers, takes=('rr1','rr2')):
    return [[fmt.format(v=v,r=r) for r in takes] for v in layers]
# kit -> lanes: (key, layers[[take,..],..], treatment, maxlen, rel_dB)  rel_dB: loudness vs the kit's reference (snare)
KITS={
 'rock2':[
  ('kick', rr('BDrumNew_hit_{v}_{r}_Sum.wav',['v2','v3','v5','v7']),'rk_kick',.7,'kick'),
  ('snare',rr('Snare2_HitSN_{v}_{r}_Mid.wav',['v3','v5','v7','v9']),'rk_snare',.9,0),
  ('hat',  rr('HiHat_HitC_{v}_{r}_Mid.wav',['v1','v2','v3','v4']),'hat',.35,-6),
  ('open', [['HiHat_HitO_rr1_Mid.wav','HiHat_HitO_rr2_Mid.wav']],'hat',1.4,0),
  ('tomhi',rr('TomH_HitS_{v}_{r}_Mid.wav',['v2','v3','v4']),'rk_tom',1.1,0),
  ('tomlo',rr('TomL_HitS_{v}_{r}_Mid.wav',['v2','v3','v4']),'rk_tom',1.3,0),
  ('crash',[['susCymb1_hit_mp1.wav'],['susCymb1_hit_f1.wav'],['susCymb1_hit_fff1.wav']],'cym',2.6,4),
  ('ride', [['susCymb1_hit_stick_pp1.wav'],['susCymb1_hit_stick_mp1.wav'],['susCymb1_hit_stick_f1.wav']],'cym',2.2,2),
 ],
 'studio':[
  ('kick', rr('BDrumNew_hit_{v}_{r}_Sum.wav',['v2','v3','v5','v7']),'st_kick',.35,'kick'),
  ('snare',rr('Snare4_HitSN_{v}_{r}_Mid.wav',['v2','v4','v5']),'st_snare',.55,0),
  ('rimshot',rr('Snare4_rimshot_{v}_{r}_Mid.wav',['v2','v4']),'st_snare',.6,0),
  ('xstick',[['Snare4_Xstick_v2_rr1_Mid.wav','Snare4_Xstick_v2_rr2_Mid.wav']],'nat',.3,-4),
  ('hat',  rr('HiHat_HitC_{v}_{r}_Mid.wav',['v1','v2','v3','v4']),'hat',.25,-6),
  ('open', [['HiHat_HitO_rr1_Mid.wav','HiHat_HitO_rr2_Mid.wav']],'hat',.9,0),
  ('foot', [['HiHat_Close_rr1_Mid.wav','HiHat_Close_rr2_Mid.wav']],'hat',.25,-9),
  ('tomhi',rr('TomH_HitS_{v}_{r}_Mid.wav',['v2','v3','v4']),'st_tom',.7,0),
  ('tomlo',rr('TomL_HitS_{v}_{r}_Mid.wav',['v2','v3','v4']),'st_tom',.8,0),
  ('crash',[['susCymb2_hit_mp1.wav'],['susCymb2_hit_mf1.wav'],['susCymb2_hit_f1.wav'],['susCymb2_hit_fff1.wav']],'cym',2.4,4),
  ('ride', [['susCymb2_hit_stick_pp1.wav'],['susCymb2_hit_stick_mp1.wav'],['susCymb2_hit_stick_mf1.wav']],'cym',2.0,2),
  ('bell', [['susCymb2_hit_bell_p1.wav'],['susCymb2_hit_bell_f1.wav']],'cym',1.8,0),
 ],
 'latin':[
  ('tumba', rr('Tumba_HitN_{v}_{r}_Sum.wav',['v1','v2','v3','v4']),'nat',.9,-2),
  ('conga', rr('Conga_HitN_{v}_{r}_Sum.wav',['v1','v2','v3']),'nat',.8,-2),
  ('quinto',rr('Quinto_HitN_{v}_{r}_Sum.wav',['v1','v2','v3']),'nat',.7,-2),
  ('bongohi',rr('BongoH_Hit1_{v}_{r}_Mid.wav',['v1','v2','v3']),'nat',.5,-3),
  ('bongolo',rr('BongoL_Hit1_{v}_{r}_Mid.wav',['v1','v2','v3']),'nat',.6,-3),
  ('cowbell',[['Cowbell1_Hit_v2_rr1_Mid.wav'],['Cowbell1_Hit_v3_rr1_Mid.wav'],['Cowbell1_Hit_v4_rr1_Mid.wav']],'nat',.7,-8),
  ('clave',[['Claves1_Hit_v1_rr1_Mid.wav'],['Claves1_Hit_v2_rr1_Mid.wav'],['Claves1_Hit_v3_rr1_Mid.wav']],'nat',.4,-7),
  ('guiro',[['Guiro_Hit_rr1_Mid.wav','Guiro_Hit_rr2_Mid.wav']],'nat',.6,-7),
  ('agogohi',[['Agogo_High_v1_rr1_Mid.wav'],['Agogo_High_v2_rr1_Mid.wav'],['Agogo_High_v3_rr1_Mid.wav']],'nat',.8,-8),
  ('agogolo',[['Agogo_Low_v1_rr1_Mid.wav'],['Agogo_Low_v2_rr1_Mid.wav']],'nat',.8,-8),
  ('shaker',[['Mid_ShakerHighFaster_Down_rr1.wav','Mid_ShakerHighFaster_Up_rr1.wav','Mid_ShakerHighFaster_Down_rr2.wav','Mid_ShakerHighFaster_Up_rr2.wav']],'hat',.3,-9),
  ('cabasa',[['Cabasa1_Hit_rr1_Mid.wav','Cabasa1_Hit_rr2_Mid.wav']],'hat',.35,-9),
 ],
 'hand':[
  ('kick',[['Cajon_hit2_pp_rr1.wav','Cajon_hit2_pp_rr2.wav'],['Cajon_hit3_p_rr1.wav','Cajon_hit3_p_rr2.wav'],['Cajon_hit3_mp_rr1.wav','Cajon_hit3_mp_rr2.wav'],['Cajon_hit3_f_rr1.wav','Cajon_hit3_f_rr2.wav']],'nat',.45,'kick'),
  ('snare',[['Cajon_hit1_mp_rr1.wav','Cajon_hit1_mp_rr2.wav'],['Cajon_hit1_f_rr1.wav','Cajon_hit1_f_rr2.wav'],['Cajon_hit1_fff_rr1.wav','Cajon_hit1_fff_rr2.wav']],'nat',.5,0),
  ('doum',rr('Darbuka_1_hit_{v}_{r}.wav',['vl1','vl2']),'nat',1.0,0),
  ('tek', rr('Darbuka_2_hit_{v}_{r}.wav',['vl1','vl2']),'nat',.4,-3),
  ('frame',rr('HDrumL_Hit_{v}_{r}_Sum.wav',['v2','v3']),'nat',1.3,-1),
  ('clap',[['Clap_rr1.wav','Clap_rr2.wav','Clap_rr3.wav','Clap_rr4.wav','Clap_rr5.wav','Clap_rr6.wav']],'nat',.4,0),
  ('tamb',[['Tamb1_Hit_v1_rr1_Mid.wav'],['Tamb1_Hit_v2_rr1_Mid.wav']],'hat',.6,-7),
  ('shaker',[['Mid_ShakerLowFaster_Down_rr1.wav','Mid_ShakerLowFaster_Up_rr1.wav','Mid_ShakerLowFaster_Down_rr2.wav','Mid_ShakerLowFaster_Up_rr2.wav']],'hat',.3,-9),
  ('wood',[['wood_click_pp_rr1.wav','wood_click_pp_rr2.wav'],['wood_click_mp.wav'],['wood_click_f_rr1.wav','wood_click_f_rr2.wav']],'nat',.3,-7),
 ],
 'orch':[
  ('kick',[['bassdrum_hit_pp1.wav','bassdrum_hit_pp2.wav'],['bassdrum_hit_mp1.wav','bassdrum_hit_mp2.wav'],['bassdrum_hit_mf1.wav','bassdrum_hit_mf2.wav'],['bassdrum_hit_f.wav'],['bassdrum_hit_ff.wav']],'nat',2.5,0),
  ('snare',[['RopeSnare_hi_sn_Main_vl1_rr1.wav','RopeSnare_hi_sn_Main_vl1_rr2.wav'],['RopeSnare_hi_sn_Main_vl2_rr1.wav','RopeSnare_hi_sn_Main_vl2_rr2.wav'],['RopeSnare_hi_sn_Main_vl3_rr1.wav','RopeSnare_hi_sn_Main_vl3_rr3.wav'],['RopeSnare_hi_sn_Main_vl4_rr1.wav','RopeSnare_hi_sn_Main_vl4_rr2.wav']],'nat',.8,0),
  ('timplo',[['Timpani1_Hit_v2_rr1_Sum.wav','Timpani1_Hit_v2_rr2_Sum.wav'],['Timpani1_Hit_v3_rr3_Sum.wav','Timpani1_Hit_v3_rr4_Sum.wav'],['Timpani1_Hit_v4_rr1_Sum.wav','Timpani1_Hit_v4_rr2_Sum.wav']],'nat',2.5,0),
  ('timphi',rr('Timpani3_Hit_{v}_{r}_Sum.wav',['v2','v3','v4']),'nat',2.2,0),
  ('crash',[['cymbal_crash1_pp1.wav','cymbal_crash1_pp2.wav'],['cymbal_crash1_mp1.wav','cymbal_crash1_mp2.wav'],['cymbal_crash1_mf1.wav','cymbal_crash1_mf2.wav'],['cymbal_crash1_ff2.wav','cymbal_crash1_ff3.wav']],'cym',3.0,4),
  ('gong',[['gong_p.wav'],['gong_mf.wav'],['gong_f.wav'],['gong_fff.wav']],'nat',5.0,2),
  ('triangle',[['triangle1_hit_pp.wav'],['triangle1_hit_mp.wav'],['triangle1_hit_mf_pt2.wav']],'nat',2.0,-8),
 ],
 # ── World percussion for the Aux layer (4.9.9.2) ──
 'mideast':[
  ('doum',rr('Darbuka_1_hit_{v}_{r}.wav',['vl1','vl2']),'nat',1.0,-1),
  ('tek', rr('Darbuka_2_hit_{v}_{r}.wav',['vl1','vl2']),'nat',.45,-3),
  ('ka',  rr('Darbuka_4_hit_{v}_{r}.wav',['vl1','vl2']),'nat',.5,-5),
  ('tek2',rr('Darbuka_3_hit_{v}_{r}.wav',['vl1','vl2']),'nat',.45,-5),
  ('framelo',rr('HDrumL_Hit_{v}_{r}_Sum.wav',['v2','v3']),'nat',1.3,-2),
  ('framemute',rr('HDrumL_HitMuted_{v}_{r}_Sum.wav',['v2','v3']),'nat',.5,-3),
  ('framehi',rr('HDrumS_Hit_{v}_{r}_Sum.wav',['v2','v3']),'nat',1.0,-3),
  ('riq',[['Tamb2_Hit_v1_rr1_Mid.wav'],['Tamb2_Hit_v2_rr2_Mid.wav']],'hat',.6,-7),
  ('zills',[['Fing_Cymb.wav']],'nat',3.0,-9),
  ('shaker',[['LShaker_Hit_rr1_Mid.wav','LShaker_Hit_rr2_Mid.wav']],'hat',.35,-9),
 ],
 'africa':[
  ('loglo',[['LogDrumLo_MedM_v1_rr1_Sum.wav'],['LogDrumLo_MedM_v2_rr1_Sum.wav'],['LogDrumLo_MedM_v3_rr1_Sum.wav']],'nat',.9,-3),
  ('loghi',[['LogDrumHi_MedM_v1_rr1_Sum.wav'],['LogDrumHi_MedM_v2_rr1_Sum.wav'],['LogDrumHi_MedM_v3_rr1_Sum.wav']],'nat',.9,-3),
  ('dbell',[['Cowbell2_Double_v2_rr1_Mid.wav'],['Cowbell2_Double_v3_rr1_Mid.wav']],'nat',.6,-8),
  ('bell',[['Cowbell2_Normal_v2_rr1_Mid.wav'],['Cowbell2_Normal_v3_rr1_Mid.wav']],'nat',.6,-8),
  ('agogo',[['agogoBell3_f_1.wav','agogoBell3_f_2.wav'],['agogoBell3_ff_1.wav','agogoBell3_ff_2.wav','agogoBell3_ff_3.wav']],'nat',.5,-8),
  ('shaker',[['LShaker_Shake1D_rr2_Mid.wav','LShaker_Shake1U_rr1_Mid.wav','LShaker_Shake1D_rr3_Mid.wav','LShaker_Shake1U_rr4_Mid.wav']],'hat',.5,-9),
  ('clap',[['SoloClap_vl1.wav'],['SoloClap_vl2.wav'],['SoloClap_vl3.wav'],['SoloClap_vl4.wav']],'nat',.4,-2),
  ('balalo',[['EthnicXylo_hardM_F3_vl1_rr1_Mid.wav'],['EthnicXylo_hardM_F3_vl2_rr1_Mid.wav'],['EthnicXylo_hardM_F3_vl3_rr1_Mid.wav']],'nat',1.0,-5),
  ('balahi',[['EthnicXylo_hardM_C4_vl1_rr1_Mid.wav'],['EthnicXylo_hardM_C4_vl2_rr1_Mid.wav'],['EthnicXylo_hardM_C4_vl3_rr1_Mid.wav']],'nat',1.0,-5),
 ],
 'samba':[
  ('bass',[['bassdrum_hit_mp1.wav','bassdrum_hit_mp2.wav'],['bassdrum_hit_mf1.wav','bassdrum_hit_mf2.wav'],['bassdrum_hit_f.wav']],'nat',1.0,0),
  ('snare',[['RopeSnare_low_sn_Main_vl1_rr1.wav','RopeSnare_low_sn_Main_vl1_rr2.wav'],['RopeSnare_low_sn_Main_vl2_rr1.wav','RopeSnare_low_sn_Main_vl2_rr2.wav'],['RopeSnare_low_sn_Main_vl3_rr1.wav','RopeSnare_low_sn_Main_vl3_rr3.wav']],'nat',.5,-2),
  ('rimtom',rr('TomH_rimS_{v}_{r}_Mid.wav',['v2','v4']),'nat',.6,-3),
  ('agogohi',[['agogoBell2_mp_1.wav','agogoBell2_mp_2.wav'],['agogoBell2_mf_1.wav']],'nat',.6,-8),
  ('agogolo',[['agogoBell_mf1.wav'],['agogoBell_f_1.wav']],'nat',.6,-8),
  ('tamb',[['Tamb2_Hit_v1_rr1_Mid.wav'],['Tamb2_Hit_v2_rr2_Mid.wav']],'hat',.5,-7),
  ('shaker',[['Mid_ShakerDouble_Down_rr1.wav','Mid_ShakerDouble_Up_rr1.wav','Mid_ShakerDouble_Down_rr2.wav','Mid_ShakerDouble_Up_rr2.wav']],'hat',.3,-9),
  ('whistle',[['Main_BallWhistle_Short-001.wav']],'nat',1.1,-6),
  ('whistlelong',[['Main_BallWhistle_Long-001.wav']],'nat',2.1,-6),
 ],
 'bellsfx':[
  ('sleigh',[['sleighbell2_hit_2.wav'],['Sleighbells_Hit_rr1_Mid.wav','Sleighbells_Hit_rr2_Mid.wav'],['sleighbell2_hit_loud.wav']],'hat',1.2,-7),
  ('marktree',[['windchimes_asc1.wav','windchimes_desc1.wav','windchimes_fastAsc1.wav']],'nat',3.0,-8),
  ('belltree',[['BellTree_Stroke_1_Mid.wav','BellTree_Stroke_3_Mid.wav','BellTree_Stroke_4_Mid.wav','BellTree_Stroke_6_Mid.wav']],'nat',3.0,-8),
  ('nepal',[['HB_1.wav','HB_2.wav','HB_3.wav']],'nat',2.5,-8),
  ('zills',[['Fing_Cymb.wav']],'nat',3.0,-9),
  ('vibraslap',[['vibraslap_rr1.wav','vibraslap_rr2.wav','vibraslap_rr3.wav','vibraslap_rr4.wav']],'nat',1.6,-6),
  ('ratchet',[['Ratchet1_Fast_rr1_Mid.wav','Ratchet2_Fast_rr1_Mid.wav']],'nat',1.2,-8),
  ('slapstick',[['slapstick_quiet_rr1.wav','slapstick_quiet_rr2.wav'],['slapstick_rr1.wav','slapstick_rr2.wav','slapstick_rr3.wav']],'nat',.4,-4),
  ('anvil',[['Anvil_Hit1_v1_rr1_Mid.wav','Anvil_Hit2_v1_rr1_Mid.wav','Anvil_Hit3_v1_rr1_Mid.wav'],['Anvil_Hit1_v2_rr1_Mid.wav','Anvil_Hit2_v2_rr1_Mid.wav','Anvil_Hit3_v2_rr1_Mid.wav'],['Anvil_Hit1_v3_rr1_Mid.wav','Anvil_Hit2_v3_rr1_Mid.wav','Anvil_Hit3_v3_rr1_Mid.wav']],'nat',1.0,-7),
  ('brake',[['BrakeDrum1_Hammer_v1_rr1_Mid.wav'],['BrakeDrum1_Hammer_v2_rr1_Mid.wav'],['BrakeDrum1_Hammer_v3_rr1_Mid.wav']],'nat',.8,-7),
  ('ocean',[['OceanDrum_Sus_1_Mid.wav','OceanDrum_Sus_2_Mid.wav','OceanDrum_Sus_3_Mid.wav']],'nat',3.0,-9),
 ],
}
REF_SNARE_DB=None
# Reference: the shipping Rock snare at its lane gain (0.75) is what every new
# kit's snare is matched to, so a new kit lands at the loudness of the old.
rk=decode(os.path.join(OUT,'rock','snare.mp3'),None); REF=aweight_db(rk)+20*np.log10(.75)
report={}
for kit,lanes in KITS.items():
    if ONLY and kit not in ONLY: continue
    rep=report[kit]={}
    for key,layers,treat,maxlen,rel in lanes:
        files=[]; top=None
        for li,layer in enumerate(layers):
            for ti,name in enumerate(layer):
                x=shape(decode(find(name),T[treat]),maxlen)
                dst=os.path.join(OUT,kit,'%s%d%s.mp3'%(key,li,'abcdef'[ti]))
                encode(x,dst); files.append(os.path.relpath(dst,os.path.dirname(OUT)))
                if li==len(layers)-1 and ti==0: top=x
        if rel=='kick': gain=.9
        else: gain=10**((REF+rel-aweight_db(top))/20)
        rep[key]={'layers':[len(l) for l in layers],'gain':round(float(gain),3),'len':round(len(top)/SR,2)}
if ONLY: print(json.dumps(report,indent=1)); sys.exit(0)
# The 808's missing hi tom, to sit with the files samples/808 already has.
x=shape(decode(HT808,None),.8); encode(x,os.path.join(OUT,'808','hitom.mp3'))
# 808 lane gains, measured the same way against the same reference.
r8={'kick':'kick','snare':0,'clap':0,'rim':-4,'hat':-6,'open':0,'lotom':0,'tom':0,'hitom':0,'cowbell':-8,'clave':-7,'conga':-2,'maracas':-9,'crash':4}
rep=report['808']={}
for k,rel in r8.items():
    x=decode(os.path.join(OUT,'808',k+'.mp3'),None)
    pk=np.max(np.abs(x))
    gain=(.9/ (pk/10**(-1/20))) if rel=='kick' else 10**((REF+rel-aweight_db(x))/20)
    rep[k]={'gain':round(float(gain),3),'len':round(len(x)/SR,2),'pk':round(float(20*np.log10(pk)),1)}
print(json.dumps(report,indent=1))

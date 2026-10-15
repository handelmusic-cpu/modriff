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
# The index is any list of source files, matched by basename — VCSL's, and
# since 4.9.9.3 Freesound packs as downloaded (each sound keeps its
# "<id>__<author>__<name>.wav" basename, which is also its credit: see
# samples/CREDITS.md), VSCO-2 CE files, and the owner's own uploads. Unzip
# them anywhere and add them the same way:
#   find VCSL freesound-packs owner-files -name '*.wav' -o -name '*.aif*' > index.txt
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
  # The second take of each strength (4.9.9.3) is VSCO-2 CE's rr2 of the same
  # cymbal: its rr1 files are byte-identical to the VCSL takes beside them.
  ('crash',[['susCymb1_hit_mp1.wav','susCymb1-hit_mp_rr2.wav'],['susCymb1_hit_f1.wav','susCymb1-hit_f_rr2.wav'],['susCymb1_hit_fff1.wav','susCymb1-hit_fff_rr2.wav']],'cym',2.6,4),
  ('ride', [['susCymb1_hit_stick_pp1.wav','susCymb1-hitstick_pp_rr2.wav'],['susCymb1_hit_stick_mp1.wav','susCymb1-hitstick_mp_rr2.wav'],['susCymb1_hit_stick_f1.wav','susCymb1-hitstick_f_rr2.wav']],'cym',2.2,2),
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
 # ── Freesound world kits (4.9.9.3), every sound CC0 ──
 # Packs name strokes loosely, so lanes were sorted by measurement: the
 # fraction of energy under 250 Hz in the first 30 ms (bass vs tone vs slap)
 # and the spectral peak. Where a pack gives no strengths, the takes of a lane
 # are split into soft and hard layers by their raw RMS, quietest first.
 'tabla':[
  ('na',[['130428__mmiron__na_sharp.wav'],['130421__mmiron__na.wav','130422__mmiron__na-open.wav']],'nat',1.2,-3),
  # The pack's "tas" strokes: the ringing sur stroke, ~555 Hz against the
  # dayan's 314 — what a theka calls Tin.
  ('tin',[['130426__mmiron__tas.wav'],['130425__mmiron__tas_2.wav','130430__mmiron__tas_3.wav']],'nat',1.4,-3),
  ('tun',[['130416__mmiron__tun.wav','130419__mmiron__tun_2.wav','130420__mmiron__tun_3.wav']],'nat',2.0,-3),
  ('te',[['130415__mmiron__te_middlefinger.wav','130418__mmiron__te_2.wav'],['130429__mmiron__te.wav','130417__mmiron__te_ne.wav']],'nat',.35,-4),
  ('re',[['130427__mmiron__re.wav']],'nat',.3,-5),
  ('ke',[['130413__mmiron__ke.wav','130424__mmiron__ke_2.wav','130423__mmiron__ke_3.wav']],'nat',.15,-3),
  ('ge',[['130406__mmiron__ghe.wav'],['130411__mmiron__ghe_4.wav','130414__mmiron__ghe_8.wav']],'nat',.9,-1),
  # Measured: none of the long ghe takes bends — each settles at ~92 Hz and
  # rings — so they are one open lane, five takes.
  ('geopen',[['130405__mmiron__ghe_2.wav','130404__mmiron__ghe_3.wav','130410__mmiron__ghe_5.wav','130409__mmiron__ghe_6.wav','130408__mmiron__ghe_7.wav']],'nat',2.6,-1),
 ],
 'djembe':[
  ('bass',[['460959__infinita08__djembe_hit22.wav','460973__infinita08__djembe_hit15.wav','460974__infinita08__djembe_hit14.wav'],
           ['460972__infinita08__djembe_hit16.wav','460958__infinita08__djembe_hit21.wav','460967__infinita08__djembe_hit13.wav']],'nat',.8,0),
  ('tone',[['460970__infinita08__djembe_hit10.wav','460949__infinita08__djembe_hit1.wav','460968__infinita08__djembe_hit12.wav'],
           ['460965__infinita08__djembe_hit4.wav','460960__infinita08__djembe_hit2.wav','460964__infinita08__djembe_hit3.wav']],'nat',.8,-1),
  # The "rim" hits are the brightest strokes in the pack: the slap.
  ('slap',[['460954__infinita08__djembe_hit7-rim.wav'],['460963__infinita08__djembe_hit6-rim.wav','460980__infinita08__djembe_hit9-rim.wav'],['460955__infinita08__djembe_hit8-rim.wav']],'nat',.8,-1),
  ('mute',[['460983__infinita08__djembe_longrim_mute.wav','460986__infinita08__djembe_longrim_mute2.wav','460985__infinita08__djembe_longrim_mute3.wav']],'nat',1.0,-2),
  ('flam',[['460948__infinita08__djembe_doublehit5.wav','460947__infinita08__djembe_doublehit6.wav','460946__infinita08__djembe_doublehit7.wav','460945__infinita08__djembe_doublehit8.wav']],'nat',.9,-2),
  ('roll',[['460978__infinita08__djembe_roll.wav','460977__infinita08__djembe_roll2.wav','460953__infinita08__djembe_roll4.wav']],'nat',1.4,-2),
 ],
 # Two packs by the same player, different recordings: one take from each.
 # The okónkolo's open tone is the exception — the two takes are tuned 2.5
 # semitones apart, which alternating would turn into a melody.
 'bata':[
  ('iyaopen',[['509892__sassaby__bata-iya-tone.wav','687122__sassaby__bata-iya-tone.wav']],'nat',1.5,-1),
  ('iyaslap',[['509893__sassaby__bata-iya-slap.wav','687119__sassaby__bata-iya-slap.wav']],'nat',.8,-2),
  ('itoopen',[['509894__sassaby__bata-itotele-tone.wav','687118__sassaby__bata-itotele-tone.wav']],'nat',1.2,-2),
  ('itoslap',[['509895__sassaby__bata-itotele-slap.wav','687117__sassaby__bata-itotele-slap.wav']],'nat',.8,-3),
  ('okoopen',[['687121__sassaby__bata-okonkolo-tone.wav']],'nat',.9,-3),
  ('okoslap',[['509897__sassaby__bata-okonkolo-slap.wav','687120__sassaby__bata-okonkolo-slap.wav']],'nat',.6,-4),
 ],
 'maracatu':[
  ('alfaia',[['509528__sassaby__alfaia-hit.wav'],['506385__sassaby__alfaia-hit-maracatu.wav','511275__sassaby__alfaia-hit-combined.wav']],'nat',1.2,0),
  ('alfaiarim',[['509527__sassaby__alfaia-rim.wav']],'nat',.6,-4),
  ('caixa',[['506384__sassaby__maracatu-caixa-snare-hit.wav','531787__sassaby__caixa-vazada-hit.wav'],['531782__sassaby__caixa-tarol-hit.wav','511274__sassaby__caixa-hit-combined.wav']],'nat',.5,-2),
  ('caixarim',[['531788__sassaby__caixa-tarol-rim.wav','531786__sassaby__caixa-vazada-rim.wav'],['531784__sassaby__samba-caixa-rimshot.wav']],'nat',.6,-3),
  ('gongue',[['506386__sassaby__agogo-hit.wav']],'nat',.7,-8),
  ('shekere',[['506383__sassaby__shekere-hit.wav']],'nat',.5,-8),
 ],
 'salsa':[
  ('timbhi',[['533095__sassaby__timbales-high-macho.wav']],'nat',.8,-2),
  ('timblo',[['533094__sassaby__timbales-low-hembra.wav']],'nat',1.2,-2),
  ('timbrim',[['533089__sassaby__timbales-high-rimshot-macho.wav']],'nat',.9,-4),
  # The bell's body is the muted, quiet stroke and its mouth the open one —
  # which is what soft and hard sound like on a mambo bell anyway.
  ('mambo',[['533091__sassaby__mambo-bell-body.wav'],['533090__sassaby__mambo-bell-mouth.wav']],'nat',.7,-8),
  ('chacha',[['533092__sassaby__cha-cha-bell.wav']],'nat',.4,-8),
  ('block',[['533093__sassaby__wood-block.wav']],'nat',.3,-7),
  ('conga',[['512063__sassaby__conga-f-tone.wav','512064__sassaby__conaa-tone.wav']],'nat',.8,-2),
  ('congaslap',[['512065__sassaby__conaa-slap.wav']],'nat',.5,-2),
  ('quinto',[['512071__sassaby__quinto-c-tone.wav','512067__sassaby__quintoc-tone.wav','512069__sassaby__quinto-b-tone.wav']],'nat',.7,-3),
  ('quintoslap',[['512068__sassaby__quinto-c-slap.wav','512066__sassaby__quintoc-slap.wav','512062__sassaby__quintob-slap.wav']],'nat',.5,-3),
  ('tumba',[['512080__sassaby__whitelowdrumd-tone.wav','512076__sassaby__whitelowdrumd-toneoff-floor.wav']],'nat',.9,-2),
  ('tumbaslap',[['512073__sassaby__whitelowdrumd-slap.wav']],'nat',.6,-2),
 ],
 'medieval':[
  ('drum',[['99743__menegass__adrum2.wav','99745__menegass__adrum4.wav','99749__menegass__adrum8.wav'],['99741__menegass__adrum1.wav','99744__menegass__adrum3.wav','99748__menegass__adrum7.wav']],'nat',.6,0),
  ('drumopen',[['99746__menegass__adrum5.wav','99747__menegass__adrum6.wav','99750__menegass__adrum9.wav','99742__menegass__adrum10.wav']],'nat',1.0,-1),
  ('hand',[['99734__menegass__conga_1.wav','99737__menegass__conga_4.wav','99740__menegass__conga_7.wav']],'nat',.6,-2),
  ('handslap',[['99735__menegass__conga_2.wav','99736__menegass__conga_3.wav','99738__menegass__conga_5.wav','99739__menegass__conga_6.wav']],'nat',.4,-3),
  ('tambbass',[['89647__menegass__pand0.wav']],'nat',.5,-3),
  ('tamb',[['90078__menegass__pand1.wav'],['89648__menegass__pand2.wav','89649__menegass__pand3.wav']],'hat',.5,-7),
  ('clappers',[['99729__menegass__clp2.wav','99730__menegass__clp3.wav'],['99728__menegass__clp1.wav','99731__menegass__clp4.wav','99732__menegass__clp5.wav','99733__menegass__clp6.wav']],'nat',.5,-6),
  ('seeds',[['99716__menegass__seedb1.wav','99717__menegass__seedb2.wav','99718__menegass__seedb3.wav','99719__menegass__seedb4.wav']],'hat',.45,-9),
  ('seedpod',[['99724__menegass__seedp1.wav','99725__menegass__seedp2.wav']],'hat',.6,-9),
  ('shaker',[['99843__menegass__shk3.wav','99842__menegass__shk2.wav','99845__menegass__shk5.wav','99846__menegass__shk6.wav'],['99844__menegass__shk4.wav','99841__menegass__shk1.wav','99848__menegass__shk8.wav']],'hat',.7,-9),
  ('rattle',[['100005__menegass__rshk2.wav'],['100004__menegass__rshk1.wav','100006__menegass__rshk3.wav','100007__menegass__rshk4.wav']],'hat',.8,-9),
 ],
 # Udu (iyankc, Freesound) and darbuka (the owner's own files) — both clay.
 'clay':[
  ('udubass',[['479245__iyankc__udu-1.wav','479250__iyankc__udu-2.wav']],'nat',1.0,-1),
  ('udumid',[['479249__iyankc__udu-3.wav','479253__iyankc__udu-8.wav']],'nat',.5,-2),
  ('udutap',[['479248__iyankc__udu-4.wav','479251__iyankc__udu-7.wav'],['479247__iyankc__udu-5.wav']],'nat',.5,-5),
  ('doum',[['Darbuka_06.wav'],['Darbuka_01.wav'],['Darbuka_02.wav']],'nat',1.0,-1),
  ('tek',[['Darbuka_03.wav'],['Darbuka_04.wav']],'nat',.5,-4),
  ('ka',[['Darbuka_05.wav']],'nat',.5,-5),
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

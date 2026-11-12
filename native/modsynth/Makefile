# The C++ mõdSynth engine, built for the null test (tests/modsynth/null.test.js).
# -ffp-contract=off matters: without it a compiler may fuse a*b+c into one
# rounding (FMA, the default on ARM), and the engine stops matching dsp.js in
# the last bit. Any other build of these files (the iOS app's) needs it too.
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -ffp-contract=off -Wall -Wno-misleading-indentation -Wno-maybe-uninitialized

render: render.cpp modsynth.cpp fdlibm.cc modsynth.h jsnum.h params_gen.h
	$(CXX) $(CXXFLAGS) -o $@ render.cpp modsynth.cpp fdlibm.cc

params_gen.h: ../../modsynth/params.js gen-params.js
	node gen-params.js

# The effects rack: fxtest measures each stage, fxwire proves a matrix macro
# reaches it through the engine. Neither is a null test (see fxrack.h).
fxtest: fxtest.cpp fxrack.cpp fxrack.h params_gen.h
	$(CXX) $(CXXFLAGS) -o $@ fxtest.cpp fxrack.cpp
sendtest: sendtest.cpp fxrack.cpp fxrack.h params_gen.h
	$(CXX) $(CXXFLAGS) -o $@ sendtest.cpp fxrack.cpp
fxwire: fxwire.cpp fxrack.cpp modsynth.cpp fdlibm.cc fxrack.h modsynth.h params_gen.h
	$(CXX) $(CXXFLAGS) -o $@ fxwire.cpp fxrack.cpp modsynth.cpp fdlibm.cc
hangtest: hangtest.cpp modsynth.cpp fdlibm.cc modsynth.h params_gen.h
	$(CXX) $(CXXFLAGS) -o $@ hangtest.cpp modsynth.cpp fdlibm.cc
mixfxtest: mixfxtest.cpp mixfx.cpp mixfx.h dspkit.h modfxproc.cpp modfxproc.h fdlibm.cc
	$(CXX) $(CXXFLAGS) -o $@ mixfxtest.cpp mixfx.cpp modfxproc.cpp fdlibm.cc
wkrender: wkrender.cpp modfxproc.cpp modfxproc.h jsnum.h fdlibm.cc
	$(CXX) $(CXXFLAGS) -o $@ wkrender.cpp modfxproc.cpp fdlibm.cc
striptest: striptest.cpp strip.h
	$(CXX) $(CXXFLAGS) -o $@ striptest.cpp
# The master bus against the browser's compressor and room: see tests/modsynth/master.test.js.
mastertest: mastertest.cpp master.cpp master.h dspkit.h
	$(CXX) $(CXXFLAGS) -o $@ mastertest.cpp master.cpp
# The capture ring that carries native audio to the recorder (N5), including a
# writer thread racing a reader.
capturetest: capturetest.cpp capture.h
	$(CXX) $(CXXFLAGS) -pthread -o $@ capturetest.cpp
# The capture path through the real ModEngineHost.mm (macOS only).
HOSTDIR = ../../ios/App/App/ModEngine
graphhosttest: synthseq.h graphhosttest.mm seqobserve.h $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h graphpool.cpp graph.cpp graphpool.h graph.h capture.h basscore.cpp basscore.h bassplay.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ graphhosttest.mm $(HOSTDIR)/ModEngineHost.mm graphpool.cpp graph.cpp basscore.cpp seqcore.cpp voicebank.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp

hosttest: synthseq.h hosttest.mm seqobserve.h $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h capture.h basscore.cpp basscore.h bassplay.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graph.cpp graphpool.h graph.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ hosttest.mm $(HOSTDIR)/ModEngineHost.mm basscore.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp
# The speaker hears nothing while a part is warmed up (macOS only).
warmtest: synthseq.h warmtest.mm seqobserve.h $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h capture.h basscore.cpp basscore.h bassplay.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graph.cpp graphpool.h graph.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ warmtest.mm $(HOSTDIR)/ModEngineHost.mm basscore.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp
# The master EQ against the browser's BiquadFilterNode responses.
eqtest: eqtest.cpp master.cpp master.h dspkit.h mixfx.cpp mixfx.h modfxproc.cpp modfxproc.h fdlibm.cc
	$(CXX) $(CXXFLAGS) -o $@ eqtest.cpp master.cpp mixfx.cpp modfxproc.cpp fdlibm.cc
trimtest: trimtest.cpp master.cpp master.h dspkit.h
	$(CXX) $(CXXFLAGS) -o $@ trimtest.cpp master.cpp
fxcheck: fxtest fxwire hangtest striptest mixfxtest mastertest capturetest trimtest eqtest
	./trimtest | tail -1 && ./eqtest | tail -1 && ./capturetest | tail -1 && ./fxtest | tail -1 && ./fxwire | tail -1 && ./hangtest | tail -1 && ./striptest | tail -1 && ./mixfxtest | tail -1 && node ../../tests/modsynth/master.test.js && node ../../tests/modsynth/master-order.test.js && node ../../tests/modsynth/mixfx-order.test.js && node ../../tests/modsynth/gatepat.test.js

# The sequencer's thread in the real host: steps on the render clock with no page, mirror, tempo, stop (macOS only).
seqhosttest: chordplay.h chordcomp.h synthseq.h seqhosttest.mm arpcore.h arpplay.h melcore.h melplay.h melcell.h seqobserve.h $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h songcore.cpp songcore.h songvoice.h voicing.h tempomap.h basscore.cpp basscore.h bassplay.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graph.cpp graphpool.h graph.h capture.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ seqhosttest.mm $(HOSTDIR)/ModEngineHost.mm basscore.cpp songcore.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp

clean:
	rm -f synthseqtest melseqtest meltool arpseqtest arptool songtool tempotest banktest chordtool chordtest chordseqtest bassscoretest scoretest basstool seqhosttest seqtool graphhosttest sendtest eqtest render fxtest fxwire hangtest striptest mixfxtest mastertest capturetest trimtest hosttest warmtest wkrender
.PHONY: clean

# The graph interpreter (graph.h): plays a Web Audio graph the page recorded.
# tests/graph/voices.test.js holds it to the browser's render of the same voice.
graphrender: graphrender.cpp graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ graphrender.cpp graph.cpp
# The voice pool the host calls: begin/edit from one thread, render from another.
graphpooltest: graphpooltest.cpp graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -pthread -o $@ graphpooltest.cpp graphpool.cpp graph.cpp
# Plays what the page sent, through the pool, for tests/graph/page.test.js.
graphmix: graphmix.cpp graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -pthread -o $@ graphmix.cpp graphpool.cpp graph.cpp
# The native-scheduling spike (docs/native-scheduling.md): replayed voice programs against fresh ones.
replaytest: replaytest.cpp graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -pthread -o $@ replaytest.cpp graphpool.cpp graph.cpp

# The voice bank's patching against voices the page records fresh: tests/seq/bank.test.js.
scoretest: scoretest.cpp seqplay.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ scoretest.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

bassscoretest: synthseq.h bassscoretest.cpp bassplay.h basscore.cpp basscore.h seqcore.cpp seqcore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ bassscoretest.cpp basscore.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

chordseqtest: chordseqtest.cpp chordplay.h chordcomp.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ chordseqtest.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

chordtool: chordtool.cpp chordcore.h chordplay.h chordcomp.h voicebank.cpp voicebank.h tuning.h
	$(CXX) $(CXXFLAGS) -o $@ chordtool.cpp voicebank.cpp

chordtest: chordtest.cpp chordcomp.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ chordtest.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

banktest: synthseq.h banktest.cpp arpplay.h arpcore.h melplay.h melcore.h melcell.h basscore.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ banktest.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

# The native sequencer core (seqcore.h): tests/seq/drumgrid.test.js holds its event lists to the page's own scheduler.
melseqtest: synthseq.h melseqtest.cpp melplay.h melcore.h melcell.h basscore.cpp basscore.h seqcore.cpp seqcore.h tempomap.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ melseqtest.cpp basscore.cpp seqcore.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

arpseqtest: synthseq.h arpseqtest.cpp arpplay.h arpcore.h seqcore.h tempomap.h voicebank.cpp voicebank.h tuning.h graphpool.cpp graphpool.h graph.cpp graph.h
	$(CXX) $(CXXFLAGS) -o $@ arpseqtest.cpp voicebank.cpp graphpool.cpp graph.cpp fdlibm.cc

arptool: arptool.cpp arpcore.h seqcore.h tempomap.h
	$(CXX) $(CXXFLAGS) -o $@ arptool.cpp

songtool: songtool.cpp songcore.cpp songcore.h songvoice.h songend.h voicing.h basscore.cpp basscore.h seqcore.cpp seqcore.h tempomap.h chordplay.h chordcomp.h voicebank.cpp voicebank.h tuning.h
	$(CXX) $(CXXFLAGS) -o $@ songtool.cpp songcore.cpp basscore.cpp seqcore.cpp voicebank.cpp

tempotest: tempotest.cpp tempomap.h basscore.cpp basscore.h seqcore.cpp seqcore.h chordcore.h chordplay.h chordcomp.h voicebank.cpp voicebank.h tuning.h
	$(CXX) $(CXXFLAGS) -o $@ tempotest.cpp basscore.cpp seqcore.cpp voicebank.cpp

meltool: meltool.cpp melcore.h melcell.h basscore.cpp basscore.h seqcore.cpp seqcore.h tempomap.h
	$(CXX) $(CXXFLAGS) -o $@ meltool.cpp basscore.cpp seqcore.cpp

basstool: basstool.cpp basscore.cpp basscore.h seqcore.cpp seqcore.h tempomap.h
	$(CXX) $(CXXFLAGS) -o $@ basstool.cpp basscore.cpp seqcore.cpp

seqtool: seqtool.cpp seqcore.cpp seqcore.h
	$(CXX) $(CXXFLAGS) -o $@ seqtool.cpp seqcore.cpp

# Processor-backed sequencer messages against the real page's msxVoice.
synthseqtest: synthseqtest.cpp synthseq.h chordplay.h chordcomp.h bassplay.h arpplay.h melplay.h voicebank.cpp voicebank.h tuning.h
	$(CXX) $(CXXFLAGS) -o $@ synthseqtest.cpp voicebank.cpp

seqobservetest: seqobservetest.cpp seqobserve.h
	$(CXX) $(CXXFLAGS) -o $@ seqobservetest.cpp

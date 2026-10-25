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
hosttest: hosttest.mm $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h capture.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ hosttest.mm $(HOSTDIR)/ModEngineHost.mm modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp
# The speaker hears nothing while a part is warmed up (macOS only).
warmtest: warmtest.mm $(HOSTDIR)/ModEngineHost.mm $(HOSTDIR)/ModEngineHost.h capture.h master.cpp modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp modfxproc.cpp
	$(CXX) -std=c++17 -O2 -ffp-contract=off -fobjc-arc -Wno-misleading-indentation -I. -I$(HOSTDIR) -framework Foundation -o $@ warmtest.mm $(HOSTDIR)/ModEngineHost.mm modsynth.cpp fdlibm.cc fxrack.cpp mixfx.cpp master.cpp modfxproc.cpp
# The master EQ against the browser's BiquadFilterNode responses.
eqtest: eqtest.cpp master.cpp master.h dspkit.h
	$(CXX) $(CXXFLAGS) -o $@ eqtest.cpp master.cpp
trimtest: trimtest.cpp master.cpp master.h dspkit.h
	$(CXX) $(CXXFLAGS) -o $@ trimtest.cpp master.cpp
fxcheck: fxtest fxwire hangtest striptest mixfxtest mastertest capturetest trimtest eqtest
	./trimtest | tail -1 && ./eqtest | tail -1 && ./capturetest | tail -1 && ./fxtest | tail -1 && ./fxwire | tail -1 && ./hangtest | tail -1 && ./striptest | tail -1 && ./mixfxtest | tail -1 && node ../../tests/modsynth/master.test.js && node ../../tests/modsynth/master-order.test.js && node ../../tests/modsynth/mixfx-order.test.js && node ../../tests/modsynth/gatepat.test.js

clean:
	rm -f eqtest render fxtest fxwire hangtest striptest mixfxtest mastertest capturetest trimtest hosttest warmtest wkrender
.PHONY: clean

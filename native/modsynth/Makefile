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

clean:
	rm -f render
.PHONY: clean

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
fxcheck: fxtest fxwire hangtest
	./fxtest | tail -1 && ./fxwire | tail -1 && ./hangtest | tail -1

clean:
	rm -f render fxtest fxwire hangtest
.PHONY: clean

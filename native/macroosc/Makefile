# The macro oscillator on its own: the synthesis models and our voice wrapper, and the
# test/measurement programs that drive them without the rest of the engine.
# -ffp-contract=off to match every other native build in this repo (modsynth/Makefile).
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -ffp-contract=off -Wall -Wno-unused-variable -Wno-sign-compare -Wno-unused-function -Wno-unused-local-typedef -I.

# Every .cc the voice needs. The iOS target lists the same files (ios/App/App.xcodeproj).
SRCS = macrovoice.cc plaits/resources.cc \
  plaits/dsp/chords/chord_bank.cc \
  plaits/dsp/engine/additive_engine.cc plaits/dsp/engine/fm_engine.cc \
  plaits/dsp/engine/grain_engine.cc plaits/dsp/engine/modal_engine.cc plaits/dsp/engine/string_engine.cc \
  plaits/dsp/engine/swarm_engine.cc plaits/dsp/engine/virtual_analog_engine.cc plaits/dsp/engine/waveshaping_engine.cc \
  plaits/dsp/engine2/chiptune_engine.cc plaits/dsp/engine2/phase_distortion_engine.cc \
  plaits/dsp/engine2/string_machine_engine.cc plaits/dsp/engine2/virtual_analog_vcf_engine.cc \
  \
  plaits/dsp/physical_modelling/modal_voice.cc plaits/dsp/physical_modelling/resonator.cc \
  plaits/dsp/physical_modelling/string.cc plaits/dsp/physical_modelling/string_voice.cc \
  stmlib/dsp/atan.cc stmlib/dsp/units.cc stmlib/utils/random.cc

libmacroosc.a: $(SRCS:.cc=.o)
	ar rcs $@ $^

HDRS = $(shell find . -name '*.h')
%.o: %.cc $(HDRS)
	$(CXX) $(CXXFLAGS) -c $< -o $@

macrotest: macrotest.cpp macrovoice.h $(SRCS)
	$(CXX) $(CXXFLAGS) -o $@ macrotest.cpp $(SRCS)

clean:
	rm -f macrotest libmacroosc.a $(SRCS:.cc=.o)

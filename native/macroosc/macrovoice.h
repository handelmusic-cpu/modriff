// One voice of the macro oscillator: a single synthesis model (analog, phase bend, FM pair,
// grain, plucked string ...) played from a note, with three controls whose meaning changes with
// the model (Harmonics, Timbre, Morph). It sits beside the pluck and sub oscillator as one more
// source inside a mõdSynth voice (native/modsynth/modsynth.cpp), so the patch's filters,
// envelopes, matrix and effects shape it like any other oscillator.
//
// The synthesis code in plaits/ and stmlib/ is Emilie Gillet's, MIT licensed (LICENSE-macroosc.txt,
// docs/macro-osc.md). This file is ours: it replaces the module's own Voice class, which was built
// around its hardware (trigger and level jacks, the low-pass gate, the model-select knob).
//
// Real-time rules: construction and init() allocate nothing after the object exists; switching
// model re-initialises the shared RAM in place (the module does the same), which takes a few
// microseconds, so it happens on the render thread without a malloc.
#pragma once
#include <cstddef>
#include <cstdint>

#include "stmlib/dsp/limiter.h"
#include "stmlib/utils/buffer_allocator.h"

namespace macroosc {

constexpr int kModels = 12;

struct ModelInfo { const char* id; const char* name; };
extern const ModelInfo kModelInfo[kModels];
// Per-model gain that puts every model at about the level of one default oscillator, by measurement (macrolevel.cpp).
extern const double kModelTrim[kModels];

// Bytes of working RAM shared by every model (the module's own figure) and the largest model object.
constexpr size_t kSharedBytes = 16384;
constexpr size_t kEngineBytes = 3 * 1024;   // checked against every model's sizeof in macrovoice.cc

class MacroVoice {
 public:
  MacroVoice();
  ~MacroVoice() = default;
  MacroVoice(const MacroVoice&) = delete;
  MacroVoice& operator=(const MacroVoice&) = delete;

  // The host's sample rate. The models are written for 48 kHz; at another rate the pitch is
  // corrected here and the timbre drifts a little, as the module's own port documents.
  void init(double sampleRate);

  // A new note: re-triggers the model (the plucked and modal models ring from it) and clears the
  // gate. `accent` is 0..1 (velocity); the models use it for level and brightness.
  void noteOn(double accent);
  void noteOff();

  // Renders `n` mono frames (n is any size; it is cut into the models' 12-frame blocks).
  // `note` is a MIDI note number as a float (69 = 440 Hz), bend and glide included.
  void render(int model, double note, float harmonics, float timbre, float morph, float* out, int n);

  int model() const { return model_; }

 private:
  void setModel(int model);

  alignas(16) unsigned char engine_[kEngineBytes];
  alignas(16) unsigned char shared_[kSharedBytes];
  stmlib::BufferAllocator allocator_;
  void* engineBase_ = nullptr;   // plaits::Engine*, kept opaque so this header needs no engine includes
  stmlib::Limiter limiter_;
  int model_ = -1;
  bool gate_ = false, rising_ = false;
  float accent_ = 0.8f;
  double pitchOffset_ = 0;       // semitones that make a 48 kHz model sound right at the host's rate
  float outGain_ = 1.0f;
  bool useLimiter_ = false;
};

}  // namespace macroosc

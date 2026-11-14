// See macrovoice.h. The model table and gains below are the module's own (plaits/dsp/voice.cc,
// Voice::Init), kept for the models we ship; the speech, six-operator FM and wavetable models are
// left out because their data cannot be traced, and so are Chord and Terrain, which read the same wavetable bank (docs/macro-osc.md).
#include "macrovoice.h"

#include <algorithm>
#include <cmath>
#include <new>

#include "plaits/dsp/engine/additive_engine.h"
#include "plaits/dsp/engine/engine.h"
#include "plaits/dsp/engine/fm_engine.h"
#include "plaits/dsp/engine/grain_engine.h"
#include "plaits/dsp/engine/modal_engine.h"
#include "plaits/dsp/engine/string_engine.h"
#include "plaits/dsp/engine/swarm_engine.h"
#include "plaits/dsp/engine/virtual_analog_engine.h"
#include "plaits/dsp/engine/waveshaping_engine.h"
#include "plaits/dsp/engine2/chiptune_engine.h"
#include "plaits/dsp/engine2/phase_distortion_engine.h"
#include "plaits/dsp/engine2/string_machine_engine.h"
#include "plaits/dsp/engine2/virtual_analog_vcf_engine.h"

namespace macroosc {

// Ids are what a song stores (modsynth param `macro.model` is an enum over these, in this order);
// never reorder or reuse one. Names say how it sounds, not whose module it came from.
const ModelInfo kModelInfo[kModels] = {
  {"filtered", "Filtered Analog"},
  {"bend",     "Phase Bend"},
  {"ensemble", "Ensemble"},
  {"chip",     "Chip"},
  {"analog",   "Dual Analog"},
  {"shaper",   "Wave Shaper"},
  {"fm",       "FM Pair"},
  {"grain",    "Grain"},
  {"additive", "Additive"},
  {"swarm",    "Swarm"},
  {"string",   "Plucked String"},
  {"modal",    "Modal Bar"},
};

const double kModelTrim[kModels] = {0.566, 0.570, 1.363, 0.564, 0.693, 0.755, 0.664, 0.877, 0.792, 0.598, 3.410, 1.440};   // from native/modsynth/macrolevel.cpp: RMS of one default oscillator, peak held to its peak

namespace {

using plaits::Engine;

struct ModelDef {
  void (*make)(void* where, Engine** out);
  float outGain;   // the module's own post gain; negative means "through its limiter at -gain"
  bool rings;      // makes its own envelope (a pluck or a bar): the note's gate does not shape it
};

template <class T> void construct(void* where, Engine** out) {
  static_assert(sizeof(T) <= kEngineBytes, "raise kEngineBytes");
  static_assert(alignof(T) <= 16, "engine storage is 16-byte aligned");
  *out = new (where) T();
}
void makeChip(void* where, Engine** out) {
  auto* e = new (where) plaits::ChiptuneEngine();
  // The module's own envelope is for its trigger jack; ours is the patch's envelope.
  e->set_envelope_shape(plaits::ChiptuneEngine::NO_ENVELOPE);
  *out = e;
}

const ModelDef kModels_[kModels] = {
  {construct<plaits::VirtualAnalogVCFEngine>,  1.0f, false},
  {construct<plaits::PhaseDistortionEngine>,   0.7f, false},
  {construct<plaits::StringMachineEngine>,     0.8f, false},
  {makeChip,                                   0.5f, false},
  {construct<plaits::VirtualAnalogEngine>,     0.8f, false},
  {construct<plaits::WaveshapingEngine>,       0.7f, false},
  {construct<plaits::FMEngine>,                0.6f, false},
  {construct<plaits::GrainEngine>,             0.7f, false},
  {construct<plaits::AdditiveEngine>,          0.8f, false},
  {construct<plaits::SwarmEngine>,            -3.0f, false},
  {construct<plaits::StringEngine>,           -1.0f, true},
  {construct<plaits::ModalEngine>,            -1.0f, true},
};

}  // namespace

MacroVoice::MacroVoice() {
  std::fill(engine_, engine_ + sizeof(engine_), 0);
  std::fill(shared_, shared_ + sizeof(shared_), 0);
  allocator_.Init(shared_, sizeof(shared_));
  limiter_.Init();
}

void MacroVoice::init(double sampleRate) {
  // The models' pitch maths assumes plaits::kCorrectedSampleRate frames a second.
  pitchOffset_ = sampleRate > 0 ? 12.0 * std::log2((double)plaits::kCorrectedSampleRate / sampleRate) : 0;
  limiter_.Init();
}

void MacroVoice::setModel(int model) {
  allocator_.Free();
  Engine* e = nullptr;
  kModels_[model].make(engine_, &e);
  e->Init(&allocator_);
  e->Reset();
  engineBase_ = e;
  model_ = model;
  outGain_ = kModels_[model].outGain;
  useLimiter_ = outGain_ < 0;
  limiter_.Init();
}

void MacroVoice::noteOn(double accent) {
  accent_ = (float)std::min(1.0, std::max(0.0, accent));
  gate_ = true; rising_ = true;
}

void MacroVoice::noteOff() { gate_ = false; }

void MacroVoice::render(int model, double note, float harmonics, float timbre, float morph, float* out, int n) {
  if (model < 0) model = 0;
  if (model >= kModels) model = kModels - 1;
  if (model != model_) setModel(model);
  Engine* e = static_cast<Engine*>(engineBase_);

  plaits::EngineParameters p;
  p.note = (float)(note + pitchOffset_);
  p.harmonics = std::min(1.0f, std::max(0.0f, harmonics));
  p.timbre = std::min(1.0f, std::max(0.0f, timbre));
  p.morph = std::min(1.0f, std::max(0.0f, morph));
  p.accent = accent_;

  float aux[plaits::kBlockSize];
  const float postGain = useLimiter_ ? 1.0f : outGain_;
  int done = 0;
  while (done < n) {
    const int chunk = std::min<int>((int)plaits::kBlockSize, n - done);
    // A patched trigger: the plucked and modal models are struck by the edge and ring on their own;
    // with it unpatched they would be re-excited by noise all the time.
    p.trigger = (rising_ ? plaits::TRIGGER_RISING_EDGE : plaits::TRIGGER_LOW) |
                (gate_ ? plaits::TRIGGER_HIGH : plaits::TRIGGER_LOW);
    rising_ = false;
    bool enveloped = kModels_[model].rings;
    e->Render(p, out + done, aux, (size_t)chunk, &enveloped);
    if (useLimiter_) limiter_.Process(-outGain_, out + done, (size_t)chunk);
    if (postGain != 1.0f) for (int i = 0; i < chunk; i++) out[done + i] *= postGain;
    done += chunk;
  }
}

}  // namespace macroosc

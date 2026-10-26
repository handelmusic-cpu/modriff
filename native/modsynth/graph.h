// The graph interpreter: plays a Web Audio graph the page recorded.
//
// The page builds each note as a small graph of Web Audio nodes (see
// tests/graph/graphrec.js for the recorder and the layout of the program it
// writes). This is the other end: it reads that program and renders it, in
// the browser's 128-frame quanta, with the browser's AudioParam timeline and
// node maths for the handful of node types the voices use — gain, oscillator,
// biquad, buffer source, wave shaper, stereo panner, delay.
//
// It is not a null test. Web Audio's oscillator is a band-limited wavetable
// and its filters are specified to a tolerance, not to the sample; the proof
// is measured closeness against the browser's own render of the same voice
// (tests/graph/voices.test.js), the way the master bus is held to the
// browser's compressor.
//
// Single-threaded and allocation-free in render(): load() builds everything.
#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace modsynth {

class Graph {
 public:
  static constexpr int kQuantum = 128;
  Graph();
  ~Graph();
  Graph(const Graph &) = delete;
  Graph &operator=(const Graph &) = delete;

  // Takes the recorder's program. Times in it are the context's; `timeBase`
  // is subtracted so 0 is where this graph starts. False if the program is
  // malformed or a cycle was found, with error() saying which.
  bool load(const double *prog, size_t len, double timeBase);
  const char *error() const { return err_; }

  // Renders `frames` (at most kQuantum) and advances the graph's clock.
  void render(int frames);

  // The host's endpoints (the recorder's createExt, in node order). `ext(i)`
  // is the i-th; its id is the recorder's own node id, which is what the
  // host maps to a part bus.
  int extCount() const;
  int extId(int i) const;
  const float *extBuf(int i, int ch) const;  // valid until the next render

  double sampleRate() const { return sr_; }
  uint64_t frame() const { return frame_; }

 private:
  struct Impl;
  std::unique_ptr<Impl> d_;
  const char *err_ = "";
  double sr_ = 48000;
  uint64_t frame_ = 0;
};

}  // namespace modsynth

// The page owns the cents table. The native clock only looks up the offset
// under the chord that covers the note's actual (swung/humanized) frame.
#pragma once
#include <array>
#include <cmath>
namespace modsynth {
struct Tuning {
  bool enabled = false;
  std::array<double,12> table{};
  double cents(int note, int root) const {
    if (!enabled || root < 0) return 0;
    return table[(size_t)(((note - root) % 12 + 12) % 12)];
  }
};
}

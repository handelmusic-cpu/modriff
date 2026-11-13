#import "ModLink.h"

#include "ABLLink.h"

// Callbacks arrive on the main thread (ABLLink.h says so), so plain logging is
// safe here. Nothing in this file runs on the audio thread yet: slice 1 adds
// the capture/commit pair to the render callback.
static void onSessionTempo(double bpm, void *context) {
  NSLog(@"[ModLink] session tempo %.3f", bpm);
}

static void onEnabled(bool enabled, void *context) {
  NSLog(@"[ModLink] enabled %d", enabled ? 1 : 0);
}

static void onPeers(size_t peers, void *context) {
  NSLog(@"[ModLink] peers %zu", peers);
}

@implementation ModLink {
  ABLLinkRef _link;
}

+ (instancetype)shared {
  static ModLink *one;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ one = [ModLink new]; });
  return one;
}

- (void)startWithBpm:(double)bpm {
  if (_link) return;
  _link = ABLLinkNew(bpm);
  ABLLinkSetSessionTempoCallback(_link, onSessionTempo, NULL);
  ABLLinkSetIsEnabledCallback(_link, onEnabled, NULL);
  ABLLinkSetNumPeersCallback(_link, onPeers, NULL);
  ABLLinkSetActive(_link, true);
  NSLog(@"[ModLink] started: tempo %.3f enabled %d connected %d peers %lu",
        self.sessionTempo, self.enabled ? 1 : 0, self.connected ? 1 : 0,
        (unsigned long)self.peers);
}

- (double)sessionTempo {
  if (!_link) return 0;
  return ABLLinkGetTempo(ABLLinkCaptureAppSessionState(_link));
}

- (BOOL)enabled { return _link && ABLLinkIsEnabled(_link); }
- (BOOL)connected { return _link && ABLLinkIsConnected(_link); }
- (NSUInteger)peers { return _link ? ABLLinkNumPeers(_link) : 0; }

@end

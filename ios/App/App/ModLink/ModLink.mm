#import "ModLink.h"
#import "../ModEngine/ModEngineHost.h"

#include <atomic>
#include <algorithm>
#include <mach/mach_time.h>

#include "ABLLink.h"
#include "ABLLinkSettingsViewController.h"

namespace {

// What the audio thread may read: no Objective-C object, no lock. Never freed
// (ModLink is a singleton), so a block that is still rendering when the engine
// is rebuilt cannot be left holding a dead pointer.
struct Core {
  ABLLinkRef link = nullptr;
  std::atomic<int> enabled{0}, peers{0};
  std::atomic<double> tempo{0};          // the stable value the SDK reports for display
  std::atomic<double> pendingBpm{0};     // a tempo the page proposed, for the next block
  std::atomic<uint64_t> lastAudio{0};    // mach time of the last block that came through the hook
};

// Link takes 20 to 999; the engine's map takes more, the session does not.
double clampBpm(double b) { return std::max(20.0, std::min(999.0, b)); }

// ── audio thread ── once per block (ModEngineHost renderInto:...hostTime:).
// Only the calls ABLLink.h documents as realtime-safe: capture, the pure
// conversions, and commit when something was changed.
void audioHook(void *context, ModLinkIO *io) {
  Core *c = (Core *)context;
  if (!c || !c->link) return;
  ABLLinkSessionStateRef st = ABLLinkCaptureAudioSessionState(c->link);
  bool changed = false;
  double bpm = c->pendingBpm.exchange(0, std::memory_order_relaxed);
  if (io->proposeBpm > 0) bpm = io->proposeBpm;
  if (bpm > 0) { ABLLinkSetTempo(st, clampBpm(bpm), io->hostTime); changed = true; }
  // Before the beat is read, so the block that carries out the request already reports the moved bar line.
  if (io->align) { ABLLinkRequestBeatAtTime(st, 0, io->alignHostTime, io->quantum); changed = true; }
  if (changed) ABLLinkCommitAudioSessionState(c->link, st);
  io->beat = ABLLinkBeatAtTime(st, io->hostTime, io->quantum);
  io->tempo = ABLLinkGetTempo(st);
  io->enabled = c->enabled.load(std::memory_order_relaxed);
  io->peers = c->peers.load(std::memory_order_relaxed);
  c->lastAudio.store(mach_absolute_time(), std::memory_order_relaxed);
}

// The SDK calls these on the main thread.
void onSessionTempo(double bpm, void *context) { ((Core *)context)->tempo.store(bpm); }
void onEnabled(bool enabled, void *context) { ((Core *)context)->enabled.store(enabled ? 1 : 0); NSLog(@"[ModLink] enabled %d", enabled ? 1 : 0); }
void onPeers(size_t peers, void *context) { ((Core *)context)->peers.store((int)peers); NSLog(@"[ModLink] peers %zu", peers); }

}  // namespace

@implementation ModLink {
  Core *_core;
  void (^_settingsDone)(void);
}

+ (instancetype)shared {
  static ModLink *one;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ one = [ModLink new]; });
  return one;
}

- (instancetype)init {
  if ((self = [super init])) _core = new Core();
  return self;
}

- (void)startWithBpm:(double)bpm {
  if (_core->link) return;
  ABLLinkRef link = ABLLinkNew(clampBpm(bpm));
  ABLLinkSetSessionTempoCallback(link, onSessionTempo, _core);
  ABLLinkSetIsEnabledCallback(link, onEnabled, _core);
  ABLLinkSetNumPeersCallback(link, onPeers, _core);
  _core->enabled.store(ABLLinkIsEnabled(link) ? 1 : 0);
  _core->peers.store((int)ABLLinkNumPeers(link));
  _core->tempo.store(ABLLinkGetTempo(ABLLinkCaptureAppSessionState(link)));
  _core->link = link;
  ABLLinkSetActive(link, true);
  NSLog(@"[ModLink] started: tempo %.3f enabled %d peers %d", _core->tempo.load(), _core->enabled.load(), _core->peers.load());
}

- (void)attachToHost:(ModEngineHost *)host {
  if (_core->link) [host setLinkHook:audioHook context:_core];
}

- (void)showSettingsFrom:(UIViewController *)presenter done:(void (^)(void))done {
  if (!_core->link) { if (done) done(); return; }
  ABLLinkSettingsViewController *pane = [ABLLinkSettingsViewController instance:_core->link];
  UINavigationController *nav = [[UINavigationController alloc] initWithRootViewController:pane];
  pane.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemDone target:self action:@selector(closeSettings:)];
  // A sheet, not full screen: Ableton recommend a popover, and on the Mac and iPad a form sheet is the centred dialog every
  // other sheet of this app is.
  nav.modalPresentationStyle = UIModalPresentationFormSheet;
  _settingsDone = [done copy];
  nav.presentationController.delegate = (id<UIAdaptivePresentationControllerDelegate>)self;
  [presenter presentViewController:nav animated:YES completion:nil];
}

- (void)closeSettings:(id)sender {
  UIViewController *top = UIApplication.sharedApplication.keyWindow.rootViewController;
  while (top.presentedViewController && ![top.presentedViewController isBeingDismissed]) top = top.presentedViewController;
  [top dismissViewControllerAnimated:YES completion:^{ [self settingsClosed]; }];
}

// Swiped down instead of Done.
- (void)presentationControllerDidDismiss:(UIPresentationController *)presentationController { [self settingsClosed]; }

- (void)settingsClosed {
  void (^done)(void) = _settingsDone; _settingsDone = nil;
  if (done) done();
}

- (void)proposeTempo:(double)bpm {
  if (!_core->link || !(bpm > 0)) return;
  bpm = clampBpm(bpm);
  // Half a second without a block means the engine is not rendering (not started yet, or the route is being rebuilt).
  mach_timebase_info_data_t tb; mach_timebase_info(&tb);
  const uint64_t now = mach_absolute_time(), last = _core->lastAudio.load();
  const double sinceMs = last ? (double)(now - last) * tb.numer / tb.denom / 1e6 : 1e9;
  if (sinceMs < 500) { _core->pendingBpm.store(bpm); return; }
  ABLLinkSessionStateRef st = ABLLinkCaptureAppSessionState(_core->link);
  ABLLinkSetTempo(st, bpm, now);
  ABLLinkCommitAppSessionState(_core->link, st);
}

- (void)setActive:(BOOL)active { if (_core->link) ABLLinkSetActive(_core->link, active); }

- (double)sessionTempo {
  if (!_core->link) return 0;
  return ABLLinkGetTempo(ABLLinkCaptureAppSessionState(_core->link));
}
- (BOOL)enabled { return _core->link && ABLLinkIsEnabled(_core->link); }
- (BOOL)connected { return _core->link && ABLLinkIsConnected(_core->link); }
- (NSUInteger)peers { return _core->link ? ABLLinkNumPeers(_core->link) : 0; }

@end

// Ableton Link (docs/link.md). The one place the app touches the SDK.
//
// Plain Objective-C on purpose, like ModEngineHost.h: the bridging header
// imports this, and Swift never sees ABLLink.h's C types, so the SDK stays
// behind one file. The engine does not see it either: it gets a C function to
// call once per audio block (attachToHost:) and keeps its own tempo map.
#import <UIKit/UIKit.h>

@class ModEngineHost;

NS_ASSUME_NONNULL_BEGIN

@interface ModLink : NSObject

+ (instancetype)shared;

/// Creates the one ABLLink instance and marks it active. Link joins a session
/// only once the user has switched it on in Ableton's own preference pane
/// (showSettingsFrom:), so until then this sends nothing on the network.
- (void)startWithBpm:(double)bpm;

/// Gives the engine its per-block hook into the session. Call when a host is
/// built; the hook outlives the host (this object is never destroyed).
- (void)attachToHost:(ModEngineHost *)host;

/// Ableton's preference pane, the only place Link can be switched on or off
/// (their UI guidelines require it to be theirs). `done` runs when it closes.
- (void)showSettingsFrom:(UIViewController *)presenter done:(void (^ _Nullable)(void))done;

/// The user moved the tempo: the session takes it. Carried out on the audio
/// thread when the engine is rendering (the SDK wants the session changed from
/// one thread only), on this thread otherwise.
- (void)proposeTempo:(double)bpm;

/// When Link is not active it leaves the network: the app is in the
/// background and not playing.
- (void)setActive:(BOOL)active;

/// Session tempo as the app sees it; the starting tempo when alone.
/// 0 before startWithBpm:.
@property (nonatomic, readonly) double sessionTempo;
@property (nonatomic, readonly) BOOL enabled;
@property (nonatomic, readonly) BOOL connected;
@property (nonatomic, readonly) NSUInteger peers;

@end

NS_ASSUME_NONNULL_END

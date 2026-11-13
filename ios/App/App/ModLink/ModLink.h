// Spike (docs/link.md, slice 0): proves LinkKit links into the app on every
// platform it builds for and that the session tempo can be read.
//
// Plain Objective-C on purpose, like ModEngineHost.h: the bridging header
// imports this, and Swift must never see ABLLink.h's C types directly, so the
// SDK stays behind one file that can be compiled out.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ModLink : NSObject

+ (instancetype)shared;

/// Creates the one ABLLink instance and marks it active. Link still only joins
/// a session once the user has switched it on in Ableton's own preference pane
/// (no such pane is shown yet), so this alone sends nothing on the network.
- (void)startWithBpm:(double)bpm;

/// Session tempo as the app thread sees it; the starting tempo when alone.
/// 0 before startWithBpm:.
@property (nonatomic, readonly) double sessionTempo;
@property (nonatomic, readonly) BOOL enabled;
@property (nonatomic, readonly) BOOL connected;
@property (nonatomic, readonly) NSUInteger peers;

@end

NS_ASSUME_NONNULL_END

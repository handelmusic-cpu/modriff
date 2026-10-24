// The C++ mõdSynth, as something Swift can hold.
//
// Everything below the bridge is C++ (modsynth::Processor, one per part) and
// everything above it is Swift (AVAudioSession, AVAudioEngine, the Capacitor
// plugin). This header is deliberately plain Objective-C — no C++ in it — so
// the Swift side can import it through the bridging header without needing
// to understand std::vector or a class template.
//
// The division of labour, which is the whole point of the design:
//
//   post:      called from whatever thread Capacitor runs plugin calls on.
//              Parses an NSDictionary (allocating freely, because it is not
//              the audio thread) into a fixed-size POD and puts it in a
//              lock-free queue.
//   renderInto: called from the audio thread. Drains the queue, applies the
//              messages, renders. Allocates nothing and takes no lock.
//
// That split is why the message is parsed where it is: JSON → POD on the
// caller's thread, POD → engine on the render thread.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ModEngineHost : NSObject

/// Builds the host. `maxFrames` is the largest block renderInto will ever be
/// asked for; the scratch buffers are sized to it once, here, because the
/// render thread cannot grow them later.
- (instancetype)initWithSampleRate:(double)sampleRate maxFrames:(int)maxFrames;

/// Creates the processor for a part if it does not exist yet. Allocates (the
/// wavetable bank is ~13 ms of work and several MB), so it must be called off
/// the audio thread — the render callback only ever reads the slot. Returns NO
/// if `part` is out of range.
- (BOOL)ensurePart:(int)part;

/// Queues one message. The dictionary is the same shape the worklet's port
/// takes — {t:'on', note:…, vel:…, id:…, at:…} and the rest — plus a `part`
/// key saying which processor it is for. Returns NO if the queue is full,
/// which is a dropped message and is counted in `dropped`.
- (BOOL)post:(NSDictionary *)message;

/// Renders `frames` frames of every live part, summed, into L and R.
/// **Audio thread only.** Overwrites the buffers.
- (void)renderInto:(float *)left right:(float *)right frames:(int)frames;

/// Creates the part like ensurePart, but first grows the engine's internal
/// containers to their steady-state size by playing and releasing notes into a
/// private buffer, and publishes it to the render thread only afterwards, so
/// the warm-up is never heard. Does nothing to a part that already exists (the
/// render thread owns it by then). Without it the first few notes of a session would each
/// allocate on the render thread as std::vector grows; with it the capacity
/// is already there and the steady state allocates nothing. See the note in
/// the implementation — this is the honest version of "the render thread
/// never allocates", not a claim that it cannot.
- (BOOL)warmUpPart:(int)part;

@property (nonatomic, readonly) double sampleRate;
/// Frames rendered since the engine started — the engine's clock, which is
/// what a message's `at` is measured against.
@property (nonatomic, readonly) uint64_t framesRendered;
/// Messages refused because the queue was full. Should stay 0; if it does
/// not, the queue is too small or the producer is too chatty.
@property (nonatomic, readonly) uint32_t dropped;
/// Voices sounding across every part, for the diagnostics readout.
@property (nonatomic, readonly) int activeVoices;
/// Loudest sample produced since this was last read, and note-ons applied.
/// Together they answer the one question a load figure cannot: did this
/// engine actually make a sound? Four rounds of debugging went past a bridge
/// reporting dropped=0, failed=0 and a healthy load while it produced pure
/// silence, because nothing measured the output.
@property (nonatomic, readonly) float peakOut;
@property (nonatomic, readonly) uint32_t notesOn;

/// Renders `frames` into a throwaway buffer, off the audio graph entirely,
/// and answers with the loudest sample. It is how "the DSP makes sound" gets
/// asked separately from "the graph stays alive" — two failures that look
/// identical from the outside and have nothing to do with each other.
- (float)renderOfflinePeakForPart:(int)part frames:(int)frames;

/// A part's RMS level: the loudest block since this was last called, then
/// reset. Any thread. The page's mixer meters poll it.
- (float)meterForPart:(int)part;

/// Capture for the recorder (v5 step N5). The page's Bounce taps Web Audio
/// nodes, and a native part is in none of them, so the host copies its own
/// output into rings the page drains. `mask` says which: bit 0 is the master
/// (after volume, the last thing before the speaker), bit 1+p is part p's own
/// bus (after its strip, mõdFX and pan, before the master: the stem).
/// A stream that is already running is left alone, so a later call can add
/// streams to a take; one that was stopped starts a new take and forgets
/// what the last left. Any thread.
- (void)startCapture:(uint32_t)mask;
/// Stops writing. What was captured stays readable until the next start.
- (void)stopCapture;
/// What has been captured since the last call, per stream:
/// {streams:[{id, frame0, frames, lost, data}], originMs, sampleRate}.
/// `data` is `frames` floats of left then `frames` of right. `frame0` is the
/// engine frame the first sample was rendered at, `lost` how many frames were
/// overwritten before they were read (frame0 has already moved past them).
/// `originMs` is where engine frame 0 sits on the wall clock (CLOCK_REALTIME,
/// ms), so engine frame f was rendered at originMs + f / rate: how the page
/// turns engine frames into its own AudioContext's. 0 until a block has been
/// rendered. Any thread.
- (NSDictionary *)readCapture;

@end

NS_ASSUME_NONNULL_END

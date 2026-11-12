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

// ── The graph path ──────────────────────────────────────────────────────
// The page records a note's Web Audio graph and sends it as numbers; the host
// plays it with the C++ interpreter (graphpool.h), into the part's own bus, so
// the part has a strip and mõdFX but no Processor. All of these on the control
// thread (the one plugin calls arrive on), in the order the page sent them: a
// clip, then the graph that names it, then its edits.

/// A part played as graphs: strip and mõdFX, no engine, no rack. Off the audio
/// thread. NO if `part` is out of range.
- (BOOL)ensureGraphPart:(int)part;
/// A decoded clip by id, as float32 channels (one or two). Once per clip.
- (BOOL)putGraphBuffer:(int)bufId sampleRate:(double)sr channels:(NSArray<NSData *> *)channels;
/// Starts a voice from a program (little-endian float64s). `timestampMs` is the
/// page's wall clock when it opened the voice. Answers {handle, unknownBuffer}:
/// handle >= 0 when it began, -2 when the program names a clip the host lacks
/// (unknownBuffer says which, and the page sends it again), -1 when it was
/// refused or the pool is full.
- (NSDictionary *)beginGraph:(int)gid program:(NSData *)program timestampMs:(double)ts;
/// Later changes to a voice (float64 increments). NO if it has finished.
- (BOOL)editGraph:(int)gid increments:(NSData *)increments;
/// {voices, dropped, lateEdits}: what the pool is playing and what it refused.
- (NSDictionary *)graphStats;

// ── The native sequencer (native/modsynth/seqcore.h; docs/native-scheduling.md slice 1) ──
// The clock and the drum grid, on a thread of the host's own, counted in the render thread's frames. So far it
// expands the score and counts what it would play; the voice bank that makes the sound is not wired to it. Any thread.

/// The drum score, float64s as `window._sqNativeScore()` makes them. NO if it does not parse.
- (BOOL)seqSetDrumScore:(NSData *)score;
/// Starts at step 0, the downbeat `leadMs` from now. NO if there is no score yet.
- (BOOL)seqStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs seed:(double)seed;
/// A voice the page recorded for a drum lane, with the map of what in it follows velocity, accent, pitch and time
/// (native/modsynth/voicebank.h). NO if it does not parse.
- (BOOL)seqPutBankEntry:(NSData *)entry;
- (void)seqClearBank;
- (void)seqStop;
/// Takes effect from the next step. A value of 0 or less leaves that one alone.
- (void)seqSetTempo:(double)bpm rate:(double)rate;
/// The song for the engine's own loop, float64s as `window._songNativeScore().score` makes them. NO if it does not parse.
- (BOOL)seqSetSong:(NSData *)score;
/// Starts the song at chord `slot` of `section`, `pass` passes in, on the drums' next bar line (`align`, drums running) or `leadMs` from now. The bass reads the
/// chord windows it makes. NO without a song or with no chord there.
- (BOOL)seqSongStartWithLeadMs:(double)leadMs alignToDrums:(BOOL)align section:(int)section slot:(int)slot pass:(int)pass;
- (void)seqSongStop;
- (void)seqSongHold;
- (void)seqSongArm:(int)kind;
/// A Next (+1) or Prev (-1) queued by the player: taken at the end of the pass.
- (void)seqSongMove:(int)delta;
/// The live key change, in semitones.
- (void)seqSongSetCapo:(int)capo;
/// The tempo moves in a straight line in time from what it is now to `bpm` over `ms`, then holds it (a ritardando; the engine's own tempo changes).
/// The drums, the bass and the chord rhythm follow it on one grid. `seqMirror` says the tempo at the render clock as `tempo`.
- (void)seqTempoRampTo:(double)bpm overMs:(double)ms;
/// For tests: keep what is expanded (13 float64s an event, see HostSeq), up to `capacity` events.
- (void)seqRecord:(BOOL)on capacity:(int)capacity;
- (NSData *)seqTakeEvents;
/// Retained seven-double musical events and native frame/wall-clock mapping.
- (NSDictionary *)seqObserveAfter:(double)after limit:(int)limit;
- (BOOL)seqSetObserverRoutes:(NSData *)routes localMask:(int)mask;
/// {running, step, bar, frame, steps, events, late, firstFrame, nextFrame, recDropped, hits, misses, silent, refused,
/// lateStarts, bank, lastMiss}: hits are events begun as voices, misses ones with no voice in the bank (lastMiss says
/// which), silent ones at a velocity of nothing, refused ones the pool would not take. step and bar are the last
/// step whose moment the render clock has reached (the playhead), late the steps expanded after their moment.
- (NSDictionary *)seqMirror;

/// The page's cents table and chord glide controls. Root is the standalone
/// arp's current chord root, or -1; songs use their native chord windows.
- (BOOL)seqSetIntonation:(NSData *)table pure:(BOOL)pure glide:(BOOL)glide glideTime:(double)time root:(int)root;

/// A hand chord for the running native followers. One window per timeline,
/// relative to the stamp in seconds, with each part's phrase locks, and float64 arp tones.
/// Same timestamp clock as beginGraph. Queued at that frame; committed notes
/// remain intact. Refused while a native song owns the timeline or all followers stop.
- (NSDictionary *)seqLiveChord:(NSData *)bass melody:(NSData *)mel notes:(NSData *)notes timestampMs:(double)ts;

// ── The bass line (native/modsynth/basscore.h, bassplay.h; slice 2) ──
// On the same thread and with the same bank as the drums. The mirror's `bass` has running, nextStep, steps, notes, hits, misses
// (no voice in the bank: lastMissLane), refused, cuts (a note cut short by the next), lateStarts, windows.

/// The bass score, float64s as `window._blNativeScore().score` makes them. NO if it does not parse.
- (BOOL)seqSetBassScore:(NSData *)score;
- (BOOL)seqSetBassScore:(NSData *)score revision:(double)revision;
/// The chord windows, float64s as `window._blNativeChords(sr)` makes them: frames from the line's start. Empty clears them.
- (BOOL)seqSetBassChords:(NSData *)chords;
/// A line written ahead for the next chord, float64s as `window._blNativePending(sr)` makes them: frames from the line's start. It takes over at its
/// moment (or at the top of the loop when it has none). A first double that is not 1 clears it. NO if it does not parse.
- (BOOL)seqSetBassPending:(NSData *)pending;
- (BOOL)seqSetBassPending:(NSData *)pending revision:(double)revision;
/// Starts at step 0 with the drums' downbeat when they are running and `align` is set, else `leadMs` from now. `kit` is the bank's
/// code for the bass voice. NO without a score.
- (BOOL)seqBassStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed;
- (void)seqBassStop;
- (void)seqBassSetTempo:(double)bpm rate:(double)rate;

// ── The arpeggiator (native/modsynth/arpcore.h, arpplay.h; slice 3) ──
// On the same thread and with the same bank as the drums (part 5). In a song it follows the song's chords. The mirror's `arp` has running, steps (the clock's),
// notes (struck as notes), blocks, voices (begun), misses (no voice in the bank: lastMissLane), refused, lateStarts, chords (taken from the song), armed, bySong, tones.

/// The arp's settings, float64s as `window._arpNativeScore().score` makes them. NO if it does not parse.
- (BOOL)seqSetArpScore:(NSData *)score;
/// The chord the arp is on: float64 MIDI notes with the octaves already added (`window._arpNativeNotes()`); the pattern starts again. Empty: none. NO for a note out of range.
- (BOOL)seqSetArpNotes:(NSData *)notes;
/// Whether a song, when it starts, brings the arp in on its bar line (following the song's chords). `kit` is the bank's code for the arp voice.
- (void)seqArpArm:(BOOL)on kit:(int)kit;
/// Starts the arp by itself: with the drums' bar line when they run and `align` is set, else `leadMs` from now, on the chord it was given. NO without a score.
- (BOOL)seqArpStartWithBpm:(double)bpm leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed;
- (void)seqArpStop;

// ── The melody generator (native/modsynth/melcore.h, melplay.h; slice 3 part three) ──
// On the same thread and with the same bank as the drums (part 6). In a song it is handed the song's chord windows (and its own phrase locks). The mirror's `mel` has running, nextStep,
// steps, notes (struck), slides (notes that slid in), voices (begun), misses (no voice in the bank: lastMissLane), refused, lateStarts, windows, armed, bySong.

/// The melody generator's line, float64s as `window._mlNativeScore().score` makes them. NO if it does not parse.
- (BOOL)seqSetMelPending:(NSData *)pending;
- (BOOL)seqSetMelPending:(NSData *)pending revision:(double)revision;
- (BOOL)seqSetMelScore:(NSData *)score;
- (BOOL)seqSetMelScore:(NSData *)score revision:(double)revision;
/// The chord windows with the melody's phrase locks, float64s as `window._mlNativeChords(sr)` makes them: frames from the line's start. For a start by hand; empty clears them.
- (BOOL)seqSetMelChords:(NSData *)chords;
/// Whether a song, when it starts, brings the melody in on its bar line (following its chords). `kit` is the bank's code for the voice, `rate` the melody's rate multiplier.
- (void)seqMelArm:(BOOL)on kit:(int)kit rate:(double)rate;
/// Starts the melody by itself: with the drums' bar line when they run and `align` is set, else `leadMs` from now. NO without a score.
- (BOOL)seqMelStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed;
- (void)seqMelStop;
- (void)seqMelSetTempo:(double)bpm rate:(double)rate;

// ── The chord comp (native/modsynth/chordcore.h, chordplay.h; slice 2) ──
// The chord rhythm on the same thread and bank. The mirror's `chord` has running, nextStep, steps, hits (struck), chords (composed), voices, stops
// (the chord before stopped), misses (a pitch missing from the bank), refused.

/// The chord rhythm and its chord, float64s as `window._crNativeScore().score` makes them. NO if it does not parse.
- (BOOL)seqSetChordScore:(NSData *)score;
/// Starts at step 0 with the drums' downbeat when they are running and `align` is set, else `leadMs` from now. `kit` is the bank's code for the chord voice.
- (BOOL)seqChordStartWithBpm:(double)bpm leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit;
- (void)seqChordStop;
- (void)seqChordSetTempo:(double)bpm;

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
/// rendered. `drainMs` is how far (ms) the blocks that placed notes sat from
/// that origin on average: notes are placed from the block that drains them,
/// the audio is `drainMs` earlier than the origin says, and the caller adds it
/// back. Any thread.
- (NSDictionary *)readCapture;

@end

NS_ASSUME_NONNULL_END

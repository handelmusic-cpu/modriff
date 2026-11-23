# Ringtone / alarm-sound export (short design)

Status: draft, parked for after launch (listed in `docs/v5-architecture.md`,
section 5). Nothing built; not yet approved.

## Intent
The owner once ended up with a quick bounce as an iPhone ringtone by accident and
liked it. They want that to be a one-tap, deliberate thing: turn a take into a
ringtone or alarm sound. Alarms in Clock draw from the same tone list, so one
export covers both.

## The constraint (why it is not literally automatic)
iOS has no API for an app to install a ringtone. The file must be an `.m4r`
(AAC, 30 s or less) and gets into Settings > Sounds through GarageBand
(Share > Ringtone) or a Finder sync. "Automatic" therefore means: everything
up to the hand-off is done for you. The GarageBand step is not verified on a
current iOS; the owner could not recall how the accidental one happened.

## Goals
- One action on a finished take produces a ready `.m4r`.
- The result sounds right as a ringtone: cut to length, faded, not clipped.
- Reuses the existing share path, so no new permissions.

## Non-goals
- Installing the tone ourselves (not possible).
- A ringtone-specific sequencer, loop builder or preset pack.
- Changing normal WAV bounces.

## Anti-goals
- A flow that promises "set as ringtone" and then leaves people stuck.
  The hint after sharing must say what to do next, plainly.

## Approaches considered
1. **Ringtone export on a finished take (chosen):** pick start and length (max 30 s),
   fade, level, encode `.m4r`, share sheet, two-line hint. Mac app also drops the
   file in the Bounces folder.
2. Add an M4A/M4R format to normal bounces: smallest, but a full-length bounce is
   too long to be a ringtone, so it solves little.
3. Mac-only folder drop: useful as an extra to 1, useless to phone-only users.

The owner said they had no preference on how, so this is my call, not their pick.

## Design (my calls, marked as such)
- **Where:** a "Ringtone" button beside the take's save/share actions
  (builder to find the exact spot near `_finishSinkMix` / `_exportName`).
- **Cutting:** a start slider and a length (5 to 30 s, default 30) over a
  waveform of the take. Default start 0. (My call.)
- **Processing:** 0.25 s fade in, 1 s fade out, peak-normalise to about -1 dBFS.
  (My call; adjust by ear.)
- **Encoding:** new Swift method in `ModEngine.swift` that takes a take's file
  and cut points, writes AAC with `AVAudioFile` or `AVAssetExportSession`,
  names it `<title>.m4r` in the temp directory, then hands it to the existing
  share-sheet code. The page never base64s the whole take.
- **Hint:** after the share sheet, a toast or small card:
  "Open the file in GarageBand, then Share > Ringtone."
- **Mac Catalyst (first-class route, no GarageBand):** writes the `.m4r` to
  `~/Downloads/mõdRïff/Bounces` and reveals it in Finder, hint: "Drag it onto
  your iPhone in Finder; it appears under Settings > Sounds." The owner has used
  this route before (the old iTunes `.m4a` to `.m4r` rename). On iPhone the
  share sheet works too, so AirDrop to the Mac then drag also works.
- **No emoji, no product names in the UI** except GarageBand in the hint
  (builder to decide whether that is acceptable or to say "the GarageBand app").
  Flag for the owner: CLAUDE.md bans other companies' names in anything App
  Review sees, and an Apple app named as an instruction is probably fine, but
  it is the owner's call.

## Left to the builder
- Exact UI placement and the waveform control's look.
- Whether the encoder reads the take from disk or receives PCM.
- Tests: a Swift or Node check that the output is AAC, 30 s or under, with the
  fade applied. "Not heard on device" line in `docs/phone-test-checklist.md`
  for the GarageBand step.
- Version label: the next step at the current depth.

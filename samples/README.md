# samples/

Every audio file the app plays from disk lives here, and every one of them has
a row in [`SOURCES.csv`](SOURCES.csv): where it came from, who made it, under
what licence, and what was done to it. [`CREDITS.md`](CREDITS.md) is the
narrative (how each set was chosen, measured and processed); the CSV is the
record a licence check or an App Store question is answered from. The same rows
also cover `fonts/`, the app icons and the share card, since they have the same
question.

`./check.sh` fails if a file is missing from the CSV, if a row's status is
`UNKNOWN`, or if a pack that needs attribution is missing from the in-app
Credits screen.

## Columns

| column | meaning |
|---|---|
| `path` | repo-relative path of the file |
| `pack` | the instrument, kit or set the file belongs to, as the app names it |
| `source_url` | where it was obtained. The most specific page recorded: a single Freesound sound where CREDITS.md names one, otherwise the pack or project page. Blank when the work is the project's own or no source was recorded |
| `author` | who made it. For a set repackaged by someone else, the repackager is named too |
| `license` / `license_url` | the licence as recorded, and a link to its text (or the file in this repo that holds it) |
| `attribution_required` | `yes` when the licence obliges the app to credit the author (CC BY, OFL, MIT, Bitstream Vera), `no` when it does not (CC0, the project's own work). Blank for a file that is not a creative work |
| `changes` | what was done between the original and the shipped file: trimmed, pitch-corrected, re-encoded. CC BY asks for a note of changes |
| `retrieved_date` | when the original was downloaded. **Blank everywhere today**: it was never written down, and it is not reconstructed from commit dates, which say when a file was added, not when it was fetched |
| `sha256` | hash of the file as shipped |
| `status` | `VERIFIED`, `NEEDS-CONFIRM` or `UNKNOWN` (below) |
| `credit_group` | which entry of the Credits screen (`CREDITS_TABLE` in `index.html`) covers the row. Blank when the row needs no credit line, or cannot have one yet |
| `notes` | anything that qualifies the row: the caveat, the source file name, the open question |

## Status

- **VERIFIED**: a source and a licence are both recorded in this repo, with a
  link, and nothing in the entry is waiting on a person.
- **NEEDS-CONFIRM**: a source and a licence are recorded, but one thing rests on
  someone's word or on an inference (a pack "supplied by the owner", a licence
  stated for a different file in the same family, a free-to-use note with no
  licence text). The `notes` column says which. The file may ship; the question
  stays open until it is answered and the row is promoted.
- **UNKNOWN**: no source, or no licence, is recorded. A file in this state
  cannot be shown to be redistributable. `check.sh` fails on it. Find the
  source, or take the file out.

A gap is `UNKNOWN`; it is never filled from memory.

## Adding a sample

1. Put the file in `samples/<pack>/`. A new folder, not new bytes under an old
   name: the service worker caches samples by URL for good (see `sw.js`).
2. Find the source *before* you encode anything: the page, the author, and the
   licence text on that page. Save the licence's wording in `CREDITS.md`, with
   what you changed.
3. Add one row per file to `SOURCES.csv`. Take `sha256` from
   `shasum -a 256 <file>`.
4. If `attribution_required` is `yes`, give the row a `credit_group` and make
   sure `CREDITS_TABLE` in `index.html` has an entry with that `id`.
5. Run `./check.sh`.

If you cannot fill in a source and a licence, the file does not ship.

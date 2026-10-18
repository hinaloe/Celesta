# Voice folder import and preparation dependencies

Issue #175. `importVoiceFolder()` (`packages/character/src/voice-folder.ts`)
reads a folder of `name.wav` + `name.txt` pairs, as VOICEROID, A.I.VOICE, or an
AquesTalk front end exports them, into `planDialogue()` lines. Files that
`prepare()` reads are reported to the editor, which reloads when they change.

## API

`importVoiceFolder({ directory, speaker?, recursive?, encoding?, lipSync?,
manifest?, incomplete?, onWarning? })` returns `VoiceLine[]` (a
`DialogueLine` with `id`, `text`, `audio`, `reading?`, `durationInSeconds`,
`source: { wav, txt }`). User documentation: `skills/celesta/references/dialogue.md`
and the website dialogue guide.

- Ids are the names without extension (`sub/name` when recursive). Order is
  `naturalCompare()`: digit runs by value, other runs by `toLowerCase()`
  code units, then plain code units; no `Intl`, so it is the same on every
  platform and ICU build. Names are NFC-normalized.
- Pairing ignores case; two `.wav` (or `.txt`) differing only in case are an
  error on every platform, so a folder never pairs differently on Linux.
- Transcripts: `TextDecoder` with `fatal: true` (`utf-8`, `utf-16le`,
  `shift_jis`) or a function. A UTF-16 BOM under `utf-8`, NULs, or U+FFFD
  fail. CRLF/CR become LF; the whole text is trimmed (`String#trim`, which
  includes U+3000 and the BOM).
- Lip sync reuses the waveform gate (`lipSyncFromAudio()`, new in
  `lipsync.ts`). Kanji (`\p{Script=Han}`) without a `reading`, or no vowels,
  fall back to the open/closed track with a warning.
- Incomplete: missing partner, empty transcript, or a WAV that is empty or
  truncated (`decodeWav` now rejects a data chunk longer than the file).
  `'error'` lists them all; `'skip'` warns.
- Every WAV is copied to `<user cache>/voice-snapshots-v1/<sha256/128>/<name>.wav`
  (same cache root as the editor's audio cache) and `audio` points there,
  so the probe, lip sync, preview, and export read the same bytes even if
  the folder changes mid-export. Snapshots are not pruned; they are small
  and content-addressed.

## Dependency reporting

- `trackPrepareDependency(src)` (`@celesta/react/internal`, `entry-dir.ts`;
  no-op in `entry-dir.browser.ts`) stats a path before it is read and keeps
  the first `{ path, mtimeNs, size }` (`mtimeNs` a bigint decimal string,
  both null when missing). `importVoiceFolder` records each scanned folder,
  each pair, and the manifest; `loadLipSync` records its WAV.
- The CLI's ready line carries `dependencies`; the bridge exposes them as
  `ReactCompositionMetadata::prepare_dependencies`
  (`PrepareDependency::sample()` produces the same form from Rust).

## Editor watcher

- `ReactPreview::dependencies` holds what the last load reported. The 800 ms
  watcher samples those paths (`sample_dependencies`) beside the source
  mtime. A source change reloads as before; a dependency change goes
  through `DependencyDebounce`: it reloads when two consecutive polls see the
  same changed state, and never twice for one state, so a mismatch between
  reported and sampled forms cannot loop.
- A reload records the new load's dependencies; a failed load records the old
  paths as sampled before it, so it retries only after they change again. The
  failed load keeps the last good preview (the preview worker is not
  respawned). Manual reload and export always spawn a fresh runtime.
- Directory mtimes catch additions, deletions, and renames; a file's
  mtime/size catches resaves and atomic replacement. Only reported paths are
  stat'ed; nothing is watched recursively.

## Validation (2026-10-18, macOS)

- `pnpm --dir packages/character test` (voice-folder tests: pairing, natural
  order, encodings, manifest validation, incomplete/partial pairs, case
  handling, kanji fallback, same-name resave, dependency recording, CLI ready
  line).
- `cargo test -p celesta-editor source::` (debounce and sampling, including
  atomic replace and deletion) and
  `cargo test -p celesta-react-bridge --test node_integration` (the example's
  dependencies are reported and match Rust's sampling).
- `celesta-exporter --react packages/cli/examples/with-voice-folder.tsx`
  exported a 12.4 s H.264/AAC MP4 with the three lines in natural order.
- Editor (debug build) on a scratch copy of the folder: resaving `voice-1`
  as a longer take (atomic rename) and editing its text reloaded the preview
  (12:13 → 15:16) with later lines moved; truncating `voice-2.wav` reported
  the file in Problems and kept the last preview; restoring it and adding a
  `voice-11` pair recovered (18:25, `voice-11` after `voice-10`).
- Windows and Linux were not run; the case-collision test runs only on Linux.

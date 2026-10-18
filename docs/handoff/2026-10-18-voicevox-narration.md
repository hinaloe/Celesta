# VOICEVOX narration (2026-10-18)

`prepareNarration(lines, options)` in `@celesta/voicevox`
(`packages/voicevox/src/narration.ts`) synthesizes a script with a local
VOICEVOX Engine during `prepare()` and returns the lines with `audio`,
`lipSync` and `narration` set for `planDialogue()` (issue #174).

- Placement: the issue named `packages/react`, but since the package split
  the VOICEVOX adapter and the dialogue planner live in `@celesta/voicevox`
  and `@celesta/character`; the API sits beside `lipSyncFromVoicevox`. The
  package now has `@types/node` and targets ES2022 (`Error` `cause`). It
  reads `CELESTA_REACT_ENTRY_DIR` itself rather than depending on
  `@celesta/react/internal`.
- API: no provider seam beyond the package boundary; another engine would
  be its own package returning the same `audio`/`lipSync` lines. Speakers
  have no `engine` field. A line needs an `id`; `spokenText` defaults to
  `text` (which must then be a string); `voice` overrides the speaker's
  settings per line. Lines with `audio` pass through untouched.
- Cache key: sha256 of the format version, spoken text, `styleId`, sorted
  `query` settings, `interrogativeUpspeak`, `katakanaEnglish`, and the
  speaker/line and script `revision`s. `baseUrl` is not in the key, so a
  port change keeps the cache. Engine version, user dictionary and models
  are not detected (that would need the engine on every load); authors bump
  `revision` or pass `refresh`. The engine's `/version` is recorded in each
  entry's JSON for diagnosis only.
- Entries: `<key>.wav`, then `<key>.json` (with the WAV's size and sha256
  and the full final query), each via temp file + rename; the old JSON is
  removed before the WAV is replaced. A hit checks the JSON, size, hash and
  that the WAV decodes; anything else resynthesizes. Hits never touch the
  network.
- Duration is measured from the WAV (`decodeWav`); `planDialogue()` still
  measures `audio` itself through the runtime's media probe. The lip sync is
  rebuilt from the saved query on every call with the same
  `interrogativeUpspeak` used for `/synthesis`.
- Concurrency is a semaphore over synthesis jobs; identical keys in one call
  share a job (not across separate calls; atomic renames keep concurrent
  processes safe). On a failure the call waits for in-flight jobs, then
  throws the first `NarrationError` in job order; succeeded lines stay
  cached.
- Tests: `packages/voicevox/test/narration.test.mjs` (mock HTTP engine).
- Verified with `voicevox/voicevox_engine:cpu-ubuntu24.04-latest` (engine
  0.25.2): the lip-sync length equals the WAV length with and without
  upspeak; `packages/cli/examples/with-narration.tsx` exported to MP4 with
  the engine running, and again with it stopped (identical audio stream,
  served from the cache). Not checked in the GPUI preview window.

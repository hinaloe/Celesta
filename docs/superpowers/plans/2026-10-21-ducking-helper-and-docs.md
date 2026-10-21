# Plan-based ducking helper, examples, and docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authors who build a dialogue plan in `prepare()` get the ducking curve as keyframes in one call. The two hand-written ducking recipes in the repository are replaced, and the docs describe ducking.

**Architecture:** `@celesta/character` turns a `DialoguePlan` (optionally with a `VoiceLevelReport`) into speech intervals in seconds, and feeds them to `duckEnvelope` from `@celesta/media-utils`. The #404 example uses that helper. `examples/feature-tour` switches to the declarative `duck` prop, because its voice is a `<Dialogue>` and belongs to `"voice"` by default.

**Tech Stack:** TypeScript, Vitest (`.test.mts`, #458), Markdown docs (skills references, website en/ja).

**Spec:** `docs/superpowers/specs/2026-10-21-audio-ducking-design.md` ("Plan-based helper", step 3 of "Delivery", "Docs").

## Global Constraints

- The helper's curve is `duckEnvelope`'s, which is pinned to the native curve. The helper only chooses intervals.
- Intervals come from the plan. Lines without `audio` and muted lines are skipped. With a `VoiceLevelReport`, a line is trimmed to `speechStartSeconds`…`speechEndSeconds` (capped at its planned length), and a silent line (`speechStartSeconds === null`) is skipped. Without one, or for a line the report did not analyze, a line counts for its planned `from` … `from + durationInFrames`.
- `origin` is in frames on the plan's clock, as `frameKeyframes`' `origin` is.
- New tests are `.test.mts` (#458).
- Run commits and tests as separate steps. Never amend.

## Review Focus

- A plan whose first line starts at frame 0 with an attack before it: the first key lands before 0, which keyframes allow. (Task 1)
- A report from a different line list than the plan (lengths differ): the helper throws rather than pairing lines wrongly. (Task 1)

---

### Task 1: `speechIntervals` and `duckingVolume` in `@celesta/character`

**Files:**
- Create: `packages/character/src/ducking.ts`, `packages/character/test/ducking.test.mts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `duckEnvelope`, `DuckShape` from `@celesta/media-utils`; `DialoguePlan`, `VoiceLevelReport`.
- Produces:
  ```ts
  export function speechIntervals<L extends DialogueLine>(plan: DialoguePlan<L>, options?: { levels?: VoiceLevelReport }): Array<[number, number]>; // seconds, plan clock
  export function duckingVolume<L extends DialogueLine>(
    plan: DialoguePlan<L>,
    duck: DuckShape & { volume?: number },
    options?: { levels?: VoiceLevelReport; origin?: number },   // origin in frames
  ): AnimatedNumber;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `lines count from their planned start for their planned length` (two lines; a muted line and a line without audio are skipped);
  - `a level report trims lines to their speech` (built by hand: one analyzed line, one silent line, one not analyzed);
  - `a report for other lines throws`;
  - `duckingVolume is duckEnvelope over the intervals, with origin in frames`;
  - `an attack before frame 0 keeps its key`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm --dir packages/character test` → FAIL.
- [ ] **Step 3: Implement**, and run → PASS.
- [ ] **Step 4: Commit** — `feat(character): build ducking curves from a dialogue plan (#87)`

### Task 2: Replace the hand-written recipes

**Files:**
- Modify: `packages/cli/examples/with-voice-level-matching.tsx` (remove `speechIntervals`, `duckVolume`, `Duck`; use `duckingVolume` with `{ volume, to, attack, release, holdGap }` converted from the current frame values; the speech bands come from `speechIntervals` × FPS; update the header and the on-screen note)
- Modify: `examples/feature-tour/film.tsx` (`<Audio src="./score.wav" duck={{ under: 'voice', attack: 0.4, release: 0.8 }} />`), delete `examples/feature-tour/audio.ts`, update the file map comment

- [ ] **Step 1: Type-check both entries** the way the repository does for examples (`skills/celesta/scripts/inspect.mjs <entry> --every 30` renders frames and fails on a type error). Expected: no errors.
- [ ] **Step 2: Commit** — `refactor(examples): duck with the shared helper and the duck prop (#87)`

### Task 3: Docs and the spec

**Files:**
- Modify: `skills/celesta/references/react-core.md` (Audio table and a "Ducking" subsection; Video soundtrack note; `frameKeyframes` section points to `duck`), `skills/celesta/references/project-json.md` (audio, video, dialogue items), `skills/celesta/references/dialogue.md` (replace "Ducking BGM and game audio under speech"; the `"voice"` default), `skills/celesta/SKILL.md` index line if it names ducking
- Modify: `packages/website/content/{en,ja}/docs/02-(guides)/06-media.md` (ducking subsection, including the instant-switch note for `attack` / `release` 0), `packages/website/content/{en,ja}/docs/02-(guides)/07-dialogue.md` (the ducking paragraph), `packages/website/content/{en,ja}/docs/03-(reference)/01-reference.md` (rows for `duckEnvelope`, `speechIntervals`, `duckingVolume`)
- Modify: `docs/superpowers/specs/2026-10-21-audio-ducking-design.md`: project `dialogue` items ignore `duck` (the crate ignores unknown fields) rather than reject it
- Create: `docs/handoff/2026-10-21-audio-ducking.md`

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the website's tests** — `pnpm --dir packages/website test` → PASS.
- [ ] **Step 3: Commit** — `docs: document audio ducking (#87)`

# Preview chapters (2026-10-22)

`<Composition chapters>` declares named spans of a React composition, and the
editor preview lists them and seeks to them (issue #144; the runtime API for
scenes is #413's `defineScenes` / `useScene`).

- Declaration: `chapters` takes a `ChapterSource` (`packages/react/src/chapters.ts`):
  `{ id, name?, from, durationInFrames }[]`, or anything holding such spans
  in `scenes` — a `defineScenes` list or a `planDialogue` plan, matched
  structurally, so `@celesta/react` does not depend on `@celesta/character`.
  Nothing is inferred from the React tree.
- Nesting: the list is flat, in the composition's frames. `listChapters(source,
  { from })` checks a source and moves it, so a list played inside one scene
  joins the composition's list at that scene's start. Overlaps are allowed.
- Checks (`compositionChapters`, run by `readCompositionConfig` with the other
  static config props): non-empty unique `id`, string `name` (defaults to
  `id`), non-negative integer `from` and `durationInFrames`, a start before
  the composition's end. A failure fails the mount like a bad `fps`. The list
  is sorted by `from` (stable) and each chapter is cut at the end. Length 0
  is a mark: listed and seekable, never current.
- Protocol: the ready message's `config.chapters` (also on each entry of
  `compositions`); absent when none are declared. The bridge reads it into
  `ReactChapter` / `ReactCompositionMetadata::chapters`, defaulting to empty
  for older runtimes. `chapter_at(chapters, frame)` is the current chapter:
  the latest-starting one containing the frame; none in a gap.
- Editor: `ReactPreview::chapters`, replaced on each successful (re)load and
  kept across failed ones. The timeline shows a Chapters row above the
  tracks when the list is non-empty, overlapping chapters stacked on lanes
  (`chapter_lanes`); the React Preview tab lists name, start and length. The
  current chapter is highlighted; a click pauses and seeks to its start
  (`seek_chapter`). Entries without chapters show neither.
- MCP inspection prints the chapters with their frame ranges.
- Examples: `packages/cli/examples/with-chapters.tsx` (scenes plus a nested
  list), `with-dialogue-series.tsx` (a dialogue plan),
  `examples/feature-tour` (its `defineScenes` list).
- Out of scope: inferring chapters from `<Series>` or conditionals, editing
  the timeline from the list, and keyboard shortcuts for next/previous
  chapter.
- Tests: `packages/react/test/chapters.test.mts`; `react-bridge` unit tests
  (`reads_chapters_from_the_ready_config`, `chapter_at_…`) and the live
  `reports_composition_chapters_in_order_when_node_is_available`; the
  editor's `overlapping_chapters_stack_on_lanes_of_their_own`.

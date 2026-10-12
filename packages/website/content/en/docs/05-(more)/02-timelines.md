> [!NOTE]
> **Deprecated**
> JSON projects are deprecated. Use React compositions for new work. This chapter remains for existing `.celesta.json` projects.

A `.celesta.json` file describes settings, assets, characters, tracks, and properties for older projects. These APIs remain available for compatibility; use React compositions for new work.

- `settings` defines dimensions, frame rate, audio sample rate, and optional duration.
- `assets` registers source media by id: `video`, `audio`, `image`, or `font`. Sources can be local files or HTTP(S) URLs; remote files use the native media cache.
- `tracks` contains video, audio, overlay, or dialogue tracks and their items.
- Each item has a `range` with a start and duration, plus its content and optional `transform`, `opacity`, and `blendMode`.

Time is represented as `{ value, timescale }`: divide the value by the timescale to get seconds. For example, `{ "value": 10, "timescale": 1 }` means ten seconds.

Copy the project below into `project.celesta.json` in your project folder, then open it with **File → Open…**.

View the complete built-in title project

```json file=../../examples/editor-demo.celesta.json title="examples/editor-demo.celesta.json"
```

`examples/minimal.celesta.json` is an empty starting point. For a visible result, begin with the title project above, then change the text and save. Use **File → Reload** to update the preview.

```sh title="Export an existing JSON project"
celesta-exporter project.celesta.json output.mp4
```

## Animate with keyframes

In a JSON transform, `position` places the item’s center. Any transform value, `opacity`, and audio `volume` can be a fixed number or keyframes. Keyframe times are relative to the item’s start, and `easing` shapes the curve into that keyframe:

```json title="Fade an item in over half a second"
"opacity": {
  "type": "keyframes",
  "keyframes": [
    { "time": { "value": 0, "timescale": 30 }, "value": 0 },
    { "time": { "value": 15, "timescale": 30 }, "value": 1, "easing": "ease-out" }
  ]
}
```

Easing names match the React `Easings` in kebab case, such as `ease-in-out-cubic` or `ease-out-back`.

## Dialogue in a JSON project

A JSON project declares characters in `characters` and lines as items on a `dialogue` track. The portrait and subtitle transforms position their centers:

View the complete JSON dialogue project

```json file=examples/dialogue.celesta.json title="dialogue.celesta.json"
```

JSON lines can lip-sync as well: add mouth-image asset ids under the portrait’s `lipSync`, and list timed shapes on the line, such as `"lipSync": [{ "time": { "value": 0, "timescale": 30 }, "shape": "a" }]`. Cue times are relative to the line’s start. For automatic timing from the recording, use React’s `loadLipSync()`.

## Combine a project with React

A React composition can include `<ProjectTimeline />`. Pass its companion JSON project when exporting so Celesta can resolve the timeline:

```sh title="Export React with its companion project"
celesta-exporter --react with-project.tsx --project project.celesta.json output.mp4
```

View the companion React composition

```tsx file=../cli/examples/with-project.tsx title="with-project.tsx"
```

Save this as `with-project.tsx` beside your JSON file. The command above assumes celesta-exporter is on PATH; see [Export a video](/en/docs/export/) for the installed executable paths. To draw one track, use `<ProjectTrack id="…" />`.

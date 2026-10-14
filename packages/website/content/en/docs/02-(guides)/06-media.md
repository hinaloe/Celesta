`Image`, `Video`, and `Audio` read files through `src`. Relative paths start from the composition file, so keep media beside it in your project folder.

`src` can also be an `http://` or `https://` URL. Native preview, export, and `preloadMedia()` download it into a local cache on first use. Later runs reuse the cached file without revalidation; use a new URL or clear the cache when its content changes.

```tsx file=examples/media.tsx title="media.tsx"
```

- An `Image` or `Video` is drawn at its own pixel size. Position it with `x`/`y` and anchors, and resize it with `scale` or a `Fit`. Images can be PNG, JPEG, WebP, GIF, or PNM.
- An animated GIF, APNG, or WebP plays on the enclosing sequence's clock, each frame for its own delay, and loops. `startFrom` and `playbackRate` work as on `Video`; `loop={false}` holds the last frame. `preloadMedia()` reports its length as `animation.durationSeconds`.
- `Video` and `Audio` accept `startFrom` (seconds into the file), `playbackRate`, `volume`, and `muted`. A `Video` plays its own soundtrack, so do not add an `Audio` with the same file to hear it; set `muted` to keep only the picture.
- `loop` on a `Video` or `Audio` starts the file over from its beginning when playback reaches its end, picture and sound together, instead of holding the last frame in silence.
- Media placed inside a `Sequence` starts when the sequence does and stops when it ends.
- `volume` and an audio `playbackRate` can be a number or keyframes. Keyframe times are seconds from the start of the enclosing sequence, written as `{ value, timescale }`.

frameKeyframes(keys, { fps, origin? }) builds volume or playbackRate keyframes from frame numbers. Times are (frame - origin) / fps on the enclosing sequence’s clock; origin defaults to 0. Use it for audio fades. The browser exporter only supports constant volume and playback rate.

## Size a scene to its media

The optional `prepare()` export runs once before rendering and may be `async`. In the example, `preloadMedia()` reads the clip’s length and `mediaDurationInFrames()` converts it to frames, so the end card always follows the footage.

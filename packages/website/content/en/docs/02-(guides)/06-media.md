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

frameKeyframes(keys, { fps, origin? }) builds volume, playbackRate, or pitch keyframes from frame numbers. Times are (frame - origin) / fps on the enclosing sequence’s clock; origin defaults to 0. Use it for audio fades. The browser exporter only supports constant volume and playback rate, and no pitch.

## Change the pitch

By default an `Audio`'s pitch follows its speed, like tape: `playbackRate={1.25}` is faster and higher. Two props separate them.

```tsx
<Audio src="bgm.mp3" playbackRate={1.25} preservePitch pitch={-2} />
```

- `pitch` transposes the clip in semitones. It defaults to 0 and ranges from −24 to 24; a fraction is cents, so `0.5` is 50 cents. It can be a number or keyframes, built with `frameKeyframes` like `volume`. Outside the range, the React path clamps to ±24 and a project JSON file fails validation.
- `preservePitch` defaults to `false`: `playbackRate` changes speed and pitch together, as before. When `true`, `playbackRate` changes only how long the clip takes, and `pitch` alone sets the pitch.
- The pitch you hear is raised by a factor of `2^(pitch / 12)`, times `playbackRate` unless `preservePitch` is set. `pitch={12}` is one octave up.
- Only `Audio` takes these props. The soundtrack of a `Video` and the voices of a `Dialogue` do not. The preview and the export sound the same, but the browser exporter in `@celesta/web` rejects a clip that uses them, with the error "Audio pitch and preservePitch are not supported by browser export yet."

## Size a scene to its media

The optional `prepare()` export runs once before rendering and may be `async`. In the example, `preloadMedia()` reads the clip’s length and `mediaDurationInFrames()` converts it to frames, so the end card always follows the footage.

## Move with the sound

`loadAudioSpectrum()` decodes an audio file, or a video’s soundtrack, in `prepare()` and analyzes all of it. `useAudioSpectrum()` then returns the current frame’s frequency bands and loudness, so bars, rings, and glows can follow the music or a voice.

```tsx file=examples/audio-spectrum.tsx title="audio-spectrum.tsx"
```

- `bands` lists every band from low to high frequency, each from 0 to 1. A band’s level is its mean FFT power in dB, relative to a full-scale sine, mapped from `minDecibels` (default −80) to `maxDecibels`. `maxDecibels` defaults to `'auto'`, the loudest band level anywhere in the file, so only the loudest moments reach 1 however loud the file was mastered. Pass a number, such as `maxDecibels: -6`, for a fixed ceiling, for example to give several files the same scale. `rms` is the root mean square of the samples, about 0.707 for a full-scale sine.
- `fftSize` sets the samples in each FFT (a power of two, default 2048). `bands` sets the number of bands (default 32), and `scale` how the range from `minFrequency` (20 Hz) to `maxFrequency` (16 kHz) is divided: `'log'` (the default) gives each octave the same number of bands, `'linear'` the same width in Hz, and `'mel'` follows perceived pitch.
- `smoothing` takes seconds, or `{ attack, release }` for rising and falling values separately: after that long a value has made about 63% of a change. The default 0 follows the sound exactly.
- The file is analyzed once, in order, every `hopSeconds` (1/240 s by default), with a Hann window centered on each moment, and frames read between two analyses interpolate them. The value of a frame therefore does not depend on the fps or on the order frames are rendered in, and is the same in the preview and in the export.
- The hook follows the enclosing `Sequence`’s clock, like `Audio`. Pass `startFrom` when the `Audio` has one. `playbackRate` is not followed. Before and after the file every value is 0.
- `spectrumAt(spectrum, seconds)` returns the same values outside a component, and `analyzeAudioSpectrum({ sampleRate, samples }, options)` analyzes samples you already have.
- The channels are averaged, and the file is analyzed at its own sample rate. Relative paths and URLs resolve as for `preloadMedia()`.

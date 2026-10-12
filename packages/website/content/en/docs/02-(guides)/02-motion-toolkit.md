These helpers cover the patterns that come up in almost every video: scenes in a row (with transitions between them), lists that cascade in, and cuts on the beat. Each is built on `Sequence`, `Group`, and the frame, so everything stays scrubbable and deterministic. Text effects, the camera, and line drawing are on [the next page](/en/docs/text-camera-lines/); seeded randomness and noise are in [`@celesta/math`](/en/docs/math/).

## Scenes back to back

`<Series>` plays its `<Series.Sequence>` children one after another, so you write each scene’s length instead of its start frame. A negative `offset` overlaps a scene with the one before it. `computeSeries()` does the same arithmetic without rendering, which is handy for the composition’s total length:

```tsx title="Three scenes, sized from their lengths"
const SCENES = [
  { name: 'intro', durationInFrames: 90, Scene: Intro },
  { name: 'body', durationInFrames: 240, Scene: Body },
  { name: 'outro', durationInFrames: 60, Scene: Outro },
];
const { durationInFrames } = computeSeries(SCENES);

export default function Root() {
  return (
    <Composition width={1920} height={1080} fps={30} durationInFrames={durationInFrames}>
      <Series>
        {SCENES.map(({ name, durationInFrames, Scene }) => (
          <Series.Sequence key={name} durationInFrames={durationInFrames}>
            <Scene />
          </Series.Sequence>
        ))}
      </Series>
    </Composition>
  );
}
```

## Transitions between scenes

`<TransitionSeries>` lays scenes out like `Series`, with a `<TransitionSeries.Transition>` between two of them: `'cut'` cuts, `'crossfade'` fades the next scene in over the previous one, `'slide'` pushes the previous scene out, and `'wipe'` reveals the next scene behind a moving edge. A transition overlaps the scenes on either side by its `durationInFrames`, so `computeTransitionSeries()` returns each scene’s start and the total length, shortened by every overlap:

```tsx file=examples/transition-series.tsx title="Scenes joined by a cross-fade and a slide"
```

Each scene is an ordinary Sequence whose frame 0 is the first frame of its transition in, and the next scene is drawn above. A transition longer than either scene, or a scene too short for its transitions in and out together, throws instead of leaving a gap or showing three scenes at once. Overlapping scenes play their sound together: `useTransitionVolume(volume)` gives an Audio in the scene a volume that fades with its picture, and `useTransitionSeriesScene()` reports the scene’s transitions for any other timing.

## Cascades and entrances

`progress(frame, start, durationInFrames, easing?)` is a clamped 0–1 value for “how far through this span are we”: the building block of most entrances. `<Stagger each={n}>` starts each child `n` frames after the previous one, so an entrance written for frame 0 cascades down a list:

```tsx title="Rows that arrive one after another"
function Row({ label, y }: { label: string; y: number }) {
  const frame = useCurrentFrame(); // 0 when this row starts
  const p = progress(frame, 0, 20, Easings.easeOutExpo);
  return <Text x={120 + 40 * (1 - p)} y={y} opacity={p}>{label}</Text>;
}

<Stagger each={4}>
  {items.map((item, i) => <Row key={item} label={item} y={200 + i * 64} />)}
</Stagger>
```

## On the beat

`useBeat({ bpm })` returns the current `beat`, `bar`, `beatInBar`, the `progress` through the beat, and a `pulse` that is 1 on every beat and decays until the next. Use it to flash, bump, or cut in time with the soundtrack; `offset` moves the first beat.

```tsx title="A dot that pulses with the music"
const { pulse } = useBeat({ bpm: 120 });
return <Rect width={40} height={40} cornerRadius={20} scale={1 + 0.3 * pulse} fill="#7cf29c" />;
```

## Cues

`useCue(cues)` takes a list of `{ at, …data }` objects sorted by `at` and returns the one in effect, its `index`, the `frame` since it started, and the `previous` and `next` cues. Swapping captions, a camera moving between stops, or a chart callout that changes are all a list of cues. `cueAt(cues, frame)` is the same outside a component.

```tsx title="Captions that swap and fade in"
const active = useCue([
  { at: 0, text: 'Write it.' },
  { at: 45, text: 'Preview it.' },
  { at: 90, text: 'Ship it.' },
]);
if (!active) return null;
return <Text opacity={progress(active.frame, 0, 10)}>{active.cue.text}</Text>;
```

## Timecodes

`frameToTimecode(frame, fps)`, from `@celesta/react`, formats `HH:MM:SS:FF` for an on-screen clock.

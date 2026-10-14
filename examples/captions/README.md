# Captions

Captions from an SRT file, and the video's subtitles written back out as a
file. Twelve seconds at 30 fps, 1920 × 1080.

`captions.srt` is imported as text and read with `parseSubtitles()` into
frame-timed cues. Each cue is drawn for its own `<Sequence>`: a band sized to
its text with `useTextMetrics()`, the cue's SRT block as
`formatSubtitles()` writes it, and a timeline of every cue with the
playhead. `<Subtitles cues>` declares the cues for the exported file. The
file leaves 8–10 s empty for a `<Dialogue>` line, whose `subtitle.render`
draws the same band; it goes into the exported file too.

The band stands in for the `CaptionTrack` component of issue #197.

The composition is `film.tsx`. The fonts come from Google Fonts, so the
first export needs a network connection. From the repository root:

```sh
"/Applications/Celesta.app/Contents/MacOS/Celesta-export" \
  --react examples/captions/film.tsx captions.mp4 --subtitles captions.srt
"/Applications/Celesta.app/Contents/MacOS/Celesta-export" \
  --react examples/captions/film.tsx cut.mp4 --from 5 --to 10.5 --subtitles cut.vtt
```

The first writes five cues: the four of `captions.srt` and the dialogue
line at 00:00:08,000. The second starts its times at 5 s, so the cue that
began at 3 s is cut to `00:00:00.000 --> 00:00:01.000` and the last one to
`00:00:05.000 --> 00:00:05.500`.

The portrait comes from `../assets/dialogue-demo/portraits/`.

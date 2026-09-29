// Musical and cue-based timing. Each hook is a thin wrapper over a pure
// function of the frame (`beatAt`, `cueAt`), so the same math also works in
// loops and helpers where hooks cannot be called.

import { useCurrentFrame, useVideoConfig } from './hooks';

export interface BeatOptions {
  /** Tempo in beats per minute. */
  bpm: number;
  /** Beats in one bar. Defaults to 4. */
  beatsPerBar?: number;
  /** Frame the first beat lands on. Defaults to 0. */
  offset?: number;
  /**
   * How fast `pulse` falls off after each beat: the number of frames it takes
   * to drop to about 37% (1/e). Defaults to a quarter of a beat.
   */
  decay?: number;
}

export interface Beat {
  /** Frames in one beat; may be fractional (for example 128 BPM at 30 fps). */
  framesPerBeat: number;
  /** Beats since `offset`, counted from 0 (negative before it). */
  beat: number;
  /** Bars since `offset`, counted from 0. */
  bar: number;
  /** Position of the current beat inside its bar, `0` to `beatsPerBar - 1`. */
  beatInBar: number;
  /** 0 on the beat, rising linearly towards 1 just before the next one. */
  progress: number;
  /** The same for the whole bar. */
  barProgress: number;
  /** 1 on the beat, decaying exponentially until the next one. Drives flashes and bumps. */
  pulse: number;
}

/** The beat grid at `frame`. See `useBeat()`. */
export function beatAt(frame: number, fps: number, options: BeatOptions): Beat {
  const { bpm, beatsPerBar = 4, offset = 0 } = options;
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error('beatAt() requires a positive bpm');
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar <= 0) {
    throw new Error('beatAt() requires a positive integer beatsPerBar');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('beatAt() requires a positive fps');
  }
  const framesPerBeat = (fps * 60) / bpm;
  const decay = options.decay ?? framesPerBeat / 4;
  if (!Number.isFinite(decay) || decay <= 0) {
    throw new Error('beatAt() requires a positive decay');
  }
  const beats = (frame - offset) / framesPerBeat;
  const beat = Math.floor(beats);
  const bar = Math.floor(beat / beatsPerBar);
  const beatInBar = beat - bar * beatsPerBar;
  const progress = beats - beat;
  return {
    framesPerBeat,
    beat,
    bar,
    beatInBar,
    progress,
    barProgress: (beatInBar + progress) / beatsPerBar,
    pulse: Math.exp(-(progress * framesPerBeat) / decay),
  };
}

/**
 * Where the current frame sits on a musical grid: the beat and bar number,
 * the position inside each, and a `pulse` that spikes on every beat. Use it
 * to cut, flash, or bump things in time with a soundtrack.
 *
 * ```tsx
 * const { pulse, beatInBar } = useBeat({ bpm: 120 });
 * <Rect scale={1 + 0.1 * pulse} … />
 * ```
 *
 * Inside a `<Sequence>` the grid starts with the sequence; pass `offset` to
 * line it up with a soundtrack that started earlier.
 */
export function useBeat(options: BeatOptions): Beat {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return beatAt(frame, fps, options);
}

/** Anything placed on the timeline at a frame. */
export interface Cue {
  at: number;
}

export interface ActiveCue<T extends Cue> {
  /** The latest cue whose `at` has been reached. */
  cue: T;
  index: number;
  /** Frames since this cue started (0 on its first frame). */
  frame: number;
  /** The cue before it, if any — handy for animating from its value. */
  previous: T | undefined;
  /** The cue after it, if any. */
  next: T | undefined;
}

/**
 * The cue in effect at `frame`: the last one whose `at` is not after it, or
 * `null` before the first. `cues` must be sorted by `at`.
 */
export function cueAt<T extends Cue>(cues: readonly T[], frame: number): ActiveCue<T> | null {
  let index = -1;
  for (let i = 0; i < cues.length; i += 1) {
    if (!Number.isFinite(cues[i].at)) {
      throw new Error('cueAt() requires every cue to have a finite `at`');
    }
    if (i > 0 && cues[i].at < cues[i - 1].at) {
      throw new Error('cueAt() requires cues sorted by `at`');
    }
    if (cues[i].at <= frame) {
      index = i;
    }
  }
  if (index < 0) {
    return null;
  }
  return {
    cue: cues[index],
    index,
    frame: frame - cues[index].at,
    previous: cues[index - 1],
    next: cues[index + 1],
  };
}

/**
 * The cue in effect at the current frame, from a list of `{ at, …data }`
 * objects sorted by `at`. Captions that swap, a camera that moves between
 * stops, a headline that changes on each beat: put the data in the cues and
 * animate from `frame`, the frames since the cue started.
 *
 * ```tsx
 * const active = useCue([{ at: 0, text: 'Write' }, { at: 30, text: 'Preview' }]);
 * if (!active) return null;
 * const opacity = progress(active.frame, 0, 10);
 * ```
 */
export function useCue<T extends Cue>(cues: readonly T[]): ActiveCue<T> | null {
  return cueAt(cues, useCurrentFrame());
}

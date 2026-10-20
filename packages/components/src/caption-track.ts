// Timed captions from data alone: each cue is shown on its frames
// `[from, from + durationInFrames)` on a Panel band, wrapped and limited to a
// number of lines by @celesta/text, with emphasis by grapheme range, and
// entering and leaving through Motion. A render callback can replace the
// band and text without changing the cue's clock.

import * as React from 'react';
import type { ReactNode } from 'react';

import { Group, Sequence, Subtitles, Text, useCurrentFrame, useTheme, useVideoConfig } from '@celesta/react';
import type { FontFamily, Paint, TextMetrics, TextStyle } from '@celesta/react';
import { safeAreaInsets, useLayoutBounds } from '@celesta/layout';
import type { Insets, SafeAreaValue } from '@celesta/layout';
import { emphasisContent, resolveEmphasis, resolveTimedRanges, timedRangeAt, useFitText } from '@celesta/text';
import type { EmphasisStyle, FitTextStyle, ResolvedEmphasis, TextEmphasis, TimedRange } from '@celesta/text';

import { hexColor } from './color';
import { Motion } from './motion';
import type { MotionEffect } from './motion';
import { Panel } from './panel';
import type { PanelProps } from './panel';

/** One caption: the `SubtitleCue` shape `parseSubtitles()` returns, plus emphasis. */
export interface CaptionCue {
  /** Names the cue in errors and in the render callback. */
  id?: string;
  /** First frame the cue is shown on, a whole number, counted like the track's own frames. */
  from: number;
  /** Frames it is shown, a whole number of at least 1. */
  durationInFrames: number;
  /** Lines are separated by `\n`; longer lines wrap. An empty text shows no band. */
  text: string;
  /** Parts of `text` to emphasize, in grapheme clusters; see `emphasisContent()`. */
  emphasis?: readonly TextEmphasis[];
}

/** What `CaptionTrack.render` draws from. */
export interface CaptionRenderProps {
  cue: CaptionCue;
  /** The cue's index in `cues`. */
  index: number;
  text: string;
  /** `text` with its emphasis as `<Span>`s: draw it with `<Text style={style}>`. */
  content: ReactNode;
  /** The cue's emphasis, checked and in order, with styles looked up. */
  emphasis: ResolvedEmphasis[];
  /** Frames since the cue appeared; the same as `useCurrentFrame()` inside the callback. */
  frame: number;
  /** Frames the cue is shown, after an `overlap: 'latest'` cut. */
  durationInFrames: number;
  /** The text style, at the size the text was fitted to. */
  style: TextStyle;
  /** `content` measured with `style`, wrapped at `maxWidth`. */
  metrics: TextMetrics;
  maxWidth: number;
  /** Whether the text fits `maxLines` at `style.fontSize`. */
  fits: boolean;
  /** Where the default band would be, in the track's coordinates (the layout area's). */
  box: { x: number; y: number; width: number; height: number };
}

export interface CaptionTrackProps {
  /** The captions. Frames count from the enclosing `<Sequence>`'s start. */
  cues: readonly CaptionCue[];
  /** Emphasis styles by name, for emphasis whose `style` is a string. */
  emphasisStyles?: Readonly<Record<string, EmphasisStyle>>;
  /**
   * What cues sharing frames mean: `'error'` (the default) throws, naming
   * both; `'latest'` lets the cue starting later cut the other short.
   */
  overlap?: 'error' | 'latest';
  /** Where the band sits in the layout area. Defaults to `'bottom'`. */
  position?: 'top' | 'middle' | 'bottom';
  /** Horizontal placement of the band and its lines. Defaults to `'center'`. */
  align?: 'left' | 'center' | 'right';
  /** Keeps the band clear of platform UI, as `<SafeArea padding>` does, e.g. `"vertical-social"`. */
  safeArea?: SafeAreaValue;
  /** Space between the area (inside `safeArea`) and the band. Defaults to 6% of the area's shorter side. */
  margin?: number | Insets;
  /** Widest the text may be before it wraps. Defaults to 80% of the room inside the margin. */
  maxWidth?: number;
  /** Most lines a caption takes. Defaults to 2. */
  maxLines?: number;
  /** Font size. Defaults to 4.4% of the area's shorter side (48 px at 1080p). */
  fontSize?: number;
  /** The smallest size a caption shrinks to to fit `maxLines`. Defaults to `fontSize`: no shrinking. */
  minFontSize?: number;
  /** Line height as a multiple of the font size. Defaults to 1.4. */
  lineHeight?: number;
  /**
   * A caption that does not fit `maxLines` even at `minFontSize`: `'clip'`
   * (the default) shows its first `maxLines` lines; `'error'` fails the render.
   */
  overflow?: 'clip' | 'error';
  /** Family name, font stack, or `<Theme>` font name. */
  fontFamily?: FontFamily;
  /** Hex color or `<Theme>` color name of the text. Defaults to `#ffffff`. */
  color?: string;
  /**
   * Extra text style, over the defaults (weight 500, `lineBreak: 'phrase'`
   * so Japanese wraps between phrases); the track sets the size, line
   * height, and alignment.
   */
  style?: FitTextStyle;
  /** The band: a hex color, `<Theme>` color name, or `Paint`; `null` for none. Defaults to `#000000b3`. */
  background?: string | Paint | null;
  /** Space between the band's edges and the text. Defaults to 0.3 em above and below, 0.6 em at the sides. */
  padding?: number | Insets;
  /** Rounds the band. Defaults to 0.2 em. */
  cornerRadius?: number;
  /** More `<Panel>` props for the band, such as `stroke` or `shadow`. */
  panel?: Omit<PanelProps, 'width' | 'height' | 'padding' | 'fill' | 'cornerRadius' | 'children'>;
  /**
   * How each caption arrives, as `<Motion enter>` takes it; `null` cuts.
   * Defaults to a fade over a tenth of a second. A cue that starts where
   * the one before it ends cuts in, so back-to-back captions swap without
   * a blink.
   */
  enter?: MotionEffect | null;
  /** How each caption leaves; `null` cuts. Defaults to a fade over a tenth of a second, skipped before a cue that follows at once. */
  exit?: MotionEffect | null;
  /**
   * Draws a caption in place of the band and text; called as a component,
   * so it may use hooks, inside the cue's own `<Sequence>` and its Motion.
   */
  render?: (props: CaptionRenderProps) => ReactNode;
  /**
   * Declares the cues with `<Subtitles>` so an export's `--subtitles` file
   * holds them. Defaults to true.
   */
  subtitles?: boolean;
  /** The language `<Subtitles lang>` declares the cues in. */
  lang?: string;
}

function fail(message: string): never {
  throw new Error(`<CaptionTrack> ${message}`);
}

function positive(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(`${name} must be a finite number greater than 0, not ${value}`);
  return value;
}

function cueLabel(cues: readonly CaptionCue[], index: number): string {
  const id = cues[index]?.id;
  return id === undefined ? `cue ${index}` : `cue ${index} ("${id}")`;
}

function edges(padding: number | Insets): Required<Insets> {
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding };
  return { top: padding.top ?? 0, right: padding.right ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0 };
}

/**
 * Timed captions drawn from data alone, with no `<Character>`, voice, or
 * audio: the cue on the current frame, on a band at the bottom of the
 * layout area. Cues are shown on `[from, from + durationInFrames)`; frames
 * no cue covers show nothing, and cues outside the enclosing `<Sequence>`
 * never show.
 *
 * ```tsx
 * <CaptionTrack cues={[
 *   { id: 'intro', from: 0, durationInFrames: 60, text: 'こんにちは' },
 *   { id: 'next', from: 60, durationInFrames: 90, text: '動画を作ります',
 *     emphasis: [{ start: 0, end: 2, style: { color: '#ffd166' } }] },
 * ]} />
 * ```
 */
export function CaptionTrack(props: CaptionTrackProps): ReturnType<typeof React.createElement> {
  const { cues, overlap = 'error', subtitles = true, lang } = props;
  const frame = useCurrentFrame();
  const ranges = React.useMemo(
    () => resolveTimedRanges(cues, { what: '<CaptionTrack>', label: (index) => cueLabel(cues, index), overlap }),
    [cues, overlap],
  );
  cues.forEach((cue, index) => {
    if (typeof cue.text !== 'string') fail(`${cueLabel(cues, index)} needs a string \`text\``);
  });
  const range = timedRangeAt(ranges, frame);
  const declared = subtitles
    ? React.createElement(Subtitles, {
      key: 'subtitles',
      cues: ranges.map((entry) => ({ from: entry.from, durationInFrames: entry.end - entry.from, text: cues[entry.index].text })),
      ...(lang !== undefined ? { lang } : {}),
    })
    : null;
  if (!range) return React.createElement(Group, null, declared);
  const position = ranges.indexOf(range);
  const before = ranges[position - 1];
  const after = ranges[position + 1];
  return React.createElement(
    Group,
    null,
    declared,
    React.createElement(
      Sequence,
      { key: range.index, from: range.from, durationInFrames: range.end - range.from },
      React.createElement(Caption, {
        track: props,
        range,
        joinsBefore: before !== undefined && before.end === range.from,
        joinsAfter: after !== undefined && after.from === range.end,
      }),
    ),
  );
}

function Caption({ track, range, joinsBefore, joinsAfter }: {
  track: CaptionTrackProps;
  range: TimedRange;
  joinsBefore: boolean;
  joinsAfter: boolean;
}): ReactNode {
  const bounds = useLayoutBounds();
  const canvas = useVideoConfig();
  const frame = useCurrentFrame();
  const theme = useTheme();
  const side = Math.min(bounds.width, bounds.height);
  const {
    cues, emphasisStyles, position = 'bottom', align = 'center', safeArea, margin = Math.round(side * 0.06),
    maxLines = 2, fontFamily, color = '#ffffff', style, background = '#000000b3', panel, overflow = 'clip', render,
  } = track;
  const fontSize = positive('fontSize', track.fontSize ?? Math.round(side * 0.044));
  const minFontSize = Math.min(positive('minFontSize', track.minFontSize ?? fontSize), fontSize);
  const lineHeight = positive('lineHeight', track.lineHeight ?? 1.4);
  if (!Number.isInteger(maxLines) || maxLines < 1) fail(`maxLines must be a whole number of at least 1, not ${maxLines}`);
  const padding = edges(track.padding ?? { top: fontSize * 0.3, bottom: fontSize * 0.3, left: fontSize * 0.6, right: fontSize * 0.6 });
  const cornerRadius = track.cornerRadius ?? Math.round(fontSize * 0.2);

  const cue = cues[range.index];
  const what = `<CaptionTrack> ${cueLabel(cues, range.index)}`;
  const emphasis = resolveEmphasis(cue.text, cue.emphasis, { styles: emphasisStyles, theme, what });
  const content = emphasisContent(cue.text, emphasis);

  // The band's room: the area, inside the safe area, inside the margin.
  const outer = safeArea === undefined
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : safeAreaInsets(safeArea, canvas.width, canvas.height);
  const inner = safeAreaInsets(margin, canvas.width, canvas.height);
  const left = outer.left + inner.left;
  const top = outer.top + inner.top;
  const room = {
    width: Math.max(1, bounds.width - left - outer.right - inner.right),
    height: Math.max(1, bounds.height - top - outer.bottom - inner.bottom),
  };
  const maxWidth = Math.max(1, Math.min(
    track.maxWidth ?? Math.round(room.width * 0.8),
    room.width - padding.left - padding.right,
  ));

  const fit = useFitText(content, {
    width: maxWidth,
    height: Math.max(1, room.height - padding.top - padding.bottom),
    minFontSize,
    maxFontSize: fontSize,
    maxLines,
    lineHeight,
    style: {
      ...(fontFamily !== undefined ? { fontFamily } : {}),
      fontWeight: 500,
      lineBreak: 'phrase',
      fill: { type: 'solid', color: hexColor(color, theme, 'CaptionTrack', 'color') },
      ...style,
      align,
    },
  });
  if (!fit.fits && overflow === 'error' && cue.text !== '') {
    fail(`${cueLabel(cues, range.index)} "${cue.text}" does not fit ${maxLines} line${maxLines === 1 ? '' : 's'} of ${maxWidth} px even at ${minFontSize} px`);
  }
  const shownHeight = fit.fits ? fit.metrics.height : Math.min(fit.metrics.height, maxLines * fit.metrics.lineHeight);
  const box = {
    width: fit.metrics.width + padding.left + padding.right,
    height: shownHeight + padding.top + padding.bottom,
    x: 0,
    y: 0,
  };
  box.x = left + (align === 'left' ? 0 : align === 'center' ? (room.width - box.width) / 2 : room.width - box.width);
  box.y = top + (position === 'top' ? 0 : position === 'middle' ? (room.height - box.height) / 2 : room.height - box.height);

  let drawn: ReactNode;
  if (render) {
    drawn = React.createElement(CaptionRenderer, {
      render,
      info: {
        cue, index: range.index, text: cue.text, content, emphasis, frame, durationInFrames: range.end - range.from,
        style: fit.style, metrics: fit.metrics, maxWidth, fits: fit.fits, box,
      },
    });
  } else if (cue.text === '') {
    drawn = null;
  } else {
    // Lines wrap at maxWidth with `align`; shift the text so its widest line
    // sits inside the band's padding.
    const offset = align === 'left' ? 0 : align === 'center' ? (maxWidth - fit.metrics.width) / 2 : maxWidth - fit.metrics.width;
    const text = React.createElement(Text, {
      x: -offset, y: fit.metrics.ascent, anchorY: 'baseline', maxWidth, style: fit.style, children: content,
    });
    const clipped = shownHeight < fit.metrics.height;
    const lines = clipped ? React.createElement(Group, { clip: { x: -offset, y: 0, width: maxWidth, height: shownHeight } }, text) : text;
    drawn = background === null
      ? React.createElement(Group, { x: box.x + padding.left, y: box.y + padding.top }, lines)
      : React.createElement(Panel, {
        ...panel,
        x: box.x, y: box.y, width: box.width, height: box.height, padding, cornerRadius, fill: background,
      }, lines);
  }
  const enter = track.enter === undefined ? { type: 'fade' as const, durationInFrames: Math.max(1, Math.round(canvas.fps / 10)) } : track.enter;
  const exit = track.exit === undefined ? { type: 'fade' as const, durationInFrames: Math.max(1, Math.round(canvas.fps / 10)) } : track.exit;
  const effects = {
    enter: enter === null || joinsBefore ? undefined : enter,
    exit: exit === null || joinsAfter ? undefined : exit,
  };
  if (effects.enter === undefined && effects.exit === undefined) return drawn;
  // Scale effects grow about the band's centre.
  return React.createElement(Motion, {
    ...effects,
    originX: box.x + box.width / 2,
    originY: box.y + box.height / 2,
  }, drawn);
}

function CaptionRenderer({ render, info }: { render: (props: CaptionRenderProps) => ReactNode; info: CaptionRenderProps }): ReactNode {
  return render(info);
}

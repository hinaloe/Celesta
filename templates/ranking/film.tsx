import * as fs from 'node:fs';

import {
  Composition,
  Easings,
  Font,
  Rect,
  Text,
  defineProjectProperties,
  getProjectProperty,
  progress,
  useCurrentFrame,
} from '@celesta/react';
import { useCountUp } from '@celesta/text';
import { useProjectProperty } from '@celesta/project';

// A ranking card. The title, subtitle, colors, format and data file come from
// project properties, so one source renders every variant:
//
// - props.json holds the values this project renders with. Change the title,
//   accent color, theme (dark / light) or format (16:9 / 9:16) there.
// - data.json is the ranking: an array of { "name", "score" } rows. The top
//   six by score are shown, and the video gets shorter with fewer rows.
// - variants/*.json are alternative sets of values, rendered with
//   `--props-file variants/spring.json` instead of props.json.
//
// The colors of the two themes and every layout number are in the constants
// block below.

// ---- Constants --------------------------------------------------------------

const FPS = 30;
// Timing, in frames: rows start entering at ROW_START, one every ROW_STAGGER,
// and the finished card holds for HOLD before the end.
const ROW_START = 24;
const ROW_STAGGER = 8;
const HOLD = 75;
const MAX_ROWS = 6;

const FONT = 'Noto Sans JP';
const FONT_SRC = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700';

const THEMES = {
  dark: { background: '#11131a', panel: '#1b1e28', text: '#f5f6fa', muted: '#8a90a6' },
  light: { background: '#f4f1ea', panel: '#ffffff', text: '#1d1f27', muted: '#6d6a63' },
} as const;

// Layout, in pixels. Each format sets the canvas and the numbers that differ
// between a wide and a tall frame; positions are derived from these and the
// sizes below in `useLayout()`. The header and the rows are centered
// vertically. Inside a row, `textY` is the center of the text line, `barY` the
// top of the bar, `nameWidth` the room for the name before the bar (0 puts
// the bar under the name), and `scoreWidth` the room kept for the score after
// the bar.
const FORMATS = {
  // One line per row: rank, name, bar, score.
  '16:9': {
    width: 1920, height: 1080, marginX: 144, headerGap: 72,
    rowHeight: 96, rowGap: 18, textY: 48, barY: 36, nameWidth: 516, scoreWidth: 144,
  },
  // Rows stack in a taller column: rank, name and score, with the bar below.
  '9:16': {
    width: 1080, height: 1920, marginX: 72, headerGap: 120,
    rowHeight: 168, rowGap: 24, textY: 60, barY: 108, nameWidth: 0, scoreWidth: 0,
  },
} as const;
type Format = keyof typeof FORMATS;

const TITLE_SIZE = 96;
const SUBTITLE_SIZE = 39;
const ROW_TEXT_SIZE = 45;
// The accent stripe left of the title; its height is the header's height.
const ACCENT_WIDTH = 18;
const HEADER_HEIGHT = 138;
// The title and subtitle start TITLE_INDENT right of the stripe; their tops
// are TITLE_Y and SUBTITLE_Y below the stripe's top. The title slides in
// from TITLE_SLIDE to the left.
const TITLE_INDENT = 54;
const TITLE_Y = -6;
const SUBTITLE_Y = 117;
const TITLE_SLIDE = 36;
// Inside a row: the padding at both ends, where the name starts, and the bar.
const ROW_PADDING = 42;
const NAME_OFFSET = 150;
const BAR_HEIGHT = 24;
const CORNER_RADIUS = 18;
// How far a row slides up while it fades in.
const ROW_RISE = 30;

defineProjectProperties({
  title: { type: 'string', label: 'Title', defaultValue: 'Top Picks' },
  subtitle: { type: 'string', label: 'Subtitle', defaultValue: 'Sample data' },
  accent: { type: 'color', label: 'Accent', defaultValue: '#4f8cff' },
  theme: { type: 'select', label: 'Theme', defaultValue: 'dark', options: ['dark', 'light'] },
  format: { type: 'select', label: 'Format', defaultValue: '16:9', options: ['16:9', '9:16'] },
  data: { type: 'path', label: 'Data', defaultValue: './data.json' },
});

interface Row {
  name: string;
  score: number;
}

let rows: Row[] = [];

// `getProjectProperty` sees the same values the render does, so the data
// file read here and the duration computed from it always match the variant.
export async function prepare(): Promise<void> {
  const file = getProjectProperty<string>('data');
  // A `path` property may also be an http(s) URL, which is fetched instead.
  const text = /^https?:\/\//i.test(file) ? await (await fetch(file)).text() : await fs.promises.readFile(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${file} must be a non-empty array of { name, score } rows`);
  }
  rows = parsed
    .map((row: Row) => ({ name: String(row.name), score: Number(row.score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ROWS);
  // Bar widths are relative to the top score.
  if (rows.some((row) => !Number.isFinite(row.score) || row.score < 0) || rows[0].score === 0) {
    throw new Error(`${file}: every score must be a non-negative number, and the top score above 0`);
  }
}

function useTheme() {
  return THEMES[useProjectProperty<'dark' | 'light'>('theme')];
}

function useLayout() {
  const format = FORMATS[useProjectProperty<Format>('format')];
  const { width, height, marginX, headerGap, rowHeight, rowGap, nameWidth, scoreWidth } = format;
  const rowWidth = width - 2 * marginX;
  // The header and the rows `prepare()` kept, centered as one block.
  const blockHeight = HEADER_HEIGHT + headerGap + rows.length * rowHeight + (rows.length - 1) * rowGap;
  const top = Math.round((height - blockHeight) / 2);
  const barX = NAME_OFFSET + nameWidth;
  return {
    ...format,
    left: marginX,
    rowWidth,
    top,
    rowsTop: top + HEADER_HEIGHT + headerGap,
    rowPitch: rowHeight + rowGap,
    barX,
    barMaxWidth: rowWidth - ROW_PADDING - scoreWidth - barX,
  };
}

function Header() {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const layout = useLayout();
  const accent = useProjectProperty<string>('accent');
  const enter = progress(frame, 0, 18, Easings.easeOutCubic);
  const textX = layout.left + TITLE_INDENT;
  return (
    <>
      <Rect x={layout.left} y={layout.top} width={ACCENT_WIDTH} height={HEADER_HEIGHT} fill={accent} opacity={enter} />
      <Text
        x={textX - TITLE_SLIDE * (1 - enter)}
        y={layout.top + TITLE_Y}
        opacity={enter}
        style={{ fontFamily: FONT, fontSize: TITLE_SIZE, fontWeight: 700, fill: { type: 'solid', color: theme.text } }}
      >
        {useProjectProperty<string>('title')}
      </Text>
      <Text
        x={textX}
        y={layout.top + SUBTITLE_Y}
        opacity={enter}
        maxWidth={layout.width - textX - layout.left}
        style={{ fontFamily: FONT, fontSize: SUBTITLE_SIZE, fill: { type: 'solid', color: theme.muted } }}
      >
        {useProjectProperty<string>('subtitle')}
      </Text>
    </>
  );
}

function RankRow({ row, index, top }: { row: Row; index: number; top: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const layout = useLayout();
  const accent = useProjectProperty<string>('accent');
  const delay = ROW_START + index * ROW_STAGGER;
  const enter = progress(frame, delay, 16, Easings.easeOutCubic);
  const grow = progress(frame, delay + 4, 30, Easings.easeOutQuart);
  const score = useCountUp(row.score, { delay: delay + 4, durationInFrames: 30 });
  const x = layout.left;
  const y = layout.rowsTop + index * layout.rowPitch + ROW_RISE * (1 - enter);
  const textY = y + layout.textY;
  const barWidth = layout.barMaxWidth * (row.score / top) * grow;
  return (
    <>
      <Rect x={x} y={y} width={layout.rowWidth} height={layout.rowHeight} cornerRadius={CORNER_RADIUS} fill={theme.panel} opacity={enter} />
      <Text
        x={x + ROW_PADDING}
        y={textY}
        anchorY={0.5}
        opacity={enter}
        style={{ fontFamily: FONT, fontSize: ROW_TEXT_SIZE, fontWeight: 700, fill: { type: 'solid', color: accent } }}
      >
        {String(index + 1).padStart(2, '0')}
      </Text>
      <Text
        x={x + NAME_OFFSET}
        y={textY}
        anchorY={0.5}
        opacity={enter}
        style={{ fontFamily: FONT, fontSize: ROW_TEXT_SIZE, fill: { type: 'solid', color: theme.text } }}
      >
        {row.name}
      </Text>
      <Rect
        x={x + layout.barX}
        y={y + layout.barY}
        width={Math.max(barWidth, 1)}
        height={BAR_HEIGHT}
        cornerRadius={BAR_HEIGHT / 2}
        fill={accent}
        opacity={enter}
      />
      <Text
        x={x + layout.rowWidth - ROW_PADDING}
        y={textY}
        anchorY={0.5}
        anchorX={1}
        opacity={enter}
        style={{ fontFamily: FONT, fontSize: ROW_TEXT_SIZE, fontWeight: 700, fill: { type: 'solid', color: theme.text } }}
      >
        {score.toLocaleString('en-US')}
      </Text>
    </>
  );
}

function Card() {
  const theme = useTheme();
  const { width, height } = useLayout();
  const top = rows[0].score;
  return (
    <>
      <Rect x={0} y={0} width={width} height={height} fill={theme.background} />
      <Header />
      {rows.map((row, index) => (
        <RankRow key={row.name} row={row} index={index} top={top} />
      ))}
    </>
  );
}

export default function Ranking() {
  const { width, height } = useLayout();
  // Fewer rows finish sooner; the hold after the last row stays the same.
  const durationInFrames = ROW_START + rows.length * ROW_STAGGER + 30 + HOLD;
  return (
    <Composition width={width} height={height} fps={FPS} durationInFrames={durationInFrames}>
      <Font src={FONT_SRC} />
      <Card />
    </Composition>
  );
}

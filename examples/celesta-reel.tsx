// "Code is the cut." A 32-second kinetic-type reel for Celesta, cut to a
// 120 BPM score (one beat = 15 frames, one bar = 60 frames at 30 fps).
// Open this file in Celesta, or export it with:
//   Celesta-export --react examples/celesta-reel.tsx celesta-reel.mp4
import type { ReactNode } from 'react';

import {
  Assets,
  Audio,
  Composition,
  Easings,
  Font,
  Group,
  Rect,
  Sequence,
  Text,
  interpolate,
  measureText,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@celesta/react';

const W = 1920;
const H = 1080;
const FPS = 30;
const BEAT = 15;
const BAR = BEAT * 4;
const DURATION = BAR * 16;

const C = {
  ink: '#0B0B0D',
  panel: '#151518',
  clip: '#1C1C21',
  paper: '#EDEBE6',
  accent: '#FF4D1F',
  tint: '#FFB29C',
  soft: '#C9C5BC',
  grey: '#8B8B90',
  dim: '#3A3A40',
} as const;

const FONT = {
  display: 'Space Grotesk',
  mono: 'JetBrains Mono',
} as const;
const FONT_SRC =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;700';

// Measured in prepare(): JetBrains Mono's per-glyph advance in em (0.6), and
// the logo's letter positions. The fallbacks keep the reel rendering when the
// fonts can't be loaded (e.g. offline).
let monoAdvance = 0.6;
const LOGO_SIZE = 250;
let logo: { width: number; letters: { text: string; x: number }[] } | null = null;

export async function prepare() {
  try {
    const fonts = [FONT_SRC];
    const mono = await measureText('M', { fontFamily: FONT.mono, fontSize: 100 }, { fonts });
    monoAdvance = mono.width / 100;
    const word = await measureText('Celesta',
      { fontFamily: FONT.display, fontSize: LOGO_SIZE, fontWeight: 700 }, { fonts });
    logo = { width: word.width, letters: word.glyphs.map(({ text, x }) => ({ text, x })) };
  } catch (error) {
    console.warn(`text measurement unavailable, using fallback metrics: ${error}`);
  }
}

// Scene boundaries, in frames.
const S = {
  intro: 0,
  words: BAR,
  field: BAR * 3,
  code: BAR * 6,
  timeline: BAR * 10,
  exportAt: BAR * 12,
  silence: BAR * 13 + BEAT * 3,
  logo: BAR * 14,
} as const;

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const progress = (f: number, start: number, frames: number, easing = Easings.easeOutCubic) =>
  easing(clamp((f - start) / frames));
const hash = (i: number, seed = 0) => {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
const timecode = (f: number) =>
  `${pad2(f / (FPS * 3600))}:${pad2((f / (FPS * 60)) % 60)}:${pad2((f / FPS) % 60)}:${pad2(f % FPS)}`;

type TProps = {
  children: string;
  x: number;
  y: number;
  size: number;
  font?: keyof typeof FONT;
  weight?: number;
  color?: string;
  ax?: number;
  ay?: number | 'baseline';
  opacity?: number;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
};

function T({
  children, x, y, size, font = 'display', weight = 700, color = C.paper,
  ax = 0, ay = 0, opacity = 1, scale = 1, align = 'left', lineHeight,
}: TProps) {
  return (
    <Text x={x} y={y} anchorX={ax} anchorY={ay} opacity={opacity} scale={scale}
      style={{ fontFamily: FONT[font], fontSize: size, fontWeight: weight, align, lineHeight,
        fill: { type: 'solid', color } }}>
      {children}
    </Text>
  );
}

type Run = { text: string; color: string; weight?: number };

// Mono text in colored runs, vertically centered on `y`, showing its first
// `visible` characters. Each run starts at its column's cell and sits
// on a shared baseline, so a caret can be placed after any character.
function Mono({ runs, x, y, size, visible = Infinity, opacity = 1 }: {
  runs: Run[];
  x: number;
  y: number;
  size: number;
  visible?: number;
  opacity?: number;
}) {
  let column = 0;
  return (
    <Group opacity={opacity}>
      {runs.map(({ text, color, weight = 400 }, i) => {
        const start = column;
        column += text.length;
        const shown = text.slice(0, Math.max(0, visible - start));
        return shown ? (
          <T key={i} x={x + start * size * monoAdvance} y={y + size * 0.24} size={size} font="mono"
            weight={weight} color={color} ay="baseline">{shown}</T>
        ) : null;
      })}
    </Group>
  );
}
const runLength = (runs: Run[]) => runs.reduce((n, r) => n + r.text.length, 0);

// A section tag: accent square, number, and name.
function Tag({ x, y, n, name, opacity = 1, color = C.paper }: {
  x: number; y: number; n: string; name: string; opacity?: number; color?: string;
}) {
  return (
    <Group x={x} y={y} opacity={opacity}>
      <Rect y={-7} width={14} height={14} fill={C.accent} />
      <T x={30} y={0} size={22} font="mono" weight={700} color={C.accent} ay={0.5}>{n}</T>
      <T x={80} y={0} size={22} font="mono" weight={400} color={color} ay={0.5}>{name}</T>
    </Group>
  );
}

// A headline that swaps on the given frames, each new line sliding up.
function Swap({ f, cues, x, y, size, color = C.paper, accentLast = false }: {
  f: number; cues: [number, string][]; x: number; y: number; size: number; color?: string; accentLast?: boolean;
}) {
  const index = cues.reduce((found, [at], i) => (f >= at ? i : found), -1);
  if (index < 0) return null;
  const [at, text] = cues[index];
  const p = progress(f, at, 10, Easings.easeOutExpo);
  const last = accentLast && index === cues.length - 1;
  return <T x={x} y={y + 40 * (1 - p)} size={size} opacity={p} color={last ? C.accent : color}>{text}</T>;
}

// ── 01 · Cold open: one chunk of code per beat ─────────────────────────────

// Keep in sync with TYPED_CHUNKS in assets/celesta-reel/make-music.py, which
// puts a key click on every typed character.
const TYPED: Run[][] = [
  [{ text: 'video', color: C.paper }],
  [{ text: ' = ', color: C.grey }, { text: 'f', color: C.accent }, { text: '(', color: C.grey }],
  [{ text: 'frame', color: C.paper }, { text: ')', color: C.grey }],
];

function Intro() {
  const f = useCurrentFrame();
  const size = 72;
  const runs = TYPED.flat();
  const length = runLength(runs);
  const x0 = W / 2 - (length * size * monoAdvance) / 2;
  // Chunk k starts on beat k and types one character per frame.
  const typed = TYPED.reduce((n, chunk, k) => n + clamp(f - k * BEAT + 1, 0, runLength(chunk)), 0);
  const caretOn = typed < length || Math.floor(f / 4) % 2 === 0;

  const push = interpolate(f, [0, BAR], [1, 1.08], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rule = progress(f, 40, 10, Easings.easeInOutExpo);
  const open = progress(f, 50, 10, Easings.easeInExpo);

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group x={W / 2} y={H / 2} scale={push} opacity={1 - progress(f, 50, 6)}>
        <Group x={-W / 2} y={-H / 2}>
          <Mono runs={runs} x={x0} y={H / 2} size={size} visible={typed} />
          {caretOn && (
            <Rect x={x0 + typed * size * monoAdvance + 4} y={H / 2 - 52} width={6} height={82} fill={C.accent} />
          )}
        </Group>
      </Group>
      <Rect x={W / 2} y={H / 2 + 90} anchorX={0.5} anchorY={0.5}
        width={Math.max(1, W * rule)} height={Math.max(1, 3 + (H + 200) * open)}
        fill={open > 0 ? C.paper : C.accent} />
    </>
  );
}

// ── 02 · Manifesto: one word per beat ──────────────────────────────────────

const WORDS: { text: string; bg: string; ax: number; size: number }[] = [
  { text: 'CODE', bg: C.paper, ax: 0.5, size: 360 },
  { text: 'IS', bg: C.ink, ax: 0, size: 360 },
  { text: 'THE', bg: C.paper, ax: 1, size: 360 },
  { text: 'CUT.', bg: C.accent, ax: 0.5, size: 400 },
  { text: 'EVERY', bg: C.ink, ax: 0, size: 330 },
  { text: 'FRAME', bg: C.paper, ax: 1, size: 330 },
  { text: 'A', bg: C.ink, ax: 0.5, size: 400 },
  { text: 'FUNCTION.', bg: C.accent, ax: 0.5, size: 270 },
];
const wordAt = (f: number) => WORDS[clamp(Math.floor(f / BEAT), 0, WORDS.length - 1)];
const inkOn = (bg: string) => (bg === C.ink ? C.paper : C.ink);

function Words() {
  const f = useCurrentFrame();
  const i = clamp(Math.floor(f / BEAT), 0, WORDS.length - 1);
  const local = f - i * BEAT;
  const word = WORDS[i];
  const fg = inkOn(word.bg);
  const punch = 1 + 0.14 * (1 - progress(local, 0, 9, Easings.easeOutExpo));
  const x = word.ax === 0 ? 120 : word.ax === 1 ? W - 120 : W / 2;
  const drift = (word.ax === 0 ? 1 : word.ax === 1 ? -1 : 0) * local * 1.2;
  return (
    <>
      <Rect width={W} height={H} fill={word.bg} />
      <T x={x + drift} y={H / 2 + 10} size={word.size} ax={word.ax} ay={0.5} color={fg} scale={punch}>
        {word.text}
      </T>
      <T x={120} y={H - 150} size={22} font="mono" weight={400} color={fg} opacity={0.6}>
        {`${pad2(i + 1)}/${pad2(WORDS.length)}`}
      </T>
      <Rect x={120} y={H - 110} width={((i + local / BEAT) / WORDS.length) * 360} height={3} fill={fg} opacity={0.6} />
    </>
  );
}

// ── 03 · Deterministic: a field of cells driven by a formula ──────────────

const COLS = 32;
const ROWS = 18;
const CELL = W / COLS;

function Field() {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = f / FPS;
  const second = f >= BAR * 1.5; // two interfering sources from here on
  const cells: ReactNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = c - (COLS - 1) / 2;
      const cy = r - (ROWS - 1) / 2;
      const d = Math.hypot(cx, cy * 1.1);
      let v: number;
      if (!second) {
        v = 0.5 + 0.5 * Math.sin(d * 0.55 - t * 5);
      } else {
        const a = Math.hypot(cx + 7 * Math.cos(t * 0.9), cy + 3 * Math.sin(t * 1.3));
        const b = Math.hypot(cx - 7 * Math.cos(t * 0.7), cy - 3 * Math.sin(t * 1.1));
        v = 0.5 + 0.25 * (Math.sin(a * 0.8 - t * 6) + Math.sin(b * 0.8 - t * 6));
      }
      const enter = progress(f, d * 1.1, 12, Easings.easeOutBack);
      const exit = 1 - progress(f, durationInFrames - 22 + (12 - d) * 0.9, 8, Easings.easeInCubic);
      const size = (4 + 24 * v * v) * enter * exit;
      if (size < 0.5) continue;
      const hot = v > 0.9;
      cells.push(
        <Rect key={`${r}-${c}`} x={(c + 0.5) * CELL} y={(r + 0.5) * CELL} anchorX={0.5} anchorY={0.5}
          width={size} height={size} rotation={second ? v * 90 : 0}
          fill={hot ? C.accent : C.paper} opacity={hot ? 1 : 0.18 + 0.6 * v} />,
      );
    }
  }

  const textIn = progress(f, 12, 16, Easings.easeOutExpo);
  const textOut = 1 - progress(f, durationInFrames - 20, 10);
  const formula = second ? 'v = ½·(sin(0.8·a − 6t) + sin(0.8·b − 6t))' : 'v = sin(0.55·d − 5t)';
  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      {cells}
      <Group x={120} y={H - 380} opacity={textIn * textOut}>
        <Rect x={-40} y={-50} width={900} height={330} fill={C.ink} opacity={0.88} />
        <Tag x={0} y={0} n="02" name="DETERMINISTIC" />
        <T x={0} y={48 + 30 * (1 - textIn)} size={104} lineHeight={108}>{'Every frame,\na pure function.'}</T>
      </Group>
      <Group x={W - 120} y={120} opacity={textIn * textOut}>
        <Rect x={-620} y={-40} width={660} height={190} fill={C.ink} opacity={0.88} />
        <T x={0} y={0} size={24} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>{formula}</T>
        <T x={0} y={50} size={24} font="mono" weight={400} color={C.paper} ax={1} ay={0.5}>
          {`t = ${t.toFixed(3)} s`}
        </T>
        <T x={0} y={100} size={24} font="mono" weight={700} color={C.accent} ay={0.5} ax={1}>
          {`frame ${String(f).padStart(3, '0')} → same pixels, every time`}
        </T>
      </Group>
    </>
  );
}

// ── 04 · Code: write it, save it, watch it ────────────────────────────────

// Local frames of the scene. Keep RELOADS in make-music.py in sync
// (scene start + these frames, in seconds).
const SAVE = 90;
const EDIT_SIZE = 150;
const EDIT_TEXT = 180;

const K = {
  kw: (text: string): Run => ({ text, color: C.accent }),
  id: (text: string): Run => ({ text, color: C.paper }),
  fn: (text: string): Run => ({ text, color: C.paper, weight: 700 }),
  p: (text: string): Run => ({ text, color: C.grey }),
  num: (text: string): Run => ({ text, color: C.tint }),
  str: (text: string): Run => ({ text, color: C.soft }),
};

// The lines of title.tsx; `size` and `label` are the two values edited live.
function codeLines(size: string, label: string): Run[][] {
  const { kw, id, fn, p, num, str } = K;
  return [
    [kw('import'), p(' { '), id('Text'), p(', '), id('spring'), p(', '), id('useCurrentFrame'), p(' } '), kw('from'), p(' '), str("'@celesta/react'"), p(';')],
    [],
    [kw('export default function'), p(' '), fn('Title'), p('() {')],
    [p('  '), kw('const'), p(' '), id('frame'), p(' = '), fn('useCurrentFrame'), p('();')],
    [p('  '), kw('const'), p(' '), id('s'), p(' = '), fn('spring'), p('({ '), id('frame'), p(', '), id('fps'), p(': '), num('30'), p(' });')],
    [p('  '), kw('return'), p(' (')],
    [p('    <'), fn('Text'), p(' '), id('x'), p('={'), num('960'), p('} '), id('y'), p('={'), num('540'), p(' + '), num('80'), p(' * ('), num('1'), p(' - '), id('s'), p(')}')],
    [p('      '), id('anchorX'), p('={'), num('0.5'), p('} '), id('anchorY'), p('={'), num('0.5'), p('} '), id('opacity'), p('={'), id('s'), p('}')],
    [p('      '), id('style'), p('={{ '), id('fontSize'), p(': '), num(size), p(' }}>')],
    [p('      '), str(label)],
    [p('    </'), fn('Text'), p('>')],
    [p('  );')],
    [p('}')],
  ];
}
const SIZE_LINE = 8;
const SIZE_COL = runLength(codeLines('', '')[SIZE_LINE].slice(0, 5));
const LABEL_LINE = 9;
const LABEL_COL = 6;

function Code() {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const size = f >= EDIT_SIZE ? '180' : '120';
  const label = f >= EDIT_TEXT ? 'Code is the cut.' : 'Hello, Celesta.';
  const lines = codeLines(size, label);

  const inAt = progress(f, 0, 14, Easings.easeOutExpo);
  const exit = 1 - progress(f, durationInFrames - 14, 12, Easings.easeInCubic);

  // Editor.
  const ex = 120;
  const ey = 330;
  const ew = 930;
  const cs = 21;
  const cw = cs * monoAdvance;
  const lh = 38;
  const codeX = ex + 64;
  const codeY = ey + 48 + 34;
  const typedChars = Math.max(0, (f - 8) * 4.5);
  let budget = typedChars;
  let caret: [number, number] = [0, 0];
  const rendered = lines.map((runs, li) => {
    const len = runLength(runs);
    const shown = Math.floor(clamp(budget, 0, len));
    if (budget > 0) caret = [li, shown];
    budget -= len + 1; // a newline costs one character
    return (
      <Group key={li}>
        {budget > -len - 1 && (
          <T x={ex + 44} y={codeY + li * lh} size={16} font="mono" weight={400} color={C.dim} ax={1} ay={0.5}>
            {String(li + 1)}
          </T>
        )}
        <Mono runs={runs} x={codeX} y={codeY + li * lh} size={cs} visible={shown} />
      </Group>
    );
  });
  // After typing, the caret jumps to each edit as it happens.
  if (f >= EDIT_SIZE - 10) caret = [SIZE_LINE, SIZE_COL + size.length];
  if (f >= EDIT_TEXT - 10) caret = [LABEL_LINE, LABEL_COL + label.length];
  const selection = (line: number, col: number, len: number, at: number) => {
    const on = f >= at - 10 && f < at + 16;
    if (!on) return null;
    const flash = f < at ? 0.35 : 0.35 * (1 - progress(f, at, 16));
    return <Rect x={codeX + col * cw - 3} y={codeY + line * lh - lh / 2 + 2} width={len * cw + 6} height={lh - 4}
      cornerRadius={4} fill={C.accent} opacity={flash} />;
  };

  // Preview: a 1920×1080 canvas drawn at k scale, playing the code above.
  const px = 1100;
  const py = 330;
  const pw = 700;
  const k = pw / W;
  const ph = H * k;
  const reloads = [SAVE, EDIT_SIZE, EDIT_TEXT];
  const lastReload = reloads.reduce((found, at) => (f >= at ? at : found), -1);
  const s = lastReload < 0 ? 0 : spring({ frame: f - lastReload, fps, config: { damping: 12, stiffness: 120 } });
  const badge = lastReload < 0 ? 0 : 1 - progress(f, lastReload + 18, 10);
  const previewFrame = lastReload < 0 ? 0 : f - lastReload;

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={exit}>
        <Tag x={120} y={150} n="03" name="CODE" opacity={inAt} />
        <Swap f={f} x={120} y={190} size={110} accentLast
          cues={[[0, 'Write it.'], [SAVE, 'Save it.'], [EDIT_SIZE, 'Change it.']]} />

        <Group y={30 * (1 - inAt)} opacity={inAt}>
          <Rect x={ex} y={ey} width={ew} height={590} cornerRadius={12} fill={C.panel} stroke="#FFFFFF14" strokeWidth={1} />
          <Rect x={ex} y={ey + 47} width={ew} height={1} fill="#FFFFFF14" />
          <Rect x={ex + 24} y={ey + 44} width={130} height={3} fill={C.accent} />
          <T x={ex + 24} y={ey + 24} size={18} font="mono" weight={700} ay={0.5}>title.tsx</T>
          <T x={ex + ew - 24} y={ey + 24} size={16} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
            {f >= SAVE ? 'saved' : 'modified ●'}
          </T>
          {selection(SIZE_LINE, SIZE_COL, 3, EDIT_SIZE)}
          {selection(LABEL_LINE, LABEL_COL, label.length, EDIT_TEXT)}
          {rendered}
          {Math.floor(f / 8) % 2 === 0 && (
            <Rect x={codeX + caret[1] * cw} y={codeY + caret[0] * lh - 14} width={3} height={28} fill={C.accent} />
          )}
        </Group>

        <Group y={30 * (1 - progress(f, 4, 14, Easings.easeOutExpo))} opacity={progress(f, 4, 14)}>
          <Rect x={px} y={py} width={pw} height={ph + 48} cornerRadius={12} fill={C.panel} stroke="#FFFFFF14" strokeWidth={1} />
          <T x={px + 24} y={py + 24} size={18} font="mono" weight={700} ay={0.5}>Preview</T>
          <T x={px + pw - 24} y={py + 24} size={16} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
            {`frame ${String(previewFrame).padStart(3, '0')}`}
          </T>
          <Rect x={px} y={py + 48} width={pw} height={ph} fill={C.paper} />
          {lastReload >= 0 && (
            <T x={px + 960 * k} y={py + 48 + (540 + 80 * (1 - s)) * k} size={Number(size) * k}
              ax={0.5} ay={0.5} opacity={clamp(s)} color={C.ink}>{label}</T>
          )}
          {lastReload < 0 && (
            <T x={px + pw / 2} y={py + 48 + ph / 2} size={18} font="mono" weight={400} color={C.grey} ax={0.5} ay={0.5}>
              waiting for save…
            </T>
          )}
          <Rect x={px} y={py + 48 + ph - 4} width={Math.max(1, pw * clamp(previewFrame / 60))} height={4} fill={C.accent} />
          <Group x={px + pw - 20} y={py + 48 + 22} opacity={badge}>
            <Rect x={-150} y={-17} width={150} height={34} cornerRadius={17} fill={C.accent} />
            <T x={-75} y={0} size={16} font="mono" weight={700} color={C.ink} ax={0.5} ay={0.5}>↻ reloaded</T>
          </Group>
        </Group>
        <Mono x={px} y={py + ph + 100} size={20} opacity={progress(f, SAVE, 12)}
          runs={[{ text: 'Save the file. ', color: C.paper }, { text: 'The preview reloads.', color: C.grey }]} />
      </Group>
    </>
  );
}

// ── 05 · Timeline: layer and sequence ─────────────────────────────────────

type Clip = { at: number; len: number; label: string };
const TRACKS: { id: string; name: string; tag: string; clips: Clip[]; wave?: boolean }[] = [
  { id: 'V1', name: 'VIDEO', tag: C.paper, clips: [
    { at: 0, len: 560, label: 'opening.mp4' },
    { at: 580, len: 760, label: 'gameplay_04.mp4' },
    { at: 1360, len: 900, label: 'boss_fight.mp4' },
  ] },
  { id: 'A1', name: 'VOICE', tag: C.grey, wave: true, clips: [
    { at: 90, len: 420, label: 'akane_001.wav' },
    { at: 640, len: 380, label: 'akane_002.wav' },
    { at: 1120, len: 460, label: 'yukari_003.wav' },
    { at: 1700, len: 520, label: 'akari_004.wav' },
  ] },
  { id: 'T1', name: 'TITLES', tag: C.accent, clips: [
    { at: 40, len: 380, label: '<Title />' },
    { at: 860, len: 420, label: '<LowerThird />' },
    { at: 1480, len: 480, label: '<Subtitle />' },
  ] },
  { id: 'FX', name: 'EFFECT', tag: C.dim, clips: [
    { at: 300, len: 520, label: 'fade' },
    { at: 1240, len: 300, label: 'slide' },
    { at: 1900, len: 560, label: 'scale' },
  ] },
];

function Timeline() {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const left = 400;
  const top = 560;
  const row = 92;
  const scroll = 200 + f * 6;
  const playhead = 1180;
  const exit = 1 - progress(f, durationInFrames - 16, 12, Easings.easeInCubic);

  const tracks = TRACKS.map((track, ti) => {
    const y = top + ti * row;
    const clips = track.clips.map((clip, ci) => {
      const x = left + clip.at - scroll;
      if (x > W || x + clip.len < left - 40) return null;
      const grow = progress(f, 4 + ti * 3 + ci * 2, 14, Easings.easeOutExpo);
      const width = Math.max(1, clip.len * grow);
      const live = playhead >= x && playhead <= x + width;
      const bars: ReactNode[] = [];
      if (track.wave) {
        for (let b = 0; b * 6 < width - 20; b++) {
          const bx = x + 14 + b * 6;
          if (bx < left - 10 || bx > W) continue;
          const amp = Math.abs(Math.sin(b * 0.37 + ci) * Math.sin(b * 0.071 + ci * 2)) * 0.8 + 0.1 * hash(b, ci);
          bars.push(<Rect key={b} x={bx} y={y + 52} anchorY={0.5} width={3} height={4 + 30 * amp}
            fill={live ? C.accent : C.grey} opacity={0.8} />);
        }
      }
      return (
        <Group key={ci} opacity={clamp(grow * 3)}>
          <Rect x={x} y={y} width={width} height={row - 16} cornerRadius={6}
            fill={live ? '#26262C' : C.clip} stroke={live ? C.accent : '#FFFFFF1A'} strokeWidth={live ? 2 : 1} />
          <Rect x={x} y={y} width={6} height={row - 16} fill={track.tag} />
          {bars}
          <T x={x + 20} y={y + (track.wave ? 20 : 38)} size={19} font="mono" weight={400}
            color={live ? C.paper : C.grey} ay={0.5} opacity={grow}>{clip.label}</T>
        </Group>
      );
    });
    return <Group key={track.id}>{clips}</Group>;
  });

  // Ruler ticks every 30 px of timeline, labeled every second (150 px).
  const ticks: ReactNode[] = [];
  const first = Math.floor(scroll / 30);
  for (let k = first; k * 30 - scroll < W - left; k++) {
    const x = left + k * 30 - scroll;
    if (x < left) continue;
    const major = k % 5 === 0;
    ticks.push(<Rect key={`t${k}`} x={x} y={major ? 508 : 520} width={1} height={major ? 24 : 12} fill={C.dim} />);
    if (major) {
      ticks.push(<T key={`l${k}`} x={x + 6} y={500} size={16} font="mono" weight={400} color={C.grey} ay={0.5}>
        {timecode(k * 6).slice(3)}</T>);
    }
  }

  const headUp = progress(f, 0, 14, Easings.easeOutExpo);

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={exit}>
        <Tag x={120} y={150} n="04" name="TIMELINE" opacity={headUp} />
        <Swap f={f} x={120} y={190} size={176} accentLast cues={[[0, 'Layer it.'], [BAR, 'Sequence it.']]} />
        {/* Clips scroll under the label column, so keep them inside the panel. */}
        <Group clip={{ x: left - 10, y: 480, width: W - left + 10, height: H - 480 }}>
          {ticks}
          {tracks}
        </Group>
        {TRACKS.map((track, ti) => (
          <Group key={track.id} x={120} y={top + ti * row + 38} opacity={progress(f, ti * 3, 12)}>
            <Rect y={-8} width={16} height={16} fill={track.tag} />
            <T x={34} y={0} size={20} font="mono" weight={700} color={C.paper} ay={0.5}>{track.id}</T>
            <T x={90} y={0} size={20} font="mono" weight={400} color={C.grey} ay={0.5}>{track.name}</T>
          </Group>
        ))}
        <Rect x={playhead - 1} y={488} width={3} height={row * TRACKS.length + 60} fill={C.accent} />
        <Rect x={playhead} y={470} anchorX={0.5} width={176} height={36} cornerRadius={4} fill={C.accent} />
        <T x={playhead} y={488} size={18} font="mono" weight={700} color={C.ink} ax={0.5} ay={0.5}>
          {timecode(Math.round((scroll + playhead - left) / 5))}
        </T>
      </Group>
    </>
  );
}

// ── 06 · Export: a counter to 100 ─────────────────────────────────────────

const SPECS = ['1920 × 1080', '30 fps', 'H.264 + AAC', 'GPU · yuv420p'];
const COMMAND: Run[] = [
  { text: '$ ', color: C.accent, weight: 700 },
  { text: 'Celesta-export', color: C.ink, weight: 700 },
  { text: ' --react ', color: C.grey },
  { text: 'reel.tsx reel.mp4', color: C.ink },
];

function Export() {
  const f = useCurrentFrame();
  const p = Easings.easeInOutCubic(clamp((f - 14) / 82));
  const pct = Math.round(p * 100);
  const done = pct === 100;
  const inAt = progress(f, 0, 14, Easings.easeOutExpo);
  const typed = Math.floor(clamp((f - 2) * 3.5, 0, runLength(COMMAND)));
  return (
    <>
      <Rect width={W} height={H} fill={C.paper} />
      <Tag x={120} y={150} n="05" name="EXPORT" color={C.ink} opacity={inAt} />
      <T x={120} y={200 + 30 * (1 - inAt)} size={112} lineHeight={116} color={C.ink} opacity={inAt}>
        {'What you preview\nis what you ship.'}
      </T>
      <Mono runs={COMMAND} x={124} y={480} size={28} visible={typed} />
      {typed < runLength(COMMAND) || Math.floor(f / 8) % 2 === 0 ? (
        <Rect x={124 + typed * 28 * monoAdvance + 2} y={464} width={3} height={32} fill={C.accent} />
      ) : null}
      {SPECS.map((spec, i) => {
        const on = progress(f, 20 + i * BEAT, 10, Easings.easeOutExpo);
        return (
          <Group key={spec} x={120} y={620 + i * 44} opacity={on}>
            <Rect y={-4} width={8} height={8} fill={i === SPECS.length - 1 ? C.accent : C.ink} />
            <T x={24 + 20 * (1 - on)} y={0} size={26} font="mono" weight={400} color={C.ink} ay={0.5}>{spec}</T>
          </Group>
        );
      })}
      <T x={W - 330} y={690} size={440} color={done ? C.accent : C.ink} ax={1} ay={0.5}
        scale={done ? 1 + 0.06 * (1 - progress(f, 96, 10, Easings.easeOutExpo)) : 1}>
        {String(pct)}
      </T>
      <T x={W - 120} y={560} size={160} weight={500} color={C.ink} ax={1} ay={0.5}>%</T>
      <Rect x={120} y={910} width={W - 240} height={4} fill={C.ink} opacity={0.15} />
      <Rect x={120} y={910} width={Math.max(1, (W - 240) * p)} height={4} fill={done ? C.accent : C.ink} />
      <T x={120} y={950} size={20} font="mono" weight={400} color={C.ink} ay={0.5}>
        {`frame ${String(Math.round(p * DURATION)).padStart(3, '0')} / ${DURATION}`}
      </T>
      <T x={W - 120} y={950} size={20} font="mono" weight={700} color={done ? C.accent : C.ink} ax={1} ay={0.5}>
        {done ? 'DONE → reel.mp4' : 'RENDERING…'}
      </T>
    </>
  );
}

// ── The beat of silence before the logo ───────────────────────────────────

function Silence() {
  const f = useCurrentFrame();
  const r = 6 + 10 * progress(f, 0, BEAT, Easings.easeInExpo);
  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Rect x={W / 2} y={H / 2} anchorX={0.5} anchorY={0.5} width={r * 2} height={r * 2} cornerRadius={r} fill={C.accent} />
    </>
  );
}

// ── 07 · Logo ─────────────────────────────────────────────────────────────

function Logo() {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const cx = W / 2;
  const cy = H / 2 - 30;

  const stars = Array.from({ length: 170 }, (_, i) => {
    const zoom = 1 + f * 0.0035;
    const sx = cx + (hash(i, 1) * W * 1.2 - W * 0.6) * zoom;
    const sy = cy + (hash(i, 2) * H * 1.2 - H * 0.6) * zoom;
    const size = 1 + Math.floor(hash(i, 3) * 3);
    const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(f * 0.15 + hash(i, 4) * 20));
    return <Rect key={i} x={sx} y={sy} width={size} height={size} fill={C.paper} opacity={twinkle * 0.5} />;
  });

  const ring = progress(f, 4, 40, Easings.easeOutCubic);
  const orbit: ReactNode[] = [];
  const tilt = (-9 * Math.PI) / 180;
  const ellipse = (a: number, rx: number, ry: number) => {
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)];
  };
  const dots = 140;
  for (let k = 0; k < dots * ring; k++) {
    const [ox, oy] = ellipse((k / dots) * Math.PI * 2 - Math.PI / 2, 700, 200);
    orbit.push(<Rect key={k} x={ox} y={oy} anchorX={0.5} anchorY={0.5} width={3} height={3} fill={C.paper} opacity={0.3} />);
  }
  const [px, py] = ellipse(f * 0.045 - Math.PI / 2, 700, 200);

  const flash = 1 - progress(f, 0, 12, Easings.easeOutCubic);
  const hit = progress(f, 0, 24, Easings.easeOutExpo);
  const rule = progress(f, 24, 20, Easings.easeInOutExpo);
  const sub = progress(f, 36, 16, Easings.easeOutExpo);
  const fadeOut = 1 - progress(f, durationInFrames - 14, 14, Easings.easeInCubic);

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={fadeOut}>
        {stars}
        {orbit}
        <Rect x={px} y={py} anchorX={0.5} anchorY={0.5} width={16} height={16} cornerRadius={8}
          fill={C.accent} opacity={ring} />
        {logo ? (
          <Group x={cx} y={cy} scale={1.3 - 0.3 * hit}>
            {logo.letters.map(({ text, x }, i) => {
              const letter = progress(f, i * 2, 24, Easings.easeOutExpo);
              return (
                <T key={i} x={x - logo!.width / 2} y={20 * (1 - letter)} size={LOGO_SIZE} weight={700}
                  ay={0.5} opacity={clamp(letter * 2)}>{text}</T>
              );
            })}
          </Group>
        ) : (
          <T x={cx} y={cy + 20 * (1 - hit)} size={LOGO_SIZE} weight={700} ax={0.5} ay={0.5}
            scale={1.3 - 0.3 * hit} opacity={clamp(hit * 2)}>Celesta</T>
        )}
        <Rect x={cx} y={cy + 160} anchorX={0.5} width={Math.max(1, 640 * rule)} height={2} fill={C.paper} opacity={0.5} />
        <T x={cx} y={cy + 216 + 16 * (1 - sub)} size={26} font="mono" weight={400} color={C.grey}
          ax={0.5} ay={0.5} opacity={sub}>C O D E - F I R S T   V I D E O</T>
      </Group>
      <Rect width={W} height={H} fill={C.paper} opacity={flash} />
    </>
  );
}

// ── Transitions and HUD ───────────────────────────────────────────────────

// A slanted accent band that sweeps across a cut. Place it so the cut lands
// at its midpoint.
function Wipe() {
  const f = useCurrentFrame();
  const p = progress(f, 0, 14, Easings.easeInOutCubic);
  const x = -700 + (W + 1400) * p;
  return (
    <>
      <Rect x={x} y={H / 2} anchorX={0.5} anchorY={0.5} width={620} height={H * 1.6} rotation={14} fill={C.accent} />
      <Rect x={x - 380} y={H / 2} anchorX={0.5} anchorY={0.5} width={60} height={H * 1.6} rotation={14} fill={C.paper} />
    </>
  );
}

const SECTIONS: [number, string][] = [
  [S.intro, 'COLD OPEN'],
  [S.words, 'MANIFESTO'],
  [S.field, 'DETERMINISTIC'],
  [S.code, 'CODE'],
  [S.timeline, 'TIMELINE'],
  [S.exportAt, 'EXPORT'],
];

// Drawn in paper and blended with `difference`, so it reads light over the
// dark scenes and dark over the paper ones without tracking which is which.
function Hud() {
  const f = useCurrentFrame();
  const fg = C.paper;
  const section = [...SECTIONS].reverse().find(([at]) => f >= at)?.[1] ?? '';
  const m = 56;
  const arm = 26;
  const corner = (x: number, y: number, sx: number, sy: number) => (
    <Group key={`${x}-${y}`} x={x} y={y}>
      <Rect x={sx < 0 ? -arm : 0} width={arm} height={2} fill={fg} />
      <Rect y={sy < 0 ? -arm : 0} width={2} height={arm} fill={fg} />
    </Group>
  );
  return (
    <>
      <Group opacity={0.75} blendMode="difference">
        {corner(m, m, 1, 1)}
        {corner(W - m, m, -1, 1)}
        {corner(m, H - m, 1, -1)}
        {corner(W - m, H - m, -1, -1)}
        <T x={m + 40} y={m + 12} size={18} font="mono" weight={700} color={fg} ay={0.5}>Celesta</T>
        <T x={m + 136} y={m + 12} size={18} font="mono" weight={400} color={fg} ay={0.5} opacity={0.6}>/ Reel 01</T>
        <T x={W - m - 40} y={m + 12} size={18} font="mono" weight={400} color={fg} ax={1} ay={0.5}>{timecode(f)}</T>
        <T x={m + 40} y={H - m - 12} size={18} font="mono" weight={400} color={fg} ay={0.5}>{section}</T>
        <T x={W - m - 40} y={H - m - 12} size={18} font="mono" weight={400} color={fg} ax={1} ay={0.5}>
          {`${W}×${H} · ${FPS} FPS · 120 BPM`}
        </T>
      </Group>
      <Rect x={m} y={H - 26} width={(W - m * 2) * (f / (DURATION - 1))} height={2} fill={C.accent} opacity={0.75} />
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

const SCENES: { from: number; to: number; C: () => ReactNode }[] = [
  { from: S.intro, to: S.words, C: Intro },
  { from: S.words, to: S.field, C: Words },
  { from: S.field, to: S.code, C: Field },
  { from: S.code, to: S.timeline, C: Code },
  { from: S.timeline, to: S.exportAt, C: Timeline },
  { from: S.exportAt, to: S.silence, C: Export },
  { from: S.silence, to: S.logo, C: Silence },
  { from: S.logo, to: DURATION, C: Logo },
];

export default function Root() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={DURATION}>
      <Assets>
        <Font src={FONT_SRC} />
      </Assets>
      {SCENES.map(({ from, to, C: Scene }) => (
        <Sequence key={from} from={from} durationInFrames={to - from}><Scene /></Sequence>
      ))}
      {[S.field, S.code, S.timeline, S.exportAt].map((cut) => (
        <Sequence key={`wipe-${cut}`} from={cut - 7} durationInFrames={15}><Wipe /></Sequence>
      ))}
      <Sequence from={0} durationInFrames={S.silence}><Hud /></Sequence>
      <Audio src="./assets/celesta-reel/music.wav" />
    </Composition>
  );
}

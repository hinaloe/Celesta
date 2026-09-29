// "Feature Tour." A 52-second tour of Celesta's features, cut to a 120 BPM
// score (one beat = 15 frames, one bar = 60 frames at 30 fps). Nine
// chapters, each a headline, a Japanese caption, the API that does it, and a
// live demo of it.
// Open this file in Celesta, or export it with:
//   Celesta-export --react examples/feature-tour/film.tsx feature-tour.mp4
import { createRef } from 'react';
import type { ReactNode } from 'react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Assets,
  Audio,
  Character,
  CharacterView,
  Composition,
  Dialogue,
  Easings,
  Font,
  Group,
  Rect,
  Sequence,
  Text,
  buildEnvelope,
  decodeWav,
  interpolate,
  loadLipSync,
  loadPsdPreset,
  spring,
  useCurrentFrame,
  useLipSync,
  useVideoConfig,
} from '@celesta/react';
import type { AssetReference, CharacterViewReference, LipSyncTrack } from '@celesta/react';

const W = 1920;
const H = 1080;
const FPS = 30;
const BEAT = 15;
const BAR = BEAT * 4;

const C = {
  ink: '#07080C',
  panel: '#10121A',
  clip: '#171A24',
  line: '#FFFFFF1F',
  paper: '#F1F0EC',
  soft: '#B9BCC6',
  grey: '#80859A',
  dim: '#2A2E3A',
  blue: '#3D5BFF',
  sky: '#9DB0FF',
  pink: '#FF4D8D',
} as const;

const FONT = {
  display: 'Unbounded',
  serif: 'Instrument Serif',
  mono: 'JetBrains Mono',
  ja: 'Noto Sans JP',
  jaDisplay: 'Dela Gothic One',
  dot: 'DotGothic16',
} as const;
// JetBrains Mono advances every glyph by 0.6 em, so mono text can be measured.
const MONO_ADVANCE = 0.6;

// Scene boundaries, in frames. Every chapter starts on a downbeat.
const S = {
  open: 0,
  index: BAR * 2,
  outro: BAR * 23,
} as const;
const DURATION = BAR * 26;

// The dialogue chapter's voice line.
const PSD = '../assets/illust/琴葉姉妹_SD立ち絵.psd';
const PRESET = '../assets/illust/琴葉茜.pfv';
const VOICE = '../assets/voices/character-lipsync-demo.wav';
const VOICE_TEXT = 'こんにちは、リップシンクのデモです！';
const VOICE_AT = 24; // local frame of the dialogue chapter
const MOUTH = '琴葉姉妹/!表情/口';

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const progress = (f: number, start: number, frames: number, easing = Easings.easeOutCubic) =>
  easing(clamp((f - start) / frames));
const hash = (i: number, seed = 0) => {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const pad = (n: number, width = 2) => String(Math.max(0, Math.floor(n))).padStart(width, '0');
const timecode = (f: number) =>
  `${pad(f / (FPS * 60))}:${pad((f / FPS) % 60)}:${pad(f % FPS)}`;
const monoWidth = (text: string, size: number) => text.length * size * MONO_ADVANCE;

// ── Text ──────────────────────────────────────────────────────────────────

type TProps = {
  children: string;
  x: number;
  y: number;
  size: number;
  font?: keyof typeof FONT;
  weight?: number;
  color?: string;
  stroke?: { color: string; width: number };
  ax?: number;
  ay?: number | 'baseline';
  opacity?: number;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  maxWidth?: number;
};

function T({
  children, x, y, size, font = 'display', weight = 800, color = C.paper, stroke,
  ax = 0, ay = 0, opacity = 1, scale = 1, align = 'left', lineHeight, maxWidth,
}: TProps) {
  return (
    <Text x={x} y={y} anchorX={ax} anchorY={ay} opacity={opacity} scale={scale} maxWidth={maxWidth}
      style={{
        fontFamily: FONT[font], fontSize: size, fontWeight: weight, align, lineHeight,
        fill: { type: 'solid', color },
        stroke: stroke && { paint: { type: 'solid', color: stroke.color }, width: stroke.width },
      }}>
      {children}
    </Text>
  );
}

// Swaps between strings on the given frames; each new one rises into place.
function Swap({ f, cues, render }: {
  f: number;
  cues: [number, string][];
  render: (text: string, p: number) => ReactNode;
}) {
  const index = cues.reduce((found, [at], i) => (f >= at ? i : found), -1);
  if (index < 0) return null;
  const [at, text] = cues[index];
  return <>{render(text, index === 0 ? 1 : progress(f, at, 10, Easings.easeOutExpo))}</>;
}

// ── Chapters ──────────────────────────────────────────────────────────────

type Chapter = {
  key: string;
  en: string;
  ja: string;
  jaShort: string;
  api: [number, string][];
  len: number;
  bg: string;
  Demo: () => ReactNode;
};

const CHAPTERS: Chapter[] = [
  {
    key: 'REACT', en: 'Write it\nin React.', jaShort: 'React で組む',
    ja: '動画は、React コンポーネント。\nRect・Text・Group を重ねて、\n1 枚のフレームを組み立てる。',
    api: [[0, '<Composition fps={30}>']], len: BAR * 2, bg: C.ink, Demo: ReactDemo,
  },
  {
    key: 'MOTION', en: 'Move it\nwith math.', jaShort: '動きを計算する',
    ja: 'interpolate・spring・Easings。\n動きはすべて、フレーム番号から計算する。',
    api: [[0, 'spring({ frame, fps })']], len: BAR * 2, bg: C.ink, Demo: MotionDemo,
  },
  {
    key: 'LAYOUT', en: 'Lay it\nall out.', jaShort: 'レイアウト',
    ja: 'Grid・Stack・Center・Fit。\n座標の計算は、レイアウトに任せる。',
    api: [[0, '<Grid columns={4}>'], [45, '<Stack direction="horizontal">'], [90, '<Center>']],
    len: BAR * 2, bg: C.ink, Demo: LayoutDemo,
  },
  {
    key: 'TYPE', en: 'Set any\ntype.', jaShort: 'フォントと文字',
    ja: 'Google Fonts もローカルのフォントも、\n<Font> ひとつで。和文も、縁取りも。',
    api: [[0, '<Font src="https://fonts…" />']], len: BAR * 2, bg: C.ink, Demo: TypeDemo,
  },
  {
    key: 'TIMELINE', en: 'Or lay out\na timeline.', jaShort: 'JSON タイムライン',
    ja: '.celesta.json にクリップを並べる。\nReact のコンポーネントも、同じタイムラインに。',
    api: [[0, 'project.celesta.json'], [60, "registerComponent('LowerThird')"]],
    len: BAR * 2, bg: C.ink, Demo: TimelineDemo,
  },
  {
    key: 'VOICE', en: 'Give it\na voice.', jaShort: '立ち絵・字幕・口パク',
    ja: 'PSD の立ち絵に、字幕と音声。\n口の動きは、音声から自動で生成する。',
    api: [[0, 'loadLipSync({ src, text })']], len: BAR * 3, bg: C.ink, Demo: VoiceDemo,
  },
  {
    key: 'PREVIEW', en: 'Scrub any\nframe.', jaShort: 'プレビュー',
    ja: 'フレーム単位でスクラブ。\nどのフレームも、何度描いても同じ絵になる。',
    api: [[0, 'useCurrentFrame()']], len: BAR * 2, bg: C.ink, Demo: PreviewDemo,
  },
  {
    key: 'EXPORT', en: 'Ship it\nas MP4.', jaShort: 'MP4 書き出し',
    ja: 'H.264 + AAC の MP4 に。\nアプリからも、コマンド一発でも。',
    api: [[0, 'Celesta-export --react film.tsx']], len: BAR * 2, bg: C.blue, Demo: ExportDemo,
  },
  {
    key: 'AGENTS', en: 'Let agents\ndirect.', jaShort: 'AI エージェント',
    ja: 'Skill を読んだ AI エージェントが、\n書いて、確かめて、書き出す。\nこの動画も、そうして作られた。',
    api: [[0, 'skills/celesta/SKILL.md']], len: BAR * 2, bg: C.ink, Demo: AgentDemo,
  },
];

// Chapter start frames, back to back after the index.
const CHAPTER_AT: number[] = [];
{
  let at = BAR * 4;
  for (const chapter of CHAPTERS) {
    CHAPTER_AT.push(at);
    at += chapter.len;
  }
}

// The demo area on the right of every chapter.
const DX = 1000;
const DW = 800;

function ChapterShell({ index, children }: { index: number; children: ReactNode }) {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const chapter = CHAPTERS[index];
  const onBlue = chapter.bg === C.blue;
  const accent = onBlue ? C.paper : C.blue;
  const exit = 1 - progress(f, durationInFrames - 8, 8, Easings.easeInCubic);
  const lines = chapter.en.split('\n');

  const numberIn = progress(f, 0, 14, Easings.easeOutExpo);
  const tagIn = progress(f, 4, 12, Easings.easeOutExpo);
  const captionIn = progress(f, 16, 14, Easings.easeOutExpo);
  const chipIn = progress(f, 22, 14, Easings.easeOutExpo);

  return (
    <>
      <Rect width={W} height={H} fill={chapter.bg} />
      <Group opacity={exit} y={-24 * (1 - exit)}>
        <T x={116} y={250 + 30 * (1 - numberIn)} size={170} font="serif" weight={400} color={accent}
          ay="baseline" opacity={numberIn}>{pad(index + 1)}</T>
        <Group x={300 - 20 * (1 - tagIn)} y={190} opacity={tagIn}>
          <T x={0} y={0} size={22} font="mono" weight={700} ay={0.5}>{chapter.key}</T>
          <T x={0} y={34} size={18} font="mono" weight={400} color={onBlue ? C.paper : C.grey} ay={0.5}
            opacity={onBlue ? 0.7 : 1}>
            {`${pad(index + 1)} / ${pad(CHAPTERS.length)}`}
          </T>
        </Group>
        {lines.map((line, i) => {
          const p = progress(f, 6 + i * 4, 16, Easings.easeOutExpo);
          return (
            <T key={i} x={120} y={300 + i * 112 + 60 * (1 - p)} size={92} opacity={p}>{line}</T>
          );
        })}
        <T x={120} y={570 + 20 * (1 - captionIn)} size={28} font="ja" weight={500}
          color={onBlue ? C.paper : C.soft} lineHeight={50} opacity={captionIn}>
          {chapter.ja}
        </T>
        <Group y={24 * (1 - chipIn)} opacity={chipIn}>
          <Swap f={f} cues={chapter.api} render={(text, p) => {
            const w = monoWidth(text, 22) + 56;
            return (
              <Group x={120} y={840} opacity={p}>
                <Rect y={-28} width={w} height={56} cornerRadius={28}
                  fill={onBlue ? C.ink : C.panel} stroke={onBlue ? undefined : C.line} strokeWidth={onBlue ? undefined : 1} />
                <Rect x={24} y={-4} width={8} height={8} cornerRadius={4} fill={onBlue ? C.paper : C.blue} />
                <T x={44} y={0} size={22} font="mono" weight={500} color={onBlue ? C.paper : C.sky} ay={0.5}>
                  {text}
                </T>
              </Group>
            );
          }} />
        </Group>
        {children}
      </Group>
    </>
  );
}

// ── 00 · Cold open: a ball bounces through one frame, then fills the screen ──

function Open() {
  const f = useCurrentFrame();
  const fw = 960;
  const fh = 540;
  const fx = (W - fw) / 2;
  const fy = (H - fh) / 2 - 20;
  const floor = fy + fh - 70;
  const frameIn = progress(f, 0, 12, Easings.easeOutExpo);
  const frameOut = 1 - progress(f, 46, 6);

  // The ball lands on every beat: 0, 15, 30, then rests at the center on 45.
  const beat = Math.floor(f / BEAT);
  const u = (f % BEAT) / BEAT;
  const hop = beat < 3 ? 4 * u * (1 - u) * [230, 180, 130][beat] : 0;
  const x = interpolate(f, [0, 45], [fx + 150, W / 2], {
    easing: Easings.easeOutSine, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const land = beat < 3 ? Math.min(u, 1 - u) : 1; // 0 at the moment of contact
  const squash = beat < 4 ? 1 - 0.28 * clamp(1 - land / 0.12) : 1;
  const d = 110;
  const ballIn = progress(f, 2, 10, Easings.easeOutBack);
  // From frame 46 the ball opens like an iris until it covers the screen.
  const iris = progress(f, 46, 14, Easings.easeInCubic);
  const size = d + (2300 - d) * iris;
  const cy = floor - d / 2 - hop + (H / 2 - (floor - d / 2)) * iris;

  const ball = (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={frameIn * frameOut} y={20 * (1 - frameIn)}>
        <Rect x={fx} y={fy} width={fw} height={fh} cornerRadius={18} fill={C.panel} stroke="#FFFFFF33" strokeWidth={2} />
        <Rect x={fx + 60} y={floor} width={fw - 120} height={2} fill="#FFFFFF22" />
        <T x={fx + 28} y={fy + 34} size={18} font="mono" weight={700} color={C.soft} ay={0.5}>
          {`frame ${pad(f, 3)}`}
        </T>
        {/* The ball's shadow shrinks as it rises. */}
        <Rect x={x} y={floor + 1} anchorX={0.5} anchorY={0.5} width={d * (1 - hop / 400)} height={10}
          cornerRadius={5} fill="#000000" opacity={0.35 * (1 - hop / 300) * ballIn} />
        <T x={fx} y={fy + fh + 50} size={20} font="mono" weight={700} ay={0.5}>{'const y = bounce(frame);'}</T>
        <T x={fx + fw} y={fy + fh + 50} size={20} font="mono" weight={400} color={C.soft} ax={1} ay={0.5}>
          {'f(frame) → pixels'}
        </T>
      </Group>
      <Rect x={x} y={cy} anchorX={0.5} anchorY={0.5}
        width={size * (iris > 0 ? 1 : (2 - squash))} height={size * (iris > 0 ? 1 : squash)}
        cornerRadius={size / 2} fill={C.blue} scale={iris > 0 ? 1 : ballIn} />
    </>
  );

  // Bar 1: the title.
  const t = f - BAR;
  const hit = progress(t, 0, 16, Easings.easeOutExpo);
  const label = progress(t, BEAT, 12, Easings.easeOutExpo);
  const ja = progress(t, BEAT * 2, 12, Easings.easeOutExpo);

  return (
    <>
      {t < 0 && ball}
      {t >= 0 && (
        <>
          <Rect width={W} height={H} fill={C.blue} />
          <T x={W / 2} y={H / 2 - 10 + 30 * (1 - hit)} size={250} ax={0.5} ay={0.5} scale={1.08 - 0.08 * hit}
            opacity={clamp(hit * 1.5)}>Celesta</T>
          <T x={W / 2} y={H / 2 - 210 + 16 * (1 - label)} size={22} font="mono" weight={700} ax={0.5} ay={0.5}
            opacity={label}>{`FEATURE TOUR  ·  ${pad(CHAPTERS.length)} CHAPTERS`}</T>
          <T x={W / 2} y={H / 2 + 190 + 16 * (1 - ja)} size={40} font="ja" weight={700} ax={0.5} ay={0.5}
            opacity={ja}>{TAGLINE}</T>
        </>
      )}
    </>
  );
}

const TAGLINE = '動画を、コードで書く。';

// ── Index: the table of contents ──────────────────────────────────────────

const INDEX_TOP = 250;
const ROW = 68;

function Index() {
  const f = useCurrentFrame();
  const scan = f >= 60 && f < 96 ? Math.floor((f - 60) / 4) : f >= 96 ? 0 : -1;
  const grow = progress(f, 100, 16, Easings.easeInOutExpo);
  const head = progress(f, 0, 14, Easings.easeOutExpo);

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={head}>
        <T x={120} y={170} size={22} font="mono" weight={700} ay={0.5}>INDEX</T>
        <T x={220} y={170} size={22} font="ja" weight={500} color={C.grey} ay={0.5}>機能一覧</T>
        <T x={W - 120} y={170} size={20} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
          {`${pad(CHAPTERS.length)} FEATURES / 1 FILE`}
        </T>
      </Group>
      {scan >= 0 && scan < CHAPTERS.length && (
        <Rect x={120} y={INDEX_TOP + scan * ROW + 4} width={W - 240} height={ROW - 8} fill={C.blue} />
      )}
      {CHAPTERS.map((chapter, i) => {
        const y = INDEX_TOP + i * ROW;
        const p = progress(f, 6 + i * 4, 14, Easings.easeOutExpo);
        const lit = i === scan;
        const out = f >= 100 && i !== 0 ? 1 - progress(f, 100, 6) : 1;
        return (
          <Group key={chapter.key} opacity={p * out}>
            <Rect x={120} y={y} width={Math.max(1, (W - 240) * p)} height={1} fill={C.line} />
            <T x={140 + 40 * (1 - p)} y={y + ROW / 2 + 14} size={44} font="serif" weight={400}
              color={lit ? C.paper : C.blue} ay="baseline">{pad(i + 1)}</T>
            <T x={250 + 40 * (1 - p)} y={y + ROW / 2} size={30} ay={0.5}>{chapter.key}</T>
            <T x={840 + 40 * (1 - p)} y={y + ROW / 2} size={24} font="ja" weight={500}
              color={lit ? C.paper : C.soft} ay={0.5}>{chapter.jaShort}</T>
            <T x={W - 140} y={y + ROW / 2} size={20} font="mono" weight={400} color={lit ? C.paper : C.grey}
              ax={1} ay={0.5}>{INDEX_API[i]}</T>
          </Group>
        );
      })}
      {/* The first row opens up into chapter 01. */}
      {f >= 100 && (
        <Rect x={120 * (1 - grow)} y={(INDEX_TOP + 4) * (1 - grow)} width={W - 240 * (1 - grow)}
          height={ROW - 8 + (H - ROW + 8) * grow} fill={C.blue} />
      )}
    </>
  );
}

const INDEX_API = [
  '<Composition>', 'interpolate · spring', '<Grid> · <Stack>', '<Font>', '.celesta.json',
  '<Dialogue>', 'useCurrentFrame()', 'Celesta-export', 'skills/celesta',
];

// ── 01 · React: a frame is a stack of layers ──────────────────────────────

function ReactDemo() {
  const f = useCurrentFrame();
  // The blue that the index opened up drains away first.
  const drain = progress(f, 0, 12, Easings.easeInOutExpo);
  const cx = 1330;
  const base = 700;
  const pw = 480;
  const ph = 270;
  const rise = progress(f, 6, 18, Easings.easeOutExpo);
  const gap = 150 * progress(f, 28, 26, Easings.easeInOutCubic);
  const bob = progress(f, 54, 20);
  const plates = [
    { name: '<Rect>', note: 'fill="#3D5BFF"' },
    { name: '<Group>', note: '3 × <Rect cornerRadius>' },
    { name: '<Text>', note: '"Hello."' },
  ];
  return (
    <>
      {plates.map((plate, i) => {
        const y = base - i * gap - 80 * (1 - rise) + Math.sin((f + i * 9) / 12) * 5 * bob;
        const label = progress(f, 40 + i * 5, 12, Easings.easeOutExpo);
        return (
          <Group key={i}>
            <Group x={cx} y={y} opacity={rise}>
              <Group scaleY={0.56}>
                <Group rotation={45}>
                  <Plate layer={i} w={pw} h={ph} f={f} />
                </Group>
              </Group>
            </Group>
            <Group opacity={label}>
              <Rect x={cx + 170} y={y} width={Math.max(1, 110 * label)} height={1} fill={C.soft} />
              <Rect x={cx + 166} y={y - 4} width={8} height={8} cornerRadius={4} fill={C.paper} />
              <T x={cx + 296} y={y - 12} size={22} font="mono" weight={700} ay={0.5}>{plate.name}</T>
              <T x={cx + 296} y={y + 18} size={15} font="mono" weight={400} color={C.grey} ay={0.5}>{plate.note}</T>
            </Group>
          </Group>
        );
      })}
      <Rect width={W} height={H * (1 - drain)} fill={C.blue} />
    </>
  );
}

function Plate({ layer, w, h, f }: { layer: number; w: number; h: number; f: number }) {
  if (layer === 0) {
    return (
      <>
        <Rect anchorX={0.5} anchorY={0.5} width={w} height={h} fill={C.blue} />
        {Array.from({ length: 11 }, (_, i) => (
          <Rect key={i} x={-w / 2 + (i + 1) * (w / 12)} y={-h / 2} width={1} height={h} fill="#FFFFFF22" />
        ))}
      </>
    );
  }
  if (layer === 1) {
    return (
      <>
        <Rect anchorX={0.5} anchorY={0.5} width={w} height={h} fill="#FFFFFF08" stroke="#FFFFFF55" strokeWidth={2} />
        {[C.pink, C.paper, C.sky].map((color, k) => {
          const a = f * 0.07 + (k * Math.PI * 2) / 3;
          return (
            <Rect key={k} x={Math.cos(a) * 110} y={Math.sin(a) * 60} anchorX={0.5} anchorY={0.5}
              width={64} height={64} cornerRadius={32} fill={color} />
          );
        })}
      </>
    );
  }
  return (
    <>
      <Rect anchorX={0.5} anchorY={0.5} width={w} height={h} fill="#FFFFFF05" stroke="#FFFFFF55" strokeWidth={2} />
      <T x={0} y={0} size={64} ax={0.5} ay={0.5}>Hello.</T>
    </>
  );
}

// ── 02 · Motion: three curves, one frame number ───────────────────────────

const CURVES: { name: string; fn: (t: number) => number }[] = [
  { name: 'easeOutExpo', fn: Easings.easeOutExpo },
  { name: 'easeInOutBack', fn: Easings.easeInOutBack },
  { name: 'spring()', fn: (t) => spring({ frame: t * 40, fps: FPS, config: { damping: 8, stiffness: 140 } }) },
];

function MotionDemo() {
  const f = useCurrentFrame();
  const size = 250;
  const gapX = 25;
  const top = 280;
  const lo = -0.3;
  const hi = 1.3;
  const py = (v: number) => top + size - 20 - ((v - lo) / (hi - lo)) * (size - 40);
  return (
    <>
      {CURVES.map(({ name, fn }, i) => {
        const x0 = DX + i * (size + gapX);
        const enter = progress(f, 4 + i * 4, 16, Easings.easeOutExpo);
        const cycle = (f + 60 - i * 3) % BAR;
        const t = clamp((cycle - 8) / 36);
        const v = fn(t);
        const dots: ReactNode[] = [];
        for (let k = 0; k <= 48; k++) {
          const u = k / 48;
          dots.push(
            <Rect key={k} x={x0 + 20 + u * (size - 40)} y={py(fn(u))} anchorX={0.5} anchorY={0.5}
              width={4} height={4} cornerRadius={2} fill={u <= t ? C.paper : C.dim} />,
          );
        }
        const trackY = top + size + 120;
        return (
          <Group key={name} y={40 * (1 - enter)} opacity={enter}>
            <Rect x={x0} y={top} width={size} height={size} cornerRadius={14} fill={C.panel} stroke={C.line} strokeWidth={1} />
            <Rect x={x0 + 20} y={py(0)} width={size - 40} height={1} fill={C.dim} />
            <Rect x={x0 + 20} y={py(1)} width={size - 40} height={1} fill={C.dim} />
            {dots}
            <Rect x={x0 + 20 + t * (size - 40)} y={py(v)} anchorX={0.5} anchorY={0.5}
              width={16} height={16} cornerRadius={8} fill={C.blue} />
            <T x={x0 + size - 16} y={top + 22} size={15} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
              {v.toFixed(3)}
            </T>
            <T x={x0} y={top + size + 34} size={19} font="mono" weight={700} ay={0.5}>{name}</T>
            <Rect x={x0} y={trackY} width={size} height={1} fill={C.dim} />
            <Rect x={x0 + 22 + v * (size - 44)} y={trackY} anchorX={0.5} anchorY={0.5}
              width={40} height={40} rotation={v * 90} fill={i === 1 ? C.pink : C.blue} />
            <Rect x={x0 + size / 2} y={trackY + 110} anchorX={0.5} anchorY={0.5}
              width={16 + 60 * clamp(v, 0, 1.4)} height={16 + 60 * clamp(v, 0, 1.4)}
              cornerRadius={8 + 30 * clamp(v, 0, 1.4)} fill="#FFFFFF00" stroke={C.soft} strokeWidth={2} />
          </Group>
        );
      })}
      <T x={DX} y={880} size={18} font="mono" weight={400} color={C.grey} ay={0.5}
        opacity={progress(f, 20, 12)}>{`frame ${pad(f, 3)} → t = ${clamp(((f % BAR) - 8) / 36).toFixed(2)}`}</T>
    </>
  );
}

// ── 03 · Layout: Grid, then Stack, then Center ────────────────────────────

const TILES = 12;

function tileState(i: number, state: number) {
  const cx = 1390;
  const cy = 540;
  if (state === 0) {
    const c = i % 4;
    const r = Math.floor(i / 4);
    return { x: 1050 + c * 170 + 75, y: 300 + r * 170 + 75, size: 150, rotation: 0, fill: 1 };
  }
  if (state === 1) {
    return { x: cx - (TILES - 1) * 32 + i * 64, y: cy, size: 52, rotation: 0, fill: 1 };
  }
  return { x: cx, y: cy, size: 300, rotation: i * 15, fill: i === 10 ? 1 : 0 };
}

function LayoutDemo() {
  const f = useCurrentFrame();
  const guides = progress(f, 0, 14) * (1 - progress(f, 45, 10));
  return (
    <>
      {/* Grid guides. */}
      <Group opacity={guides * 0.9}>
        {Array.from({ length: 5 }, (_, c) => (
          <Rect key={`c${c}`} x={1045 + c * 170} y={290} width={1} height={3 * 170} fill={C.dim} />
        ))}
        {Array.from({ length: 4 }, (_, r) => (
          <Rect key={`r${r}`} x={1045} y={290 + r * 170} width={4 * 170} height={1} fill={C.dim} />
        ))}
      </Group>
      {Array.from({ length: TILES }, (_, i) => {
        const enter = progress(f, 4 + i * 1.5, 12, Easings.easeOutBack);
        const toStack = progress(f, 45 + i * 0.8, 16, Easings.easeInOutExpo);
        const toCenter = progress(f, 90 + (TILES - i) * 0.8, 16, Easings.easeInOutExpo);
        const a = tileState(i, 0);
        const b = tileState(i, 1);
        const c = tileState(i, 2);
        const mix = (k: keyof typeof a) => a[k] + (b[k] - a[k]) * toStack + (c[k] - b[k]) * toCenter;
        const size = mix('size') * (0.5 + 0.5 * enter);
        const fill = mix('fill');
        const color = i % 5 === 0 ? C.blue : i % 3 === 0 ? C.paper : C.clip;
        return (
          <Group key={i} x={mix('x')} y={mix('y')} rotation={mix('rotation')} opacity={enter}>
            <Rect anchorX={0.5} anchorY={0.5} width={size} height={size} cornerRadius={size * 0.06}
              fill={fill > 0.02 ? color : undefined} opacity={1}
              stroke={color === C.clip || fill < 0.98 ? '#FFFFFF40' : undefined}
              strokeWidth={color === C.clip || fill < 0.98 ? 1 : undefined} />
            {fill < 0.98 && (
              <Rect anchorX={0.5} anchorY={0.5} width={size} height={size} cornerRadius={size * 0.06}
                fill={color} opacity={fill} />
            )}
            <T x={-size / 2 + 12} y={-size / 2 + 20} size={15} font="mono" weight={700}
              color={color === C.paper ? C.ink : C.paper} ay={0.5} opacity={clamp((size - 100) / 40)}>
              {pad(i + 1)}
            </T>
          </Group>
        );
      })}
    </>
  );
}

// ── 04 · Type: one card, eight faces ──────────────────────────────────────

type Specimen = {
  font: keyof typeof FONT;
  weight: number;
  glyph: string;
  sample: string;
  meta: string;
  color?: string;
  stroke?: { color: string; width: number };
};

const SPECIMENS: Specimen[] = [
  { font: 'display', weight: 800, glyph: 'Aa', sample: 'Every frame, typeset.', meta: 'Unbounded · 800' },
  { font: 'serif', weight: 400, glyph: 'Aa', sample: 'Every frame, typeset.', meta: 'Instrument Serif · 400' },
  { font: 'ja', weight: 900, glyph: '字', sample: '動画を、コードで書く。', meta: 'Noto Sans JP · 900' },
  { font: 'jaDisplay', weight: 400, glyph: '字', sample: '動画を、コードで書く。', meta: 'Dela Gothic One · 400' },
  { font: 'dot', weight: 400, glyph: '字', sample: '動画を、コードで書く。', meta: 'DotGothic16 · 400' },
  { font: 'mono', weight: 700, glyph: '{ }', sample: 'const f = useCurrentFrame();', meta: 'JetBrains Mono · 700' },
  { font: 'ja', weight: 900, glyph: '縁', sample: '縁取りも、スタイルひとつで。', meta: 'stroke · 10 px',
    color: C.ink, stroke: { color: C.sky, width: 10 } },
  { font: 'display', weight: 800, glyph: 'Aa', sample: 'Load anything with <Font>.', meta: 'fill + stroke',
    color: C.blue, stroke: { color: C.paper, width: 6 } },
];

function TypeDemo() {
  const f = useCurrentFrame();
  const k = clamp(Math.floor(f / BEAT), 0, SPECIMENS.length - 1);
  const local = f - k * BEAT;
  const s = SPECIMENS[k];
  const punch = 1 + 0.08 * (1 - progress(local, 0, 8, Easings.easeOutExpo));
  const enter = progress(f, 2, 16, Easings.easeOutExpo);
  const top = 250;
  const h = 580;
  const listX = DX + DW - 250;
  return (
    <Group y={40 * (1 - enter)} opacity={enter}>
      <Rect x={DX} y={top} width={DW} height={h} cornerRadius={14} fill={C.panel} stroke={C.line} strokeWidth={1} />
      <Rect x={listX - 30} y={top + 30} width={1} height={h - 60} fill={C.line} />
      <T x={(DX + listX - 30) / 2} y={top + 230} size={220} font={s.font} weight={s.weight} ax={0.5} ay={0.5}
        color={s.color ?? C.paper} stroke={s.stroke} scale={punch}>{s.glyph}</T>
      <T x={DX + 40} y={top + 440} size={s.font === 'mono' ? 22 : 30} font={s.font} weight={s.weight}
        color={C.paper} ay={0.5} opacity={progress(local, 1, 6)}>{s.sample}</T>
      <T x={DX + 40} y={top + 510} size={16} font="mono" weight={400} color={C.grey} ay={0.5}>{s.meta}</T>
      <T x={listX - 60} y={top + 510} size={16} font="mono" weight={700} color={C.blue} ax={1} ay={0.5}>
        {`${k + 1} / ${SPECIMENS.length}`}
      </T>
      {SPECIMENS.map((spec, i) => (
        <Group key={i} x={listX} y={top + 70 + i * 62}>
          {i === k && <Rect x={-14} y={-5} width={10} height={10} fill={C.blue} />}
          <T x={0} y={0} size={15} font="mono" weight={i === k ? 700 : 400} color={i === k ? C.paper : C.grey} ay={0.5}>
            {spec.meta.split(' · ')[0]}
          </T>
        </Group>
      ))}
    </Group>
  );
}

// ── 05 · Timeline: a JSON project, and components on it ───────────────────

type TClip = { at: number; len: number; label: string; component?: boolean };
const T_TRACKS: { id: string; kind: string; tag: string; wave?: boolean; clips: TClip[] }[] = [
  { id: 'footage', kind: 'video', tag: C.paper, clips: [
    { at: 0, len: 300, label: 'gameplay.mp4' }, { at: 310, len: 370, label: 'boss_fight.mp4' }] },
  { id: 'voice', kind: 'audio', tag: C.grey, wave: true, clips: [
    { at: 40, len: 200, label: '001.wav' }, { at: 330, len: 250, label: '002.wav' }] },
  { id: 'titles', kind: 'overlay', tag: C.pink, clips: [
    { at: 20, len: 230, label: '<LowerThird />', component: true }, { at: 420, len: 220, label: 'Stage 1' }] },
  { id: 'lines', kind: 'dialogue', tag: C.blue, clips: [
    { at: 60, len: 250, label: 'akane · line 01' }, { at: 360, len: 290, label: 'yukari · line 02' }] },
];
const trackDrop = (i: number) => 10 + i * BEAT;

function TimelineDemo() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = progress(f, 2, 16, Easings.easeOutExpo);
  // The JSON.
  const jx = DX;
  const jy = 200;
  const fs = 17;
  const lh = 27;
  const json = [
    '{',
    '  "version": 0,',
    '  "tracks": [',
    ...T_TRACKS.map((t, i) => {
      const id = `"${t.id}",`.padEnd(11);
      const kind = `"${t.kind}",`.padEnd(12);
      return `    { "id": ${id} "kind": ${kind} "items": [ … ] }${i < T_TRACKS.length - 1 ? ',' : ''}`;
    }),
    '  ]',
    '}',
  ];
  const active = T_TRACKS.reduce((found, _, i) => (f >= trackDrop(i) ? i : found), -1);

  // The timeline.
  const top = 570;
  const row = 76;
  const left = DX + 120;
  const span = DX + DW - left;
  const k = span / 680;
  const head = left + span * progress(f, 30, 86, Easings.linear);

  return (
    <Group y={30 * (1 - enter)} opacity={enter}>
      <Rect x={jx} y={jy} width={DW} height={json.length * lh + 36} cornerRadius={14} fill={C.panel} stroke={C.line} strokeWidth={1} />
      {active >= 0 && (
        <Rect x={jx + 12} y={jy + 18 + (3 + active) * lh} width={DW - 24} height={lh} cornerRadius={4}
          fill={C.blue} opacity={0.35 * (1 - progress(f, trackDrop(active) + 4, 12))} />
      )}
      {json.map((line, i) => (
        <T key={i} x={jx + 24} y={jy + 18 + i * lh + lh / 2 + fs * 0.34} size={fs} font="mono" weight={400}
          ay="baseline" color={i >= 3 && i < 3 + T_TRACKS.length && i - 3 <= active ? C.paper : C.grey}>{line}</T>
      ))}
      {T_TRACKS.map((track, ti) => {
        const y = top + ti * row;
        return (
          <Group key={track.id}>
            <Rect x={DX} y={y + 22} width={12} height={12} fill={track.tag} />
            <T x={DX + 24} y={y + 28} size={16} font="mono" weight={700} ay={0.5}>{track.id}</T>
            <T x={DX + 24} y={y + 50} size={13} font="mono" weight={400} color={C.grey} ay={0.5}>{track.kind}</T>
            {track.clips.map((clip, ci) => {
              const s = spring({ frame: f - trackDrop(ti) - ci * 5, fps, config: { damping: 13, stiffness: 160 } });
              const x = left + clip.at * k;
              const w = clip.len * k;
              const live = head >= x && head <= x + w;
              const bars: ReactNode[] = [];
              if (track.wave) {
                for (let b = 0; b * 5 < w - 24; b++) {
                  const amp = Math.abs(Math.sin(b * 0.41 + ci) * Math.sin(b * 0.09 + ci * 2)) * 0.85 + 0.1 * hash(b, ci);
                  bars.push(<Rect key={b} x={x + 14 + b * 5} y={y + 44} anchorY={0.5} width={2} height={3 + 22 * amp}
                    fill={live ? C.sky : C.grey} opacity={0.7} />);
                }
              }
              return (
                <Group key={ci} y={-50 * (1 - clamp(s))} opacity={clamp(s * 2)}>
                  <Rect x={x} y={y} width={w} height={row - 14} cornerRadius={6}
                    fill={live ? '#1F2436' : C.clip} stroke={live ? C.blue : clip.component ? C.pink : C.line}
                    strokeWidth={live || clip.component ? 2 : 1} />
                  <Rect x={x} y={y} width={5} height={row - 14} fill={track.tag} />
                  {bars}
                  <T x={x + 16} y={y + (track.wave ? 18 : 31)} size={15} font="mono" weight={clip.component ? 700 : 400}
                    color={clip.component ? C.pink : live ? C.paper : C.soft} ay={0.5}>{clip.label}</T>
                </Group>
              );
            })}
          </Group>
        );
      })}
      <Rect x={head - 1} y={top - 16} width={2} height={row * T_TRACKS.length + 10} fill={C.blue} opacity={progress(f, 26, 6)} />
      <Rect x={head} y={top - 16} anchorX={0.5} anchorY={0.5} width={14} height={14} cornerRadius={7}
        fill={C.blue} opacity={progress(f, 26, 6)} />
    </Group>
  );
}

// ── 06 · Voice: a PSD portrait, a subtitle, lip sync from the recording ───

const akane = createRef<AssetReference>();
const akaneView = createRef<CharacterViewReference>();
let poseLayers: string[] = [];
let lipSync: LipSyncTrack | null = null;
// The voice's peak envelope, one value per waveform bar.
let voiceBars: number[] = Array.from({ length: 120 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i * 0.3)));
let voiceSeconds = 3.46;

export async function prepare() {
  poseLayers = await loadPsdPreset({ src: PRESET });
  lipSync = await loadLipSync({ src: VOICE, text: VOICE_TEXT });
  voiceSeconds = lipSync.durationInSeconds;
  try {
    const audio = decodeWav(new Uint8Array(await readFile(join(import.meta.dirname, VOICE))));
    const envelope = buildEnvelope(audio, 100);
    const peak = envelope.reduce((m, v) => Math.max(m, v), 1e-6);
    voiceBars = voiceBars.map((_, i) => {
      const a = Math.floor((i / voiceBars.length) * envelope.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / voiceBars.length) * envelope.length));
      let m = 0;
      for (let j = a; j < b; j++) m = Math.max(m, envelope[j]);
      return m / peak;
    });
  } catch {
    // Keep the placeholder waveform; the portrait still lip-syncs.
  }
}

const VOWEL_KANA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', closed: 'ん' } as const;

function VoiceDemo() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cx = 1400;
  const cy = 480;
  const disc = spring({ frame: f - 2, fps, config: { damping: 14, stiffness: 120 } });
  const portraitIn = progress(f, 8, 16, Easings.easeOutExpo);
  const voiceFrames = Math.ceil(voiceSeconds * fps);
  const t = clamp((f - VOICE_AT) / voiceFrames);
  const wave = progress(f, 14, 14, Easings.easeOutExpo);
  const barsW = DW;
  const bw = barsW / voiceBars.length;
  return (
    <>
      <Rect x={cx} y={cy} anchorX={0.5} anchorY={0.5} width={500 * disc} height={500 * disc}
        cornerRadius={250 * disc} fill={C.blue} />
      <Rect x={cx} y={cy} anchorX={0.5} anchorY={0.5} width={580 * disc} height={580 * disc}
        cornerRadius={290 * disc} stroke={C.line} strokeWidth={1} />
      <Group opacity={portraitIn} y={30 * (1 - portraitIn)}>
        <CharacterView ref={akaneView} character={akane} x={cx} y={cy + 40} anchorX={0.5} anchorY={0.5} scale={0.2} />
      </Group>
      <Sequence from={VOICE_AT} durationInFrames={voiceFrames + 40}>
        <Dialogue character={akaneView} audio={VOICE} lipSync={lipSync ?? undefined}>{VOICE_TEXT}</Dialogue>
        {lipSync ? <Mouth track={lipSync} /> : <MouthLabel shape="closed" opacity={1} />}
      </Sequence>
      {f < VOICE_AT && <MouthLabel shape="closed" opacity={progress(f, 12, 10)} />}
      <Group opacity={wave}>
        {voiceBars.map((v, i) => {
          const played = i / voiceBars.length < t;
          const h = 4 + 70 * v * wave;
          return (
            <Rect key={i} x={DX + i * bw + bw / 2} y={800} anchorX={0.5} anchorY={0.5} width={Math.max(2, bw - 3)}
              height={h} cornerRadius={1} fill={played ? C.blue : C.dim} />
          );
        })}
        {f >= VOICE_AT && t < 1 && <Rect x={DX + barsW * t} y={750} width={2} height={100} fill={C.paper} />}
        <T x={DX} y={728} size={15} font="mono" weight={400} color={C.grey} ay={0.5}>character-lipsync-demo.wav</T>
        <T x={DX + DW} y={728} size={15} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
          {`${(t * voiceSeconds).toFixed(2)} / ${voiceSeconds.toFixed(2)} s`}
        </T>
      </Group>
    </>
  );
}

function Mouth({ track }: { track: LipSyncTrack }) {
  return <MouthLabel shape={useLipSync(track)} opacity={1} />;
}

function MouthLabel({ shape, opacity }: { shape: keyof typeof VOWEL_KANA; opacity: number }) {
  return (
    <Group opacity={opacity}>
      <T x={1760} y={330} size={150} font="jaDisplay" weight={400} ax={0.5} ay={0.5}
        color={shape === 'closed' ? C.ink : C.paper} stroke={shape === 'closed' ? { color: C.paper, width: 3 } : undefined}>
        {VOWEL_KANA[shape]}
      </T>
      <T x={1760} y={450} size={16} font="mono" weight={700} color={C.grey} ax={0.5} ay={0.5}>
        {`mouth: ${shape}`}
      </T>
    </Group>
  );
}

// ── 07 · Preview: scrub, and the frame answers ────────────────────────────

const MINI_FRAMES = 600;

function PreviewDemo() {
  const f = useCurrentFrame();
  const enter = progress(f, 2, 16, Easings.easeOutExpo);
  const s = Math.round(interpolate(f, [0, 20, 40, 56, 76, 96, 119], [96, 150, 40, 400, 310, 520, 452], {
    easing: Easings.easeInOutCubic, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const prev = Math.round(interpolate(f - 1, [0, 20, 40, 56, 76, 96, 119], [96, 150, 40, 400, 310, 520, 452], {
    easing: Easings.easeInOutCubic, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const dir = s > prev ? 'FWD ▸' : s < prev ? '◂ REV' : 'HOLD';
  const muted = f >= 64;

  const wx = DX;
  const wy = 190;
  const vx = wx + 40;
  const vy = wy + 70;
  const vw = 720;
  const vh = 405;
  const tlY = vy + vh + 40;
  const tlX = vx + 90;
  const tlW = vw - 90;
  const head = tlX + (s / MINI_FRAMES) * tlW;

  // The mini scene: a pure function of its own frame number `s`.
  const orbit = Array.from({ length: 10 }, (_, i) => {
    const a = s * 0.035 + (i * Math.PI * 2) / 10;
    const r = 120 + 30 * Math.sin(s * 0.05 + i);
    return (
      <Rect key={i} x={vx + vw / 2 + Math.cos(a) * r * 1.6} y={vy + vh / 2 + Math.sin(a) * r * 0.9}
        anchorX={0.5} anchorY={0.5} width={18} height={18} cornerRadius={9} fill={i % 3 === 0 ? C.pink : C.paper} />
    );
  });

  return (
    <Group y={30 * (1 - enter)} opacity={enter}>
      <Rect x={wx} y={wy} width={DW} height={680} cornerRadius={14} fill={C.panel} stroke={C.line} strokeWidth={1} />
      <T x={wx + 24} y={wy + 30} size={16} font="mono" weight={700} ay={0.5}>Preview</T>
      <T x={wx + DW - 24} y={wy + 30} size={16} font="mono" weight={400} color={C.grey} ax={1} ay={0.5}>
        {`${dir}   ${timecode(s)}`}
      </T>
      <Rect x={vx} y={vy} width={vw} height={vh} fill={C.blue} />
      <Rect x={vx + vw / 2} y={vy + vh / 2} anchorX={0.5} anchorY={0.5} width={2} height={vh} fill="#FFFFFF22" />
      <Rect x={vx} y={vy + vh / 2} width={vw} height={2} fill="#FFFFFF22" />
      {orbit}
      <T x={vx + vw / 2} y={vy + vh / 2} size={96} ax={0.5} ay={0.5}>{pad(s, 3)}</T>
      <Rect x={vx} y={vy + vh - 4} width={Math.max(1, vw * (s / MINI_FRAMES))} height={4} fill={C.paper} />

      {/* Timeline: ruler, a video track, and an audio track with mute/solo. */}
      {Array.from({ length: 21 }, (_, i) => (
        <Rect key={i} x={tlX + (i / 20) * tlW} y={tlY + (i % 5 === 0 ? 0 : 6)} width={1}
          height={i % 5 === 0 ? 14 : 8} fill={C.dim} />
      ))}
      <T x={vx} y={tlY + 44} size={15} font="mono" weight={700} ay={0.5}>V1</T>
      <Rect x={tlX} y={tlY + 28} width={tlW} height={32} cornerRadius={4} fill={C.clip} stroke={C.line} strokeWidth={1} />
      <Rect x={tlX} y={tlY + 28} width={4} height={32} fill={C.blue} />
      <T x={tlX + 14} y={tlY + 44} size={13} font="mono" weight={400} color={C.soft} ay={0.5}>{'<Scene />'}</T>
      <T x={vx} y={tlY + 90} size={15} font="mono" weight={700} ay={0.5}>A1</T>
      <Group x={vx + 34} y={tlY + 90}>
        <Rect y={-11} width={22} height={22} cornerRadius={4} fill={muted ? C.pink : C.dim} />
        <T x={11} y={0} size={12} font="mono" weight={700} color={muted ? C.ink : C.soft} ax={0.5} ay={0.5}>M</T>
        <Rect x={26} y={-11} width={22} height={22} cornerRadius={4} fill={C.dim} />
        <T x={37} y={0} size={12} font="mono" weight={700} color={C.soft} ax={0.5} ay={0.5}>S</T>
      </Group>
      <Rect x={tlX} y={tlY + 74} width={tlW} height={32} cornerRadius={4} fill={C.clip} stroke={C.line} strokeWidth={1} />
      {Array.from({ length: Math.floor(tlW / 5) - 2 }, (_, b) => {
        const amp = Math.abs(Math.sin(b * 0.23) * Math.sin(b * 0.057 + 1)) * 0.8 + 0.12 * hash(b, 7);
        const bx = tlX + 6 + b * 5;
        return (
          <Rect key={b} x={bx} y={tlY + 90} anchorY={0.5} width={2} height={3 + 24 * amp}
            fill={muted ? C.dim : bx <= head ? C.sky : C.grey} />
        );
      })}
      <Rect x={head - 1} y={tlY - 6} width={2} height={120} fill={C.paper} />
      <Rect x={head} y={tlY - 6} anchorX={0.5} anchorY={0.5} width={12} height={12} cornerRadius={2} rotation={45} fill={C.paper} />
      <T x={wx + 24} y={wy + 650} size={15} font="mono" weight={400} color={C.grey} ay={0.5}>
        {`frame ${pad(s, 3)} → same pixels, every time`}
      </T>
      <T x={wx + DW - 24} y={wy + 650} size={15} font="mono" weight={700} color={muted ? C.pink : C.grey} ax={1} ay={0.5}>
        {muted ? 'A1 muted' : 'A1 on'}
      </T>
    </Group>
  );
}

// ── 08 · Export: frames become a file ─────────────────────────────────────

const MOSAIC_COLS = 14;
const MOSAIC_ROWS = 8;

function ExportDemo() {
  const f = useCurrentFrame();
  const p = Easings.easeInOutCubic(clamp((f - 10) / 84));
  const pct = Math.round(p * 100);
  const done = pct === 100;
  const total = MOSAIC_COLS * MOSAIC_ROWS;
  const filled = p * total;
  const tw = 50;
  const th = 28;
  const g = 6;
  const mx = DX + (DW - (MOSAIC_COLS * (tw + g) - g)) / 2;
  const my = 250;
  const flash = done ? 1 - progress(f, 95, 12) : 0;
  const tiles: ReactNode[] = [];
  for (let i = 0; i < total; i++) {
    const c = i % MOSAIC_COLS;
    const r = Math.floor(i / MOSAIC_COLS);
    const x = mx + c * (tw + g);
    const y = my + r * (th + g);
    const on = i < filled;
    const head = i === Math.floor(filled) && !done;
    // Each tile stands for a frame of this film; its marks hint at which chapter.
    const chapter = Math.floor((i / total) * (CHAPTERS.length + 2));
    tiles.push(
      <Group key={i}>
        <Rect x={x} y={y} width={tw} height={th} fill={head ? C.paper : on ? C.ink : undefined}
          stroke={on || head ? undefined : '#FFFFFF40'} strokeWidth={on || head ? undefined : 1} />
        {on && (
          <>
            <Rect x={x + 6} y={y + 7} width={8 + 20 * hash(chapter, 1)} height={4} fill={C.paper} opacity={0.8} />
            <Rect x={x + 6} y={y + 15} width={12 + 20 * hash(i, 2)} height={3} fill={chapter % 3 === 0 ? C.blue : C.grey} />
          </>
        )}
      </Group>,
    );
  }
  return (
    <>
      {tiles}
      <Rect x={mx - 12} y={my - 12} width={MOSAIC_COLS * (tw + g) - g + 24} height={MOSAIC_ROWS * (th + g) - g + 24}
        fill={C.paper} opacity={flash * 0.9} />
      <T x={DX + DW} y={690} size={150} ax={1} ay="baseline">{`${pct}%`}</T>
      <T x={DX} y={690} size={18} font="mono" weight={700} ay="baseline">{done ? 'DONE' : 'RENDERING…'}</T>
      <T x={DX} y={660} size={16} font="mono" weight={400} ay="baseline" opacity={0.7}>
        {`frame ${pad(Math.round(p * DURATION), 4)} / ${DURATION}`}
      </T>
      <Rect x={DX} y={730} width={DW} height={6} fill="#FFFFFF40" />
      <Rect x={DX} y={730} width={Math.max(1, DW * p)} height={6} fill={C.paper} />
      {['1920 × 1080', '30 fps', 'H.264 + AAC', 'GPU'].map((spec, i) => {
        const on = progress(f, 20 + i * 8, 10, Easings.easeOutExpo);
        return (
          <Group key={spec} x={DX + i * 200} y={790} opacity={on}>
            <Rect y={-4} width={8} height={8} fill={C.paper} />
            <T x={20 + 16 * (1 - on)} y={0} size={18} font="mono" weight={400} ay={0.5}>{spec}</T>
          </Group>
        );
      })}
      <Group opacity={progress(f, 96, 10, Easings.easeOutExpo)} x={DX} y={850 + 20 * (1 - progress(f, 96, 10, Easings.easeOutExpo))}>
        <Rect y={-26} width={DW} height={52} cornerRadius={26} fill={C.ink} />
        <Rect x={24} y={-5} width={10} height={10} cornerRadius={5} fill={C.paper} />
        <T x={46} y={0} size={18} font="mono" weight={700} ay={0.5}>feature-tour.mp4</T>
        <T x={DW - 24} y={0} size={18} font="mono" weight={400} color={C.soft} ax={1} ay={0.5}>
          {`${timecode(DURATION)} · ${DURATION} frames`}
        </T>
      </Group>
    </>
  );
}

// ── 09 · Agents: this film, as a transcript ───────────────────────────────

type Line = { at: number; text: string; color?: string; bullet?: boolean; ja?: boolean };
const PROMPT = 'Celesta の機能を紹介する、かっこいい動画を作って';
const TRANSCRIPT: Line[] = [
  { at: 4, text: PROMPT, ja: true },
  { at: 30, text: 'Read   skills/celesta/SKILL.md', bullet: true },
  { at: 40, text: 'Write  examples/feature-tour/film.tsx', bullet: true },
  { at: 50, text: 'Bash   node inspect.mjs film.tsx --every 15', bullet: true },
  { at: 58, text: `       composition: 1920×1080 @ 30 fps, ${DURATION} frames`, color: C.grey },
  { at: 64, text: '       OK: entry loads and every frame evaluates', color: C.sky },
  { at: 76, text: 'Bash   Celesta-export --react film.tsx', bullet: true },
  { at: 92, text: '       → feature-tour.mp4', color: C.sky },
];

function AgentDemo() {
  const f = useCurrentFrame();
  const enter = progress(f, 2, 16, Easings.easeOutExpo);
  const x = DX;
  const y = 190;
  const lh = 50;
  const size = 19;
  const visible = TRANSCRIPT.filter((line) => f >= line.at);
  const last = visible[visible.length - 1];
  const spinner = '|/-\\'[Math.floor(f / 3) % 4];
  return (
    <Group y={30 * (1 - enter)} opacity={enter}>
      <Rect x={x} y={y} width={DW} height={680} cornerRadius={14} fill="#0B0D13" stroke={C.line} strokeWidth={1} />
      {[C.dim, C.dim, C.dim].map((color, i) => (
        <Rect key={i} x={x + 24 + i * 20} y={y + 24} width={11} height={11} cornerRadius={6} fill={color} />
      ))}
      <T x={x + DW / 2} y={y + 30} size={15} font="mono" weight={400} color={C.grey} ax={0.5} ay={0.5}>
        agent — examples/feature-tour
      </T>
      <Rect x={x} y={y + 58} width={DW} height={1} fill={C.line} />
      {visible.map((line, i) => {
        const ly = y + 110 + i * lh;
        const p = progress(f, line.at, 8, Easings.easeOutExpo);
        if (line.ja) {
          const typed = Math.floor(clamp((f - line.at) / 18) * line.text.length);
          return (
            <Group key={i}>
              <Rect x={x + 20} y={ly - 24} width={DW - 40} height={48} cornerRadius={8} fill={C.panel} />
              <T x={x + 40} y={ly} size={size} font="mono" weight={700} color={C.blue} ay={0.5}>{'>'}</T>
              <T x={x + 70} y={ly} size={20} font="ja" weight={500} ay={0.5}>{line.text.slice(0, typed)}</T>
            </Group>
          );
        }
        const pending = line === last && line.bullet && f < line.at + 10;
        return (
          <Group key={i} opacity={p} x={-12 * (1 - p)}>
            {line.bullet && (
              pending
                ? <T x={x + 40} y={ly} size={size} font="mono" weight={700} color={C.sky} ay={0.5}>{spinner}</T>
                : <Rect x={x + 40} y={ly - 5} width={10} height={10} cornerRadius={5} fill={C.blue} />
            )}
            <T x={x + 70} y={ly} size={size} font="mono" weight={line.bullet ? 700 : 400}
              color={line.color ?? C.paper} ay={0.5}>{line.text}</T>
          </Group>
        );
      })}
      {Math.floor(f / 8) % 2 === 0 && (
        <Rect x={x + 40} y={y + 110 + visible.length * lh - 14} width={11} height={24} fill={C.paper} />
      )}
    </Group>
  );
}

// ── Outro ─────────────────────────────────────────────────────────────────

function Outro() {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const flash = 1 - progress(f, 0, 14, Easings.easeOutCubic);
  const hit = progress(f, 0, 22, Easings.easeOutExpo);
  const rule = progress(f, 16, 20, Easings.easeInOutExpo);
  const ja = progress(f, 26, 16, Easings.easeOutExpo);
  const url = progress(f, 36, 16, Easings.easeOutExpo);
  const fadeOut = 1 - progress(f, durationInFrames - 24, 24, Easings.easeInCubic);
  const beat = Math.floor(f / BEAT);

  // A faint sheet of frames behind the logo; a few light up on each beat.
  const cols = 16;
  const rows = 9;
  const cell = W / cols;
  const sheet: ReactNode[] = [];
  const drift = f * 0.4;
  for (let r = 0; r < rows + 1; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = hash(r * cols + c, beat) > 0.96 && (r < 2 || c < 3 || c > 12);
      sheet.push(
        <Rect key={`${r}-${c}`} x={c * cell + 6} y={r * cell + 6 - drift} width={cell - 12} height={cell - 12}
          cornerRadius={4} fill={lit ? '#3D5BFF26' : undefined} stroke="#FFFFFF0A" strokeWidth={1} />,
      );
    }
  }

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Group opacity={fadeOut}>
        {sheet}
        <T x={W / 2} y={440 + 20 * (1 - hit)} size={230} ax={0.5} ay={0.5} scale={1.2 - 0.2 * hit}
          opacity={clamp(hit * 2)}>Celesta</T>
        <Rect x={W / 2} y={590} anchorX={0.5} width={Math.max(1, 600 * rule)} height={6} fill={C.blue} />
        <T x={W / 2} y={670 + 16 * (1 - ja)} size={44} font="ja" weight={700} ax={0.5} ay={0.5} opacity={ja}>
          {TAGLINE}
        </T>
        <T x={W / 2} y={745 + 16 * (1 - url)} size={22} font="mono" weight={400} color={C.grey} ax={0.5} ay={0.5}
          opacity={url}>github.com/mika-f/celesta</T>
        {CHAPTERS.map((chapter, i) => {
          const on = progress(f, 44 + i * 6, 8, Easings.easeOutExpo);
          const x = W / 2 + (i - (CHAPTERS.length - 1) / 2) * 150;
          return (
            <Group key={chapter.key} x={x} y={900} opacity={0.25 + 0.75 * on}>
              <T x={0} y={0} size={40} font="serif" weight={400} color={on > 0.5 ? C.blue : C.grey} ax={0.5} ay="baseline">
                {pad(i + 1)}
              </T>
              <T x={0} y={30} size={12} font="mono" weight={700} color={C.soft} ax={0.5} ay={0.5}>{chapter.key}</T>
            </Group>
          );
        })}
      </Group>
      <Rect width={W} height={H} fill={C.blue} opacity={flash} />
    </>
  );
}

// ── Transitions and HUD ───────────────────────────────────────────────────

// Twelve slats sweep across a cut in a chevron, center rows first. Place the
// sequence so the cut lands at its frame 9.
function Shutter({ color }: { color: string }) {
  const f = useCurrentFrame();
  const slats = 12;
  const h = H / slats;
  return (
    <>
      {Array.from({ length: slats }, (_, i) => {
        const d = Math.abs(i - (slats - 1) / 2) * 0.4;
        const grow = progress(f, d, 7, Easings.easeInCubic);
        const leave = progress(f, d + 10, 7, Easings.easeOutCubic);
        const x0 = W * leave;
        const x1 = W * grow;
        if (x1 - x0 < 1) return null;
        return <Rect key={i} x={x0} y={i * h} width={x1 - x0} height={h + 1} fill={color} />;
      })}
    </>
  );
}

function Hud() {
  const f = useCurrentFrame();
  const abs = f + S.index;
  const chapter = CHAPTER_AT.reduce((found, at, i) => (abs >= at ? i : found), -1);
  const m = 56;
  const arm = 22;
  const corner = (x: number, y: number, sx: number, sy: number) => (
    <Group key={`${x}-${y}`} x={x} y={y}>
      <Rect x={sx < 0 ? -arm : 0} width={arm} height={2} fill={C.paper} />
      <Rect y={sy < 0 ? -arm : 0} width={2} height={arm} fill={C.paper} />
    </Group>
  );
  return (
    <Group opacity={0.7}>
      {corner(m, m, 1, 1)}
      {corner(W - m, m, -1, 1)}
      {corner(m, H - m, 1, -1)}
      {corner(W - m, H - m, -1, -1)}
      <T x={m + 36} y={m + 10} size={16} font="mono" weight={700} ay={0.5}>CELESTA</T>
      <T x={m + 118} y={m + 10} size={16} font="mono" weight={400} ay={0.5} opacity={0.6}>/ FEATURE TOUR</T>
      <T x={W - m - 36} y={m + 10} size={16} font="mono" weight={400} ax={1} ay={0.5}>{timecode(abs)}</T>
      {CHAPTERS.map((_, i) => (
        <Rect key={i} x={m + 36 + i * 30} y={H - m - 12} width={24} height={4}
          fill={i === chapter ? (CHAPTERS[i].bg === C.blue ? C.paper : C.blue) : i < chapter ? C.soft : C.dim} />
      ))}
      <T x={m + 36 + CHAPTERS.length * 30 + 12} y={H - m - 10} size={16} font="mono" weight={400} ay={0.5}>
        {chapter < 0 ? 'INDEX' : `${pad(chapter + 1)} ${CHAPTERS[chapter].key}`}
      </T>
      <T x={W - m - 36} y={H - m - 10} size={16} font="mono" weight={400} ax={1} ay={0.5}>
        {`${W}×${H} · ${FPS} FPS · 120 BPM`}
      </T>
    </Group>
  );
}

// ── Fonts ─────────────────────────────────────────────────────────────────

// Japanese faces are subset to exactly the characters this film uses (the
// Google Fonts `text=` parameter), so they load as a few small files. Any new
// Japanese string must be listed here too.
const JA_TEXT = [
  ...CHAPTERS.flatMap((c) => [c.ja, c.jaShort]),
  ...SPECIMENS.flatMap((s) => [s.glyph, s.sample]),
  ...Object.values(VOWEL_KANA),
  VOICE_TEXT, TAGLINE, PROMPT, '機能一覧',
].join('');
const JA_GLYPHS = encodeURIComponent([...new Set(JA_TEXT)].sort().join(''));
const LATIN_FONTS = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@800'
  + '&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500;700';
const JA_FONTS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700;900'
  + `&family=Dela+Gothic+One&family=DotGothic16&text=${JA_GLYPHS}`;

// The score ducks under the voice line. Called from Root, after prepare()
// has measured the recording.
function scoreVolume() {
  const at = (CHAPTER_AT[5] + VOICE_AT) / FPS;
  const key = (seconds: number, value: number, easing?: 'ease-in' | 'ease-out') =>
    ({ time: { value: Math.round(seconds * 100), timescale: 100 }, value, easing });
  return {
    type: 'keyframes' as const,
    keyframes: [key(at - 0.4, 1), key(at, 0.3, 'ease-out'), key(at + voiceSeconds, 0.3), key(at + voiceSeconds + 0.8, 1, 'ease-in')],
  };
}

// ── Root ──────────────────────────────────────────────────────────────────

export default function Root() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={DURATION}>
      <Assets>
        <Font src={LATIN_FONTS} />
        <Font src={JA_FONTS} />
        <Character ref={akane} name="Kotonoha Akane"
          portrait={{
            type: 'psd', src: PSD, layers: poseLayers, lipSync: {
              a: `${MOUTH}/あいうえお/*あ`, i: `${MOUTH}/あいうえお/*い`, u: `${MOUTH}/あいうえお/*う`,
              e: `${MOUTH}/あいうえお/*え`, o: `${MOUTH}/あいうえお/*お`, closed: `${MOUTH}/*-`,
            },
          }}
          subtitle={{
            x: 1400, y: 905, anchorX: 0.5, anchorY: 0.5, maxWidth: DW,
            style: {
              fontFamily: FONT.ja, fontWeight: 700, fontSize: 40, align: 'center',
              fill: { type: 'solid', color: C.paper },
              stroke: { paint: { type: 'solid', color: C.ink }, width: 8 },
            },
          }} />
      </Assets>

      <Sequence from={S.open} durationInFrames={S.index}><Open /></Sequence>
      <Sequence from={S.index} durationInFrames={CHAPTER_AT[0] - S.index}><Index /></Sequence>
      {CHAPTERS.map((chapter, i) => (
        <Sequence key={chapter.key} from={CHAPTER_AT[i]} durationInFrames={chapter.len}>
          <ChapterShell index={i}><chapter.Demo /></ChapterShell>
        </Sequence>
      ))}
      <Sequence from={S.outro} durationInFrames={DURATION - S.outro}><Outro /></Sequence>

      {/* Chapter 01 opens out of the index, so its cut has no shutter. */}
      {[S.index, ...CHAPTER_AT.slice(1)].map((cut, i) => {
        const into = CHAPTERS[i]?.bg;
        const color = cut === S.index ? C.paper : into === C.blue || CHAPTERS[i - 1]?.bg === C.blue ? C.paper : C.blue;
        return (
          <Sequence key={`cut-${cut}`} from={cut - 9} durationInFrames={20}><Shutter color={color} /></Sequence>
        );
      })}
      <Sequence from={S.index} durationInFrames={S.outro - S.index}><Hud /></Sequence>

      <Audio src="./score.wav" volume={scoreVolume()} />
    </Composition>
  );
}

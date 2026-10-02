// 「動画はコードで書くのだ」— ずんだもんと四国めたんが Celesta を紹介する解説動画。
//
// 真っ黒な <Composition> から始まり、二人が話すたびに、この動画自身に
// レイヤーが一枚ずつ増えていく。台本は script.ts、音声は make-voices.ts が
// VOICEVOX で作る。全シーンのタイミングは voices.json の音声の長さから
// 計算するので、台本を直して音声を作り直せば映像が追従する。
//
//   node examples/zunda/prepare-assets.ts   # 立ち絵・映像素材
//   node examples/zunda/make-voices.ts      # 音声（VOICEVOX Engine が必要）
//   python3 examples/zunda/make-score.py    # BGM
//   Celesta-export --react examples/zunda/film.tsx zunda.mp4
import { createRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Assets,
  Audio,
  Camera,
  Character,
  CharacterView,
  Composition,
  Dialogue,
  Easings,
  Font,
  Group,
  Image,
  Line,
  Path,
  Polyline,
  Rect,
  Sequence,
  Text,
  TextReveal,
  Video,
  buildEnvelope,
  decodeWav,
  interpolate,
  loadLipSync,
  noise,
  pointOnPolyline,
  progress,
  spring,
  useCurrentFrame,
} from '@celesta/react';
import type { AssetReference, CharacterViewReference, LipSyncTrack, TextStyle } from '@celesta/react';

import { LINES } from './script.ts';
import type { Line as ScriptLine, MetanFace, SceneId, ZundaFace } from './script.ts';
import voicesJson from './voices.json';

const W = 1920;
const H = 1080;
const FPS = 30;

const C = {
  ink: '#050607',
  zunda: '#7CC242',
  zundaDeep: '#2F6B1F',
  leaf: '#2C6B1F',
  metan: '#E0549B',
  metanDeep: '#8E2A62',
  paper: '#FFF9EC',
  white: '#FFFFFF',
  panel: '#11161CEE',
  mute: '#8A96A3',
  str: '#B8E986',
  num: '#FFD166',
  tag: '#7FD1FF',
  attr: '#FF9BCB',
  navy: '#0E1420',
} as const;

const F = { ja: 'M PLUS Rounded 1c', title: 'Dela Gothic One', mono: 'JetBrains Mono' } as const;
const MONO_ADVANCE = 0.6; // JetBrains Mono advances every glyph by 0.6 em.

const ASSET = {
  zunda: './assets/zundamon.psd',
  photo: './assets/field.jpg',
  clip: './assets/field.mp4',
  score: './assets/score.wav',
} as const;

const solid = (color: string) => ({ type: 'solid' as const, color });
const alpha = (color: string, a: number) =>
  `${color.slice(0, 7)}${Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')}`;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ── タイミング：音声の長さから全体を組み立てる ───────────────────────────

type VoiceInfo = { file: string; kana: string; seconds: number };
const VOICES = voicesJson as Record<string, VoiceInfo>;

// 各シーンの最初の台詞の前に置く間（フレーム）。
const LEAD: Record<SceneId, number> = {
  void: 84, layers: 26, effects: 16, path: 22, timeline: 26, voice: 18, rewind: 22, agent: 30, outro: 26,
};
const SCENES: SceneId[] = ['void', 'layers', 'effects', 'path', 'timeline', 'voice', 'rewind', 'agent', 'outro'];
const TAIL = 96;

type Timed = ScriptLine & { at: number; len: number; hold: number; file: string; kana: string };
const TIMED: Timed[] = [];
const SCENE_AT = {} as Record<SceneId, number>;
let cursor = 0;
for (const line of LINES) {
  if (!(line.scene in SCENE_AT)) {
    SCENE_AT[line.scene] = cursor;
    cursor += LEAD[line.scene];
  }
  const voice = VOICES[line.id];
  if (!voice) throw new Error(`voices.json has no line "${line.id}"; run make-voices.ts`);
  const len = Math.ceil(voice.seconds * FPS);
  const hold = len + Math.round((line.pause ?? 0.25) * FPS);
  TIMED.push({ ...line, at: cursor, len, hold, file: voice.file, kana: voice.kana });
  cursor += hold;
}
const DURATION = cursor + TAIL;
const L = Object.fromEntries(TIMED.map((t) => [t.id, t])) as Record<string, Timed>;
const sceneEnd = (id: SceneId) => {
  const next = SCENES[SCENES.indexOf(id) + 1];
  return next ? SCENE_AT[next] : DURATION;
};
const mid = (id: string, t: number) => L[id].at + Math.round(L[id].len * t);
const lineAt = (g: number) => {
  let current: Timed | undefined;
  for (const t of TIMED) if (t.at <= g) current = t;
  return current;
};

// ── 立ち絵：PSD の表情フォルダと口・目のレイヤー ─────────────────────────

type MouthMap = { a: string; i: string; u: string; e: string; o: string; closed: string };
type Face = { label: string; base: string[]; blink: string[]; mouth: MouthMap };

// ずんだもん（公式 PSD）：表情ごとに目（開・閉じ）と、あいうえお・ん の口がある。
function zundaFace(
  label: string,
  folder: string,
  eyes: [open: string, closed: string],
  mouthDir: string,
  mouth: { n: string; suffix: string; a?: string },
  extra: string[] = [],
): Face {
  const m = (v: string) => `${folder}/${mouthDir}/${v}`;
  const base = ['ベース', ...extra.map((e) => `${folder}/${e}`)];
  return {
    label,
    base: [...base, `${folder}/${eyes[0]}`],
    blink: [...base, `${folder}/${eyes[1]}`],
    mouth: {
      a: m(mouth.a ?? `あ${mouth.suffix}`), i: m(`い${mouth.suffix}`), u: m(`う${mouth.suffix}`),
      e: m(`え${mouth.suffix}`), o: m(`お${mouth.suffix}`), closed: m(mouth.n),
    },
  };
}

const ZUNDA: Record<ZundaFace, Face> = {
  normal: zundaFace('ノーマル', 'ノーマル', ['開', '閉じ2'], '口', { n: 'ん のコピー', suffix: '' }),
  aori: zundaFace('煽り', '煽り', ['開け目 のコピー', '2 のコピー'], '口 のコピー', { n: 'ん のコピー 2', suffix: ' のコピー' }),
  tsuntsun: zundaFace('つんつん', 'つんつん', ['開け目 のコピー 2', '2 のコピー 2'], '口 のコピー 3', { n: 'ん のコピー 4', suffix: ' のコピー 3' }),
  amaama: zundaFace('あまあま', 'あまあま', ['開け目 のコピー 3', '2 のコピー 3'], '口 のコピー 4', { n: 'ん のコピー 5', suffix: ' のコピー 4' }),
  namida: zundaFace('涙目', '顔涙目 のコピー', ['開け目 のコピー 7', 'とじ2'], '口 のコピー 9',
    { n: 'とじ のコピー 2', suffix: ' のコピー 9', a: 'あけ のコピー 2' }, ['まゆ のコピー 3']),
  herohero: zundaFace('へろへろ', '顔へろへろ のコピー', ['開け目 のコピー 6', 'とじ2'], '口 のコピー 8',
    { n: 'ん のコピー 8', suffix: ' のコピー 8', a: 'あ のコピー 7' }, ['赤', 'まゆ のコピー 2']),
};

// 四国めたん（公式 SD 立ち絵）：ポーズごとに別の PSD。口は開・閉の 2 枚なので、
// あいうえお はすべて「開」に割り当てる。
function metanFace(label: string, src: string, open: string[], closed: string[], mouthOpen: string, mouthClosed: string) {
  return {
    label,
    src,
    base: open,
    blink: closed,
    mouth: { a: mouthOpen, i: mouthOpen, u: mouthOpen, e: mouthOpen, o: mouthOpen, closed: mouthClosed },
  };
}
const METAN: Record<MetanFace, Face & { src: string }> = {
  talk: metanFace('おしゃべり', './assets/metan-talk.psd', ['レイヤー 112 のコピー'], ['せん 3'], '2 のコピー', '1 のコピー'),
  happy: metanFace('にっこり', './assets/metan-happy.psd', ['目あけ'], ['目とじ'], '口あけ', '口とじ'),
  worried: metanFace('しょんぼり', './assets/metan-worried.psd', ['目開け', '涙/レイヤー 17'], ['目閉じ', '涙/レイヤー 17'], '口/開け', '口/閉じ'),
  what: metanFace('はてな', './assets/metan-what.psd', ['？', '目開け'], ['？', '目閉じ'], '口/あけ', '口/とじ'),
};

const ZUNDA_REF = Object.fromEntries(Object.keys(ZUNDA).map((k) => [k, createRef<AssetReference>()])) as Record<ZundaFace, RefObject<AssetReference>>;
const METAN_REF = Object.fromEntries(Object.keys(METAN).map((k) => [k, createRef<AssetReference>()])) as Record<MetanFace, RefObject<AssetReference>>;
const zundaView = createRef<CharacterViewReference>();
const metanView = createRef<CharacterViewReference>();

// 立ち絵の置き場所。顔の中心がこの点に来るように PSD を置く。
const Z = { scale: 0.56, x: 1382, y: 106, face: [1700, 430] as const };
const M = { scale: 0.66, x: -168, y: 234, face: [250, 740] as const };

// s3 の間、ずんだもんの表情を順に切り替える。
const FACE_PARADE: ZundaFace[] = ['amaama', 'aori', 'tsuntsun', 'namida', 'herohero', 'normal'];

function faceAt<T extends string>(speaker: 'zunda' | 'metan', g: number, fallback: T): T {
  let face = fallback;
  for (const t of TIMED) {
    if (t.at > g) break;
    if (t.speaker === speaker) face = t.face as T;
  }
  if (speaker === 'zunda' && g >= L.s3.at && g < L.s3.at + L.s3.len) {
    const step = Math.floor(((g - L.s3.at) / L.s3.len) * FACE_PARADE.length);
    return FACE_PARADE[Math.min(FACE_PARADE.length - 1, step)] as unknown as T;
  }
  return face;
}

// まばたき：3〜5 秒ごとに 4 フレーム閉じる。
function blinking(g: number, seed: number) {
  const period = 104 + seed * 23;
  const p = (g + seed * 37) % period;
  return p < 4 || (seed % 2 === 0 && p > 9 && p < 13 && Math.floor((g + seed * 37) / period) % 3 === 0);
}

// ── 字幕 ──────────────────────────────────────────────────────────────────

const subtitleStyle = (stroke: string): TextStyle => ({
  fontFamily: F.ja, fontSize: 44, fontWeight: 800, lineHeight: 60, align: 'center',
  fill: solid(C.white), stroke: { paint: solid(stroke), width: 9 },
});
const SUBTITLE = { x: 960, y: 962, anchorX: 0.5, anchorY: 0.5, maxWidth: 1060 } as const;

// 長い字幕は、真ん中に近い句読点で 2 行に分ける（行の途中で単語が割れないように）。
function wrapSubtitle(text: string) {
  const chars = [...text];
  if (chars.length <= 23) return text;
  let best = -1;
  chars.forEach((c, i) => {
    if ('、。！？'.includes(c) && i < chars.length - 2 && (best < 0 || Math.abs(i - chars.length / 2) < Math.abs(best - chars.length / 2))) best = i;
  });
  return best < 0 ? text : `${chars.slice(0, best + 1).join('')}\n${chars.slice(best + 1).join('')}`;
}

// ── 補助 ─────────────────────────────────────────────────────────────────

type Pt = [number, number];
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 72): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
const blob = (cx: number, cy: number, rx: number, ry: number, seed: number, n = 96): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = 1 + 0.07 * Math.sin(9 * a + seed) + 0.04 * Math.sin(5 * a + seed * 2.3);
    return [cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)];
  });
// さや：3 粒ぶんふくらんだ細長い形。
const pod = (cx: number, cy: number, length: number, angle: number): Pt[] => {
  const n = 48;
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.45);
    const h = 30 * taper * (0.78 + 0.22 * Math.abs(Math.sin(3 * Math.PI * t)));
    const x = (t - 0.5) * length;
    top.push([x, -h]);
    bottom.push([x, h * 0.85]);
  }
  const rad = (angle * Math.PI) / 180;
  return [...top, ...bottom.reverse(), top[0]].map(([x, y]) => [
    cx + x * Math.cos(rad) - y * Math.sin(rad),
    cy + x * Math.sin(rad) + y * Math.cos(rad),
  ]);
};

// 太い縁取りの文字。Text の stroke は文字列の左右の端で切れてしまうので、
// 縁の色で塗った同じ文字を周囲にずらして重ね、その上に本体を描く。
function OutlinedText({ children, style, outline, color, glow, shadow, ...props }: {
  children: string; style: TextStyle; outline: number; color: string;
  glow?: { color: string; blur: number }; shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  x?: number; y?: number; anchorX?: number; anchorY?: number;
}) {
  const ring = Array.from({ length: 32 }, (_, i) => [Math.cos((i / 32) * Math.PI * 2), Math.sin((i / 32) * Math.PI * 2)]);
  return (
    <Group glow={glow} shadow={shadow}>
      {ring.map(([dx, dy], i) => (
        <Text key={i} {...props} x={(props.x ?? 0) + dx * outline} y={(props.y ?? 0) + dy * outline}
          style={{ ...style, fill: solid(color) }}>{children}</Text>
      ))}
      <Text {...props} style={style}>{children}</Text>
    </Group>
  );
}

// ── コードパネル ─────────────────────────────────────────────────────────

type CodeStep = { at: number; lines: string[] };

const TOKEN = /("[^"]*"?|'[^']*'?|<\/?[A-Za-z]+|\/?>|[A-Za-z_]+(?=[=:])|-?\d+(?:\.\d+)?|\s+|[{}()[\],;=:]|[^\s"'{}()[\],;=:<>\d]+|.)/g;

function tokenColor(token: string) {
  if (/^["']/.test(token)) return C.str;
  if (/^<\/?[A-Za-z]/.test(token) || /^\/?>$/.test(token)) return C.tag;
  if (/^-?\d/.test(token)) return C.num;
  if (/^[{}()[\],;=:]$/.test(token)) return C.mute;
  return '#E6EDF3';
}

function CodeLine({ text, size }: { text: string; size: number }) {
  const tokens = text.match(TOKEN) ?? [];
  let col = 0;
  return (
    <>
      {tokens.map((token, i) => {
        const x = col * size * MONO_ADVANCE;
        col += [...token].length;
        if (!token.trim()) return null;
        const isAttr = /^[A-Za-z_]+$/.test(token) && /^[=:]/.test(text.slice(text.indexOf(token, 0) + token.length));
        return (
          <Text key={i} x={x} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: size, fontWeight: 500,
            fill: solid(isAttr ? C.attr : tokenColor(token)) }}>{token}</Text>
        );
      })}
    </>
  );
}

function CodePanel({ g, steps, x = 40, y = 36, width = 660, title = 'film.tsx', scale = 1, maxRows = 9 }: {
  g: number; steps: CodeStep[]; x?: number; y?: number; width?: number; title?: string; scale?: number; maxRows?: number;
}) {
  const shown = steps.filter((s) => g >= s.at);
  if (!shown.length) return null;
  const SIZE = 21;
  const LH = 31;
  const rows: { text: string; fresh: boolean }[] = [];
  shown.forEach((step, i) => {
    const latest = i === shown.length - 1;
    let budget = latest ? Math.floor((g - step.at) * 1.8) : Number.POSITIVE_INFINITY;
    for (const line of step.lines) {
      if (budget <= 0) break;
      rows.push({ text: line.slice(0, budget), fresh: latest && g - step.at < 50 });
      budget -= line.length;
    }
  });
  const visible = rows.slice(-maxRows);
  const height = 62 + visible.length * LH + 14;
  const appear = progress(g, steps[0].at, 14, Easings.easeOutCubic);
  return (
    <Group x={x} y={y + 16 * (1 - appear)} scale={scale} opacity={appear}>
      <Rect width={width} height={height} cornerRadius={18} fill={C.panel} stroke="#FFFFFF26" strokeWidth={2}
        shadow={{ color: '#00000080', blur: 24, offsetX: 0, offsetY: 10 }} />
      {['#FF5F57', '#FEBC2E', '#28C840'].map((color, i) => (
        <Rect key={color} x={22 + i * 22} y={20} width={12} height={12} cornerRadius={6} fill={color} />
      ))}
      <Text x={width - 22} y={33} anchorX={1} anchorY="baseline"
        style={{ fontFamily: F.mono, fontSize: 16, fill: solid(C.mute) }}>{title}</Text>
      {visible.map((row, i) => (
        <Group key={i} y={56 + i * LH}>
          {row.fresh && <Rect x={0} y={0} width={width} height={LH} fill="#7CC24230" />}
          <Group x={24} y={22}><CodeLine text={row.text} size={SIZE} /></Group>
        </Group>
      ))}
    </Group>
  );
}

// ── 0 · 真っ黒なコンポジション ───────────────────────────────────────────

const COMPOSITION_CODE = [
  '<Composition width={1920} height={1080}',
  `  fps={30} durationInFrames={${DURATION}}>`,
];

function VoidOverlay() {
  const g = SCENE_AT.void + useCurrentFrame();
  const end = sceneEnd('void');
  const move = progress(g, end - 22, 22, Easings.easeInOutCubic);
  return (
    <CodePanel g={g} steps={[{ at: 10, lines: [...COMPOSITION_CODE, '</Composition>'] }]}
      x={interpolate(move, [0, 1], [630, 40])} y={interpolate(move, [0, 1], [430, 36])}
      scale={interpolate(move, [0, 1], [1.0, 1])} />
  );
}

function VoidStage() {
  const g = SCENE_AT.void + useCurrentFrame();
  const caret = Math.floor(g / 15) % 2 === 0;
  const fade = 1 - progress(g, sceneEnd('void') - 20, 20);
  return (
    <Group opacity={fade}>
      {/* 空のキャンバスの輪郭 */}
      <Rect x={160} y={90} width={1600} height={900} cornerRadius={8} stroke={alpha(C.white, caret ? 0.18 : 0.1)} strokeWidth={2} />
      <Text x={176} y={124} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 18, fill: solid('#FFFFFF55') }}>
        {`1920 × 1080 · ${FPS} fps · frame ${g}`}
      </Text>
    </Group>
  );
}

// ── 1 · レイヤーを重ねる / 2 · エフェクト：同じ背景が育っていく ───────────

const RECT_AT = L.l4.at - 2;
const GRADIENT_AT = mid('l4', 0.55);
const PHOTO_AT = mid('l6', 0.4);
const TITLE_AT = L.e1.at + 6;
const SHADOW_AT = mid('e2', 0.3);
const BLUR_AT = mid('e2', 0.56);

function BuildBackground() {
  const g = useCurrentFrame();
  const rect = progress(g, RECT_AT, 18, Easings.easeOutExpo);
  const gradient = progress(g, GRADIENT_AT, 20, Easings.easeInOutSine);
  const photo = progress(g, PHOTO_AT, 24, Easings.easeOutCubic);
  const blur = interpolate(g, [BLUR_AT, BLUR_AT + 45], [0, 14], { ...CLAMP, easing: Easings.easeInOutSine });
  const zoom = 1.04 + 0.1 * progress(g, PHOTO_AT, SCENE_AT.path - PHOTO_AT);
  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      {rect > 0 && (
        <Group clip={{ width: W * rect, height: H }}>
          <Rect width={W} height={H} fill={C.leaf} />
        </Group>
      )}
      {gradient > 0 && (
        <Rect width={W} height={H} opacity={gradient} fill={{ type: 'linear', start: { x: 0, y: 0 }, end: { x: 600, y: H },
          stops: [{ offset: 0, color: '#C3EC78' }, { offset: 1, color: '#1F5A1A' }] }} />
      )}
      {photo > 0 && (
        <Group opacity={photo} blur={blur}>
          <Camera zoom={zoom} x={1000} y={520}>
            <Image src={ASSET.photo} x={-40} y={-24} width={W + 80} height={H + 48} fit="cover" />
          </Camera>
        </Group>
      )}
      {photo > 0 && (
        <Rect width={W} height={H} opacity={photo} fill={{ type: 'linear', start: { x: 0, y: 420 }, end: { x: 0, y: H },
          stops: [{ offset: 0, color: '#00000000' }, { offset: 1, color: '#000000A0' }] }} />
      )}
    </>
  );
}

// 足したレイヤーの名前が、画面の真ん中にぽんと出る。
function Callout({ g, at, label, color = C.white }: { g: number; at: number; label: string; color?: string }) {
  const local = g - at;
  if (local < 0 || local > 70) return null;
  const s = spring({ frame: local, fps: FPS, config: { damping: 12 } });
  const out = 1 - progress(local, 52, 18);
  return (
    <Group x={960} y={430} scale={0.6 + 0.4 * s} opacity={Math.min(s, out)}>
      <OutlinedText anchorX={0.5} anchorY={0.5} outline={3} color="#00000088"
        style={{ fontFamily: F.mono, fontSize: 64, fontWeight: 700, fill: solid(color) }}
        shadow={{ color: '#00000066', blur: 18, offsetX: 0, offsetY: 8 }}>{label}</OutlinedText>
    </Group>
  );
}

function LayersOverlay() {
  const g = SCENE_AT.layers + useCurrentFrame();
  return (
    <>
      <CodePanel g={g} steps={[
        { at: 0, lines: COMPOSITION_CODE },
        { at: RECT_AT, lines: ['  <Rect width={1920} height={1080}', `    fill="${C.leaf}" />`] },
        { at: GRADIENT_AT, lines: ['  <Rect width={1920} height={1080}', "    fill={{ type: 'linear', stops }} />"] },
        { at: PHOTO_AT, lines: ['  <Image src="./field.jpg"', '    width={1920} height={1080}', '    fit="cover" />'] },
      ]} />
      <Callout g={g} at={RECT_AT + 4} label="<Rect />" />
      <Callout g={g} at={GRADIENT_AT + 4} label="type: 'linear'" />
      <Callout g={g} at={PHOTO_AT + 8} label='fit="cover"' />
    </>
  );
}

function EffectsStage() {
  const g = SCENE_AT.effects + useCurrentFrame();
  const s = spring({ frame: g - TITLE_AT, fps: FPS, config: { damping: 11 } });
  const glow = progress(g, TITLE_AT + 34, 30);
  const pulse = 0.65 + 0.35 * Math.sin((g - TITLE_AT) / 5);
  const shadow = progress(g, SHADOW_AT, 14, Easings.easeOutCubic);
  if (g < TITLE_AT) return null;
  return (
    <Group x={930} y={470} scale={0.55 + 0.45 * s} opacity={Math.min(1, s * 1.5)}>
      <OutlinedText y={-128} anchorX={0.5} anchorY={0.5} outline={6} color={C.zundaDeep}
        style={{ fontFamily: F.ja, fontSize: 56, fontWeight: 800, fill: solid(C.white) }}>ずんだもんとめたんの</OutlinedText>
      <OutlinedText anchorX={0.5} anchorY={0.5} outline={13} color={C.zundaDeep}
        style={{ fontFamily: F.title, fontSize: 168, fill: solid(C.white) }}
        glow={glow > 0 ? { color: alpha('#D4FF6E', glow), blur: 8 + 26 * glow * pulse } : undefined}
        shadow={shadow > 0 ? { color: alpha('#0A2A06', 0.7 * shadow), blur: 14 * shadow, offsetX: 0, offsetY: 16 * shadow } : undefined}>
        Celesta 入門
      </OutlinedText>
    </Group>
  );
}

function EffectsOverlay() {
  const g = SCENE_AT.effects + useCurrentFrame();
  const blur = interpolate(g, [BLUR_AT, BLUR_AT + 45], [0, 14], { ...CLAMP, easing: Easings.easeInOutSine });
  const glowBlur = Math.round(8 + 26 * progress(g, TITLE_AT + 34, 30));
  return (
    <CodePanel g={g} steps={[
      { at: 0, lines: [...COMPOSITION_CODE, '  <Image src="./field.jpg" fit="cover" />'] },
      { at: TITLE_AT, lines: ['  <Text style={{ fontSize: 168 }}', `    glow={{ color: '#D4FF6E', blur: ${glowBlur} }}`] },
      { at: SHADOW_AT, lines: ['    shadow={{ blur: 14, offsetY: 16 }}>'] },
      { at: BLUR_AT, lines: [`  <Image src="./field.jpg" blur={${blur.toFixed(1)}} />`] },
    ]} />
  );
}

// ── 3 · Path で描く ──────────────────────────────────────────────────────

const DRAW_AT = L.p1.at + 26;
type Stroke = { points: Pt[]; at: number; dur: number; stroke: string; width: number; fill?: string };
const MOCHI = [
  { cx: 960, cy: 500, seed: 1 },
  { cx: 818, cy: 556, seed: 2 },
  { cx: 1102, cy: 556, seed: 3 },
];
const DRAWING: Stroke[] = [
  { points: ellipse(960, 612, 390, 104), at: 0, dur: 22, stroke: '#6B5B4B', width: 6, fill: '#FFFFFF' },
  { points: ellipse(960, 600, 300, 70), at: 14, dur: 16, stroke: '#D8CBBB', width: 4 },
  ...MOCHI.flatMap((m, i): Stroke[] => [
    { points: ellipse(m.cx, m.cy, 118, 74), at: 32 + i * 30, dur: 14, stroke: '#6B5B4B', width: 5, fill: '#FFFDF6' },
    { points: blob(m.cx, m.cy - 28, 112, 44, m.seed), at: 44 + i * 30, dur: 16, stroke: '#3E6B1A', width: 5, fill: '#8CC63F' },
  ]),
  { points: pod(560, 668, 250, -16), at: 128, dur: 20, stroke: '#3E6B1A', width: 5, fill: '#7CB342' },
  { points: pod(1366, 660, 230, 196), at: 142, dur: 20, stroke: '#3E6B1A', width: 5, fill: '#7CB342' },
];
const BEANS = MOCHI.flatMap((m, i) => [-56, -18, 22, 60].map((dx, j) => ({
  x: m.cx + dx, y: m.cy - 30 + (j % 2 ? -12 : 8), r: 11 + ((i + j) % 2) * 2, at: 60 + i * 30 + j * 3,
})));

function PathStage() {
  const g = SCENE_AT.path + useCurrentFrame();
  const t = g - DRAW_AT;
  const active = DRAWING.find((s) => t >= s.at && t < s.at + s.dur);
  const yum = progress(g, L.p3.at, 16, Easings.easeOutCubic);
  return (
    <>
      <Rect width={W} height={H} fill={C.paper} />
      {Array.from({ length: 24 }, (_, i) => (
        <Rect key={`v${i}`} x={i * 84} width={2} height={H} fill="#E9DEC6" />
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <Rect key={`h${i}`} y={i * 84} width={W} height={2} fill="#E9DEC6" />
      ))}
      <Group y={-10}>
        {DRAWING.map((s, i) => {
          const p = progress(t, s.at, s.dur, Easings.easeInOutSine);
          if (p <= 0) return null;
          const fill = s.fill ? progress(t, s.at + s.dur - 4, 10) : 0;
          return (
            <Group key={i}>
              {fill > 0 && <Path points={s.points} closed fill={alpha(s.fill!, fill)} />}
              <Polyline points={s.points} progress={p} stroke={s.stroke} strokeWidth={s.width} />
            </Group>
          );
        })}
        {BEANS.map((b, i) => {
          const s = spring({ frame: t - b.at, fps: FPS, config: { damping: 9 } });
          if (t < b.at) return null;
          return <Rect key={i} x={b.x} y={b.y} width={b.r * 2} height={b.r * 2} cornerRadius={b.r} anchorX={0.5} anchorY={0.5}
            scale={s} fill="#C5E384" stroke="#5C8A2B" strokeWidth={3} />;
        })}
        {active && (() => {
          const [px, py] = pointOnPolyline(active.points, progress(t, active.at, active.dur, Easings.easeInOutSine));
          return <Rect x={px} y={py} width={22} height={22} cornerRadius={11} anchorX={0.5} anchorY={0.5} fill={C.zunda}
            glow={{ color: '#B8FF5AAA', blur: 14 }} />;
        })()}
        {yum > 0 && Array.from({ length: 10 }, (_, i) => {
          const a = (-150 + i * 13) * (Math.PI / 180);
          const r1 = 300;
          const r2 = 300 + 70 * yum;
          return <Line key={i} x1={960 + r1 * Math.cos(a)} y1={520 + r1 * Math.sin(a) * 0.8}
            x2={960 + r2 * Math.cos(a)} y2={520 + r2 * Math.sin(a) * 0.8} stroke="#F2A93B" strokeWidth={6} opacity={yum} />;
        })}
      </Group>
    </>
  );
}

function PathOverlay() {
  const g = SCENE_AT.path + useCurrentFrame();
  return (
    <CodePanel g={g} steps={[{ at: L.p2.at - 4, lines: [
      '<Path commands={[',
      "  { type: 'moveTo', x: 570, y: 612 },",
      "  { type: 'cubicTo', x1: 570, y1: 540,",
      '    x2: 760, y2: 508, x: 960, y: 508 },',
      ']} stroke="#6B5B4B" strokeWidth={6} />',
      '<Polyline points={mochi} progress={t} />',
    ] }]} />
  );
}

// ── 4 · 動画素材とタイムライン ───────────────────────────────────────────

const DROP_AT = mid('t1', 0.55);
const MONITOR = { x: 700, y: 64, w: 800, h: 450 };
const TRACK = { x: 700, y: 548, w: 800 };

function TimelineStage() {
  const g = SCENE_AT.timeline + useCurrentFrame();
  const drop = spring({ frame: g - DROP_AT, fps: FPS, config: { damping: 13 } });
  const playing = g >= DROP_AT + 8;
  const head = interpolate(g, [DROP_AT + 8, sceneEnd('timeline')], [0, 1], CLAMP);
  const rows = [
    { name: 'V1', label: 'field.mp4', color: C.zunda, x0: 0.06, x1: 0.68, drop: true },
    { name: 'A1', label: 'voices/t1.wav · t2.wav', color: C.metan, x0: 0.02, x1: 0.92 },
    { name: 'A2', label: 'score.wav', color: '#8C7CF0', x0: 0, x1: 1 },
    { name: 'T1', label: 'LowerThird', color: '#F2A93B', x0: 0.2, x1: 0.6 },
  ];
  return (
    <>
      <Rect width={W} height={H} fill="#12161B" />
      {Array.from({ length: 30 }, (_, i) => <Rect key={i} x={i * 64} width={1} height={H} fill="#FFFFFF08" />)}
      {/* モニター：ここに本物の <Video> が流れる */}
      <Group x={MONITOR.x} y={MONITOR.y}>
        <Rect x={-10} y={-10} width={MONITOR.w + 20} height={MONITOR.h + 20} cornerRadius={20} fill="#000000" stroke="#FFFFFF22" strokeWidth={2} />
        <Group clip={{ width: MONITOR.w, height: MONITOR.h, cornerRadius: 12 }}>
          <Rect width={MONITOR.w} height={MONITOR.h} fill="#0A0C0F" />
          {!playing && (
            <Text x={MONITOR.w / 2} y={MONITOR.h / 2} anchorX={0.5} anchorY={0.5}
              style={{ fontFamily: F.mono, fontSize: 24, fill: solid('#FFFFFF55') }}>no clip</Text>
          )}
          <Sequence from={DROP_AT + 8 - SCENE_AT.timeline}>
            <Video src={ASSET.clip} startFrom={2} scale={MONITOR.w / 1280} />
            <LowerThird />
          </Sequence>
        </Group>
      </Group>
      {/* トラック */}
      <Group x={TRACK.x} y={TRACK.y}>
        <Rect x={-10} y={-10} width={TRACK.w + 20} height={290} cornerRadius={16} fill="#1A1F26" stroke="#FFFFFF1A" strokeWidth={2} />
        {Array.from({ length: 9 }, (_, i) => (
          <Group key={i} x={60 + i * 90}>
            <Rect width={2} height={10} fill="#FFFFFF40" />
            <Text x={6} y={10} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 13, fill: solid('#FFFFFF60') }}>{`00:0${i}`}</Text>
          </Group>
        ))}
        {rows.map((row, i) => {
          const y = 28 + i * 62;
          const w = (TRACK.w - 70) * (row.x1 - row.x0);
          const lift = row.drop ? (1 - drop) * -260 : 0;
          return (
            <Group key={row.name} y={y}>
              <Text x={8} y={34} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 700, fill: solid(C.mute) }}>{row.name}</Text>
              <Rect x={60} width={TRACK.w - 70} height={50} cornerRadius={8} fill="#FFFFFF08" />
              {(!row.drop || g >= DROP_AT) && (
                <Group x={60 + (TRACK.w - 70) * row.x0} y={lift}>
                  <Rect width={w} height={50} cornerRadius={8} fill={alpha(row.color, 0.85)} stroke="#FFFFFF55" strokeWidth={2} />
                  <Text x={14} y={32} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 17, fontWeight: 700, fill: solid('#0B0F0C') }}>{row.label}</Text>
                </Group>
              )}
            </Group>
          );
        })}
        {playing && <Rect x={60 + (TRACK.w - 70) * head} y={14} width={3} height={262} fill="#FF5A5A" />}
      </Group>
    </>
  );
}

// JSON の "component" アイテムから呼ぶ想定の下帯。React コンポーネントなので
// registerComponent すれば JSON から props だけ渡して使い回せる。
function LowerThird() {
  const f = useCurrentFrame();
  const s = progress(f, 10, 18, Easings.easeOutExpo);
  return (
    <Group x={24} y={MONITOR.h - 82} opacity={s}>
      <Group clip={{ width: 420 * s, height: 58 }}>
        <Rect width={420} height={58} cornerRadius={8} fill="#0B0F0CCC" />
        <Rect width={8} height={58} fill={C.zunda} />
        <Text x={24} y={38} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 26, fontWeight: 800, fill: solid(C.white) }}>
          どこかの畑（イメージ）
        </Text>
      </Group>
    </Group>
  );
}

function TimelineOverlay() {
  const g = SCENE_AT.timeline + useCurrentFrame();
  return (
    <CodePanel g={g} title="project.celesta.json" width={620} maxRows={10} steps={[{ at: L.t1.at + 6, lines: [
      '{ "id": "broll",',
      '  "range": {',
      '    "start": { "value": 2, "timescale": 1 },',
      '    "duration": { "value": 6, "timescale": 1 }',
      '  },',
      '  "content": {',
      '    "type": "video", "asset": "field"',
      '  } }',
    ] }]} />
  );
}

// ── 5 · 声と口パク ───────────────────────────────────────────────────────

const TRACKS: Record<string, LipSyncTrack> = {};
const ENVELOPES: Record<string, Float32Array> = {};
const ZOOM_AT = L.s1.at + L.s1.len - 26;
const UNZOOM_AT = L.s4.at + L.s4.hold - 8;

type Shot = { at: number; x: number; y: number; zoom: number };
const SHOTS: Shot[] = [
  { at: 0, x: 960, y: 540, zoom: 1 },
  { at: ZOOM_AT, x: 960, y: 540, zoom: 1 },
  { at: ZOOM_AT + 22, x: 1500, y: 470, zoom: 2 },
  { at: L.s3.at + 6, x: 1500, y: 470, zoom: 2 },
  { at: L.s3.at + 30, x: 1430, y: 560, zoom: 1.5 },
  { at: L.s4.at, x: 1430, y: 560, zoom: 1.5 },
  { at: L.s4.at + 10, x: 1520, y: 470, zoom: 2.15 },
  { at: UNZOOM_AT, x: 1520, y: 470, zoom: 2.15 },
  { at: UNZOOM_AT + 20, x: 960, y: 540, zoom: 1 },
];

function shotAt(g: number) {
  let i = 0;
  while (i < SHOTS.length - 1 && SHOTS[i + 1].at <= g) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1] ?? a;
  const t = b === a ? 0 : Easings.easeInOutCubic(Math.min(1, (g - a.at) / (b.at - a.at)));
  const shake = (g >= L.s4.at && g < L.s4.at + L.s4.len ? 7 : 0) + (g >= L.a5.at && g < L.a5.at + 24 ? 12 : 0);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom: a.zoom + (b.zoom - a.zoom) * t, shake };
}

function VoiceStage() {
  const g = SCENE_AT.voice + useCurrentFrame();
  return (
    <>
      {/* カメラが寄っても端が見えないよう、画面より広く敷く */}
      <Rect x={-400} y={-300} width={W + 800} height={H + 600} fill={{ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: H + 600 },
        stops: [{ offset: 0, color: '#F2FBE6' }, { offset: 1, color: '#BFE39A' }] }} />
      {Array.from({ length: 14 * 7 }, (_, i) => {
        const cx = (i % 14) * 170 - 170 + ((Math.floor(i / 12) % 2) * 85) + ((g * 0.6) % 170) - 85;
        const cy = Math.floor(i / 14) * 170 + 40;
        return <Rect key={i} x={cx} y={cy} width={26} height={26} cornerRadius={13} fill="#7CC24233" />;
      })}
    </>
  );
}

const VOWEL_KANA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', closed: 'ん' } as const;

function VoiceOverlay() {
  const g = SCENE_AT.voice + useCurrentFrame();
  const from = ZOOM_AT + 10;
  const show = progress(g, from, 16, Easings.easeOutCubic) * (1 - progress(g, UNZOOM_AT - 4, 14));
  if (show <= 0) return null;
  const line = [L.s2, L.s3, L.s4].reduce((cur, t) => (t.at <= g ? t : cur), L.s2);
  const parade = line.id === 's3';
  return (
    <Group x={80 - 40 * (1 - show)} y={110} opacity={show}>
      <Rect width={660} height={700} cornerRadius={26} fill="#10241AEE" stroke="#FFFFFF22" strokeWidth={2}
        shadow={{ color: '#0000004D', blur: 24, offsetX: 0, offsetY: 12 }} />
      {parade ? <FaceParade g={g} /> : <MouthMeter g={g} line={line} />}
    </Group>
  );
}

function MouthMeter({ g, line }: { g: number; line: Timed }) {
  const local = Math.max(0, g - line.at);
  const speaking = local < line.len;
  const shape = speaking ? TRACKS[line.id]?.mouthAtFrame(local, FPS) ?? 'closed' : 'closed';
  const face = ZUNDA[line.face as ZundaFace];
  const env = ENVELOPES[line.id];
  const bars = 72;
  return (
    <>
      <Text x={36} y={64} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 24, fontWeight: 700, fill: solid(C.str) }}>
        loadLipSync({'{'} src, text {'}'})
      </Text>
      <Text x={36} y={102} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 22, fontWeight: 500, fill: solid('#FFFFFFAA') }}>
        {`text: ${line.kana.replace(/['/_]/g, '')}`}
      </Text>
      {/* いまの口の形 */}
      <Group x={330} y={290}>
        <Rect width={250} height={250} cornerRadius={125} anchorX={0.5} anchorY={0.5} fill={C.zunda}
          glow={{ color: '#B8FF5A88', blur: 20 }} />
        <Text anchorX={0.5} anchorY={0.5} style={{ fontFamily: F.ja, fontSize: 150, fontWeight: 800, fill: solid('#0B2A06') }}>
          {VOWEL_KANA[shape]}
        </Text>
      </Group>
      <Group x={60} y={470}>
        {(['a', 'i', 'u', 'e', 'o', 'closed'] as const).map((v, i) => (
          <Group key={v} x={i * 92}>
            <Rect width={76} height={56} cornerRadius={12} fill={v === shape ? C.zunda : '#FFFFFF14'} />
            <Text x={38} y={28} anchorX={0.5} anchorY={0.5} style={{ fontFamily: F.ja, fontSize: 30, fontWeight: 800,
              fill: solid(v === shape ? '#0B2A06' : '#FFFFFF88') }}>{VOWEL_KANA[v]}</Text>
          </Group>
        ))}
      </Group>
      {/* 波形（WAV から読んだ実データ） */}
      <Group x={40} y={560}>
        {env && Array.from({ length: bars }, (_, i) => {
          const k = Math.floor((i / bars) * env.length);
          const v = Math.min(1, env[k] * 1.6);
          const passed = (i / bars) * line.len <= local;
          return <Rect key={i} x={i * 8} y={40 - 36 * v} width={5} height={Math.max(2, 72 * v)} cornerRadius={2}
            fill={passed ? C.zunda : '#FFFFFF33'} />;
        })}
      </Group>
      <Text x={36} y={672} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 20, fontWeight: 500, fill: solid('#FFFFFF99') }}>
        {`PSD レイヤー: ${face.mouth[shape]}`}
      </Text>
    </>
  );
}

function FaceParade({ g }: { g: number }) {
  const current = faceAt<ZundaFace>('zunda', g, 'normal');
  return (
    <>
      <Text x={36} y={64} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 24, fontWeight: 700, fill: solid(C.str) }}>
        {"portrait={{ type: 'psd', layers }}"}
      </Text>
      {FACE_PARADE.map((face, i) => {
        const on = face === current;
        return (
          <Group key={face} x={40} y={110 + i * 78}>
            <Rect width={580} height={64} cornerRadius={14} fill={on ? C.zunda : '#FFFFFF10'} />
            <Text x={24} y={42} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 30, fontWeight: 800,
              fill: solid(on ? '#0B2A06' : '#FFFFFFAA') }}>{ZUNDA[face].label}</Text>
            <Text x={556} y={42} anchorX={1} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 18, fontWeight: 500,
              fill: solid(on ? '#0B2A06' : '#FFFFFF55') }}>{ZUNDA[face].base[ZUNDA[face].base.length - 1]}</Text>
          </Group>
        );
      })}
    </>
  );
}

// ── 6 · フレームは関数：過去のシーンをその場で描き直す ────────────────────

const RECALL = [
  { frame: L.l6.at + 50, scene: 'layers' },
  { frame: L.e2.at + 70, scene: 'effects' },
  { frame: L.p2.at + 40, scene: 'path' },
  { frame: L.t2.at + 40, scene: 'timeline' },
];
const THUMB = { scale: 0.23, w: W * 0.23, h: H * 0.23 };
const EXPAND_AT = L.r2.at + 34;
const EXPAND = 2;

function RewindStage() {
  const f = useCurrentFrame();
  const g = SCENE_AT.rewind + f;
  const scrub = progress(g, L.r1.at + 30, 20);
  const expand = progress(g, EXPAND_AT, 22, Easings.easeInOutCubic);
  return (
    <>
      <Rect width={W} height={H} fill={C.navy} />
      {Array.from({ length: 26 }, (_, i) => (
        <Group key={i} x={((i * 80 - g * 3) % 2080 + 2080) % 2080 - 80}>
          <Rect y={24} width={36} height={22} cornerRadius={5} fill="#FFFFFF14" />
          <Rect y={H - 46} width={36} height={22} cornerRadius={5} fill="#FFFFFF14" />
        </Group>
      ))}
      {RECALL.map((r, i) => {
        const appear = spring({ frame: g - (SCENE_AT.rewind + 10 + i * 6), fps: FPS, config: { damping: 14 } });
        if (appear <= 0) return null;
        const wobble = Math.round(24 * Math.sin((g - L.r1.at) / 11 + i) * scrub);
        const isExpanding = i === EXPAND && expand > 0;
        const frame = isExpanding ? r.frame + wobble + (g - EXPAND_AT) : r.frame + wobble;
        const x0 = 580 + (i % 2) * (THUMB.w + 28);
        const y0 = 96 + Math.floor(i / 2) * (THUMB.h + 64);
        const x = isExpanding ? x0 * (1 - expand) : x0;
        const y = isExpanding ? y0 * (1 - expand) : y0;
        const scale = isExpanding ? THUMB.scale + (1 - THUMB.scale) * expand : THUMB.scale;
        const fade = !isExpanding && expand > 0 ? 1 - expand : 1;
        return (
          <Group key={r.scene} opacity={fade}>
            <Group x={x} y={y} scale={scale} opacity={Math.min(1, appear)}>
              <Rect x={-12} y={-12} width={W + 24} height={H + 24} cornerRadius={24} fill="#FFFFFF" />
              <Group clip={{ width: W, height: H }}>
                {/* 子の Sequence の 0 フレームが「いま」になるようにずらすと、
                    過去のどのフレームでもその場で描き直せる */}
                <Sequence from={f - frame}>
                  <Stage />
                  <Overlay />
                </Sequence>
              </Group>
            </Group>
            {!isExpanding && (
              <Group x={x0} y={y0 + THUMB.h + 12} opacity={Math.min(1, appear)}>
                <Rect width={THUMB.w} height={6} cornerRadius={3} fill="#FFFFFF22" />
                <Rect width={THUMB.w * (frame / DURATION)} height={6} cornerRadius={3} fill={C.zunda} />
                <Text y={36} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 500, fill: solid('#FFFFFFAA') }}>
                  {`frame ${String(frame).padStart(4, '0')}`}
                </Text>
              </Group>
            )}
          </Group>
        );
      })}
    </>
  );
}

// ── 7 · AI エージェント ─────────────────────────────────────────────────

type TermLine = { at: number; mono: string; ja?: string; color?: string };
const TERM: TermLine[] = [
  { at: SCENE_AT.agent + 6, mono: '$ claude', color: C.white },
  { at: L.a2.at + 6, mono: '> ', ja: 'ずんだもんとめたんの解説動画を作って', color: C.white },
  { at: mid('a2', 0.45), mono: '● Read skills/celesta/SKILL.md', color: C.str },
  { at: mid('a2', 0.6), mono: '● Write script.ts', ja: `  台本 ${LINES.length} 行`, color: C.str },
  { at: mid('a2', 0.75), mono: '● Run node make-voices.ts', ja: `  VOICEVOX で ${LINES.length} 本`, color: C.str },
  { at: mid('a2', 0.9), mono: '● Write film.tsx', ja: `  ${SCENES.length} シーン`, color: C.str },
  { at: L.a3.at, mono: '● Run inspect.mjs film.tsx --every 30', color: C.str },
  { at: mid('a3', 0.6), mono: `  ok  ${DURATION} frames, 0 errors`, color: C.mute },
  { at: L.a4.at, mono: '● Run celesta-exporter --react film.tsx', color: C.str },
];
const EXPORT_FROM = L.a4.at + 14;
const EXPORT_TO = L.a4.at + L.a4.len - 6;

function AgentStage() {
  const g = SCENE_AT.agent + useCurrentFrame();
  const size = 24;
  const progressValue = progress(g, EXPORT_FROM, EXPORT_TO - EXPORT_FROM, Easings.easeInOutSine);
  const done = g >= EXPORT_TO;
  const stamp = spring({ frame: g - L.a5.at, fps: FPS, config: { damping: 8 } });
  return (
    <>
      <Rect width={W} height={H} fill="#07090D" />
      <Group x={560} y={60}>
        <Rect width={940} height={770} cornerRadius={20} fill="#0D1117" stroke="#FFFFFF22" strokeWidth={2}
          shadow={{ color: '#000000AA', blur: 40, offsetX: 0, offsetY: 18 }} />
        <Rect width={940} height={48} cornerRadius={20} fill="#161B22" />
        {['#FF5F57', '#FEBC2E', '#28C840'].map((color, i) => (
          <Rect key={color} x={24 + i * 24} y={18} width={13} height={13} cornerRadius={7} fill={color} />
        ))}
        <Text x={470} y={31} anchorX={0.5} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 16, fill: solid(C.mute) }}>
          ~/celesta/examples/zunda
        </Text>
        {TERM.filter((t) => g >= t.at).map((t, i) => {
          const typed = Math.floor((g - t.at) * 2.2);
          const mono = t.mono.slice(0, typed);
          const ja = t.ja ? t.ja.slice(0, Math.max(0, typed - t.mono.length)) : '';
          return (
            <Group key={i} x={32} y={100 + i * 50}>
              <Text anchorY="baseline" style={{ fontFamily: F.mono, fontSize: size, fill: solid(t.color ?? C.white) }}>{mono}</Text>
              {ja && (
                <Text x={t.mono.length * size * MONO_ADVANCE} anchorY="baseline"
                  style={{ fontFamily: F.ja, fontSize: size, fontWeight: 500, fill: solid(C.white) }}>{ja}</Text>
              )}
            </Group>
          );
        })}
        {g >= EXPORT_FROM && (
          <Group x={32} y={100 + TERM.length * 50 - 26}>
            <Rect width={620} height={20} cornerRadius={10} fill="#FFFFFF14" />
            <Rect width={620 * progressValue} height={20} cornerRadius={10} fill={C.zunda} />
            <Text x={640} y={18} anchorY="baseline" style={{ fontFamily: F.mono, fontSize: 20, fill: solid(C.mute) }}>
              {`${Math.round(progressValue * DURATION)}/${DURATION}`}
            </Text>
          </Group>
        )}
        {done && (
          <Text x={32} y={100 + (TERM.length + 1) * 50} anchorY="baseline"
            style={{ fontFamily: F.mono, fontSize: size, fontWeight: 700, fill: solid(C.zunda) }}>
            export complete: zunda.mp4
          </Text>
        )}
      </Group>
      {stamp > 0 && g < sceneEnd('agent') && (
        <Group x={1030} y={430} rotation={-8} scale={0.4 + 0.6 * stamp} opacity={Math.min(1, stamp)}>
          <Rect width={560} height={150} cornerRadius={20} anchorX={0.5} anchorY={0.5} stroke={C.metan} strokeWidth={10} fill="#FFFFFFEE" />
          <Text anchorX={0.5} anchorY={0.5} style={{ fontFamily: F.title, fontSize: 84, fill: solid(C.metan) }}>出番なし</Text>
        </Group>
      )}
    </>
  );
}

// ── 8 · おわり ─────────────────────────────────────────────────────────

const CREDITS = [
  '音声　VOICEVOX:ずんだもん　VOICEVOX:四国めたん',
  '立ち絵　東北ずん子・ずんだもんプロジェクト 公式イラスト',
  '映像素材　Mixkit　　BGM　make-score.py（オリジナル）',
  'フォント　M PLUS Rounded 1c / Dela Gothic One / JetBrains Mono',
];

function OutroStage() {
  const g = SCENE_AT.outro + useCurrentFrame();
  const logo = spring({ frame: g - SCENE_AT.outro - 4, fps: FPS, config: { damping: 10 } });
  const credits = progress(g, L.o2.at + 10, 20);
  return (
    <>
      <Rect width={W} height={H} fill={{ type: 'radial', center: { x: 960, y: 380 }, radius: 1100,
        stops: [{ offset: 0, color: '#E6F7CF' }, { offset: 1, color: '#7CC242' }] }} />
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + g / 90;
        return <Line key={i} x1={960 + 260 * Math.cos(a)} y1={330 + 260 * Math.sin(a)} x2={960 + 1400 * Math.cos(a)}
          y2={330 + 1400 * Math.sin(a)} stroke="#FFFFFF" strokeWidth={60} cap="butt" opacity={0.18} />;
      })}
      <Group x={960} y={300} scale={0.5 + 0.5 * logo} opacity={Math.min(1, logo * 1.5)}>
        <OutlinedText anchorX={0.5} anchorY={0.5} outline={15} color={C.zundaDeep}
          style={{ fontFamily: F.title, fontSize: 200, fill: solid(C.white) }} glow={{ color: '#FFFFFFAA', blur: 24 }}>Celesta</OutlinedText>
      </Group>
      <TextReveal x={960} y={440} align={0.5} from={L.o1.at - SCENE_AT.outro} stagger={4} durationInFrames={22}
        style={{ fontFamily: F.ja, fontSize: 64, fontWeight: 800, lineHeight: 84, fill: solid(C.zundaDeep) }}>
        動画は、コードで書ける。
      </TextReveal>
      <Group x={960} y={600} opacity={credits}>
        {CREDITS.map((c, i) => (
          <Text key={i} y={i * 38} anchorX={0.5} anchorY="baseline"
            style={{ fontFamily: F.ja, fontSize: 24, fontWeight: 500, fill: solid('#1F4A14') }}>{c}</Text>
        ))}
      </Group>
    </>
  );
}

// ── 組み立て ─────────────────────────────────────────────────────────────

const SCENE_TITLES: Partial<Record<SceneId, string>> = {
  layers: 'レイヤーを重ねる', effects: 'エフェクト', path: 'Path で描く', timeline: '動画とタイムライン',
  voice: '声と口パク', rewind: 'フレームは関数', agent: 'AI エージェント',
};

function SceneSequence({ id, extra = 0, children }: { id: SceneId; extra?: number; children: ReactNode }) {
  return <Sequence from={SCENE_AT[id]} durationInFrames={sceneEnd(id) - SCENE_AT[id] + extra}>{children}</Sequence>;
}

function Stage() {
  return (
    <>
      <Sequence durationInFrames={SCENE_AT.path}><BuildBackground /></Sequence>
      <SceneSequence id="void"><VoidStage /></SceneSequence>
      <SceneSequence id="effects"><EffectsStage /></SceneSequence>
      <SceneSequence id="path"><PathStage /></SceneSequence>
      <SceneSequence id="timeline"><TimelineStage /></SceneSequence>
      <SceneSequence id="voice"><VoiceStage /></SceneSequence>
      <SceneSequence id="rewind"><RewindStage /></SceneSequence>
      <SceneSequence id="agent"><AgentStage /></SceneSequence>
      <SceneSequence id="outro"><OutroStage /></SceneSequence>
    </>
  );
}

function ChapterTag() {
  const g = useCurrentFrame();
  const scene = [...SCENES].reverse().find((s) => SCENE_AT[s] <= g) ?? 'void';
  const title = SCENE_TITLES[scene];
  if (!title) return null;
  const index = SCENES.indexOf(scene);
  const s = progress(g, SCENE_AT[scene] + 6, 16, Easings.easeOutExpo);
  return (
    <Group x={1880 + 40 * (1 - s)} y={40} opacity={s}>
      <Rect x={-430} width={430} height={56} cornerRadius={28} fill="#0B0F0CCC" />
      <Rect x={-420} y={8} width={64} height={40} cornerRadius={20} fill={C.zunda} />
      <Text x={-388} y={28} anchorX={0.5} anchorY={0.5} style={{ fontFamily: F.mono, fontSize: 22, fontWeight: 700, fill: solid('#0B2A06') }}>
        {String(index).padStart(2, '0')}
      </Text>
      <Text x={-338} y={38} anchorY="baseline" style={{ fontFamily: F.ja, fontSize: 26, fontWeight: 800, fill: solid(C.white) }}>{title}</Text>
    </Group>
  );
}

function Overlay() {
  return (
    <>
      <SceneSequence id="void"><VoidOverlay /></SceneSequence>
      <SceneSequence id="layers"><LayersOverlay /></SceneSequence>
      <SceneSequence id="effects"><EffectsOverlay /></SceneSequence>
      <SceneSequence id="path"><PathOverlay /></SceneSequence>
      <SceneSequence id="timeline"><TimelineOverlay /></SceneSequence>
      <SceneSequence id="voice"><VoiceOverlay /></SceneSequence>
      <ChapterTag />
    </>
  );
}

// シーンの切り替わりで、緑とピンクの帯が画面を横切る。
const WIPE_AT = (['path', 'timeline', 'voice', 'rewind', 'agent', 'outro'] as SceneId[]).map((s) => SCENE_AT[s]);
function Wipes() {
  const g = useCurrentFrame();
  const at = WIPE_AT.find((w) => g >= w - 9 && g < w + 9);
  if (at === undefined) return null;
  const t = (g - (at - 9)) / 18;
  return (
    <>
      {[C.zunda, C.metan].map((color, i) => {
        const p = Easings.easeInOutCubic(Math.min(1, Math.max(0, t - i * 0.08) / 0.92));
        return <Rect key={color} x={interpolate(p, [0, 1], [-3000, 2300])} y={-500} width={2700} height={2100}
          rotation={14} fill={color} />;
      })}
    </>
  );
}

function Cast() {
  const g = useCurrentFrame();
  const zIn = progress(g, L.l1.at - 16, 20, Easings.easeOutBack);
  const mIn = progress(g, L.l2.at - 12, 20, Easings.easeOutBack);
  const hop = (speaker: string) => {
    const t = TIMED.find((l) => l.speaker === speaker && g >= l.at && g < l.at + 9);
    return t ? 18 * Math.sin((Math.PI * (g - t.at)) / 9) : 0;
  };
  const sway = (seed: number) => 3 * noise(seed, g / 40);
  const zFace = faceAt<ZundaFace>('zunda', g, 'normal');
  const mFace = faceAt<MetanFace>('metan', g, 'talk');
  return (
    <>
      <CharacterView ref={metanView} character={METAN_REF[mFace]} mouth="closed" scale={M.scale}
        x={M.x - 620 * (1 - mIn)} y={M.y - hop('metan') + sway(2)} opacity={g >= L.l2.at - 12 ? 1 : 0} />
      <CharacterView ref={zundaView} character={ZUNDA_REF[zFace]} mouth="closed" scale={Z.scale}
        x={Z.x + 620 * (1 - zIn)} y={Z.y - hop('zunda') + sway(1)} opacity={g >= L.l1.at - 16 ? 1 : 0} />
    </>
  );
}

function SubtitleBand() {
  const g = useCurrentFrame();
  const line = lineAt(g);
  const show = progress(g, L.v1.at - 10, 12) * (1 - progress(g, L.o2.at + L.o2.hold - 6, 16));
  if (!line || show <= 0) return null;
  const color = line.speaker === 'zunda' ? C.zunda : C.metan;
  const name = line.speaker === 'zunda' ? 'ずんだもん' : '四国めたん';
  return (
    <Group opacity={show}>
      <Rect x={400} y={866} width={1120} height={196} cornerRadius={30} fill="#0B0F0CC8" stroke={color} strokeWidth={4} />
      <Rect x={430} y={842} width={200} height={46} cornerRadius={23} fill={color} />
      <Text x={530} y={865} anchorX={0.5} anchorY={0.5} style={{ fontFamily: F.ja, fontSize: 24, fontWeight: 800, fill: solid('#0B0F0C') }}>{name}</Text>
    </Group>
  );
}

function scoreVolume() {
  const start = SCENE_AT.layers;
  const key = (frame: number, value: number) => ({ time: { value: frame - start, timescale: FPS }, value });
  const end = DURATION - 1;
  return {
    type: 'keyframes' as const,
    keyframes: [key(start, 0), key(start + 12, 0.3), key(L.o2.at + L.o2.len, 0.3), key(L.o2.at + L.o2.len + 15, 0.55), key(end - 45, 0.55), key(end, 0)],
  };
}

// 和文フォントは使う文字だけに絞って読み込む。
const JA_TEXT = [
  ...LINES.map((l) => l.text), ...CREDITS, ...Object.values(SCENE_TITLES), ...Object.values(ZUNDA).map((f) => f.label),
  ...Object.values(ZUNDA).flatMap((f) => [...f.base, ...Object.values(f.mouth)]), ...Object.values(VOICES).map((v) => v.kana),
  ...Object.values(VOWEL_KANA), ...TERM.map((t) => t.ja ?? ''),
  'ずんだもん四国めたん', 'ずんだもんとめたんの', 'Celesta 入門', '動画は、コードで書ける。', '出番なし', 'どこかの畑（イメージ）',
  'text: PSD レイヤー: ',
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
].join('');
const JA_GLYPHS = encodeURIComponent([...new Set(JA_TEXT)].sort().join(''));
const JA_FONTS = `https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;800&family=Dela+Gothic+One&text=${JA_GLYPHS}`;
const MONO_FONT = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700';

export async function prepare() {
  for (const t of TIMED) TRACKS[t.id] = await loadLipSync({ src: t.file, text: t.kana });
  for (const id of ['s2', 's4']) {
    const bytes = new Uint8Array(await readFile(join(import.meta.dirname, L[id].file)));
    ENVELOPES[id] = buildEnvelope(decodeWav(bytes), 30);
  }
}

export default function Root() {
  const g = useCurrentFrame();
  const shot = shotAt(g);
  const zBlink = blinking(g, 1);
  const mBlink = blinking(g, 2);
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={DURATION}>
      <Assets>
        <Font src={JA_FONTS} />
        <Font src={MONO_FONT} />
        {(Object.keys(ZUNDA) as ZundaFace[]).map((k) => (
          <Character key={k} ref={ZUNDA_REF[k]} id={`zunda-${k}`} name="ずんだもん"
            portrait={{ type: 'psd', src: ASSET.zunda, layers: zBlink ? ZUNDA[k].blink : ZUNDA[k].base, lipSync: ZUNDA[k].mouth }}
            subtitle={{ ...SUBTITLE, style: subtitleStyle(C.zundaDeep) }} />
        ))}
        {(Object.keys(METAN) as MetanFace[]).map((k) => (
          <Character key={k} ref={METAN_REF[k]} id={`metan-${k}`} name="四国めたん"
            portrait={{ type: 'psd', src: METAN[k].src, layers: mBlink ? METAN[k].blink : METAN[k].base, lipSync: METAN[k].mouth }}
            subtitle={{ ...SUBTITLE, style: subtitleStyle(C.metanDeep) }} />
        ))}
      </Assets>

      <Camera x={shot.x} y={shot.y} zoom={shot.zoom} shake={shot.shake} shakeFrequency={6}>
        <Stage />
        <Cast />
      </Camera>
      <Overlay />
      <Wipes />
      <SubtitleBand />

      {TIMED.map((t) => (
        <Sequence key={t.id} from={t.at} durationInFrames={t.hold}>
          <Dialogue character={t.speaker === 'zunda' ? zundaView : metanView} audio={t.file} lipSync={TRACKS[t.id]}>
            {wrapSubtitle(t.text)}
          </Dialogue>
        </Sequence>
      ))}
      <Sequence from={SCENE_AT.layers}>
        <Audio src={ASSET.score} volume={scoreVolume()} />
      </Sequence>
    </Composition>
  );
}

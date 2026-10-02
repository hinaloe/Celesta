import React from 'react';
import {
  Assets, Audio, Composition, Easings, Font, Group, Image, Line, Rect, Sequence, Text, Video,
  interpolate, noise, progress, random, useCurrentFrame, useTypewriter,
} from '@celesta/react';

// OKAERI — an unofficial VRChat promotion video. 68 s, 1920×1080, 30 fps.
// Cut on a 120 BPM grid: one beat = 15 frames, one bar = 60 frames.
//
//   0– 240  cold open   a grey commute; the phone lights up
//  240– 360  log in      joining "Home"
//  360– 840  manifesto   one shot and one word every two beats
//  840–1140  avatars     the avatar carousel
// 1140–1440  worlds      the in-game camera; every shutter prints a photo
// 1440–1680  friends     the campfire and the selfie
// 1680–1800  flicker     eight worlds, one beat each
// 1800–1920  pier        everyone logs off
// 1920–2040  logo

const W = 1920;
const H = 1080;
const BEAT = 15;

const C = {
  ink: '#07080F',
  night: '#0B0D1A',
  paper: '#F4F1EA',
  white: '#FFFFFF',
  gray: '#CCCCCC',
  blue: '#1778FF',
  green: '#2BCF5C',
  orange: '#FF7B42',
  purple: '#8143E6',
};
// VRChat trust-rank colours: New User, User, Known User, Trusted User.
const RANKS = [C.blue, C.green, C.orange, C.purple];
const RANK_NAMES = ['New User', 'User', 'Known User', 'Trusted User'];

const F = {
  display: 'Dela Gothic One',
  jp: 'Zen Kaku Gothic New',
  latin: 'Space Grotesk',
  mono: 'JetBrains Mono',
  dot: 'DotGothic16',
};

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clip = (name: string) => `./assets/clips/${name}.mp4`;
const photo = (name: string) => `./assets/photos/${name}`;
const CL = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ------------------------------------------------------------------ primitives

type TProps = {
  children: string;
  x?: number; y?: number; size?: number; color?: string; font?: string; weight?: number;
  ax?: number; ay?: number; opacity?: number; spacing?: number; rotation?: number; scale?: number;
  blendMode?: 'normal' | 'difference' | 'screen' | 'overlay' | 'multiply' | 'add';
  shadow?: boolean; align?: 'left' | 'center' | 'right';
};

function T({ children, x = 0, y = 0, size = 64, color = C.white, font = F.jp, weight,
  ax = 0, ay = 0, opacity = 1, spacing, rotation, scale, blendMode, shadow, align }: TProps) {
  return (
    <Text x={x} y={y} anchorX={ax} anchorY={ay} opacity={opacity} rotation={rotation} scale={scale}
      blendMode={blendMode}
      shadow={shadow ? { color: '#000000A0', blur: 18, offsetX: 0, offsetY: 6 } : undefined}
      style={{
        fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: spacing, align,
        fill: { type: 'solid', color },
      }}>
      {children}
    </Text>
  );
}

// Japanese set vertically (縦書き): one glyph per line, small kana and
// punctuation nudged to the upper right as in print.
function VText({ children, x, y, size, color = C.ink, font = F.display, opacity = 1 }: {
  children: string; x: number; y: number; size: number; color?: string; font?: string; opacity?: number;
}) {
  const chars = Array.from(children);
  return (
    <Group x={x} y={y} opacity={opacity}>
      {chars.map((ch, i) => {
        const punct = '。、'.includes(ch);
        const long = ch === 'ー';
        return (
          <T key={i} x={punct ? size * 0.62 : 0} y={i * size * 1.04 - (punct ? size * 0.55 : 0)}
            ax={0.5} ay={0.5} size={size} font={font} color={color} rotation={long ? 90 : 0}>
            {ch}
          </T>
        );
      })}
    </Group>
  );
}

// An image or video shown through a rectangular window, centred on a point
// of the source (cx, cy) at scale s.
function Window({ src, video = false, w, h, cx, cy, s = 1, x = 0, y = 0, radius = 0,
  rate, startFrom, opacity = 1 }: {
  src: string; video?: boolean; w: number; h: number; cx: number; cy: number; s?: number;
  x?: number; y?: number; radius?: number; rate?: number; startFrom?: number; opacity?: number;
}) {
  return (
    <Group x={x} y={y} opacity={opacity} clip={{ width: w, height: h, cornerRadius: radius }}>
      <Group x={w / 2 - cx * s} y={h / 2 - cy * s} scale={s}>
        {video ? <Video src={src} playbackRate={rate} startFrom={startFrom} /> : <Image src={src} />}
      </Group>
    </Group>
  );
}

// Scale a full-frame layer about the canvas centre.
function Zoom({ s, children, dx = 0, dy = 0 }: { s: number; children: React.ReactNode; dx?: number; dy?: number }) {
  return (
    <Group x={W / 2 + dx} y={H / 2 + dy} scale={s}>
      <Group x={-W / 2} y={-H / 2}>{children}</Group>
    </Group>
  );
}

function Shade({ from = 0.0, to = 0.7, top = 0.45 }: { from?: number; to?: number; top?: number }) {
  const a = (n: number) => Math.round(clamp(n) * 255).toString(16).padStart(2, '0');
  return (
    <Rect width={W} height={H} fill={{
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: H },
      stops: [
        { offset: 0, color: `#000000${a(from)}` },
        { offset: top, color: '#00000000' },
        { offset: 1, color: `#000000${a(to)}` },
      ],
    }} />
  );
}

function Flash({ f, at, len = 6, peak = 1, color = C.white }: { f: number; at: number; len?: number; peak?: number; color?: string }) {
  const o = f >= at && f < at + len ? peak * (1 - (f - at) / len) : 0;
  return o > 0 ? <Rect width={W} height={H} fill={color} opacity={o} /> : null;
}

// A VRChat-style nameplate.
function Nameplate({ name, rank, x, y, appear = 1, scale = 1 }: {
  name: string; rank: number; x: number; y: number; appear?: number; scale?: number;
}) {
  const w = Array.from(name).reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2fff ? 30 : 17), 0) + 64;
  const color = RANKS[rank % 4];
  return (
    <Group x={x} y={y + 18 * (1 - appear)} opacity={appear} scale={scale * mix(0.7, 1, appear)}>
      <Rect x={-w / 2} y={-26} width={w} height={52} cornerRadius={26} fill="#0A0B14D8"
        stroke={color} strokeWidth={3} />
      <Rect x={-w / 2 + 14} y={-6} width={12} height={12} cornerRadius={6} fill={color} />
      <T x={-w / 2 + 36} y={0} ay={0.5} size={28} weight={700}>{name}</T>
      <T x={0} y={44} ax={0.5} ay={0.5} size={15} font={F.mono} color={color}>{RANK_NAMES[rank % 4].toUpperCase()}</T>
    </Group>
  );
}

// ------------------------------------------------------------------ HUD

const STATUS = [
  { at: 0, label: 'OFFLINE', color: '#8A8D99' },
  { at: 300, label: 'ONLINE', color: C.green },
  { at: 360, label: 'JOIN ME', color: C.blue },
  { at: 1890, label: 'OFFLINE', color: '#8A8D99' },
];

function Hud() {
  const f = useCurrentFrame();
  if (f >= 1920) return null;
  const st = [...STATUS].reverse().find((s) => f >= s.at)!;
  const minutes = 22 * 60 + 47 + Math.floor(f * 196 / 1890);
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const blink = f % 30 < 22 || st.label !== 'OFFLINE';
  return (
    <Group opacity={progress(f, 4, 20)}>
      <Rect x={56} y={38} width={190} height={40} cornerRadius={20} fill="#0A0B14B0" />
      <Rect x={72} y={52} width={12} height={12} cornerRadius={6} fill={st.color} opacity={blink ? 1 : 0.3} />
      <T x={94} y={58} ay={0.5} size={17} font={F.mono} color={C.white} spacing={2}>{st.label}</T>
      <Rect x={1744} y={38} width={120} height={40} cornerRadius={20} fill="#0A0B14B0" />
      <T x={1804} y={58} ax={0.5} ay={0.5} size={20} font={F.mono} color={C.white} spacing={1}>{clock}</T>
    </Group>
  );
}

// ------------------------------------------------------------------ 1. cold open

function ColdOpen() {
  const f = useCurrentFrame();
  const typed = useTypewriter('帰りの電車。', { from: 8, framesPerChar: 3 });
  const bar = 140 * (1 - progress(f, 196, 34, Easings.easeInCubic));
  const push = mix(1.0, 1.06, f / 240);
  return (
    <>
      <Rect width={W} height={H} fill="#000000" />
      <Zoom s={push}>
        <Sequence from={40} durationInFrames={80}><Video src={clip('commute')} playbackRate={0.7} /></Sequence>
        <Sequence from={120} durationInFrames={60}><Video src={clip('phone')} /></Sequence>
        <Sequence from={180} durationInFrames={60}><Video src={clip('flash')} startFrom={0.35} /></Sequence>
      </Zoom>
      <Rect width={W} height={bar} fill="#000000" />
      <Rect y={H - bar} width={W} height={bar} fill="#000000" />

      {f < 40 && <>
        <T x={W / 2} y={H / 2} ax={0.5} ay={0.5} size={40} font={F.jp} weight={500} color="#B9BCC8"
          spacing={8}>{typed.text}</T>
        <Rect x={W / 2 - 120} y={H / 2 + 52} width={240 * progress(f, 4, 30, Easings.easeOutCubic)} height={1}
          fill="#B9BCC8" opacity={0.5} />
      </>}

      <T x={W / 2} y={H - 70} ax={0.5} ay={0.5} size={38} weight={500} color="#E6E6E6" spacing={4}
        opacity={progress(f, 50, 10) * (1 - progress(f, 112, 6))}>
        今日も、ちゃんと「ふつう」をやった。
      </T>
      <T x={W / 2} y={H - 70} ax={0.5} ay={0.5} size={38} weight={500} color="#E6E6E6" spacing={4}
        opacity={progress(f, 128, 8) * (1 - progress(f, 176, 4))}>
        だから、ここからは ──
      </T>
      <T x={W / 2} y={70} ax={0.5} ay={0.5} size={18} font={F.mono} color="#FFFFFF" spacing={6}
        opacity={progress(f, 192, 6) * (1 - progress(f, 222, 8))}>
        CONNECTING …
      </T>
      <Rect width={W} height={H} fill={C.white} opacity={progress(f, 222, 18, Easings.easeInQuad)} />
    </>
  );
}

// ------------------------------------------------------------------ 2. log in

function SpeedLines({ f, strength }: { f: number; strength: number }) {
  const lines = [];
  for (let i = 0; i < 70; i++) {
    const a = random(`sl-a-${i}`) * Math.PI * 2;
    const speed = 0.6 + random(`sl-s-${i}`) * 1.4;
    const d = (((random(`sl-d-${i}`) + Math.max(0, f) * 0.012 * speed * (1 + 3 * strength)) % 1) + 1) % 1;
    const r0 = 120 + d * d * 1300;
    const len = (30 + 220 * d) * (0.4 + strength);
    lines.push(
      <Line key={i} x1={960 + Math.cos(a) * r0} y1={540 + Math.sin(a) * r0}
        x2={960 + Math.cos(a) * (r0 + len)} y2={540 + Math.sin(a) * (r0 + len)}
        stroke={i % 5 === 0 ? '#9CC4FF' : '#FFFFFF'} strokeWidth={1.5 + d * 2} opacity={d * 0.8} />,
    );
  }
  return <>{lines}</>;
}

function Login() {
  const f = useCurrentFrame();
  const open = progress(f, 2, 40, Easings.easeOutExpo);
  const burst = progress(f, 92, 24, Easings.easeInExpo);
  const r = mix(0, 290, open) + burst * 1400;
  const pct = Math.round(interpolate(f, [8, 50, 78, 96], [0, 64, 71, 100], CL));
  const uiOut = 1 - progress(f, 94, 10);
  const dots = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const lit = ((i - f * 0.9) % 36 + 36) % 36;
    const glow = clamp(1 - lit / 10);
    dots.push(
      <Rect key={i} x={960 + Math.cos(a) * (r + 46)} y={540 + Math.sin(a) * (r + 46)} anchorX={0.5} anchorY={0.5}
        width={8} height={8} cornerRadius={4} fill={glow > 0.5 ? C.white : '#5D7CB8'} opacity={(0.25 + glow * 0.75) * uiOut} />,
    );
  }
  return (
    <>
      <Rect width={W} height={H} fill={{
        type: 'radial', center: { x: 960, y: 540 }, radius: 1100,
        stops: [{ offset: 0, color: '#1B2A5C' }, { offset: 0.55, color: '#0B0F26' }, { offset: 1, color: '#04050C' }],
      }} />
      <SpeedLines f={f} strength={progress(f, 60, 50, Easings.easeInCubic)} />
      <Group clip={{ x: 960 - r, y: 540 - r, width: r * 2, height: r * 2, cornerRadius: r }}>
        <Window src={clip('portal')} video w={W} h={H} cx={1470} cy={330} s={1.15} />
        {f >= 86 && <Sequence from={86}><Video src={clip('warp')} /></Sequence>}
      </Group>
      <Rect x={960} y={540} anchorX={0.5} anchorY={0.5} width={2 * r + 20} height={2 * r + 20}
        cornerRadius={r + 10} stroke="#FFFFFFCC" strokeWidth={3} opacity={uiOut} />
      {dots}

      <Group opacity={uiOut * progress(f, 10, 14)}>
        <T x={960} y={118} ax={0.5} ay={0.5} size={18} font={F.mono} color="#9FB3E6" spacing={8}>JOINING WORLD</T>
        <T x={960} y={1080 - 172} ax={0.5} ay={0.5} size={84} font={F.latin} weight={700} spacing={-1}>Home</T>
        <T x={960} y={1080 - 112} ax={0.5} ay={0.5} size={22} font={F.mono} color="#9FB3E6" spacing={2}>
          by You · Friends+ · JP · #0247
        </T>
        <Rect x={660} y={1080 - 70} width={600} height={4} cornerRadius={2} fill="#FFFFFF30" />
        <Rect x={660} y={1080 - 70} width={6 * pct} height={4} cornerRadius={2} fill={C.white} />
        <T x={1280} y={1080 - 68} ay={0.5} size={18} font={F.mono} color="#FFFFFF">{`${pct}%`}</T>
      </Group>
      <Rect width={W} height={H} fill={C.white} opacity={1 - progress(f, 0, 14, Easings.easeOutQuad)} />
      <Rect width={W} height={H} fill={C.white} opacity={progress(f, 108, 12, Easings.easeInQuad)} />
    </>
  );
}

// ------------------------------------------------------------------ 3. manifesto

type Layout = 'hero' | 'vertical' | 'strips' | 'window' | 'tiles' | 'welcome';
const SLOTS: { clip: string; word: string; layout: Layout; rate?: number }[] = [
  { clip: 'burst', word: 'ただいま。', layout: 'hero' },
  { clip: 'bridge', word: 'どこへでも', layout: 'vertical', rate: 0.9 },
  { clip: 'island', word: '行ける。', layout: 'strips' },
  { clip: 'hamsters', word: 'なんにでも', layout: 'window' },
  { clip: 'horse', word: 'なれる。', layout: 'hero', rate: 0.9 },
  { clip: 'bar', word: 'だれとでも', layout: 'vertical' },
  { clip: 'dance', word: '会える。', layout: 'strips' },
  { clip: 'club', word: 'ことばが', layout: 'tiles' },
  { clip: 'painter', word: 'ちがっても、', layout: 'window' },
  { clip: 'kitchen', word: '時差が', layout: 'vertical', rate: 0.92 },
  { clip: 'street', word: 'あっても、', layout: 'hero' },
  { clip: 'grid', word: 'ここでは', layout: 'strips' },
  { clip: 'dancer', word: 'みんな', layout: 'window' },
  { clip: 'geese', word: 'おなじ夜に', layout: 'vertical' },
  { clip: 'stars', word: 'いる。', layout: 'hero' },
  { clip: 'pool', word: 'WELCOME HOME.', layout: 'welcome' },
];

function Slot({ i }: { i: number }) {
  const f = useCurrentFrame();
  const { clip: name, word, layout, rate } = SLOTS[i];
  const color = RANKS[(i + Math.floor(i / 4)) % 4];
  const inE = progress(f, 0, 10, Easings.easeOutExpo);
  const full = <Video src={clip(name)} playbackRate={rate} />;
  const n = Array.from(word).length;

  if (layout === 'hero') {
    const size = i === 0 ? 250 : 230;
    const tw = n * size;
    return (
      <>
        <Zoom s={mix(1.12, 1.0, progress(f, 0, 30, Easings.easeOutCubic))}>{full}</Zoom>
        <Shade from={0.2} to={0.55} top={0.4} />
        <Rect x={960 - tw / 2} y={540 + size * 0.62} width={tw * inE} height={18} fill={color} />
        <T x={960} y={540} ax={0.5} ay={0.5} size={size} font={F.display} scale={mix(1.25, 1, inE)} shadow>
          {word}
        </T>
      </>
    );
  }
  if (layout === 'vertical') {
    const panel = 560;
    const px = W - panel * inE;
    return (
      <>
        <Zoom s={1.04} dx={-panel / 2 * inE}>{full}</Zoom>
        <Rect x={px} width={panel + 10} height={H} fill={color} />
        <Rect x={px - 10} width={10} height={H} fill={C.paper} />
        <VText x={px + panel / 2} y={140 + 30 * (1 - inE)} size={Math.min(150, 820 / n)} color={C.white}>{word}</VText>
        <T x={px + 36} y={H - 64} size={16} font={F.mono} color="#FFFFFFB0" spacing={4} rotation={-90}>
          {`${String(i + 1).padStart(2, '0')} / 16`}
        </T>
      </>
    );
  }
  if (layout === 'strips') {
    const strips = [];
    for (let k = 0; k < 6; k++) {
      const dir = k % 2 ? 1 : -1;
      const off = dir * 420 * (1 - progress(f, k, 12, Easings.easeOutExpo));
      strips.push(
        <Group key={k} clip={{ y: k * 180, width: W, height: 180 }}>
          <Group x={off}>{full}</Group>
        </Group>,
      );
    }
    return (
      <>
        <Rect width={W} height={H} fill={C.ink} />
        {strips}
        <Rect x={0} y={H - 300} width={W * inE} height={300} fill={color} opacity={0.88} />
        <T x={110} y={H - 150} ay={0.5} size={200} font={F.display} color={C.white}
          opacity={progress(f, 3, 6)}>{word}</T>
      </>
    );
  }
  if (layout === 'window') {
    const rot = mix(-6, -2, inE);
    return (
      <>
        <Rect width={W} height={H} fill={C.paper} />
        {Array.from({ length: 12 }, (_, k) => (
          <Rect key={k} x={-200 + k * 200 + (f * 3) % 200} y={0} width={60} height={H} fill="#0000000A" rotation={20} />
        ))}
        <Group x={720} y={540 + 80 * (1 - inE)} rotation={rot} opacity={inE}>
          <Rect x={-570} y={-345} width={1140} height={690} cornerRadius={34} fill={C.ink} />
          <Window src={clip(name)} video rate={rate} w={1100} h={620} cx={960} cy={540} s={0.62} x={-550} y={-325} radius={22} />
          <Rect x={-550} y={-325} width={1100} height={620} cornerRadius={22} stroke={color} strokeWidth={6} />
        </Group>
        <VText x={1640} y={150 + 40 * (1 - inE)} size={Math.min(170, 820 / n)} color={C.ink}>{word}</VText>
        <Rect x={1530} y={130} width={8} height={240 * inE} fill={color} />
      </>
    );
  }
  if (layout === 'tiles') {
    return (
      <>
        <Rect width={W} height={H} fill={C.ink} />
        {Array.from({ length: 9 }, (_, k) => {
          const p = progress(f, k * 1.2, 8, Easings.easeOutBack);
          return (
            <Group key={k} x={(k % 3) * 640 + 320} y={Math.floor(k / 3) * 360 + 180} scale={p * 0.96}>
              <Group x={-320} y={-180} clip={{ width: 640, height: 360, cornerRadius: 10 }}>
                <Video src={clip(`${name}-small`)} startFrom={k * 0.1} />
              </Group>
            </Group>
          );
        })}
        <Rect x={960} y={540} anchorX={0.5} anchorY={0.5} width={n * 200 + 120} height={260} fill={color}
          scaleX={inE} />
        <T x={960} y={540} ax={0.5} ay={0.5} size={200} font={F.display} color={C.white}
          opacity={progress(f, 4, 4)}>{word}</T>
      </>
    );
  }
  // welcome
  return (
    <>
      <Zoom s={mix(1.0, 1.08, f / 30)}>{full}</Zoom>
      <Rect width={W} height={H} fill="#0B0D1A" opacity={0.4} />
      <Group clip={{ x: 0, y: 440, width: W, height: 200 }}>
        <T x={960} y={540 + 190 * (1 - progress(f, 0, 12, Easings.easeOutExpo))} ax={0.5} ay={0.5}
          size={170} font={F.latin} weight={700} spacing={6}>{word}</T>
      </Group>
      <T x={960} y={700} ax={0.5} ay={0.5} size={40} weight={700} spacing={18} opacity={progress(f, 12, 8)}>
        おかえり。
      </T>
      {RANKS.map((c, k) => (
        <Rect key={c} x={660 + k * 150} y={770} width={140 * progress(f, 14 + k, 8, Easings.easeOutExpo)} height={8} fill={c} />
      ))}
    </>
  );
}

function Manifesto() {
  const f = useCurrentFrame();
  return (
    <>
      {SLOTS.map((_, i) => (
        <Sequence key={i} from={i * 2 * BEAT} durationInFrames={2 * BEAT}><Slot i={i} /></Sequence>
      ))}
      {SLOTS.map((_, i) => <Flash key={i} f={f} at={i * 2 * BEAT} len={5} peak={i === 0 ? 1 : 0.45} />)}
    </>
  );
}

// ------------------------------------------------------------------ 4. avatars

type Card = { name: string; rank: number; src: string; video?: boolean; cx: number; cy: number; s: number };
const CARDS: Card[] = [
  { name: 'みかん', rank: 2, src: photo('steam-1.jpg'), cx: 450, cy: 560, s: 0.78 },
  { name: 'Gekko', rank: 1, src: photo('steam-1.jpg'), cx: 1170, cy: 600, s: 0.72 },
  { name: 'ハム太郎2号', rank: 0, src: clip('hamsters-small'), video: true, cx: 330, cy: 190, s: 1.75 },
  { name: 'Cirno_P', rank: 3, src: photo('steam-3.jpg'), cx: 1080, cy: 760, s: 0.88 },
  { name: 'ZERO-G', rank: 1, src: photo('steam-4.jpg'), cx: 790, cy: 520, s: 0.62 },
  { name: 'こんこん', rank: 2, src: photo('site-bewhoever.webp'), cx: 1170, cy: 330, s: 0.78 },
  { name: 'Ballroom', rank: 0, src: clip('dancer-small'), video: true, cx: 300, cy: 190, s: 1.7 },
  { name: 'Kuro', rank: 3, src: photo('site-worlds.webp'), cx: 880, cy: 520, s: 0.62 },
  { name: 'YAMI crew', rank: 2, src: photo('steam-5.jpg'), cx: 640, cy: 760, s: 0.62 },
  { name: 'えんじゅ', rank: 1, src: photo('steam-1.jpg'), cx: 1360, cy: 640, s: 0.8 },
  { name: 'Sakura', rank: 3, src: photo('site-bewhoever.webp'), cx: 520, cy: 620, s: 0.7 },
];

function AvatarCard({ card, index, pos, f }: { card: Card; index: number; pos: number; f: number }) {
  const d = index - pos;
  const focus = clamp(1 - Math.abs(d));
  const fly = 1 - progress(f, index * 1.5, 18, Easings.easeOutExpo);
  const cx = 960 + d * 450 + fly * 900;
  const s = mix(0.86, 1.08, focus);
  const color = RANKS[card.rank];
  return (
    <Group x={cx} y={650 + mix(26, 0, focus)} scale={s} opacity={mix(0.5, 1, focus) * (1 - fly * 0.8)}>
      <Rect x={-212} y={-312} width={424} height={624} cornerRadius={30} fill={C.ink} />
      <Window src={card.src} video={card.video} w={400} h={600} cx={card.cx} cy={card.cy} s={card.s} x={-200} y={-300} radius={22} />
      <Rect x={-200} y={60} width={400} height={240} fill={{
        type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 240 },
        stops: [{ offset: 0, color: '#07080F00' }, { offset: 1, color: '#07080FE8' }],
      }} />
      <T x={-170} y={226} ay={0.5} size={40} weight={900}>{card.name}</T>
      <Rect x={-170} y={258} width={150} height={26} cornerRadius={13} fill={color} />
      <T x={-95} y={271} ax={0.5} ay={0.5} size={14} font={F.mono} color={C.ink}>{RANK_NAMES[card.rank].toUpperCase()}</T>
      <Rect x={-212} y={-312} width={424} height={624} cornerRadius={30} stroke={color} strokeWidth={6} opacity={focus} />
    </Group>
  );
}

function Avatars() {
  const f = useCurrentFrame();
  // snap to the next card every two beats
  const step = Math.floor((f - 24) / 30);
  const within = (f - 24) - step * 30;
  const pos = f < 24 ? 0 : clamp(step + progress(within, 0, 14, Easings.easeInOutCubic), 0, CARDS.length - 1);
  const sel = Math.round(pos);
  const out = progress(f, 240, 24, Easings.easeInCubic);
  const grid = [];
  for (let x = 0; x <= W; x += 96) grid.push(<Rect key={`x${x}`} x={x} width={1} height={H} fill="#FFFFFF0C" />);
  for (let y = 0; y <= H; y += 96) grid.push(<Rect key={`y${y}`} y={y} width={W} height={1} fill="#FFFFFF0C" />);
  return (
    <>
      <Rect width={W} height={H} fill={{
        type: 'linear', start: { x: 0, y: 0 }, end: { x: W, y: H },
        stops: [{ offset: 0, color: '#141833' }, { offset: 1, color: '#07080F' }],
      }} />
      <Group x={-(f * 0.6) % 96}>{grid}</Group>

      <Group opacity={1 - out} y={-60 * out}>
        <T x={120} y={150} size={20} font={F.mono} color="#9FB3E6" spacing={6}>
          {`AVATARS  ${String(sel + 1).padStart(2, '0')} / ${CARDS.length}`}
        </T>
        <Group clip={{ x: 110, y: 170, width: 1500, height: 100 }}>
          <T x={120} y={190 + 90 * (1 - progress(f, 4, 18, Easings.easeOutExpo))} size={76} weight={900}>
            見た目は、じぶんで決める。
          </T>
        </Group>
      </Group>

      <Group opacity={1 - out} y={120 * out}>
        {CARDS.map((card, i) => Math.abs(i - pos) < 3.2 &&
          <AvatarCard key={i} card={card} index={i} pos={pos} f={f} />)}
      </Group>

      <Rect width={W} height={H} fill={C.ink} opacity={out * 0.9} />
      <Group opacity={progress(f, 246, 10)} scale={mix(1.1, 1, progress(f, 246, 20, Easings.easeOutCubic))}
        x={960} y={540}>
        <T x={0} y={-40} ax={0.5} ay={0.5} size={150} font={F.display}>なりたい自分で、</T>
        <T x={0} y={130} ax={0.5} ay={0.5} size={150} font={F.display} color={C.orange}>いい。</T>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ 5. worlds (camera)

type View = { name: string; src: string; still?: string; video?: boolean };
const VIEWS: View[] = [
  { name: 'Abyssal Treehouse', src: photo('steam-1.jpg') },
  { name: 'Mini Golf Odyssey', src: clip('golf'), still: './assets/clips/golf-still.jpg', video: true },
  { name: 'Orbit Lounge', src: photo('steam-4.jpg') },
  { name: '竜の巣', src: photo('steam-6.jpg') },
  { name: '夜のピアノ室', src: clip('piano'), still: './assets/clips/piano-still.jpg', video: true },
  { name: 'Midnight Cinema', src: photo('steam-7.jpg') },
  { name: 'Tabletop Tavern', src: photo('steam-8.jpg') },
  { name: 'YAMI FUNHOUSE', src: photo('steam-5.jpg') },
  { name: 'オーロラ駅', src: clip('aurora'), still: './assets/clips/aurora-still.jpg', video: true },
  { name: 'Neon Rave', src: clip('party'), still: './assets/clips/party-still.jpg', video: true },
  { name: 'Campfire', src: photo('site-tribe.webp') },
];
const SHUTTERS = Array.from({ length: 10 }, (_, k) => 15 + k * 30);
const VF = { x: 210, y: 118, w: 1500, h: 844 };

function ViewLayer({ view, f, k }: { view: View; f: number; k: number }) {
  const drift = noise(`v${k}`, f / 40) * 30;
  const s = mix(1.04, 1.12, clamp(f / 40));
  return (
    <Zoom s={s} dx={drift}>
      {view.video ? <Video src={view.src} playbackRate={view.src.includes('piano') ? 0.6 : 1} /> : <Image src={view.src} />}
    </Zoom>
  );
}

function Polaroid({ view, k, t }: { view: View; k: number; t: number }) {
  const tx = 1560 + (random(`px${k}`) - 0.5) * 120;
  const ty = 870 + (random(`py${k}`) - 0.5) * 60;
  const rot = (random(`pr${k}`) - 0.5) * 24;
  const e = Easings.easeOutCubic(t);
  const s = mix(0.72, 0.17, e);
  const src = view.still ?? view.src;
  const isSmall = !!view.still;
  return (
    <Group x={mix(960, tx, e)} y={mix(540, ty, e)} rotation={mix(0, rot, e)} scale={s}
      shadow={{ color: '#00000080', blur: 20, offsetX: 0, offsetY: 10 }}>
      <Rect x={-1000} y={-600} width={2000} height={1240} fill={C.paper} />
      <Group x={-960} y={-540} scale={isSmall ? 3 : 1}><Image src={src} /></Group>
      <T x={-960} y={590} ay={0.5} size={56} font={F.dot} color="#333333">{view.name}</T>
    </Group>
  );
}

function Worlds() {
  const f = useCurrentFrame();
  const shot = SHUTTERS.filter((s) => f >= s).length;
  const viewStart = shot === 0 ? 0 : SHUTTERS[shot - 1];
  const view = VIEWS[shot];
  const since = f - viewStart;
  const kick = shot > 0 ? 1 - progress(since, 0, 8, Easings.easeOutCubic) : 0;
  const dim = '#000000A0';
  return (
    <>
      <Sequence key={shot} from={viewStart}><ViewLayer view={view} f={since} k={shot} /></Sequence>

      <Rect width={W} height={VF.y} fill={dim} />
      <Rect y={VF.y + VF.h} width={W} height={H - VF.y - VF.h} fill={dim} />
      <Rect y={VF.y} width={VF.x} height={VF.h} fill={dim} />
      <Rect x={VF.x + VF.w} y={VF.y} width={W - VF.x - VF.w} height={VF.h} fill={dim} />

      <Group x={960} y={540} scale={1 - kick * 0.025}>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => (
          <Group key={i} x={sx * (VF.w / 2 - 10)} y={sy * (VF.h / 2 - 10)}>
            <Rect x={sx > 0 ? -70 : 0} y={sy > 0 ? -4 : 0} width={70} height={4} fill={C.white} />
            <Rect x={sx > 0 ? -4 : 0} y={sy > 0 ? -70 : 0} width={4} height={70} fill={C.white} />
          </Group>
        ))}
        <Rect x={-30} y={-1} width={60} height={2} fill="#FFFFFFB0" />
        <Rect x={-1} y={-30} width={2} height={60} fill="#FFFFFFB0" />
        <Rect x={-110} y={-70} width={220} height={140} stroke={kick > 0.1 ? C.green : '#FFFFFF80'} strokeWidth={2} />
      </Group>

      <Rect x={VF.x + 34} y={VF.y + 34} width={14} height={14} cornerRadius={7} fill="#FF4040" opacity={f % 30 < 18 ? 1 : 0.3} />
      <T x={VF.x + 60} y={VF.y + 41} ay={0.5} size={18} font={F.mono} spacing={3}>PHOTO</T>
      <T x={VF.x + VF.w - 34} y={VF.y + 41} ax={1} ay={0.5} size={18} font={F.mono} spacing={2}>
        {`35mm  f/2.8  1/60  ${String(Math.min(shot, 10)).padStart(2, '0')}/10`}
      </T>
      <T x={VF.x + 34} y={VF.y + VF.h - 70} size={14} font={F.mono} color="#FFFFFFA0" spacing={4}>WORLD</T>
      <T x={VF.x + 34} y={VF.y + VF.h - 34} ay={0.5} size={40} weight={700} shadow>{view.name}</T>

      <T x={960} y={62} ax={0.5} ay={0.5} size={40} weight={700} opacity={progress(f, 6, 12)}>
        ワールドは、ぜんぶ だれかの手づくり。
      </T>
      <T x={960} y={1024} ax={0.5} ay={0.5} size={17} font={F.mono} color="#FFFFFFA0" spacing={8}
        opacity={progress(f, 14, 12)}>
        EVERY WORLD IS MADE BY SOMEONE
      </T>

      {SHUTTERS.map((s, k) => f >= s && (
        <Polaroid key={k} view={VIEWS[k]} k={k} t={progress(f, s + 2, 16)} />
      ))}
      {SHUTTERS.map((s) => <Flash key={s} f={f} at={s} len={7} peak={0.85} />)}
    </>
  );
}

// ------------------------------------------------------------------ 6. friends

const CAMPFIRE = [
  { name: 'ももいろ', rank: 2, x: 330, y: 120 },
  { name: 'Kaito_guitar', rank: 3, x: 560, y: 215 },
  { name: 'BOLT-07', rank: 1, x: 960, y: 140 },
  { name: 'あかね', rank: 0, x: 1070, y: 390 },
  { name: 'midori', rank: 2, x: 1310, y: 130 },
];

function Friends() {
  const f = useCurrentFrame();
  const a = f < 120;
  if (a) {
    return (
      <>
        <Zoom s={mix(1.0, 1.1, f / 120)} dx={-20 * f / 120}>
          <Image src={photo('site-tribe.webp')} />
          {CAMPFIRE.map((n, i) => (
            <Nameplate key={n.name} {...n} appear={progress(f, 14 + i * 7, 12, Easings.easeOutBack)} />
          ))}
        </Zoom>
        <Shade from={0} to={0.75} top={0.55} />
        <Group clip={{ x: 110, y: 860, width: 1200, height: 130 }}>
          <T x={120} y={930 + 110 * (1 - progress(f, 40, 20, Easings.easeOutExpo))} ay={0.5} size={84} weight={900} shadow>
            ひとりで来ても、
          </T>
        </Group>
        <Rect width={W} height={H} fill="#000000" opacity={1 - progress(f, 0, 10)} />
      </>
    );
  }
  const g = f - 120;
  const snap = progress(g, 0, 18, Easings.easeOutBack);
  return (
    <>
      <Rect width={W} height={H} fill={C.paper} />
      <Group x={960} y={490} rotation={mix(-5, -1.5, snap)} scale={mix(0.78, 0.82, snap) + g * 0.0004}>
        <Rect x={-1000} y={-580} width={2000} height={1250} fill={C.white} shadow={{ color: '#00000040', blur: 40, offsetX: 0, offsetY: 20 }} />
        <Group x={-960} y={-540}><Image src={photo('site-bewhoever.webp')} /></Group>
        <T x={-940} y={610} ay={0.5} size={50} font={F.dot} color="#333333">{`2026.10.03  01:${30 + Math.min(9, Math.floor(g / 12))}  Selfie`}</T>
      </Group>
      <Flash f={g} at={0} len={8} />
      <Group x={960} y={540}>
        <Rect x={-760} y={190} width={1520} height={250} cornerRadius={20} fill="#07080FE0"
          scaleX={progress(g, 10, 12, Easings.easeOutExpo)} />
        <T x={-700} y={260} ay={0.5} size={56} weight={700} opacity={progress(g, 14, 8)}>帰るときは、</T>
        <T x={-700} y={370} ay={0.5} size={110} font={F.display} color={C.orange}
          opacity={progress(g, 40, 6)} scale={mix(1.15, 1, progress(g, 40, 12, Easings.easeOutCubic))}>
          ひとりじゃない。
        </T>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ 7. flicker

const FLICKER = [
  { clip: 'spirit', word: '今夜も' },
  { clip: 'forest', word: '世界の' },
  { clip: 'snow', word: 'どこかで' },
  { clip: 'road', word: 'だれかが' },
  { clip: 'door', word: '「ただいま」' },
  { clip: 'hall', word: 'って' },
  { clip: 'tree', word: '言ってる。' },
  { clip: 'runway', word: 'おかえり。' },
];

function FlickerBeat({ i }: { i: number }) {
  const f = useCurrentFrame();
  const { clip: name, word } = FLICKER[i];
  const last = i === FLICKER.length - 1;
  const color = RANKS[i % 4];
  const n = Array.from(word).length;
  const e = progress(f, 0, 6, Easings.easeOutExpo);
  return (
    <>
      <Zoom s={mix(1.1, 1.0, progress(f, 0, 15))}>
        <Video src={clip(name)} playbackRate={name === 'runway' ? 1 : 0.84} />
      </Zoom>
      <Rect width={W} height={H} fill="#000000" opacity={0.25} />
      <Rect x={960} y={540} anchorX={0.5} anchorY={0.5} width={W} height={last ? 300 : 230} fill={color}
        opacity={0.9} scaleX={e} />
      <T x={960} y={540} ax={0.5} ay={0.5} size={last ? 210 : Math.min(170, 1500 / n)} font={F.display}
        scale={mix(1.2, 1, e)}>{word}</T>
    </>
  );
}

function Flicker() {
  const f = useCurrentFrame();
  return (
    <>
      {FLICKER.map((_, i) => (
        <Sequence key={i} from={i * BEAT} durationInFrames={BEAT}><FlickerBeat i={i} /></Sequence>
      ))}
      {FLICKER.map((_, i) => <Flash key={i} f={f} at={i * BEAT} len={4} peak={i === 0 ? 0.9 : 0.35} />)}
    </>
  );
}

// ------------------------------------------------------------------ 8. pier

function Pier() {
  const f = useCurrentFrame();
  const bar = 120 * progress(f, 0, 30, Easings.easeOutCubic);
  return (
    <>
      <Zoom s={mix(1.08, 1.0, f / 120)}><Video src={clip('pier')} playbackRate={0.55} /></Zoom>
      <Rect width={W} height={bar} fill="#000000" />
      <Rect y={H - bar} width={W} height={bar} fill="#000000" />
      <T x={960} y={H - 60} ax={0.5} ay={0.5} size={40} weight={500} spacing={10}
        opacity={progress(f, 12, 10) * (1 - progress(f, 54, 8))}>おやすみ。</T>
      <T x={960} y={H - 60} ax={0.5} ay={0.5} size={40} weight={500} spacing={10}
        opacity={progress(f, 64, 10) * (1 - progress(f, 108, 8))}>また、あした。</T>
      <Rect width={W} height={H} fill="#000000" opacity={progress(f, 100, 20, Easings.easeInQuad)} />
    </>
  );
}

// ------------------------------------------------------------------ 9. logo

function Logo() {
  const f = useCurrentFrame();
  const e = progress(f, 4, 26, Easings.easeOutBack);
  return (
    <>
      <Rect width={W} height={H} fill="#000000" />
      <Rect width={W} height={H} fill={{
        type: 'radial', center: { x: 960, y: 470 }, radius: 700,
        stops: [{ offset: 0, color: '#1B2550' }, { offset: 1, color: '#00000000' }],
      }} opacity={progress(f, 0, 30)} />
      <Group x={960} y={430} scale={mix(0.8, 1.35, e)} opacity={progress(f, 4, 10)}>
        <Image src={photo('vrc-logo.webp')} x={-258} y={-112} />
      </Group>
      {RANKS.map((c, k) => (
        <Rect key={c} x={660 + k * 150} y={650} width={140 * progress(f, 18 + k * 2, 14, Easings.easeOutExpo)} height={6} fill={c} />
      ))}
      <T x={960} y={730} ax={0.5} ay={0.5} size={46} weight={700} spacing={6} opacity={progress(f, 26, 14)}>
        あなたの、もうひとつの帰る場所。
      </T>
      <T x={960} y={1010} ax={0.5} ay={0.5} size={16} font={F.mono} color="#8A8D99" spacing={4} opacity={progress(f, 40, 14)}>
        UNOFFICIAL FAN-MADE PROMOTION VIDEO · MADE WITH CELESTA
      </T>
      <Rect width={W} height={H} fill="#000000" opacity={progress(f, 104, 16)} />
    </>
  );
}

// ------------------------------------------------------------------ root

const SCENES: { from: number; len: number; Scene: () => React.ReactElement }[] = [
  { from: 0, len: 240, Scene: ColdOpen },
  { from: 240, len: 120, Scene: Login },
  { from: 360, len: 480, Scene: Manifesto },
  { from: 840, len: 300, Scene: Avatars },
  { from: 1140, len: 300, Scene: Worlds },
  { from: 1440, len: 240, Scene: Friends },
  { from: 1680, len: 120, Scene: Flicker },
  { from: 1800, len: 120, Scene: Pier },
  { from: 1920, len: 120, Scene: Logo },
];

export default function Okaeri() {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={2040}>
      <Assets>
        <Font src="./assets/fonts/DelaGothicOne-Regular.ttf" />
        <Font src="./assets/fonts/ZenKakuGothicNew-Medium.ttf" />
        <Font src="./assets/fonts/ZenKakuGothicNew-Bold.ttf" />
        <Font src="./assets/fonts/ZenKakuGothicNew-Black.ttf" />
        <Font src="./assets/fonts/SpaceGrotesk.ttf" />
        <Font src="./assets/fonts/JetBrainsMono.ttf" />
        <Font src="./assets/fonts/DotGothic16-Regular.ttf" />
      </Assets>
      <Audio src="./assets/score.wav" />
      {SCENES.map(({ from, len, Scene }) => (
        <Sequence key={from} from={from} durationInFrames={len}><Scene /></Sequence>
      ))}
      <Hud />
    </Composition>
  );
}

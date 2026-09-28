import { Assets, Audio, Composition, Font, Group, Rect, Text, useCurrentFrame } from '@celesta/react';

// CELESTA / SIGNAL — an editorial motion piece, 16 seconds at 30 fps.
// Cuts are on the half-second grid of the 120 BPM score.
const W = 1920, H = 1080, END = 480;
const INK = '#0C0E10', BONE = '#EAEAE2', ACID = '#DEFA60', BLUE = '#3152DC';
const GREY = '#718088', TAU = Math.PI * 2;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function T({ children, x, y, size, color = BONE, mono = false, weight = 400,
  opacity = 1, anchorX = 0 }: {
  children: string; x: number; y: number; size: number; color?: string;
  mono?: boolean; weight?: number; opacity?: number; anchorX?: number;
}) {
  return <Text x={x} y={y} anchorX={anchorX} opacity={opacity} style={{
    fontFamily: mono ? 'IBM Plex Mono' : 'Helvetica Neue', fontSize: size,
    fontWeight: weight, fill: { type: 'solid', color },
  }}>{children}</Text>;
}

// The same evolving signal recurs in the source scene and final title.
function Signal({ frame, top, color, count = 96, amplitude = 150 }: {
  frame: number; top: number; color: string; count?: number; amplitude?: number;
}) {
  return <>{Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    const envelope = Math.sin(u * Math.PI) ** 2;
    const phase = u * 21 - frame * 0.14;
    const y = top + Math.sin(phase) * amplitude * envelope
      + Math.sin(phase * 0.49 + frame * 0.045) * amplitude * 0.26;
    const h = 20 + 140 * Math.abs(Math.sin(phase * 0.58)) * envelope;
    return <Rect key={i} x={72 + i * (1776 / (count - 1))} y={y - h / 2}
      width={i % 7 === 0 ? 8 : 4} height={h} fill={color}
      opacity={0.28 + 0.72 * envelope} />;
  })}</>;
}

// Equal-angle, unequal-length spokes make the form breathe rather than spin as a disc.
function Rotor({ frame, x, y, color, size = 1 }: {
  frame: number; x: number; y: number; color: string; size?: number;
}) {
  return <>{Array.from({ length: 72 }, (_, i) => {
    const a = i / 72 * TAU + frame * 0.019;
    const radius = size * (125 + 81 * Math.sin(i * 0.52 - frame * 0.12));
    const length = size * (110 + 90 * Math.sin(i * 0.27 + frame * 0.11) ** 2);
    return <Rect key={i} x={x + Math.cos(a) * radius}
      y={y + Math.sin(a) * radius} anchorY={0.5}
      rotation={a * 180 / Math.PI} width={length} height={i % 6 === 0 ? 7 : 2}
      fill={color} opacity={i % 6 === 0 ? 1 : 0.54} />;
  })}
    <Rect x={x} y={y} anchorX={0.5} anchorY={0.5}
      width={112 * size} height={112 * size} fill={color}
      rotation={-frame * 2.7} />
  </>;
}

function Counter({ f }: { f: number }) {
  const local = f;
  return <>
    <Rect width={W} height={H} fill={INK} />
    <T x={74} y={58} size={21} mono color={GREY}>CELESTA / FRAME 000</T>
    <T x={1555} y={58} size={21} mono color={GREY}>30 FPS / 16 S</T>
    <Rect x={72} y={153} width={1776} height={3} fill={BONE} />
    <T x={60} y={165} size={401} mono color={BONE}>
      {String(Math.min(f * 7, 9999)).padStart(4, '0')}
    </T>
    {Array.from({ length: 44 }, (_, i) => {
      const h = 110 + Math.abs(Math.sin(i * 0.4 + local * 0.14)) * 230;
      return <Rect key={i} x={72 + i * 40} y={750 - h / 2}
        width={i % 4 === 0 ? 14 : 6} height={h} fill={i % 4 === 0 ? ACID : GREY}
        opacity={ease((f - i * 0.4) / 24)} />;
    })}
    <Rect x={72} y={962} width={1776} height={2} fill={GREY} />
    <T x={74} y={982} size={23} mono color={ACID}>SOURCE → FRAME</T>
    <T x={1589} y={982} size={23} mono color={GREY}>00:{String(f).padStart(2, '0')}</T>
  </>;
}

function Source({ f }: { f: number }) {
  const local = f - 60;
  const enter = ease(local / 14);
  return <>
    <Rect width={W} height={H} fill={BONE} />
    <Rect x={0} y={0} width={W * (1 - enter)} height={H} fill={INK} />
    <T x={77} y={51} size={22} mono color={INK}>01 / THE SOURCE</T>
    <T x={1431} y={51} size={22} mono color={INK}>FILM.TSX ↗</T>
    <Rect x={75} y={121} width={1770} height={3} fill={INK} />
    <T x={67} y={186} size={131} mono color={INK} opacity={ease((local - 7) / 14)}>
      useCurrentFrame()
    </T>
    <T x={77} y={405} size={26} mono color={INK}>const f = useCurrentFrame();</T>
    <T x={77} y={448} size={26} mono color={BLUE}>
      {'y = Math.sin(f * 0.14 + i * 0.21) * amplitude;'}
    </T>
    <Rect x={74} y={535} width={1772} height={410} fill={INK} />
    <Signal frame={f} top={737} color={ACID} count={96} amplitude={110} />
    <T x={81} y={895} size={18} mono color={GREY}>RESULT / LIVE PREVIEW</T>
    <Rect x={74} y={978} width={1772} height={2} fill={INK} />
    <T x={77} y={995} size={19} mono color={INK}>EDIT THE VALUE. WATCH THE FRAME CHANGE.</T>
  </>;
}

function Kinetic({ f }: { f: number }) {
  const local = f < 210 ? f - 150 : f < 255 ? f - 210 : f - 255;
  const stage = f < 210 ? 0 : f < 255 ? 1 : 2;
  const bg = [INK, ACID, BLUE][stage], fg = [BONE, INK, BONE][stage];
  const accent = [ACID, BLUE, ACID][stage];
  const word = ['COMPOSE.', 'PREVIEW.', 'RENDER.'][stage];
  const slide = (1 - ease(local / 12)) * 530;
  return <>
    <Rect width={W} height={H} fill={bg} />
    <T x={75} y={63} size={23} mono color={fg}>
      {`0${stage + 2} / ${word.slice(0, -1)}`}
    </T>
    <Rect x={76} y={138} width={1770} height={3} fill={fg} />
    <Rotor frame={f} x={1441} y={562} color={accent} size={1.22} />
    <T x={72 - slide} y={335} size={183} color={fg} weight={700}>{word}</T>
    <T x={80} y={807} size={25} mono color={fg}>
      {stage === 0 ? '1920 × 1080 / 30 FPS' :
        stage === 1 ? 'NO WAITING FOR A RENDER TO SEE IT.' : 'H.264 + AAC / MP4'}
    </T>
    <Rect x={76} y={980} width={1770} height={2} fill={fg} />
    {Array.from({ length: 9 }, (_, i) => <Rect key={i}
      x={W - Math.max(0, 9 - i) * 244 + local * 80} y={0}
      width={24} height={H} fill={fg} opacity={0.8 * (1 - ease(local / 12))} />)}
  </>;
}

function Scrub({ f }: { f: number }) {
  const local = f - 300;
  const position = local < 45 ? local / 45 : local < 65 ? 1 - (local - 45) / 35
    : 0.43 + (local - 65) / 25 * 0.57;
  const playX = mix(87, 1823, clamp(position));
  return <>
    <Rect width={W} height={H} fill={INK} />
    <T x={69} y={91} size={160} color={BONE} weight={700}>EVERY FRAME.</T>
    <T x={78} y={303} size={21} mono color={GREY}>THE TIMELINE / SCRUB FORWARD, THEN BACK.</T>
    {[0, 1].map(row => <Rect key={row} x={75} y={395 + row * 239}
      width={1771} height={209} fill={row ? '#25292A' : '#1B2020'} />)}
    {Array.from({ length: 16 }, (_, i) => {
      const x = 84 + i * 109;
      return <Group key={i}>
        <Rect x={x} y={407} width={103} height={185}
          fill={i % 4 === 0 ? ACID : i % 4 === 1 ? '#ADB6AE' : '#465B59'} />
        <Rect x={x + 51} y={505} anchorX={0.5} anchorY={0.5}
          width={20 + i * 2.4} height={20 + i * 2.4} fill={INK}
          rotation={i * 17 + f * 0.2} />
        <Rect x={x} y={646 + (i % 3) * 8}
          width={103} height={110 - (i % 3) * 15} fill={i % 2 ? BLUE : ACID} />
      </Group>;
    })}
    <Rect x={playX} y={350} width={5} height={524} fill={BONE} />
    <Rect x={playX - 13} y={344} width={31} height={25} fill={BONE} />
    <T x={77} y={887} size={40} mono color={ACID}>
      {`FRAME ${String(Math.floor(clamp(position) * 479)).padStart(3, '0')}`}
    </T>
    <T x={1546} y={908} size={22} mono color={GREY}>← 30 FPS →</T>
    <Rect x={76} y={1000} width={1770} height={2} fill={GREY} />
  </>;
}

function Title({ f }: { f: number }) {
  const local = f - 390;
  const reveal = ease(local / 18);
  const fade = clamp((f - 466) / 14);
  return <>
    <Rect width={W} height={H} fill={ACID} />
    <Rect x={0} y={0} width={W * (1 - reveal)} height={H} fill={INK} />
    <T x={75} y={75} size={23} mono color={INK}>CODE / MOTION / FILM</T>
    <T x={61} y={290} size={258} color={INK} weight={700} opacity={ease((local - 6) / 15)}>
      CELESTA
    </T>
    <Rect x={75} y={650} width={1770 * ease((local - 16) / 27)} height={12} fill={INK} />
    <T x={79} y={721} size={37} mono color={INK}
      opacity={ease((local - 25) / 15)}>A CODE-FIRST VIDEO TOOL.</T>
    <Signal frame={f} top={925} color={INK} count={92} amplitude={44} />
    <Rect width={W} height={H} fill={INK} opacity={fade} />
  </>;
}

function Film() {
  const f = useCurrentFrame();
  return <>
    {f < 60 ? <Counter f={f} /> : f < 150 ? <Source f={f} /> :
      f < 300 ? <Kinetic f={f} /> : f < 390 ? <Scrub f={f} /> : <Title f={f} />}
    {[60, 150, 210, 255, 300, 390].includes(f) &&
      <Rect width={W} height={H} fill={BONE} opacity={0.48} />}
  </>;
}

export default function CelestaSignal() {
  return <Composition width={W} height={H} fps={30} durationInFrames={END}>
    <Assets><Font src="../afterimage/assets/fonts/IBMPlexMono-Regular.ttf" /></Assets>
    <Audio src="./assets/score.wav" />
    <Film />
  </Composition>;
}

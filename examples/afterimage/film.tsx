import {
  Assets, Audio, Composition, Font, Group, Rect, Text, useCurrentFrame,
} from '@celesta/react';

// AFTERIMAGE — a 24-second optical study. All cuts sit on a 120 BPM grid.
const W = 1920;
const H = 1080;
const INK = '#171716';
const PAPER = '#EAE5D9';
const RED = '#EF402B';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - Math.pow(1 - clamp(n), 4);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function Type({ children, x = 0, y = 0, size = 100, color = PAPER,
  mono = false, center = false, opacity = 1, scaleX = 1,
}: { children: string; x?: number; y?: number; size?: number; color?: string;
  mono?: boolean; center?: boolean; opacity?: number; scaleX?: number }) {
  return <Text x={x} y={y} anchorX={center ? 0.5 : 0} anchorY={center ? 0.5 : 0}
    opacity={opacity} scaleX={scaleX} style={{
      fontFamily: mono ? 'IBM Plex Mono' : 'Bebas Neue', fontSize: size,
      fill: { type: 'solid', color },
    }}>{children}</Text>;
}

function Line({ a, b, color, width = 2, opacity = 1 }: {
  a: number[]; b: number[]; color: string; width?: number; opacity?: number;
}) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return <Rect x={a[0]} y={a[1]} width={Math.hypot(dx, dy) + 0.7} height={width}
    anchorY={0.5} rotation={Math.atan2(dy, dx) * 180 / Math.PI}
    fill={color} opacity={opacity} />;
}

// A half-twist ribbon, projected from 3D. Each strand runs twice around
// the surface, closing without a seam. Depth controls ink density.
function Ribbon({ time, x = 960, y = 540, size = 350, color = RED,
  turn = 0, opacity = 1, strands = 13 }: {
  time: number; x?: number; y?: number; size?: number; color?: string;
  turn?: number; opacity?: number; strands?: number;
}) {
  const yaw = time * 0.23 + turn;
  const pitch = 0.85 + Math.sin(time * 0.19) * 0.35;
  const project = (u: number, v: number) => {
    const radius = 1 + v * Math.cos(u / 2);
    const px = radius * Math.cos(u), py = radius * Math.sin(u), pz = v * Math.sin(u / 2);
    const xx = px * Math.cos(yaw) + pz * Math.sin(yaw);
    const zz = -px * Math.sin(yaw) + pz * Math.cos(yaw);
    const yy = py * Math.cos(pitch) - zz * Math.sin(pitch);
    const depth = py * Math.sin(pitch) + zz * Math.cos(pitch);
    const perspective = 3.6 / (3.6 - depth);
    return [x + size * xx * perspective, y + size * yy * perspective, depth];
  };
  const segments = [];
  for (let strand = 0; strand < strands; strand++) {
    const v = 0.035 + strand / (strands - 1) * 0.47;
    for (let i = 0; i < 112; i++) {
      const a = project(i / 112 * Math.PI * 4, v);
      const b = project((i + 1) / 112 * Math.PI * 4, v);
      segments.push({ a, b, depth: (a[2] + b[2]) / 2, key: `${strand}-${i}` });
    }
  }
  segments.sort((a, b) => a.depth - b.depth);
  return <Group opacity={opacity}>{segments.map(s => <Line key={s.key}
    a={s.a} b={s.b} width={1.5 + clamp((s.depth + 1) / 2) * 0.8}
    color={color} opacity={0.25 + clamp((s.depth + 1.4) / 2.8) * 0.75} />)}</Group>;
}

function Margin({ frame, color = INK, label = 'AN OPTICAL STUDY' }: {
  frame: number; color?: string; label?: string;
}) {
  return <>
    <Type x={72} y={53} size={19} mono color={color}>AFTERIMAGE / 01</Type>
    <Type x={1480} y={53} size={19} mono color={color}>{label}</Type>
    <Rect x={72} y={998} width={1776} height={1} fill={color} opacity={0.4} />
    <Type x={72} y={1022} size={17} mono color={color}>LIGHT / FORM / MEMORY</Type>
    <Type x={1645} y={1022} size={17} mono color={color}>{`00:${String(Math.floor(frame / 30)).padStart(2, '0')} / 00:24`}</Type>
  </>;
}

function Film() {
  const f = useCurrentFrame();
  const t = f / 30;
  const intro = f < 60;
  const title = f >= 60 && f < 180;
  const study = f >= 180 && f < 300;
  const impact = f >= 300 && f < 420;
  const echo = f >= 420 && f < 570;
  const outro = f >= 570;
  const bg = title || echo ? PAPER : impact ? RED : INK;
  return <>
    <Rect width={W} height={H} fill={bg} />

    {intro && <>
      <Ribbon time={t} size={330} opacity={ease(f / 45)} />
      <Rect width={mix(960, 0, ease((f - 12) / 44))} height={H} fill={INK} />
      <Rect x={mix(960, 1920, ease((f - 12) / 44))} width={960} height={H} fill={INK} />
      <Type x={960} y={896} size={19} mono center opacity={ease((f - 12) / 20)}>SOME THINGS STAY.</Type>
      <Rect x={959} y={mix(540, 400, ease(f / 30))} width={2} height={mix(0, 280, ease(f / 30))}
        fill={PAPER} opacity={1 - ease((f - 25) / 30)} />
    </>}

    {title && <>
      <Ribbon time={t} x={1370} y={510} size={420} turn={0.5} />
      <Type x={65 - 110 * (1 - ease((f - 60) / 22))} y={180} size={435} color={INK}>AFTER</Type>
      <Type x={510 + 280 * (1 - ease((f - 68) / 25))} y={560} size={435} color={INK}>IMAGE</Type>
      <Rect x={72} y={560} width={340 * ease((f - 78) / 28)} height={8} fill={RED} />
      <Type x={78} y={618} size={20} mono color={INK}>THE SHAPE OF</Type>
      <Type x={78} y={648} size={20} mono color={INK}>WHAT REMAINS.</Type>
      <Margin frame={f} />
      <Rect x={0} y={H * ease((f - 60) / 14)} width={W} height={H * (1 - ease((f - 60) / 14))} fill={INK} />
    </>}

    {study && <>
      <Ribbon time={t} x={1270} y={540} size={430} color={PAPER} turn={0.3} />
      {['LIGHT', 'LEAVES', 'A MARK.'].map((word, i) => <Group key={word}
        opacity={ease((f - 180 - i * 9) / 10)} x={-55 * (1 - ease((f - 180 - i * 9) / 18))}>
        <Type x={76} y={206 + i * 222} size={255} color={i === 2 ? RED : PAPER}>{word}</Type>
      </Group>)}
      <Margin frame={f} color={PAPER} label="RETINAL PERSISTENCE" />
      <Rect x={82} y={936} width={460 * clamp((f - 180) / 120)} height={4} fill={RED} />
    </>}

    {impact && <>
      <Ribbon time={t * 1.3} size={790 - (f - 300) * 2.4} color={INK} turn={1.2} strands={17} />
      <Type x={960} y={540} center size={f < 330 ? 530 : f < 360 ? 470 : 400} color={PAPER}>
        {f < 330 ? 'HOLD' : f < 360 ? 'THAT' : 'FEELING.'}
      </Type>
      <Type x={74} y={56} mono size={19} color={INK}>DO NOT LOOK AWAY.</Type>
      <Type x={74} y={1017} mono size={19} color={INK}>A MOMENT CAN OUTLIVE ITSELF.</Type>
      <Rect x={1825} y={62} width={20} height={20} fill={INK} />
    </>}

    {echo && <>
      {[0, 1, 2].map(i => <Ribbon key={i} time={t - i * 0.35}
        x={960 + (i - 1) * (180 + 400 * (1 - ease((f - 420) / 100)))}
        y={510} size={310} color={i === 1 ? RED : INK} opacity={i === 1 ? 1 : 0.15}
        turn={0.7} strands={9} />)}
      <Type x={960} y={875} center size={74} color={INK}>GONE. STILL HERE.</Type>
      <Margin frame={f} label="THE TRACE REMAINS" />
      <Rect x={0} y={0} width={W} height={H * (1 - ease((f - 420) / 15))} fill={RED} />
    </>}

    {outro && <>
      <Ribbon time={t * 0.6} x={960} y={470} size={260} opacity={0.55 * (1 - ease((f - 652) / 55))} />
      <Group opacity={ease((f - 579) / 24)}>
        <Type x={960} y={545} center size={350}>AFTERIMAGE</Type>
        <Rect x={mix(960, 78, ease((f - 592) / 35))} y={765}
          width={1764 * ease((f - 592) / 35)} height={3} fill={RED} />
        <Type x={960} y={816} center mono size={21}>SOME THINGS STAY.</Type>
        <Type x={960} y={1008} center mono size={16} color="#85837B">AN INDEPENDENT MOTION STUDY / 2026</Type>
      </Group>
      <Rect width={W} height={H} fill={INK} opacity={clamp((f - 699) / 20)} />
    </>}
  </>;
}

export default function Afterimage() {
  return <Composition width={W} height={H} fps={30} durationInFrames={720}>
    <Assets>
      <Font src="./assets/fonts/BebasNeue-Regular.ttf" />
      <Font src="./assets/fonts/IBMPlexMono-Regular.ttf" />
    </Assets>
    <Audio src="./assets/score.wav" />
    <Film />
  </Composition>;
}

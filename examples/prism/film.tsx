import { createRef } from 'react';
import {
  Assets, Audio, Composition, Font, Group, Rect, Sequence, Text,
  Character, CharacterView, Dialogue, Grid, Transition,
  Easings, interpolate, spring, useCurrentFrame, loadLipSync, loadPsdPreset, useLipSync,
} from '@celesta/react';
import type { AssetReference, CharacterViewReference, LipSyncTrack } from '@celesta/react';

// PRISM — a Celesta product film. 48 seconds / 120 BPM / 30 fps.
// Each chapter is a real React component, each image a pure function of time.
const W = 1920, H = 1080, FPS = 30, END = 1440;
const INK = '#111211', PAPER = '#F0EDE4', RED = '#FF4B2B';
const GREY = '#91928A', BLUE = '#384CFF';
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PSD = '../assets/illust/琴葉姉妹_SD立ち絵.psd';
const PRESET = '../assets/illust/琴葉茜.pfv';
const VOICE = '../assets/voices/character-lipsync-demo.wav';
const MOUTH = '琴葉姉妹/!表情/口';
const akane = createRef<AssetReference>();
const akaneView = createRef<CharacterViewReference>();
let poseLayers: string[] = [];
let lipSync: LipSyncTrack;

export async function prepare() {
  poseLayers = await loadPsdPreset({ src: PRESET });
  lipSync = await loadLipSync({ src: VOICE, text: 'こんにちは、リップシンクのデモです！' });
}

function T({ children, x = 80, y = 80, size = 100, color = PAPER,
  mono = false, center = false, opacity = 1, scaleX = 1,
}: { children: string; x?: number; y?: number; size?: number; color?: string;
  mono?: boolean; center?: boolean; opacity?: number; scaleX?: number }) {
  return <Text x={x} y={y} anchorX={center ? 0.5 : 0} anchorY={center ? 0.5 : 0}
    opacity={opacity} scaleX={scaleX} style={{ fontFamily: mono ? 'IBM Plex Mono' : 'Bebas Neue',
      fontSize: size, fill: { type: 'solid', color } }}>{children}</Text>;
}

function Line({ a, b, color = PAPER, width = 2, opacity = 1 }: {
  a: number[]; b: number[]; color?: string; width?: number; opacity?: number;
}) {
  return <Rect x={a[0]} y={a[1]} width={Math.max(0.1, Math.hypot(b[0] - a[0], b[1] - a[1]))}
    height={width} anchorY={0.5} rotation={Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI}
    fill={color} opacity={opacity} />;
}

// A moving stack of triangular apertures, projected with perspective.
// The same motif travels from the opening through code, motion, and export.
function Prism({ frame, x = 960, y = 540, size = 320, color = RED, count = 28 }: {
  frame: number; x?: number; y?: number; size?: number; color?: string; count?: number;
}) {
  return <>{Array.from({ length: count }, (_, i) => {
    const depth = i / count;
    const angle = frame * 0.009 + depth * 1.2;
    const r = size * (0.22 + depth * 0.78);
    const points = Array.from({ length: 3 }, (_, j) => {
      const a = angle + j * Math.PI * 2 / 3 - Math.PI / 2;
      const z = Math.sin(a) * Math.sin(frame * 0.006) * 0.4;
      return [x + Math.cos(a) * r / (1 - z),
        y + Math.sin(a) * r * 0.84 / (1 - z) + (depth - 0.5) * size * 0.25];
    });
    return <Group key={i}>{points.map((a, j) => <Line key={j} a={a} b={points[(j + 1) % 3]}
      color={color} width={i % 7 === 0 ? 4 : 1.6} opacity={0.25 + depth * 0.75} />)}</Group>;
  })}</>;
}

function Rails({ chapter, light = false }: { chapter: string; light?: boolean }) {
  const c = light ? INK : PAPER;
  return <>
    <T x={80} y={52} size={20} mono color={c}>CELESTA / PRISM</T>
    <T x={1390} y={52} size={20} mono color={c}>{chapter}</T>
    <Rect x={80} y={115} width={1760} height={1} fill={c} opacity={0.35} />
    <Rect x={80} y={987} width={1760} height={1} fill={c} opacity={0.35} />
    <T x={80} y={1010} size={17} mono color={c}>IDEA → CODE → MOTION</T>
    <T x={1555} y={1010} size={17} mono color={c}>A FILM IN REACT</T>
  </>;
}

function Opening() {
  const f = useCurrentFrame();
  return <>
    <Prism frame={f} y={480} size={340} color={PAPER} />
    <Rect width={lerp(960, 0, ease(f / 44))} height={H} fill={INK} />
    <Rect x={lerp(960, W, ease(f / 44))} width={960} height={H} fill={INK} />
    <Rect x={958} y={300} width={4} height={480} fill={RED} opacity={1 - ease(f / 50)} />
    <T x={960} y={925} size={22} mono center opacity={ease((f - 18) / 25)}>AN IDEA IS ONLY THE BEGINNING.</T>
    <T x={80} y={58} size={20} mono>CELESTA / MOTION STUDY 001</T>
  </>;
}

function Identity() {
  const f = useCurrentFrame();
  return <>
    <Rect width={W} height={H} fill={PAPER} />
    <Prism frame={f + 60} x={1540} y={528} size={440} />
    <T x={70 - 180 * (1 - ease(f / 22))} y={185} size={450} color={INK}>CELESTA</T>
    <Rect x={80} y={659} width={160 * ease((f - 8) / 22)} height={10} fill={RED} />
    <T x={80} y={724} size={105} color={INK} opacity={ease((f - 14) / 18)}>MAKE YOUR IDEAS MOVE.</T>
    <T x={84} y={872} size={23} mono color={INK}>CODE-FIRST VIDEO. FRAME BY FRAME.</T>
    <Rails chapter="00 / A NEW PERSPECTIVE" light />
  </>;
}

function Source() {
  const f = useCurrentFrame();
  const changed = f >= 62;
  const scale = lerp(0.65, 1, ease((f - 62) / 30));
  const lines = [
    { indent: 0, text: 'function Idea() {' },
    { indent: 1, text: 'const f = useCurrentFrame();' },
    { indent: 1, text: 'return (' },
    { indent: 2, text: '<Group rotation={f * 0.4}>' },
    { indent: 3, text: `<Prism color="${changed ? RED : PAPER}" />` },
    { indent: 2, text: '</Group>' },
    { indent: 1, text: ');' },
    { indent: 0, text: '}' },
  ];
  const codeX = 110, codeY = 455, lineHeight = 39, indentWidth = 28;
  return <>
    <Rails chapter="01 / WRITE & PREVIEW" />
    <T y={161} size={155}>YOUR CODE. ALIVE.</T>
    <Rect x={80} y={377} width={875} height={489} fill="#1D201E" />
    <Rect x={975} y={377} width={865} height={489} fill="#252824" />
    <T x={108} y={402} size={18} mono color={GREY}>idea.tsx</T>
    <T x={1003} y={402} size={18} mono color={GREY}>LIVE PREVIEW</T>
    {/* Align the highlight to the rendered glyphs (10 px above and below). */}
    <Rect x={codeX - 10} y={codeY + 4 * lineHeight + 1} width={827} height={lineHeight + 1}
      fill={changed ? '#4A2C23' : '#30352F'} />
    {/* Explicit indentation keeps matching delimiters on the same pixel column.
        Multiline layout preserves glyph bearings and the common baseline. */}
    {lines.map((line, i) => <Text key={i} x={codeX + line.indent * indentWidth}
      y={codeY + i * lineHeight} maxWidth={817 - line.indent * indentWidth}
      style={{ fontFamily: 'IBM Plex Mono', fontSize: 23, lineHeight,
        fill: { type: 'solid', color: i === 4 ? RED : i === 1 ? '#B5C59D' : PAPER },
      }}>{`${line.text}\n`}</Text>)}
    <Prism frame={f + 180} x={1410} y={642} size={165 * scale} color={changed ? RED : PAPER} count={20} />
    <Rect x={1679} y={408} width={9} height={9} cornerRadius={4.5} fill={RED} />
    <T x={1704} y={402} size={16} mono>{changed ? 'UPDATED' : 'READY'}</T>
    <T y={912} size={23} mono color={GREY}>REACT COMPONENTS. SAVE THE SOURCE. SEE THE CHANGE.</T>
  </>;
}

function Motion() {
  const f = useCurrentFrame();
  const phase = interpolate(f, [0, 150], [0, 1], { easing: Easings.easeInOutCubic,
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <>
    <Rect width={W} height={H} fill={RED} />
    <Rails chapter="02 / FRAME BY FRAME" light />
    <T y={157} size={190} color={INK}>NOTHING BY CHANCE.</T>
    <T y={383} size={22} mono color={INK}>INTERPOLATE. SPRING. SEQUENCE.</T>
    {Array.from({ length: 8 }, (_, i) => {
      const rise = spring({ frame: f, fps: FPS, delay: i * 4,
        config: { damping: 13, stiffness: 95 } });
      const cx = 185 + i * 220;
      return <Group key={i}>
        <Line a={[cx, 500]} b={[cx, 890]} color={INK} opacity={0.2} />
        <Rect x={cx} y={lerp(840, 659 + Math.sin(phase * 6.28 + i * 0.7) * 120, rise)}
          anchorX={0.5} anchorY={0.5} width={132} height={132}
          opacity={ease((f - i * 4) / 12)}
          rotation={phase * 180 + i * 12} fill={i % 3 === 0 ? PAPER : INK}
          cornerRadius={i % 2 ? 66 : 0} />
        <T x={cx} y={935} size={18} mono center color={INK}>{`0${i + 1}`}</T>
      </Group>;
    })}
  </>;
}

function Rhythm() {
  const f = useCurrentFrame();
  // The global score is 120 BPM; local beat zero is also a downbeat.
  const hit = Math.exp(-(f % 15) / 4);
  return <>
    <Rails chapter="03 / SOUND & PICTURE" />
    <T y={163} size={185}>FIND YOUR FREQUENCY.</T>
    <T y={381} size={23} mono color={GREY}>LAYER THE IMAGE. SHAPE THE SOUND.</T>
    <Rect x={80} y={462} width={555} height={437} fill={BLUE} />
    <Rect x={657} y={462} width={555} height={437} fill={PAPER} />
    <Rect x={1234} y={462} width={606} height={437} fill={RED} />
    <Prism frame={f + 400} x={358} y={675} size={190 + hit * 20} color={PAPER} count={16} />
    <T x={685} y={493} size={17} mono color={INK}>02 / TYPOGRAPHY</T>
    {['MAKE', 'SOME', 'NOISE.'].map((s, i) => <T key={s} x={688 + hit * (i + 1) * 4}
      y={544 + i * 99} size={116} color={INK}>{s}</T>)}
    {Array.from({ length: 42 }, (_, i) => {
      const height = 15 + (130 + hit * 90) * Math.abs(Math.sin(i * 0.57 + f * 0.13))
        * Math.sin((i + 1) / 43 * Math.PI);
      return <Rect key={i} x={1261 + i * 13} y={681} anchorY={0.5}
        width={6} height={height} fill={INK} />;
    })}
    <T x={110} y={852} size={17} mono>01 / GENERATIVE IMAGE</T>
    <T x={1265} y={852} size={17} mono color={INK}>03 / ORIGINAL AUDIO</T>
    <T y={932} size={21} mono color={GREY}>THREE LAYERS. ONE RHYTHM.</T>
  </>;
}

function Punctuation() {
  const f = useCurrentFrame();
  const index = Math.floor(f / 30);
  const local = f % 30;
  const bg = [PAPER, RED, BLUE][index];
  return <>
    <Rect width={W} height={H} fill={bg} />
    <T x={960} y={515 + (1 - ease(local / 9)) * 140} size={410} center
      color={index === 2 ? PAPER : INK}>{['WRITE.', 'PLAY.', 'REPEAT.'][index]}</T>
    <T x={960} y={872} size={24} mono center color={index === 2 ? PAPER : INK}>FROM THE FIRST IDEA TO THE FINAL FRAME.</T>
  </>;
}

function Typography() {
  return <>
    <Rect width={W} height={H} fill={PAPER} />
    <Rails chapter="04 / TYPE & LAYOUT" light />
    <T y={167} size={175} color={INK}>YOUR TYPE. YOUR RULES.</T>
    <T y={385} size={23} mono color={INK}>CUSTOM FONTS. OUTLINED TEXT. REUSABLE LAYOUTS.</T>
    <Group x={80} y={463}>
      <Grid columns={3} columnWidth={560} columnGap={40} rowHeight={420}>
        {[0, 1, 2].map(i => <Sequence key={i} from={i * 8} durationInFrames={150 - i * 8}>
          <Transition type="slide" slideFrom="bottom" distance={100} durationInFrames={24}>
            <Rect width={560} height={420} fill={[INK, BLUE, RED][i]} />
            <T x={28} y={28} size={18} mono color={i === 2 ? INK : PAPER}>
              {['01 / LOAD A FONT', '02 / STYLE THE TEXT', '03 / COMPOSE A GRID'][i]}</T>
            {i === 0 && <>
              <T x={27} y={100} size={156}>Aa / 01</T>
              <T x={32} y={278} size={42} mono>Abc. 0123.</T>
              <T x={32} y={368} size={16} mono color={GREY}>BEBAS NEUE + IBM PLEX MONO</T>
            </>}
            {i === 1 && <>
              <Text x={28} y={115} style={{ fontFamily: 'Bebas Neue', fontSize: 159,
                fill: { type: 'solid', color: BLUE },
                stroke: { paint: { type: 'solid', color: PAPER }, width: 2 } }}>MAKE IT</Text>
              <T x={28} y={251} size={124}>YOUR OWN.</T>
            </>}
            {i === 2 && <>
              <Group x={32} y={112}><Grid columns={4} columnWidth={110} columnGap={17} rowHeight={117}>
                {Array.from({ length: 8 }, (_, k) => <Rect key={k} width={110} height={100}
                  fill={k % 3 === 0 ? PAPER : INK} cornerRadius={k % 3 === 0 ? 50 : 0} />)}
              </Grid></Group>
              <T x={32} y={368} size={16} mono color={INK}>GRID / STACK / SAFE AREA / FIT</T>
            </>}
          </Transition>
        </Sequence>)}
      </Grid>
    </Group>
    <T y={931} size={22} mono color={INK}>DESIGN ONCE. REUSE THROUGHOUT THE FILM.</T>
  </>;
}

function TalkingPortrait() {
  const mouth = useLipSync(lipSync);
  return <>
    <CharacterView ref={akaneView} character={akane} x={1410} y={650}
      anchorX={0.5} anchorY={0.5} scale={0.18} />
    <Dialogue character={akaneView} audio={VOICE} lipSync={lipSync} volume={0.9}>
      Hello! This is a lip-sync demo.
    </Dialogue>
    {['a', 'i', 'u', 'e', 'o', 'closed'].map((v, i) => <Group key={v}>
      <Rect x={80 + i * 137} y={693} width={120} height={61}
        fill={mouth === v ? RED : '#30352F'} />
      <T x={140 + i * 137} y={724} center size={20} mono>{v.toUpperCase()}</T>
    </Group>)}
  </>;
}

function Characters() {
  const f = useCurrentFrame();
  return <>
    <Rails chapter="05 / CHARACTERS & VOICE" />
    <T y={170} size={185}>GIVE IT A VOICE.</T>
    <Rect x={990} y={377} width={850} height={503} fill={PAPER} />
    <T x={1018} y={402} size={17} mono color={INK}>LAYERED PSD / LIVE LIP SYNC</T>
    <T y={419} size={72}>PSD PORTRAITS.</T>
    <T y={511} size={72}>STYLED SUBTITLES.</T>
    <T y={603} size={72} color={RED}>AUTOMATIC LIP SYNC.</T>
    {(f < 30 || f >= 135) && <CharacterView character={akane} x={1410} y={650}
      anchorX={0.5} anchorY={0.5} scale={0.18} />}
    <Sequence from={30} durationInFrames={105}><TalkingPortrait /></Sequence>
    <T x={80} y={913} size={19} mono color={GREY}>VOICE → VOWELS → MOUTH SHAPES</T>
    <T x={990} y={913} size={16} mono color={GREY}>ART: AZISABASA / KOTONOHA AKANE</T>
    {f >= 135 && <T x={80} y={825} size={27} mono>ONE LINE. PICTURE, VOICE, SUBTITLE.</T>}
  </>;
}

function Scrubbing() {
  const f = useCurrentFrame();
  const position = interpolate(f, [0, 55, 100, 149], [0, 0.9, 0.3, 0.72], {
    easing: Easings.easeInOutCubic, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const selectedFrame = Math.round(position * 149);
  return <>
    <Rect width={W} height={H} fill={PAPER} />
    <Rails chapter="06 / PREVIEW & SCRUB" light />
    <T y={169} size={180} color={INK}>EVERY FRAME IS YOURS.</T>
    <T y={388} size={23} mono color={INK}>SCRUB FORWARD. GO BACK. FIND THE EXACT MOMENT.</T>
    <Rect x={80} y={462} width={790} height={406} fill={INK} />
    <Prism frame={selectedFrame + 180} x={475} y={648} size={132} count={19} />
    <T x={922} y={476} size={19} mono color={INK}>CURRENT FRAME</T>
    <T x={910} y={526} size={231} color={INK}>{String(selectedFrame).padStart(3, '0')}</T>
    <T x={925} y={802} size={24} mono color={INK}>SAME FRAME. SAME RESULT.</T>
    <Line a={[80, 927]} b={[1840, 927]} color={INK} opacity={0.3} />
    {Array.from({ length: 61 }, (_, i) => <Rect key={i} x={80 + i * 1760 / 60}
      y={912} width={1} height={i % 5 === 0 ? 32 : 14} fill={INK} opacity={0.55} />)}
    <Rect x={80 + position * 1760} y={895} width={5} height={68} fill={RED} />
    <Rect x={72 + position * 1760} y={889} width={21} height={12} fill={RED} />
  </>;
}

function Delivery() {
  const f = useCurrentFrame();
  const progress = ease(f / 105);
  return <>
    <Rails chapter="07 / READY TO SHARE" />
    <T y={178} size={223}>MAKE IT</T>
    <T y={415} size={223} color={RED}>A MOVIE.</T>
    <T y={738} size={25} mono>H.264 + AAC / MP4</T>
    <T y={788} size={21} mono color={GREY}>1920 × 1080 / 30 FPS / STEREO</T>
    <Rect x={1050} y={233} width={790} height={563} stroke="#43483F" strokeWidth={2} />
    <Prism frame={f + 720} x={1445} y={510} size={230} color={PAPER} />
    <Rect x={1050} y={833} width={790} height={5} fill="#30352F" />
    <Rect x={1050} y={833} width={Math.max(0.1, 790 * progress)} height={5} fill={RED} />
    <T x={1050} y={873} size={21} mono color={GREY}>{f >= 105 ? 'YOUR NEXT FILM STARTS HERE.' : 'RENDERING THE POSSIBILITIES'}</T>
    <T x={1715} y={735} size={22} mono>{`${String(Math.floor(progress * 100)).padStart(3, '0')}%`}</T>
  </>;
}

function Closing() {
  const f = useCurrentFrame();
  return <>
    <Rect width={W} height={H} fill={PAPER} />
    <Prism frame={f + 840} x={1580} y={580} size={500} count={32} />
    <T x={80} y={65} size={20} mono color={INK}>PRISM / MADE WITH CELESTA</T>
    <T x={71} y={267} size={455} color={INK}>CELESTA</T>
    <T x={84} y={759} size={94} color={INK}>MAKE YOUR IDEAS MOVE.</T>
    <T x={84} y={960} size={22} mono color={INK}>YOUR SOURCE. YOUR VISION. YOUR NEXT FILM.</T>
    <Rect width={W} height={H} fill={INK} opacity={clamp((f - 102) / 17)} />
  </>;
}

export default function Film() {
  return <Composition width={W} height={H} fps={FPS} durationInFrames={END}>
    <Assets>
      <Font src="./assets/fonts/BebasNeue-Regular.ttf" />
      <Font src="./assets/fonts/IBMPlexMono-Regular.ttf" />
      <Character ref={akane} name="Kotonoha Akane" portrait={{ type: 'psd', src: PSD,
        layers: poseLayers, lipSync: {
          a: `${MOUTH}/あいうえお/*あ`, i: `${MOUTH}/あいうえお/*い`,
          u: `${MOUTH}/あいうえお/*う`, e: `${MOUTH}/あいうえお/*え`,
          o: `${MOUTH}/あいうえお/*お`, closed: `${MOUTH}/*-`,
        },
      }} subtitle={{ x: 80, y: 824, maxWidth: 860,
        style: { fontFamily: 'IBM Plex Mono', fontSize: 28,
          fill: { type: 'solid', color: PAPER } } }} />
    </Assets>
    <Rect width={W} height={H} fill={INK} />
    <Audio src="./assets/score.wav" />
    <Sequence from={0} durationInFrames={60}><Opening /></Sequence>
    <Sequence from={60} durationInFrames={120}><Identity /></Sequence>
    <Sequence from={180} durationInFrames={150}><Source /></Sequence>
    <Sequence from={330} durationInFrames={150}><Motion /></Sequence>
    <Sequence from={480} durationInFrames={150}><Rhythm /></Sequence>
    <Sequence from={630} durationInFrames={150}><Typography /></Sequence>
    <Sequence from={780} durationInFrames={180}><Characters /></Sequence>
    <Sequence from={960} durationInFrames={150}><Scrubbing /></Sequence>
    <Sequence from={1110} durationInFrames={90}><Punctuation /></Sequence>
    <Sequence from={1200} durationInFrames={120}><Delivery /></Sequence>
    <Sequence from={1320} durationInFrames={120}><Closing /></Sequence>
  </Composition>;
}

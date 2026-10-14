import * as React from 'react';
import {
  Assets,
  Composition,
  Font,
  Group,
  Rect,
  Sequence,
  Subtitles,
  Text,
  formatSubtitles,
  parseSubtitles,
  progress,
  useCurrentFrame,
  useTextMetrics,
} from '@celesta/react';
import { Character, CharacterView, Dialogue } from '@celesta/character';
import type { AssetReference, SubtitleCue, TextStyle } from '@celesta/react';
import type { CharacterViewReference, SubtitleRenderProps } from '@celesta/character';
import captions from './captions.srt';

// Captions from an SRT file. parseSubtitles() turns the file into frame-timed
// cues; each is drawn in a band for its own <Sequence>, and <Subtitles>
// declares them for `--subtitles`. A <Dialogue> line fills the gap the file
// leaves at 8–10 s and goes into the exported file too. The band stands in
// for the CaptionTrack component of issue #197.

const W = 1920, H = 1080, FPS = 30;
const INK = '#f4f1ea', MUTED = '#8b8f9c', ACCENT = '#28a34a', LINE = '#3a3e4a', BG = '#16181f';
const MONO = ['JetBrains Mono', 'Noto Sans JP'];

const cues = parseSubtitles(captions, { fps: FPS });
const DIALOGUE = { from: 8 * FPS, durationInFrames: 2 * FPS };
const DURATION = 12 * FPS;

const captionStyle: TextStyle = {
  fontFamily: 'Noto Sans JP', fontWeight: 500, fontSize: 52, lineHeight: 72, align: 'center',
  fill: { type: 'solid', color: INK },
};

/** A caption on a dark band sized to its text, fading in over its first frames. */
function Band({ children, style }: { children: React.ReactNode; style: TextStyle }) {
  const frame = useCurrentFrame();
  const metrics = useTextMetrics(children, style);
  const width = metrics.width + 96, height = metrics.height + 40;
  return (
    <Group x={W / 2} y={960} opacity={progress(frame, 0, 6)}>
      <Rect x={-width / 2} y={-height / 2} width={width} height={height} fill="#000000b3" />
      <Text anchorX={0.5} anchorY={0.5} style={style}>{children}</Text>
    </Group>
  );
}

/** The cue as the file holds it, written back with formatSubtitles(). */
function SourceBlock({ cue, index }: { cue: SubtitleCue; index: number }) {
  const block = formatSubtitles([cue], { fps: FPS, format: 'srt' }).replace(/^1\n/, `${index + 1}\n`);
  return (
    <Text x={160} y={300} style={{ fontFamily: MONO, fontSize: 40, lineHeight: 60, fill: { type: 'solid', color: INK } }}>
      {block.trimEnd()}
    </Text>
  );
}

/** Every cue as a block on one strip, with the playhead. */
function Timeline() {
  const frame = useCurrentFrame();
  const x = (at: number) => 160 + (at / DURATION) * 1600;
  const block = (from: number, duration: number, color: string, key: string) => (
    <Rect key={key} x={x(from)} y={760} width={x(from + duration) - x(from) - 4} height={28} fill={color} />
  );
  const active = (from: number, duration: number) => frame >= from && frame < from + duration;
  return (
    <Group>
      <Rect x={160} y={772} width={1600} height={4} fill={LINE} />
      {cues.map((cue, index) =>
        block(cue.from, cue.durationInFrames, active(cue.from, cue.durationInFrames) ? ACCENT : MUTED, `cue-${index}`))}
      {block(DIALOGUE.from, DIALOGUE.durationInFrames, active(DIALOGUE.from, DIALOGUE.durationInFrames) ? ACCENT : LINE, 'dialogue')}
      <Rect x={x(frame) - 2} y={740} width={4} height={68} fill={INK} />
    </Group>
  );
}

const komugi = React.createRef<AssetReference>();
const komugiView = React.createRef<CharacterViewReference>();

export default function Captions() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={DURATION} lang="ja-JP">
      <Assets>
        <Font src="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400" />
        <Font src="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500" />
        <Character ref={komugi} name="komugi"
          portrait={{
            defaultExpression: 'smile',
            expressions: { smile: '../assets/dialogue-demo/portraits/komugi-smile.png' },
          }}
          subtitle={{
            style: captionStyle,
            render: ({ content, style }: SubtitleRenderProps) => <Band style={style}>{content}</Band>,
          }} />
      </Assets>
      <Rect width={W} height={H} fill={BG} />
      <Text x={160} y={160} style={{ fontFamily: MONO, fontSize: 32, fill: { type: 'solid', color: MUTED } }}>
        captions.srt
      </Text>
      <Timeline />

      <Subtitles cues={cues} />
      {cues.map((cue, index) => (
        <Sequence key={index} from={cue.from} durationInFrames={cue.durationInFrames}>
          <SourceBlock cue={cue} index={index} />
          <Band style={captionStyle}>{cue.text}</Band>
        </Sequence>
      ))}

      <Sequence {...DIALOGUE}>
        <Text x={160} y={300} style={{ fontFamily: MONO, fontSize: 40, fill: { type: 'solid', color: INK } }}>
          {'<Dialogue character={komugi}>'}
        </Text>
        <CharacterView ref={komugiView} character={komugi} x={1360} y={300} />
        <Dialogue character={komugiView}>キャラクターのセリフも、同じファイルに入るよ。</Dialogue>
      </Sequence>
    </Composition>
  );
}

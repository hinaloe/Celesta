// 4 · 動画とタイムライン
// トラックにクリップが落ちてきて、上のモニターで実写の映像が流れ始める。
// モニターの <Video> と下帯は本物。トラックの表示は説明のための絵。

import { Easings, Group, Rect, Sequence, Text, Video, interpolate, progress, spring, useCurrentFrame } from '@celesta/react';

import { SCENE_AT, line, partway, sceneEnd, useFilmFrame } from '../timing.ts';
import { ASSET, CANVAS, CLAMP, COLOR, FONT, FPS, alpha, solid } from '../theme.ts';
import { CodePanel } from '../ui/CodePanel.tsx';
import type { SceneDefinition } from './types.ts';

const { width: W, height: H } = CANVAS;

/** 「JSON のタイムラインも使えるわ」の途中で、クリップがトラックに落ちる */
const DROP_AT = partway('t1', 0.55);
/** 落ちて少し跳ねてから再生が始まる */
const PLAY_AT = DROP_AT + 8;

const MONITOR = { x: 700, y: 64, width: 800, height: 450 } as const;
const TRACKS = { x: 700, y: 548, width: 800, labelWidth: 60 } as const;
/** 映像素材（field.mp4）の幅。モニターの幅に縮めて映す。 */
const CLIP_WIDTH = 1280;

/** トラックの行。`from`・`to` はトラックの幅に対する位置（0〜1）。 */
const ROWS = [
  { name: 'V1', label: 'field.mp4', color: COLOR.zunda, from: 0.06, to: 0.68, drops: true },
  { name: 'A1', label: 'voices/t1.wav · t2.wav', color: COLOR.metan, from: 0.02, to: 0.92 },
  { name: 'A2', label: 'score.wav', color: '#8C7CF0', from: 0, to: 1 },
  { name: 'T1', label: 'LowerThird', color: '#F2A93B', from: 0.2, to: 0.6 },
] as const;

function Stage() {
  const frame = useFilmFrame('timeline');
  return (
    <>
      <Rect width={W} height={H} fill="#12161B" />
      {Array.from({ length: 30 }, (_, i) => <Rect key={i} x={i * 64} width={1} height={H} fill="#FFFFFF08" />)}
      <Monitor playing={frame >= PLAY_AT} />
      <Tracks frame={frame} />
    </>
  );
}

function Monitor({ playing }: { playing: boolean }) {
  return (
    <Group x={MONITOR.x} y={MONITOR.y}>
      <Rect x={-10} y={-10} width={MONITOR.width + 20} height={MONITOR.height + 20} cornerRadius={20}
        fill="#000000" stroke="#FFFFFF22" strokeWidth={2} />
      <Group clip={{ width: MONITOR.width, height: MONITOR.height, cornerRadius: 12 }}>
        <Rect width={MONITOR.width} height={MONITOR.height} fill="#0A0C0F" />
        {!playing && (
          <Text x={MONITOR.width / 2} y={MONITOR.height / 2} anchorX={0.5} anchorY={0.5}
            style={{ fontFamily: FONT.mono, fontSize: 24, fill: solid('#FFFFFF55') }}>
            no clip
          </Text>
        )}
        {/* シーンの Sequence の中なので、開始はシーンの先頭からのフレームで書く */}
        <Sequence from={PLAY_AT - SCENE_AT.timeline}>
          <Video src={ASSET.clip} startFrom={2} scale={MONITOR.width / CLIP_WIDTH} />
          <LowerThird />
        </Sequence>
      </Group>
    </Group>
  );
}

function Tracks({ frame }: { frame: number }) {
  const drop = spring({ frame: frame - DROP_AT, fps: FPS, config: { damping: 13 } });
  const head = interpolate(frame, [PLAY_AT, sceneEnd('timeline')], [0, 1], CLAMP);
  const laneWidth = TRACKS.width - TRACKS.labelWidth - 10;
  return (
    <Group x={TRACKS.x} y={TRACKS.y}>
      <Rect x={-10} y={-10} width={TRACKS.width + 20} height={290} cornerRadius={16}
        fill="#1A1F26" stroke="#FFFFFF1A" strokeWidth={2} />
      {/* 目盛り */}
      {Array.from({ length: 9 }, (_, i) => (
        <Group key={i} x={TRACKS.labelWidth + i * 90}>
          <Rect width={2} height={10} fill="#FFFFFF40" />
          <Text x={6} y={10} anchorY="baseline" style={{ fontFamily: FONT.mono, fontSize: 13, fill: solid('#FFFFFF60') }}>
            {`00:0${i}`}
          </Text>
        </Group>
      ))}
      {ROWS.map((row, i) => {
        const dropping = 'drops' in row;
        return (
          <Group key={row.name} y={28 + i * 62}>
            <Text x={8} y={34} anchorY="baseline"
              style={{ fontFamily: FONT.mono, fontSize: 18, fontWeight: 700, fill: solid(COLOR.mute) }}>
              {row.name}
            </Text>
            <Rect x={TRACKS.labelWidth} width={laneWidth} height={50} cornerRadius={8} fill="#FFFFFF08" />
            {(!dropping || frame >= DROP_AT) && (
              <Group x={TRACKS.labelWidth + laneWidth * row.from} y={dropping ? (1 - drop) * -260 : 0}>
                <Rect width={laneWidth * (row.to - row.from)} height={50} cornerRadius={8}
                  fill={alpha(row.color, 0.85)} stroke="#FFFFFF55" strokeWidth={2} />
                <Text x={14} y={32} anchorY="baseline"
                  style={{ fontFamily: FONT.mono, fontSize: 17, fontWeight: 700, fill: solid('#0B0F0C') }}>
                  {row.label}
                </Text>
              </Group>
            )}
          </Group>
        );
      })}
      {frame >= PLAY_AT && <Rect x={TRACKS.labelWidth + laneWidth * head} y={14} width={3} height={262} fill="#FF5A5A" />}
    </Group>
  );
}

/**
 * 映像に重ねる下帯。props だけで見た目が決まる React コンポーネントにしておけば、
 * registerComponent() で JSON のタイムラインからも使える。
 */
function LowerThird() {
  const reveal = progress(useCurrentFrame(), 10, 18, Easings.easeOutExpo);
  return (
    <Group x={24} y={MONITOR.height - 82} opacity={reveal}>
      <Group clip={{ width: 420 * reveal, height: 58 }}>
        <Rect width={420} height={58} cornerRadius={8} fill="#0B0F0CCC" />
        <Rect width={8} height={58} fill={COLOR.zunda} />
        <Text x={24} y={38} anchorY="baseline"
          style={{ fontFamily: FONT.ja, fontSize: 26, fontWeight: 800, fill: solid(COLOR.white) }}>
          どこかの畑（イメージ）
        </Text>
      </Group>
    </Group>
  );
}

function Overlay() {
  const frame = useFilmFrame('timeline');
  return (
    <CodePanel frame={frame} title="project.celesta.json" width={620} maxRows={10} steps={[{ at: line('t1').at + 6, lines: [
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

export const timelineScene: SceneDefinition = {
  id: 'timeline',
  title: '動画とタイムライン',
  wipeIn: true,
  Stage,
  Overlay,
  strings: ['どこかの畑（イメージ）'],
};

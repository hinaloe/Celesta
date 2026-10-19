import { Group, Rect, Text, cueAt, frameToTimecode, useCurrentFrame } from '@celesta/react';
import { C, DURATION, FPS, H, W } from '../constants';
import { S } from '../timeline';

const SECTIONS = [
  { at: S.intro, name: 'COLD OPEN' },
  { at: S.words, name: 'MANIFESTO' },
  { at: S.field, name: 'DETERMINISTIC' },
  { at: S.code, name: 'CODE' },
  { at: S.timeline, name: 'TIMELINE' },
  { at: S.exportAt, name: 'EXPORT' },
];

// Drawn in paper and blended with `difference`, so it reads light over the
// dark scenes and dark over the paper ones without tracking which is which.
export function Hud() {
  const f = useCurrentFrame();
  const fg = C.paper;
  const section = cueAt(SECTIONS, f)?.cue.name ?? '';
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
        <Text x={m + 40} y={m + 12} fontFamily="mono" fontSize={18} fontWeight={700} color={fg} anchorY={0.5}>Celesta</Text>
        <Text x={m + 136} y={m + 12} fontFamily="mono" fontSize={18} fontWeight={400} color={fg} anchorY={0.5} opacity={0.6}>/ Reel 01</Text>
        <Text x={W - m - 40} y={m + 12} fontFamily="mono" fontSize={18} fontWeight={400} color={fg} anchorX={1} anchorY={0.5}>{frameToTimecode(f, FPS)}</Text>
        <Text x={m + 40} y={H - m - 12} fontFamily="mono" fontSize={18} fontWeight={400} color={fg} anchorY={0.5}>{section}</Text>
        <Text x={W - m - 40} y={H - m - 12} fontFamily="mono" fontSize={18} fontWeight={400} color={fg} anchorX={1} anchorY={0.5}>
          {`${W}×${H} · ${FPS} FPS · 120 BPM`}
        </Text>
      </Group>
      <Rect x={m} y={H - 26} width={(W - m * 2) * (f / (DURATION - 1))} height={2} fill={C.accent} opacity={0.75} />
    </>
  );
}

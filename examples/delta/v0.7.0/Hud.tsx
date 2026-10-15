import { Group, Rect, Text, useCurrentFrame } from '@celesta/react';
import { useAudioSpectrum } from '@celesta/media-utils';
import { C, FONT, solid } from '../components/theme';
import { scoreSpectrum } from './score';

// Top-right: the series name, one segment per chapter (MORE is twice as
// long, so its segment is too), and a live meter of the score. It sits above
// the chapter cuts, at the root, where useAudioSpectrum() reads the film's clock.
const BANDS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];

export function Hud({ version, starts, lengths }: { version: string; starts: readonly number[]; lengths: readonly number[] }) {
  const frame = useCurrentFrame();
  const { bands } = useAudioSpectrum(scoreSpectrum());
  const current = starts.filter((start) => frame >= start).length - 1;
  const unit = 30 / lengths[0];
  const gap = 6;
  const right = 1800;
  const total = lengths.reduce((sum, length) => sum + length * unit, 0) + (lengths.length - 1) * gap;
  const mono = { fontFamily: FONT.mono, fontSize: 18 };
  let x = right - total;
  return (
    <Group>
      <Text x={right} y={62} anchorX={1} anchorY={0.5} style={{ ...mono, fill: solid(C.grey) }}>
        {`CELESTA  Δ  WHAT'S NEW IN ${version}`}
      </Text>
      <Group x={right - 470} y={62}>
        {BANDS.map((band, i) => {
          const h = 3 + 22 * bands[band];
          return <Rect key={band} x={i * 6} y={h / 2} anchorY={1} width={3} height={h} fill={bands[band] > 0.75 ? C.orange : C.dim} />;
        })}
      </Group>
      {starts.map((start, i) => {
        const seg = lengths[i] * unit;
        const at = x;
        x += seg + gap;
        const fill = i < current ? 1 : i === current ? Math.min(1, (frame - start) / lengths[i]) : 0;
        return (
          <Group key={start} x={at} y={84}>
            <Rect width={seg} height={4} fill={C.line} />
            {fill > 0 ? <Rect width={seg * fill} height={4} fill={i === current ? C.orange : C.grey} /> : null}
          </Group>
        );
      })}
    </Group>
  );
}

import { Instances, Rect, Static } from '@celesta/react';
import { C, H, W } from './theme';

// The dotted ground every scene stands on: one <Instances> layer of dots,
// inside a <Static>, so it is built and sent to the renderer once.
const STEP = 80;
const COLS = Math.ceil(W / STEP);
const ROWS = Math.ceil(H / STEP);
const COUNT = COLS * ROWS;
const xs = new Float32Array(COUNT);
const ys = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  xs[i] = STEP / 2 + (i % COLS) * STEP;
  ys[i] = STEP / 2 + Math.floor(i / COLS) * STEP;
}

export function Backdrop({ fill = C.ink, dots = '#FFFFFF14' }: { fill?: string; dots?: string }) {
  return (
    <Static deps={[fill, dots]}>
      <Rect width={W} height={H} fill={fill} />
      <Instances count={COUNT} x={xs} y={ys} width={3} height={3} shape="circle" fill={dots} />
    </Static>
  );
}

import { useContext } from 'react';
import { FreezeFrame, Group, Rect, Span, Text, useCurrentFrame } from '@celesta/react';
import { Backdrop } from '../components/Backdrop';
import { CUT } from '../components/ChapterShell';
import { Delta } from '../components/Delta';
import { C, FONT, H, W, ease, solid } from '../components/theme';
import { FilmContext } from './film-context';
import { TAGLINE } from './Open';
import { scoreAt } from './score';
import { OUTRO_AT } from './timeline';

// The mark in a ring of the score's bands, the tagline, and every chapter
// again: each thumbnail is the film itself, redrawn by <FreezeFrame>.
const THUMB = { width: 208, height: 117, gap: 22, columns: 7 };

function Ring({ frame, opacity }: { frame: number; opacity: number }) {
  const { bands } = scoreAt(OUTRO_AT + frame);
  const count = 48;
  return (
    <Group x={W / 2} y={175} opacity={opacity}>
      {Array.from({ length: count }, (_, i) => {
        const level = bands[Math.floor((i < count / 2 ? i : count - 1 - i) * 2 / 3)];
        const length = 6 + 46 * level;
        return (
          <Group key={i} rotation={(i / count) * 360}>
            <Rect x={-2} y={-110 - length} width={4} height={length} cornerRadius={2}
              fill={level > 0.7 ? C.orange : C.dim} />
          </Group>
        );
      })}
    </Group>
  );
}

export function Outro({ chapters }: { chapters: readonly { title: string; at: number }[] }) {
  const Film = useContext(FilmContext);
  const frame = useCurrentFrame() - CUT;
  const mark = ease(frame, -4, 24);
  const title = ease(frame, 4, 24);
  const line = ease(frame, 12, 24);
  const sub = ease(frame, 18, 24);
  const foot = ease(frame, 90, 24);
  const { rms } = scoreAt(OUTRO_AT + frame);
  const scale = THUMB.width / W;
  const left = (W - (THUMB.columns * THUMB.width + (THUMB.columns - 1) * THUMB.gap)) / 2;
  return (
    <Group>
      <Backdrop />
      <Ring frame={frame} opacity={mark} />
      <Delta x={W / 2} y={175} size={120} opacity={mark} scale={(0.6 + 0.4 * mark) * (1 + 0.12 * rms)}
        glow={{ color: '#F26A2EAA', blur: 36 }} />
      <Text x={W / 2} y={380 + 20 * (1 - title)} anchorX={0.5} anchorY={0.5} opacity={title}
        style={{ fontFamily: FONT.display, fontSize: 150, letterSpacing: { em: 0.04 }, fill: solid(C.paper) }}>
        CELESTA <Span style={{ fill: C.orange }}>0.7.0</Span>
      </Text>
      <Text x={W / 2} y={486} anchorX={0.5} anchorY={0.5} opacity={line}
        style={{ fontFamily: FONT.sans, fontSize: 40, fontWeight: 700, fill: solid(C.paper) }}>
        {TAGLINE}
      </Text>
      <Text x={W / 2} y={538} anchorX={0.5} anchorY={0.5} opacity={sub}
        style={{ fontFamily: FONT.sans, fontSize: 28, fill: solid(C.grey) }}>
        A diff in the code is a diff in the video.
      </Text>
      {chapters.map((chapter, i) => {
        const col = i % THUMB.columns;
        const row = Math.floor(i / THUMB.columns);
        const inRow = Math.min(THUMB.columns, chapters.length - row * THUMB.columns);
        const rowLeft = left + ((THUMB.columns - inRow) * (THUMB.width + THUMB.gap)) / 2;
        const x = rowLeft + col * (THUMB.width + THUMB.gap);
        const y = 600 + row * (THUMB.height + 62);
        const p = ease(frame, 24 + i * 3, 20);
        return (
          <Group key={chapter.title} x={x} y={y + 24 * (1 - p)} opacity={p}>
            <Rect x={-2} y={-2} width={THUMB.width + 4} height={THUMB.height + 4} cornerRadius={6} fill={C.line} />
            <Group clip={{ width: THUMB.width, height: THUMB.height, cornerRadius: 4 }}>
              <Group scale={scale}>
                <FreezeFrame frame={chapter.at}><Film /></FreezeFrame>
              </Group>
            </Group>
            <Text y={THUMB.height + 26} anchorY={0.5} style={{ fontFamily: FONT.mono, fontSize: 16, fontWeight: 700, fill: solid(C.orange) }}>
              {i < 12 ? `Δ${String(i + 1).padStart(2, '0')}` : '+'}
            </Text>
            <Text x={i < 12 ? 46 : 20} y={THUMB.height + 26} anchorY={0.5} style={{ fontFamily: FONT.display, fontSize: 28, fill: solid(C.paper) }}>
              {chapter.title}
            </Text>
          </Group>
        );
      })}
      <Text x={W / 2} y={H - 46} anchorX={0.5} anchorY={0.5} opacity={foot}
        style={{ fontFamily: FONT.mono, fontSize: 20, fill: solid(C.dim) }}>
        celesta.natsuneko.cat   ·   github.com/mika-f/Celesta   ·   examples/delta
      </Text>
    </Group>
  );
}

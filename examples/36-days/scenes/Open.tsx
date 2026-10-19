import { Easings, Group, Rect, interpolate, progress, textCaret, useCurrentFrame, useTextMetrics } from '@celesta/react';
import { Camera } from '@celesta/layout';
import { useTypewriter } from '@celesta/text';
import { Caret } from '../components/Caret';
import { Label, textStyle } from '../components/Label';
import { BEAT, C, H, W } from '../constants';
import { DAYS } from '../data';

// Keep in sync with the key clicks in make-score.py.
const PROMPT = 'git log --reverse --date=short --format=%ad';
const LOG = DAYS.flatMap((d) => Array.from({ length: d.commits }, () => d.date));

export function Open() {
  const f = useCurrentFrame();
  const typed = useTypewriter(PROMPT, { from: 6, blinkFrames: BEAT });
  const size = 40;
  // The whole prompt line, measured once: the typed text starts after `$ `,
  // and the caret sits at the end of what is typed so far.
  const line = useTextMetrics(`$ ${PROMPT}`, textStyle('mono', size));
  // The camera aims past the year of the first date (`YYYY-`).
  const year = useTextMetrics(LOG[0].slice(0, 5), textStyle('mono', 28)).width;
  const x0 = 160;
  const y0 = 300;
  const firstY = y0 + 90;

  const shown = f < 60 ? 0 : Math.min(LOG.length, Math.floor((f - 60) * 3) + 1);
  const rows = 8;
  // The first line stays put; the rest of the log scrolls up beneath it.
  const scroll = Math.max(1, shown - rows);
  // From frame 96 the camera flies to the first line and dives into it.
  const aim = progress(f, 96, 18, Easings.easeInOutCubic);
  const dive = progress(f, 96, 24, Easings.easeInExpo);

  return (
    <>
      <Rect width={W} height={H} fill={C.ink} />
      <Camera x={interpolate(aim, [0, 1], [W / 2, x0 + year])}
        y={interpolate(aim, [0, 1], [H / 2, firstY])} zoom={1 + 7 * dive}>
        <Group x={x0} y={y0}>
          <Label size={size} font="mono" weight={700} color={C.mint} ay={0.5}>$</Label>
          <Label x={textCaret(line, 2).x} size={size} font="mono" ay={0.5}>{typed.text}</Label>
          <Caret x={textCaret(line, 2 + typed.length).x} size={size} visible={f < 60 && typed.caretVisible} />
        </Group>
        {shown > 0 && <Label x={x0} y={firstY} size={28} font="mono" ay={0.5}>{LOG[0]}</Label>}
        <Group y={firstY + 24} clip={{ x: -W, width: W * 3, height: rows * 44 }}>
          {LOG.slice(scroll, shown).map((date, i) => (
            <Label key={scroll + i} x={x0} y={20 + i * 44} size={28} font="mono" color={C.grey} ay={0.5}
              opacity={1 - 0.8 * progress(f, 84, 10)}>{date}</Label>
          ))}
        </Group>
        <Label x={x0 + 260} y={firstY} size={22} font="mono" color={C.mint} ay={0.5}
          opacity={progress(f, 84, 10)}>{'← day 1'}</Label>
        <Label x={x0} y={firstY + rows * 44 + 70} size={22} font="mono" color={C.grey} ay={0.5}
          opacity={progress(f, 72, 10)}>{`${shown} commits`}</Label>
      </Camera>
    </>
  );
}

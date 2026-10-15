import type { ReactNode } from 'react';
import { Easings, Group, Rect, Text, formatSubtitles, interpolate, progress, useCurrentFrame } from '@celesta/react';
import { safeAreaInsets } from '@celesta/layout';
import { chromaticAberration, pixelate } from '@celesta/shader';
import { Backdrop } from '../components/Backdrop';
import { CUT } from '../components/ChapterShell';
import { Delta } from '../components/Delta';
import { C, FONT, FPS, ease, solid } from '../components/theme';
import { CAPTIONS } from './captions';
import { BAR, BEAT, CHAPTER_COUNT, DURATION } from './timeline';

// MORE: eight one-bar cards for what did not get a chapter. Each lands on a
// downbeat with a stab in the score; the title slams in through a pixelate
// and a channel split that settle within a beat. Cards alternate ink and
// orange, and every color below comes from the card's palette.
interface Palette {
  /** Main text and strokes. */
  ink: string;
  /** Secondary text. */
  sub: string;
  /** Highlights. */
  accent: string;
  /** Panels drawn on the card. */
  panel: string;
}

const DARK: Palette = { ink: C.paper, sub: C.grey, accent: C.orange, panel: '#FFFFFF10' };
const LIGHT: Palette = { ink: C.ink, sub: '#0C0D0FAA', accent: C.paper, panel: '#0C0D0F1C' };

interface VisualProps { f: number; c: Palette }

interface Card {
  title: string;
  line: string;
  prs: readonly number[];
  Visual: (props: VisualProps) => ReactNode;
}

const mono = (size: number, color: string, weight = 400) =>
  ({ fontFamily: FONT.mono, fontSize: size, fontWeight: weight, fill: solid(color) }) as const;

function Compositions({ f, c }: VisualProps) {
  const p = ease(f, 4, 14);
  const q = ease(f, 10, 14);
  return (
    <Group>
      <Group opacity={p} y={20 * (1 - p)}>
        <Rect y={60} width={384} height={216} stroke={c.ink} strokeWidth={4} cornerRadius={8} fill={c.panel} />
        <Text x={192} y={168} anchorX={0.5} anchorY={0.5} style={mono(26, c.ink, 700)}>id="film"</Text>
        <Text y={310} style={mono(20, c.sub)}>{`1920×1080 · ${FPS} fps · ${DURATION} frames`}</Text>
      </Group>
      <Group opacity={q} y={20 * (1 - q)}>
        <Rect x={440} y={60} width={216} height={122} stroke={c.accent} strokeWidth={4} cornerRadius={8} fill={c.panel} />
        <Text x={548} y={121} anchorX={0.5} anchorY={0.5} style={mono(22, c.accent, 700)}>id="poster"</Text>
        <Text x={440} y={216} style={mono(20, c.sub)}>the outro, still</Text>
      </Group>
      <Text y={390} opacity={q} style={mono(22, c.ink, 700)}>Celesta-export --composition poster</Text>
    </Group>
  );
}

function GoogleFonts({ f, c }: VisualProps) {
  const rows = [
    ['Bebas Neue', { fontFamily: 'Bebas Neue', fontSize: 96 }],
    ['Space Grotesk', { fontFamily: 'Space Grotesk', fontSize: 60, fontWeight: 700 }],
    ['JetBrains Mono', { fontFamily: 'JetBrains Mono', fontSize: 50, fontWeight: 700 }],
  ] as const;
  return (
    <Group>
      {rows.map(([name, style], i) => {
        const p = ease(f, 3 + i * 4, 12);
        return (
          <Group key={name} y={40 + i * 140} opacity={p} x={30 * (1 - p)}>
            <Text style={mono(20, c.sub)}>{`<Font google="${name}" />`}</Text>
            <Text y={34} style={{ ...style, fill: solid(i === 0 ? c.accent : c.ink) }}>{name}</Text>
          </Group>
        );
      })}
    </Group>
  );
}

function SubtitleFile({ f, c }: VisualProps) {
  // This card's own cue, as the export writes it with --subtitles.
  const cue = CAPTIONS[CHAPTER_COUNT];
  const srt = formatSubtitles([cue], { fps: FPS, format: 'srt' }).trim().split('\n');
  return (
    <Group>
      <Rect x={-30} y={20} width={760} height={330} cornerRadius={12} fill={c.panel} />
      <Text y={50} opacity={ease(f, 2, 10)} style={mono(20, c.sub)}>delta-0.7.0.srt</Text>
      {srt.map((line, i) => (
        <Text key={i} y={100 + i * 50} opacity={ease(f, 5 + i * 4, 10)} maxWidth={700}
          style={{ ...mono(i === 1 ? 24 : 26, i === 1 ? c.accent : c.ink, i === 2 ? 700 : 400), lineHeight: 40 }}>{line}</Text>
      ))}
    </Group>
  );
}

function SafeAreas({ f, c }: VisualProps) {
  const inset = safeAreaInsets('vertical-social', 1080, 1920);
  const s = 0.24;
  const p = ease(f, 4, 16);
  return (
    <Group x={20} y={-20}>
      <Rect width={1080 * s} height={1920 * s} cornerRadius={24} stroke={c.ink} strokeWidth={4} fill={c.panel} />
      <Group opacity={p}>
        <Rect x={(1080 - inset.right) * s} y={inset.top * s} width={inset.right * s} height={(1920 - inset.top - inset.bottom) * s} fill="#0C0D0F40" />
        <Rect y={(1920 - inset.bottom) * s} width={1080 * s} height={inset.bottom * s} cornerRadius={24} fill="#0C0D0F40" />
        <Rect x={inset.left * s} y={inset.top * s} width={(1080 - inset.left - inset.right) * s}
          height={(1920 - inset.top - inset.bottom) * s} stroke={c.accent} strokeWidth={4} dash={[12, 8]} dashOffset={-f * 2} />
      </Group>
      <Group x={330} y={60} opacity={p}>
        {[['top', inset.top], ['right', inset.right], ['bottom', inset.bottom], ['left', inset.left]].map(([edge, px], i) => (
          <Text key={edge} y={i * 50} style={mono(28, c.ink, 700)}>{`${String(edge).padEnd(7)} ${Math.round(Number(px))} px`}</Text>
        ))}
        <Text y={230} style={mono(20, c.sub)}>{"padding='vertical-social'"}</Text>
        <Text y={262} style={mono(20, c.sub)}>at 1080×1920</Text>
      </Group>
    </Group>
  );
}

const MORAS = ['ア', 'イ', 'ヴィ', 'ス', 'ス', 'ピー', 'チ'];

function Moras({ f, c }: VisualProps) {
  const lit = Math.floor(f / 5);
  return (
    <Group>
      <Group y={110}>
        {MORAS.map((mora, i) => {
          const on = i <= lit;
          return (
            <Group key={i} x={i * 100}>
              <Rect width={88} height={88} cornerRadius={10} fill={on ? c.accent : c.panel} stroke={c.ink} strokeWidth={on ? 0 : 2} />
              <Text x={44} y={46} anchorX={0.5} anchorY={0.5}
                style={{ fontFamily: FONT.sans, fontSize: 34, fontWeight: 700, fill: solid(on ? (c === DARK ? C.ink : C.orange) : c.ink) }}>{mora}</Text>
            </Group>
          );
        })}
      </Group>
      <Text y={260} style={mono(20, c.sub)}>timingFromAivisSpeech(query, wav).moras</Text>
      <Text y={292} style={mono(20, c.sub)}>timingFromVoicevox(query).moras</Text>
    </Group>
  );
}

function React19({ f, c }: VisualProps) {
  const spin = f * 3;
  return (
    <Group x={260} y={200}>
      {[0, 60, 120].map((angle) => (
        <Rect key={angle} anchorX={0.5} anchorY={0.5} width={380} height={130} cornerRadius={65}
          rotation={angle + spin} stroke={c.ink} strokeWidth={6} />
      ))}
      <Text anchorX={0.5} anchorY={0.5} style={{ fontFamily: FONT.display, fontSize: 130, fill: solid(c.accent) }}>19</Text>
    </Group>
  );
}

function Website({ f, c }: VisualProps) {
  const p = ease(f, 3, 16);
  return (
    <Group opacity={p} y={20 * (1 - p)}>
      <Rect width={680} height={380} cornerRadius={12} fill="#0C0D0F" stroke={c.ink} strokeWidth={3} />
      <Rect width={680} height={40} cornerRadius={12} fill="#1E2026" />
      {[C.red, C.amber, C.green].map((color, i) => <Rect key={color} x={20 + i * 22} y={14} width={12} height={12} cornerRadius={6} fill={color} />)}
      <Text x={110} y={20} anchorY={0.5} style={mono(17, C.grey)}>celesta.natsuneko.cat</Text>
      <Text x={40} y={130} style={{ fontFamily: FONT.display, fontSize: 96, fill: solid(C.paper) }}>CELESTA</Text>
      <Text x={40} y={214} style={{ fontFamily: FONT.sans, fontSize: 26, fontWeight: 500, fill: solid(C.grey) }}>{WEBSITE_LINE}</Text>
      <Rect x={40} y={284} width={170} height={48} cornerRadius={24} fill={C.orange} />
      <Text x={125} y={308} anchorX={0.5} anchorY={0.5} style={mono(18, C.ink, 700)}>Download</Text>
    </Group>
  );
}
const WEBSITE_LINE = 'Videos from code. Docs in English and 日本語.';

const FIX_LIST: readonly (readonly [number, string])[] = [
  [275, 'Windows: startup, title bar, paths'],
  [331, 'bash: words and flags kept whole'],
  [347, 'a missing media file is named'],
  [353, 'web gradients match native'],
  [358, 'a faded group fades as one'],
  [337, 'the template list scrolls'],
];

function Fixes({ f, c }: VisualProps) {
  return (
    <Group>
      {FIX_LIST.map(([n, text], i) => {
        const p = ease(f, 2 + i * 3, 10);
        return (
          <Group key={n} y={20 + i * 62} opacity={p} x={24 * (1 - p)}>
            <Rect y={-2} width={30} height={30} cornerRadius={6} fill={c.ink} />
            <Text x={15} y={13} anchorX={0.5} anchorY={0.5} style={mono(20, c === DARK ? C.ink : C.orange, 700)}>x</Text>
            <Text x={50} style={mono(26, c.accent, 700)}>{`#${n}`}</Text>
            <Text x={150} style={mono(26, c.ink)}>{text}</Text>
          </Group>
        );
      })}
    </Group>
  );
}

export const CARDS: readonly Card[] = [
  { title: 'COMPOSITIONS', line: 'One entry, several videos. This one has two.', prs: [340], Visual: Compositions },
  { title: 'GOOGLE FONTS', line: 'Ask for a family by name. Every Latin face here is.', prs: [341], Visual: GoogleFonts },
  { title: 'SUBTITLES', line: 'SRT and WebVTT in, --subtitles out. This film writes its own.', prs: [342], Visual: SubtitleFile },
  { title: 'SAFE AREAS', line: 'Insets for Shorts, TikTok and Reels, guides in PNG checks.', prs: [281, 220], Visual: SafeAreas },
  { title: 'AIVISSPEECH', line: 'Mora and phoneme timing from VOICEVOX and AivisSpeech.', prs: [274], Visual: Moras },
  { title: 'REACT 19', line: 'The workspace and every example on one React.', prs: [330, 345, 361], Visual: React19 },
  { title: 'WEBSITE', line: 'Rebuilt with Makit, theme Noir, the README pointing to it.', prs: [323, 360], Visual: Website },
  { title: 'FIXES', line: 'And the things that were wrong.', prs: [275, 331, 347, 353, 358, 337], Visual: Fixes },
];

/** Strings with Japanese in them, for the font subset. */
export const MORE_STRINGS = [...MORAS, WEBSITE_LINE];

function CardView({ card, index, f }: { card: Card; index: number; f: number }) {
  const orange = index % 2 === 1;
  const c = orange ? LIGHT : DARK;
  const hit = 1 - progress(f, 0, BEAT, Easings.easeOutCubic);
  const title = { fontFamily: FONT.display, fontSize: 220, fill: solid(c.ink) } as const;
  const spacing = interpolate(f, [0, 16], [0.12, 0.02], { easing: Easings.easeOutCubic, extrapolateRight: 'clamp' });
  const line = ease(f, 4, 12);
  const { Visual } = card;
  return (
    <Group>
      <Backdrop fill={orange ? C.orange : C.ink} dots={orange ? '#0C0D0F18' : '#FFFFFF14'} />
      <Group shader={[pixelate(1 + 26 * hit ** 2), chromaticAberration({ offset: 22 * hit })]}>
        <Group x={120} y={150}>
          <Delta x={10} y={0} size={22} fill={orange ? C.ink : C.orange} />
          <Text x={34} y={0} anchorY={0.5} style={mono(22, orange ? C.ink : C.orange, 700)}>
            {`MORE  ${String(index + 1).padStart(2, '0')} / ${CARDS.length}`}
          </Text>
        </Group>
        <Text x={116} y={190} style={{ ...title, letterSpacing: { em: spacing } }}>{card.title}</Text>
        <Text x={120} y={440} opacity={line} maxWidth={760}
          style={{ fontFamily: FONT.sans, fontSize: 42, fontWeight: 700, lineHeight: 54, fill: solid(c.ink) }}>{card.line}</Text>
        <Text x={120} y={960} opacity={line} style={mono(22, c.sub)}>
          {card.prs.map((n) => `#${n}`).join('  ·  ')}
        </Text>
        <Group x={1020} y={420}>
          <Visual f={f} c={c} />
        </Group>
      </Group>
    </Group>
  );
}

export function More() {
  const frame = useCurrentFrame() - CUT;
  const index = Math.max(0, Math.min(CARDS.length - 1, Math.floor(frame / BAR)));
  return <CardView card={CARDS[index]} index={index} f={frame - index * BAR} />;
}

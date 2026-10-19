import { Composition, Font, Rect, Span, Text, Theme, useTextMetrics, useTheme } from '@celesta/react';

// <Theme> names fonts and colors once; <Text> and <Span> refer to them by
// name, and the shorthand props stand in for the usual `style` entries.

const fonts = { display: 'Inter', mono: 'JetBrains Mono' };
const colors = { paper: '#F4F1EA', ink: '#111111', accent: '#FF4D1F' };

function Badge({ x, y, children }: { x: number; y: number; children: string }) {
  const { colors } = useTheme();
  const m = useTextMetrics(children, { fontFamily: 'mono', fontSize: 18, fontWeight: 700 });
  return <>
    <Rect x={x} y={y} width={m.width + 24} height={36} fill={colors.accent} />
    <Text x={x + 12} y={y + 18} anchorY={0.5} fontFamily="mono" fontSize={18} fontWeight={700} color="ink">
      {children}
    </Text>
  </>;
}

export default function WithTheme() {
  return (
    <Composition width={960} height={540} fps={30} durationInFrames={30}>
      <Font google="Inter" weights={[400, 700]} />
      <Font google="JetBrains Mono" weights={[700]} />
      <Theme fonts={fonts} colors={colors}>
        <Rect width={960} height={540} fill={colors.ink} />
        <Badge x={56} y={56}>CELESTA</Badge>
        <Text x={56} y={140} fontFamily="display" fontSize={72} fontWeight={700} color="paper">
          Code is the <Span color="accent">cut</Span>.
        </Text>
        {/* An inner theme adds to the outer one, its own names winning. */}
        <Theme colors={{ paper: '#8B8B90' }}>
          <Text x={56} y={250} fontFamily="display" fontSize={28} color="paper">
            Same names, a quieter paper.
          </Text>
        </Theme>
      </Theme>
    </Composition>
  );
}

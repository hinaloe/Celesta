import { Composition, Group, Rect, Text, interpolate, useCurrentFrame } from '@celesta/react';
import { chromaticAberration, noise, scanlines } from '@celesta/shader';

// Built-in stylize effects. Each panel shows the same scene with one
// effect prop whose values change every frame; the last stacks three
// through the `shader` array. They run in the browser editor too.

const SIZE = 280;

type Panel = [label: string, props: (frame: number) => Record<string, unknown>];

const PANELS: Panel[] = [
  ['pixelate', frame => ({ pixelate: interpolate(frame, [0, 60, 120], [1, 28, 1]) })],
  ['halftone', frame => ({ halftone: { size: 12, angle: 45 + frame / 2 } })],
  ['chromaticAberration', frame => ({ chromaticAberration: { offset: 8 * Math.abs(Math.sin(frame / 12)), angle: 20 } })],
  ['wave', frame => ({ wave: { amplitude: 10, wavelength: 90, phase: frame * 12 } })],
  // No seed: the grain changes every frame, the same on every render.
  ['noise', () => ({ noise: 0.3 })],
  ['scanlines', frame => ({ scanlines: { amount: 0.6, spacing: 6, offset: frame / 4 } })],
  ['zoomBlur', frame => ({ zoomBlur: { amount: interpolate(frame, [0, 60, 120], [0, 0.35, 0]), centerY: 0.4 } })],
  ['shader array', () => ({ shader: [chromaticAberration(3), noise({ amount: 0.12, monochrome: false }), scanlines(0.35)] })],
];

export default function Root() {
  const frame = useCurrentFrame();
  return (
    <Composition width={1280} height={720} fps={30} durationInFrames={120}>
      <Rect width={1280} height={720} fill="#101014" />
      {PANELS.map(([label, props], index) => (
        <Group key={label} x={24 + (index % 4) * (SIZE + 32)} y={24 + Math.floor(index / 4) * (SIZE + 64)}>
          <Group {...props(frame)}>
            <Scene />
          </Group>
          <Text y={SIZE + 12} style={{ fontFamily: 'sans-serif', fontSize: 20, fill: { type: 'solid', color: '#d0d0d8' } }}>
            {label}
          </Text>
        </Group>
      ))}
    </Composition>
  );
}

/** A small landscape with a sun, a house, and a title. */
function Scene() {
  return (
    <>
      <Rect
        width={SIZE}
        height={SIZE}
        fill={{ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: SIZE }, stops: [{ offset: 0, color: '#4aa0f0' }, { offset: 1, color: '#f6d39a' }] }}
      />
      <Rect x={180} y={36} width={64} height={64} cornerRadius={32} fill="#ffe070" />
      <Rect y={196} width={SIZE} height={84} fill="#3c8a3c" />
      <Rect x={36} y={128} width={84} height={96} fill="#c04a30" />
      <Rect x={28} y={108} width={100} height={28} fill="#6a2a20" />
      <Text x={SIZE / 2} y={226} anchorX={0.5} style={{ fontFamily: 'sans-serif', fontSize: 36, fontWeight: 800, fill: { type: 'solid', color: '#ffffff' } }}>
        CELESTA
      </Text>
    </>
  );
}

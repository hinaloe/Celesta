import { Composition, Group, Rect, Text, useCurrentFrame } from '@celesta/react';

// Stand-in green-screen footage, drawn by Celesta so it can ship with the
// repository: a presenter waving in front of an unevenly lit #00b140 screen,
// casting a shadow on it, with a sheer scarf the screen shows through, a
// green cast on everything (spill), soft moving edges, and sensor grain.
// Exported to assets/footage.mp4 and assets/still.jpg; see the README.

const W = 640;
const H = 360;

export default function Footage() {
  const frame = useCurrentFrame();
  const wave = Math.sin((frame / 90) * Math.PI * 4);
  const sway = Math.sin((frame / 90) * Math.PI * 2) * 6;
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={90}>
      <Group noise={0.025}>
        <Screen />
        {/* The presenter's shadow on the screen, soft and to the right. */}
        <Rect x={360 + sway} y={110} width={150} height={260} cornerRadius={70} fill="#003a1480" blur={18} />
        <Group x={sway} tint={{ color: '#00b140', amount: 0.1 }}>
          <Presenter wave={wave} />
        </Group>
      </Group>
    </Composition>
  );
}

/** The green screen, brighter at the top centre where the lights point. */
function Screen() {
  return (
    <Rect
      width={W}
      height={H}
      fill={{
        type: 'radial',
        center: { x: W / 2, y: H * 0.3 },
        radius: W * 0.75,
        stops: [
          { offset: 0, color: '#12c450' },
          { offset: 0.6, color: '#00b140' },
          { offset: 1, color: '#008a32' },
        ],
      }}
    />
  );
}

function Presenter({ wave }: { wave: number }) {
  return (
    <>
      {/* Body and head. */}
      <Rect x={240} y={190} width={160} height={190} cornerRadius={60} fill="#2a3550" />
      <Rect x={300} y={170} width={40} height={36} fill="#e8b890" />
      <Rect x={270} y={80} width={100} height={110} cornerRadius={50} fill="#f2c9a0" />
      <Rect x={262} y={70} width={116} height={52} cornerRadius={26} fill="#3a2a20" />
      {/* A sheer scarf hanging past the shoulder: the screen shows through it. */}
      <Rect x={262} y={196} width={116} height={26} cornerRadius={13} fill="#f0f0f0" opacity={0.55} />
      <Rect x={250} y={206} width={30} height={130} cornerRadius={12} rotation={14} fill="#f0f0f0" opacity={0.55} />
      {/* The waving arm, blurred as fast motion is on camera. */}
      <Group x={392} y={214} rotation={30 + wave * 22} blur={1.5 + Math.abs(wave)}>
        <Rect x={-14} y={-118} width={28} height={120} cornerRadius={14} fill="#2a3550" />
        <Rect x={-16} y={-150} width={32} height={36} cornerRadius={16} fill="#f2c9a0" />
      </Group>
      {/* A card the presenter holds. */}
      <Group x={196} y={250} rotation={-6}>
        <Rect width={120} height={64} cornerRadius={8} fill="#fafafa" />
        <Text
          x={60}
          y={32}
          anchorX={0.5}
          anchorY={0.5}
          style={{ fontFamily: 'sans-serif', fontSize: 26, fontWeight: 800, fill: { type: 'solid', color: '#d04030' } }}
        >
          HELLO
        </Text>
      </Group>
    </>
  );
}

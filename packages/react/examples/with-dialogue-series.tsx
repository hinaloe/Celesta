import * as React from 'react';

import {
  Assets,
  Character,
  CharacterView,
  Composition,
  DialogueSeries,
  Rect,
  Sequence,
  planDialogue,
} from '@celesta/react';
import type { AssetReference, CharacterViewReference, DialoguePlan } from '@celesta/react';

const FPS = 30;
const VOICES = '../../../examples/assets/voices';

const akane = React.createRef<AssetReference>();
const akaneView = React.createRef<CharacterViewReference>();

// Filled once by prepare(): every line's start and length, measured from its voice.
let plan: DialoguePlan;

export async function prepare(): Promise<void> {
  plan = await planDialogue(
    [
      { id: 'hello', scene: 'intro', speaker: 'akane', audio: `${VOICES}/character-lipsync-demo.wav`, text: 'こんにちは、リップシンクのデモです！' },
      { id: 'next', scene: 'intro', speaker: 'akane', audio: `${VOICES}/001.wav`, text: '台詞は音声の長さで並びます。' },
      // A new scene starts after a one-second pause (`sceneLeadIn`).
      { id: 'body', scene: 'body', speaker: 'akane', audio: `${VOICES}/001.wav`, text: '場面の区切りには間が入ります。', gap: 0.5 },
    ],
    { fps: FPS, sceneLeadIn: 1 },
  );
}

export default function Root() {
  return (
    <Composition width={1280} height={720} fps={FPS} durationInFrames={plan.durationInFrames}>
      <Assets>
        <Character
          ref={akane}
          name="Akane"
          portrait={{ defaultExpression: 'default', expressions: { default: '../../../examples/assets/akane/default.ppm' } }}
          subtitle={{
            x: 640,
            y: 640,
            anchorX: 0.5,
            anchorY: 0.5,
            maxWidth: 1120,
            style: { fontSize: 44, align: 'center', fill: { type: 'solid', color: '#ffffff' } },
          }}
        />
      </Assets>
      {/* Scene backgrounds follow the plan, so they cut when the lines do. */}
      <Sequence {...plan.scene('intro')}>
        <Rect width={1280} height={720} fill="#20243a" />
      </Sequence>
      <Sequence {...plan.scene('body')}>
        <Rect width={1280} height={720} fill="#2f3b2a" />
      </Sequence>
      <CharacterView ref={akaneView} character={akane} x={840} y={120} />
      <DialogueSeries plan={plan} views={{ akane: akaneView }} />
    </Composition>
  );
}

// What `<Dialogue>` lines report for the exporter's subtitle file.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';

import { Assets, Composition, FreezeFrame, Sequence, Span } from '@celesta/react';
import { Character, CharacterView, Dialogue, DialogueSeries, planDialogue } from '../dist/index.js';
import { mount } from '@celesta/react/internal';

const h = React.createElement;

const portrait = { defaultExpression: 'calm', expressions: { calm: 'calm.png' } };

/** Every distinct subtitle reported over `frames` frames at 30 fps, in first-seen order. */
function subtitles(Root, frames) {
  const mounted = mount(Root);
  const seen = new Map();
  for (let frame = 0; frame < frames; frame++) {
    for (const cue of mounted.renderAt({ value: frame, timescale: 30 }, null).subtitles) {
      seen.set(JSON.stringify(cue), cue);
    }
  }
  return [...seen.values()].map(({ text, start, end }) => [text, Math.round(start * 30), Math.round(end * 30)]);
}

test('each dialogue line is a subtitle for as long as its sequence, held lines are not', async () => {
  const plan = await planDialogue(
    [
      { id: 'one', text: 'First', durationInFrames: 10, gap: 0.2, speaker: 'mira' },
      { id: 'two', text: 'Second', durationInFrames: 10, gap: 0.2, speaker: 'mira' },
    ],
    { fps: 30 },
  );
  const mira = React.createRef();
  const view = React.createRef();
  const Root = () =>
    h(
      Composition,
      { width: 640, height: 360, fps: 30, durationInFrames: plan.durationInFrames },
      h(Assets, null, h(Character, { ref: mira, name: 'mira', portrait })),
      h(CharacterView, { ref: view, character: mira }),
      h(DialogueSeries, { plan, views: { mira: view }, holdSubtitle: true }),
    );
  // one: 0–10, gap to 16; two: 16–26. The held gaps report nothing.
  assert.deepEqual(subtitles(Root, plan.durationInFrames), [['First', 0, 10], ['Second', 16, 26]]);
});

test('a dialogue line reports its spans as plain text, and nothing inside a freeze frame', () => {
  const mira = React.createRef();
  const view = React.createRef();
  const Root = () =>
    h(
      Composition,
      { width: 640, height: 360, fps: 30, durationInFrames: 20 },
      h(Assets, null, h(Character, { ref: mira, name: 'mira', portrait })),
      h(CharacterView, { ref: view, character: mira }),
      h(Sequence, { from: 5, durationInFrames: 10 },
        h(Dialogue, { character: view }, 'Hello ', h(Span, { style: { color: '#ff0000' } }, 'world'))),
      h(FreezeFrame, { frame: 7 },
        h(CharacterView, { ref: view, character: mira }),
        h(Dialogue, { character: view }, 'Frozen')),
    );
  assert.deepEqual(subtitles(Root, 20), [['Hello world', 5, 15]]);
});

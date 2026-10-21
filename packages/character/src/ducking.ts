// Ducking from a dialogue plan: where the voices are, and the volume of a
// bed that dips under them, as keyframes built in `prepare()`. The curve is
// `duckEnvelope`'s, the same one `<Audio duck>` plays.

import type { AnimatedNumber } from '@celesta/react';
import { duckEnvelope } from '@celesta/media-utils';
import type { DuckShape } from '@celesta/media-utils';

import type { DialogueLine, DialoguePlan } from './dialogue-series';
import type { VoiceLevelReport } from './voice-level';

/**
 * Seconds on the plan's clock where a voice plays: each line with `audio`
 * that is not muted, from its planned start for its planned length. With
 * `levels` (from `matchVoiceLevels()` on the same lines), a line is trimmed
 * to the speech its analysis found, and a silent one is left out; a line the
 * report did not analyze counts whole.
 */
export function speechIntervals<L extends DialogueLine>(
  plan: DialoguePlan<L>,
  options: { levels?: VoiceLevelReport } = {},
): Array<[number, number]> {
  const { levels } = options;
  if (levels && levels.lines.length !== plan.lines.length) {
    const count = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
    throw new Error(`speechIntervals(): the level report has ${count(levels.lines.length)}, the plan ${plan.lines.length}; pass the report of the lines the plan was made from`);
  }
  const intervals: Array<[number, number]> = [];
  for (const entry of plan.lines) {
    if (entry.line.audio === undefined || entry.line.muted) continue;
    const start = entry.from / plan.fps;
    const length = entry.durationInFrames / plan.fps;
    const analysis = levels?.lines[entry.index].analysis;
    if (!analysis) {
      intervals.push([start, start + length]);
    } else if (analysis.speechStartSeconds !== null && analysis.speechEndSeconds !== null) {
      intervals.push([start + analysis.speechStartSeconds, start + Math.min(length, analysis.speechEndSeconds)]);
    }
  }
  return intervals;
}

/**
 * The volume of a bed ducked under the plan's voices: `duckEnvelope` over
 * `speechIntervals(plan, { levels })`. `origin` is the frame, on the plan's
 * clock, that the `<Audio>`'s sequence starts on, as for `frameKeyframes`.
 */
export function duckingVolume<L extends DialogueLine>(
  plan: DialoguePlan<L>,
  duck: DuckShape & { volume?: number },
  options: { levels?: VoiceLevelReport; origin?: number } = {},
): AnimatedNumber {
  const origin = (options.origin ?? 0) / plan.fps;
  return duckEnvelope(speechIntervals(plan, { levels: options.levels }), duck, { origin });
}

import type { AudioClip } from './types';
import { type AutomationEvent, automationEvents } from './keyframes';

const RATE_MESSAGE = 'Audio playback rate must be positive.';

/** Throws when the Web Audio export cannot reproduce the clip faithfully. */
export function assertBrowserMixable(clip: AudioClip): void {
  if (typeof clip.playbackRate === 'number' && !(clip.playbackRate > 0)) throw new Error(RATE_MESSAGE);
  if ((clip.pitch !== undefined && clip.pitch !== 0) || (clip.preservePitch === true && clip.playbackRate !== 1)) {
    throw new Error('Audio pitch and preservePitch are not supported by browser export yet.');
  }
}

/** Schedules `events` from `automationEvents` on `param`. */
export function applyEvents(param: Pick<AudioParam, 'setValueAtTime' | 'linearRampToValueAtTime'>, events: AutomationEvent[]): void {
  for (const event of events) {
    if (event.kind === 'set') param.setValueAtTime(event.value, event.time);
    else param.linearRampToValueAtTime(event.value, event.time);
  }
}

/**
 * Plays `clip` from `buffer` into `context`'s destination: its playback rate
 * and volume follow their keyframes (volume clamped to 0–16, as in the native
 * mixer), its fades chain after the volume, and it stops at the clip's end on
 * the timeline or at `total`, the mix's length in seconds.
 */
export function scheduleClip(
  context: Pick<BaseAudioContext, 'createBufferSource' | 'createGain' | 'destination'>,
  clip: AudioClip,
  buffer: AudioBuffer,
  total: number,
): void {
  assertBrowserMixable(clip);
  const begin = Math.max(0, clip.start);
  const end = clip.start + clip.duration;
  if (clip.start >= total || end <= begin) return;
  const rate = automationEvents(clip.playbackRate, clip.start, end);
  // Web Audio would play a negative rate backwards; the native mixer plays silence.
  if (rate.some((event) => !(event.value > 0))) throw new Error(RATE_MESSAGE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  applyEvents(source.playbackRate, rate);
  // Looping starts the source over from its beginning past its end.
  source.loop = clip.loop === true;
  const offset = source.loop ? ((clip.sourceStart % buffer.duration) + buffer.duration) % buffer.duration : clip.sourceStart;
  const gain = context.createGain();
  applyEvents(gain.gain, automationEvents(clip.volume, clip.start, end, { min: 0, max: 16 }));
  let output: AudioNode = source.connect(gain);
  for (const fade of fadeGains(context, clip)) output = output.connect(fade);
  output.connect(context.destination);
  // Stopping on the timeline holds for any rate, where start()'s duration
  // argument is in source seconds and only right for a constant rate.
  source.start(begin, offset);
  source.stop(Math.min(end, total));
}

/**
 * Gain nodes for the clip's fade-in and fade-out, to chain after its volume.
 * Each fade is a node of its own, so fades that overlap multiply as they do
 * in the native mixer.
 */
export function fadeGains(context: Pick<BaseAudioContext, 'createGain'>, clip: AudioClip): GainNode[] {
  const end = clip.start + clip.duration;
  const gains: GainNode[] = [];
  if (clip.fadeIn) gains.push(ramp(context, clip.start, clip.start + clip.fadeIn, 0, 1));
  if (clip.fadeOut) gains.push(ramp(context, end - clip.fadeOut, end, 1, 0));
  return gains;
}

/** A gain moving linearly from `fromValue` at `from` seconds to `toValue` at `to`. */
function ramp(context: Pick<BaseAudioContext, 'createGain'>, from: number, to: number, fromValue: number, toValue: number): GainNode {
  const node = context.createGain();
  // Automation cannot start before 0, so a ramp under way by then starts
  // from where it has got to.
  const start = Math.max(0, from);
  node.gain.setValueAtTime(fromValue + (toValue - fromValue) * Math.min(1, (start - from) / (to - from)), start);
  if (to > start) node.gain.linearRampToValueAtTime(toValue, to);
  return node;
}

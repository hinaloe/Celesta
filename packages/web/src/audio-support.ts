import type { AudioClip } from './types';

/** Throws when the Web Audio export cannot reproduce the clip faithfully. */
export function assertBrowserMixable(clip: AudioClip): asserts clip is AudioClip & { playbackRate: number; volume: number } {
  if (typeof clip.playbackRate !== 'number' || typeof clip.volume !== 'number') {
    throw new Error('Animated audio volume and playback rate are not supported by browser export yet.');
  }
  if (!(clip.playbackRate > 0)) throw new Error('Audio playback rate must be positive.');
  if ((clip.pitch !== undefined && clip.pitch !== 0) || (clip.preservePitch === true && clip.playbackRate !== 1)) {
    throw new Error('Audio pitch and preservePitch are not supported by browser export yet.');
  }
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

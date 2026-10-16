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

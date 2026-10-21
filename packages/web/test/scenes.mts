import type { Scene } from '../src/types';

/** A still scene of `scene`'s size, fonts, and layers: `SceneCanvas` reads no frame rate or time. */
export const still = (scene: Omit<Scene, 'frameRate' | 'time'>): Scene => ({
  frameRate: { numerator: 30, denominator: 1 }, time: { value: 0, timescale: 30 }, ...scene,
});

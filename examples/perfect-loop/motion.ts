export const WIDTH = 1080;
export const HEIGHT = 1350;
export const FPS = 60;
export const FRAMES = 16 * FPS;
export const PAPER = '#F3EADB';
export const INK = '#17171C';
const COLORS = [INK, '#F55138', PAPER, '#284BE4'];
const DETAILS = [PAPER, PAPER, INK, PAPER];
const RATIO = 0.58;
const TAU = Math.PI * 2;

/** Advancing eight shells repeats both the four-color palette and geometry.
 * Relative depth controls every transform: shell i at t = 16 is shell i - 8
 * at t = 0, including its rotation and decorations. No crossfade or reset.
 * Deliberately accepts frame 960 so the boundary can be checked directly.
 */
export function tunnelAt(frame: number) {
  const phase = frame / FRAMES;
  const depth = 8 * phase + 0.10 * Math.sin(TAU * 8 * phase);
  const twist = 32 * Math.sin(TAU * phase) + 9 * Math.sin(TAU * 2 * phase);
  const center = {
    x: 486 + 14 * Math.sin(TAU * phase),
    y: 486 + 14 * Math.sin(TAU * 2 * phase),
  };
  const shells = Array.from({ length: 22 }, (_, offset) => {
    const index = Math.floor(depth) - 4 + offset;
    const relative = index - depth;
    const slot = ((index % 4) + 4) % 4;
    return {
      index, radius: 690 * RATIO ** relative,
      rotation: relative * 22.5 + twist,
      round: index % 2 === 0, color: COLORS[slot], detail: DETAILS[slot],
    };
  });
  // Retain the innermost shell covering the aperture in either geometry.
  let covering = 0;
  for (let i = 0; i < shells.length; i++) {
    if (shells[i].radius > 1100) covering = i;
  }
  return { center, shells: shells.slice(Math.max(0, covering)) };
}

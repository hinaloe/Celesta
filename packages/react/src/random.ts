// Deterministic randomness. Every frame must be a pure function of the frame
// number, so `Math.random()` is off limits in a composition; these return the
// same value for the same seed on every render, in preview and in export.

/** Hashes a string seed to a 32-bit integer (FNV-1a). */
function hashString(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes a 32-bit integer into a well-distributed one (the murmur3 finalizer). */
function mix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function seedToInt(seed: number | string): number {
  if (typeof seed === 'string') {
    return hashString(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new Error('random() requires a finite number or a string seed');
  }
  // Keep fractional seeds distinct: 0.5 and 1.5 must not collide with 0 and 1.
  return Number.isInteger(seed) ? seed | 0 : hashString(String(seed));
}

/**
 * A pseudo-random number in `[0, 1)` for `seed`: the same seed always gives
 * the same number. Use an index, or a string such as `` `star-${i}-x` ``, so
 * that different properties get independent values.
 */
export function random(seed: number | string): number {
  return mix32(seedToInt(seed) ^ 0x9e3779b9) / 4294967296;
}

/**
 * Smooth 1D value noise in `[-1, 1]`: random values at whole numbers of `t`,
 * blended with smoothstep in between. Feed it time (`frame / 20`) for drift,
 * wobble, or camera shake; different seeds give unrelated curves.
 */
export function noise(seed: number | string, t: number): number {
  if (!Number.isFinite(t)) {
    throw new Error('noise() requires a finite t');
  }
  const base = seedToInt(seed);
  const i = Math.floor(t);
  const u = t - i;
  const s = u * u * (3 - 2 * u);
  const a = mix32(base ^ mix32(i)) / 4294967296;
  const b = mix32(base ^ mix32(i + 1)) / 4294967296;
  return (a + (b - a) * s) * 2 - 1;
}

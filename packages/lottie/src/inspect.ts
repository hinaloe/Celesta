// Finds the features of a Lottie file that `<Lottie>` does not draw, so a
// file that would come out differently from After Effects says so.

import type { LottieAnimation, LottieLayer, LottieMask, LottieShape } from './types';

const layerTypes: Record<number, string> = {
  5: 'text layers',
  6: 'audio layers',
  7: 'video placeholder layers',
  8: 'image sequence layers',
  9: 'video layers',
  10: 'image placeholder layers',
  11: 'guide layers',
  12: 'adjustment layers',
  13: 'camera layers',
  14: 'light layers',
  15: 'data layers',
};

const shapeItems: Record<string, string> = {
  mm: 'merge paths',
  rp: 'repeaters',
  rd: 'round corners',
  pb: 'pucker & bloat',
  tw: 'twist',
  op: 'offset paths',
  zz: 'zig zag',
  ms: 'mesh fills',
  no: 'no-style items',
};

const supportedShapes = new Set(['gr', 'sh', 'rc', 'el', 'sr', 'fl', 'st', 'gf', 'gs', 'tm', 'tr']);

/** Whether a property's value is ever other than `value`. */
function differs(prop: unknown, value: number): boolean {
  if (typeof prop !== 'object' || prop === null || !('k' in prop)) {
    return false;
  }
  const k = (prop as { k: unknown }).k;
  if (typeof k === 'number') {
    return k !== value;
  }
  if (Array.isArray(k)) {
    return k.some(entry => typeof entry === 'number'
      ? entry !== value
      : typeof entry === 'object' && entry !== null && 's' in entry
        && [entry.s].flat().some(v => typeof v === 'number' && v !== value));
  }
  return false;
}

/** Whether any property object below `value` has an expression. */
function hasExpression(value: unknown, depth = 0): boolean {
  if (depth > 64 || typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(entry => hasExpression(entry, depth + 1));
  }
  const record = value as Record<string, unknown>;
  if ('k' in record && typeof record.x === 'string' && record.x.length > 0) {
    return true;
  }
  return Object.entries(record).some(([key, entry]) =>
    key !== 'layers' && key !== 'shapes' && key !== 'it' && hasExpression(entry, depth + 1));
}

/**
 * The features `animation` uses that `<Lottie>` does not draw, one message
 * each, naming the first layer that uses it. Empty when everything is drawn.
 */
export function inspectLottie(animation: LottieAnimation): string[] {
  const found = new Map<string, string>();
  const note = (feature: string, layer: LottieLayer | undefined) => {
    if (!found.has(feature)) {
      found.set(feature, layer?.nm === undefined ? '' : ` (layer "${layer.nm}")`);
    }
  };

  const shapes = (items: readonly LottieShape[] | undefined, layer: LottieLayer) => {
    for (const shape of items ?? []) {
      if (shape.hd === true) {
        continue;
      }
      if (!supportedShapes.has(shape.ty)) {
        note(shapeItems[shape.ty] ?? `shape items of type "${shape.ty}"`, layer);
        continue;
      }
      if (hasExpression(shape)) {
        note('expressions', layer);
      }
      if ((shape.ty === 'fl' || shape.ty === 'gf') && shape.r === 2) {
        note('the even-odd fill rule', layer);
      }
      if ((shape.ty === 'gf' || shape.ty === 'gs') && shape.t === 2 && differs(shape.h, 0)) {
        note('radial gradient highlights', layer);
      }
      if (shape.ty === 'gr') {
        const tr = (shape.it as LottieShape[] | undefined)?.find(child => child.ty === 'tr');
        if (tr !== undefined && (differs(tr.rx, 0) || differs(tr.ry, 0))) {
          note('3D transforms', layer);
        }
        shapes(shape.it as LottieShape[] | undefined, layer);
      }
    }
  };

  const masks = (list: readonly LottieMask[] | undefined, layer: LottieLayer) => {
    for (const mask of list ?? []) {
      if (mask.mode === 'l' || mask.mode === 'd' || mask.mode === 'f') {
        note('lighten, darken, and difference masks', layer);
      }
      if (differs(mask.x, 0)) {
        note('mask expansion', layer);
      }
      if (hasExpression(mask)) {
        note('expressions', layer);
      }
    }
  };

  const seen = new Set<readonly LottieLayer[]>();
  const assets = new Map((animation.assets ?? []).map(asset => [asset.id, asset]));
  const layers = (list: readonly LottieLayer[] | undefined) => {
    if (list === undefined || seen.has(list)) {
      return;
    }
    seen.add(list);
    for (const layer of list) {
      const type = layerTypes[layer.ty];
      if (type !== undefined) {
        note(type, layer);
        continue;
      }
      if (layer.ty < 0 || layer.ty > 4) {
        note(`layers of type ${layer.ty}`, layer);
        continue;
      }
      if (layer.ddd === 1) {
        note('3D layers', layer);
      }
      if (layer.ao === 1) {
        note('auto-orient', layer);
      }
      if ((layer.ef ?? []).length > 0) {
        note('layer effects', layer);
      }
      if ((layer.sy ?? []).length > 0) {
        note('layer styles', layer);
      }
      if (layer.bm !== undefined && layer.bm > 16) {
        note('hard mix and other blend modes past "add"', layer);
      }
      if (layer.tt !== undefined && (layer.tt < 1 || layer.tt > 4)) {
        note(`track mattes of type ${layer.tt}`, layer);
      }
      if (hasExpression(layer.ks) || hasExpression(layer.tm)) {
        note('expressions', layer);
      }
      masks(layer.masksProperties, layer);
      if (layer.ty === 4) {
        shapes(layer.shapes, layer);
      }
      if (layer.ty === 0) {
        const asset = layer.refId === undefined ? undefined : assets.get(layer.refId);
        if (asset?.layers === undefined) {
          note('precompositions whose asset is missing', layer);
        }
        layers(asset?.layers);
      }
      if (layer.ty === 2) {
        const asset = layer.refId === undefined ? undefined : assets.get(layer.refId);
        if (asset?.p === undefined) {
          note('image layers whose asset is missing', layer);
        } else if (asset.e === 1 || asset.p.startsWith('data:')) {
          note('embedded images (export them as separate files and set `assetsPath`)', layer);
        }
      }
    }
  };
  layers(animation.layers);
  return [...found].map(([feature, where]) => `<Lottie> does not support ${feature}${where}`);
}

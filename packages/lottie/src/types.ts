// The parts of the Lottie (Bodymovin) JSON format this package reads. Field
// names are the format's own one- and two-letter keys; everything is optional
// that exporters leave out. See https://lottiefiles.github.io/lottie-docs/.

/** Bézier easing handles of a keyframe: one number, or one per dimension. */
export interface LottieEasing {
  x: number | number[];
  y: number | number[];
}

export interface LottieKeyframe<T> {
  /** Frame the keyframe is at. */
  t: number;
  /** Value at `t`. Scalars come as one-element arrays. */
  s?: T;
  /** Value at the next keyframe, in files from Bodymovin before 5.5. */
  e?: T;
  /** Easing into the next keyframe. */
  i?: LottieEasing;
  /** Easing out of this keyframe. */
  o?: LottieEasing;
  /** 1 holds the value until the next keyframe. */
  h?: number;
  /** Spatial out tangent of a position keyframe, relative to `s`. */
  to?: number[];
  /** Spatial in tangent of the next position keyframe, relative to it. */
  ti?: number[];
}

/** A property: a static value (`a: 0`) or keyframes (`a: 1`). */
export interface LottieProperty<T> {
  a?: number;
  k: T | LottieKeyframe<T>[];
  /** An After Effects expression, which this package does not run. */
  x?: string;
}

export type LottieValue = LottieProperty<number | number[]>;

/** A Bézier path: vertices, and in/out tangents relative to them. */
export interface LottieBezier {
  c?: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

export type LottieShapeProperty = LottieProperty<LottieBezier | LottieBezier[]>;

/** Position with separate x and y properties. */
export interface LottieSplitPosition {
  s: true;
  x: LottieValue;
  y: LottieValue;
}

export interface LottieTransform {
  a?: LottieValue;
  p?: LottieValue | LottieSplitPosition;
  s?: LottieValue;
  r?: LottieValue;
  o?: LottieValue;
  sk?: LottieValue;
  sa?: LottieValue;
  rx?: LottieValue;
  ry?: LottieValue;
  rz?: LottieValue;
  or?: LottieValue;
}

export interface LottieMask {
  /** `a` add, `s` subtract, `i` intersect, `n` none; `l`, `d`, `f` are not supported. */
  mode?: string;
  inv?: boolean;
  pt: LottieShapeProperty;
  o?: LottieValue;
  x?: LottieValue;
}

export interface LottieShape {
  ty: string;
  nm?: string;
  hd?: boolean;
  [key: string]: unknown;
}

export interface LottieLayer {
  ty: number;
  nm?: string;
  ind?: number;
  parent?: number;
  ip: number;
  op: number;
  st?: number;
  sr?: number;
  ks?: LottieTransform;
  ddd?: number;
  hd?: boolean;
  /** Blend mode, by After Effects' index. */
  bm?: number;
  ao?: number;
  /** 1 when this layer is a track matte, only drawn through the layer it masks. */
  td?: number;
  /** Track matte of this layer: 1 alpha, 2 inverted alpha, 3 luma, 4 inverted luma. */
  tt?: number;
  /** Index (`ind`) of the matte layer; without it, the layer above is. */
  tp?: number;
  hasMask?: boolean;
  masksProperties?: LottieMask[];
  /** Precomposition or image asset id. */
  refId?: string;
  /** Time remap of a precomposition layer, in seconds. */
  tm?: LottieValue;
  w?: number;
  h?: number;
  /** Solid color (`#rrggbb`), width, and height. */
  sc?: string;
  sw?: number;
  sh?: number;
  shapes?: LottieShape[];
  ef?: unknown[];
  sy?: unknown[];
  [key: string]: unknown;
}

export interface LottieAsset {
  id: string;
  layers?: LottieLayer[];
  w?: number;
  h?: number;
  /** File name, or a data URL when `e` is 1. */
  p?: string;
  /** Directory of `p`. */
  u?: string;
  e?: number;
  fr?: number;
}

/** A Lottie animation, as `JSON.parse` returns it from a Bodymovin export. */
export interface LottieAnimation {
  v?: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm?: string;
  ddd?: number;
  layers: LottieLayer[];
  assets?: LottieAsset[];
  fonts?: unknown;
  chars?: unknown[];
  markers?: unknown[];
  [key: string]: unknown;
}

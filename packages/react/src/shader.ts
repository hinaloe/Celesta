// Filters as the scene walker accepts them: custom shaders, which
// `@celesta/shader` builds through `@celesta/react/internal`, and the
// built-in color filters. The walker serializes them into `effects.filters`
// and lists the custom shaders' sources in the scene's `shaders`.

import type { LayerFilter } from './generated/LayerFilter';
import type { ShaderSource } from './generated/ShaderSource';
import type { ShaderParamType } from './generated/ShaderParamType';

const MAX_PARAMS = 16;

const COMPONENTS: Record<ShaderParamType, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };

/** A shader definition registered with `shaderSource()`. */
export class ShaderSourceHandle {
  readonly id: string;
  readonly source: ShaderSource;
  /** How many numbers one use of the shader gives. */
  readonly components: number;

  /** @internal */
  constructor(source: ShaderSource, components: number) {
    this.id = source.id;
    this.source = source;
    this.components = components;
  }
}

/** A built-in color filter as the scene lists it. */
export type ColorFilter = Exclude<LayerFilter, { type: 'shader' }>;

/**
 * A filter with concrete values: a custom shader from `@celesta/shader`'s
 * `defineShader()`, or a built-in color filter such as `brightness(1.2)`.
 */
export class ShaderEffect {
  readonly #source: ShaderSourceHandle | null;
  readonly #params: readonly number[];
  readonly #padding: number;
  readonly #filter: ColorFilter | null;

  /** @internal */
  constructor(source: ShaderSourceHandle | ColorFilter, params: readonly number[] = [], padding = 0) {
    const custom = source instanceof ShaderSourceHandle;
    this.#source = custom ? source : null;
    this.#filter = custom ? null : source;
    this.#params = params;
    this.#padding = padding;
  }

  /** @internal The custom shader's source; `null` for a color filter. */
  static source(effect: ShaderEffect): ShaderSourceHandle | null {
    return effect.#source;
  }

  /** @internal */
  static serialize(effect: ShaderEffect): LayerFilter {
    if (effect.#filter) return { ...effect.#filter };
    return {
      type: 'shader',
      id: effect.#source!.id,
      ...(effect.#params.length > 0 ? { params: [...effect.#params] } : {}),
      ...(effect.#padding !== 0 ? { padding: effect.#padding } : {}),
    };
  }
}

/** `tint`: lays `color` over the pixels at `amount`, keeping their alpha. */
export interface LayerTint {
  /** `#RRGGBB` or `#RRGGBBAA`; its alpha scales `amount`. */
  color: string;
  /** 0 keeps the pixels, 1 replaces their color. Defaults to 1. */
  amount?: number;
}

/** `vignette`: darkens toward the edges of the layer's content box. */
export interface LayerVignette {
  /** How dark the corners get: 0 not at all, 1 black. */
  amount: number;
  /**
   * Where darkening starts, from 0 at the box's centre to 1 at its
   * corners. Defaults to 0.5.
   */
  radius?: number;
  /** How far beyond `radius` darkening takes to reach `amount`. Defaults to 0.5. */
  softness?: number;
}

/** The value each built-in color filter takes. */
export interface ColorFilterValues {
  /** Multiplies the color: 1 keeps it, 0 is black, above 1 brightens. */
  brightness: number;
  /** Scales the distance from mid-gray: 1 keeps it, 0 is mid-gray. */
  contrast: number;
  /** 1 keeps the color, 0 is grayscale, above 1 saturates. */
  saturation: number;
  /** Rotates the hue, in degrees. */
  hue: number;
  /** 0 keeps the color, 1 is grayscale. */
  grayscale: number;
  /** 0 keeps the color, 1 inverts it. */
  invert: number;
  tint: LayerTint;
  /** A number is the `amount`, with the default radius and softness. */
  vignette: number | LayerVignette;
}

export type ColorFilterName = keyof ColorFilterValues;

/** The built-in color filters, in the order their props apply. */
export const COLOR_FILTERS: readonly ColorFilterName[] = [
  'brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'invert', 'tint', 'vignette',
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * The built-in color filter `name` with `value`, checked; throws naming
 * the filter. Each works on the straight sRGB color, keeps alpha, and
 * clamps its result to 0–1.
 */
export function colorFilter<N extends ColorFilterName>(name: N, value: ColorFilterValues[N]): ShaderEffect;
export function colorFilter(name: ColorFilterName, value: unknown): ShaderEffect {
  const number = (input: unknown, label: string, min = -Infinity, max = Infinity): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
      const range = max === Infinity
        ? (min === -Infinity ? '' : ` of at least ${min}`)
        : ` between ${min} and ${max}`;
      throw new Error(`${label} must be a finite number${range}`);
    }
    return input;
  };
  const object = (input: unknown, label: string): Record<string, unknown> => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(`${label} must be an object`);
    }
    return input as Record<string, unknown>;
  };
  switch (name) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      return new ShaderEffect({ type: name, amount: number(value, name, 0) });
    case 'hue':
      return new ShaderEffect({ type: 'hue', degrees: number(value, 'hue') });
    case 'grayscale':
    case 'invert':
      return new ShaderEffect({ type: name, amount: number(value, name, 0, 1) });
    case 'tint': {
      const tint = object(value, 'tint');
      if (typeof tint.color !== 'string' || !HEX_COLOR.test(tint.color)) {
        throw new Error('tint.color must be a #RRGGBB or #RRGGBBAA color');
      }
      const amount = tint.amount === undefined ? 1 : number(tint.amount, 'tint.amount', 0, 1);
      return new ShaderEffect({ type: 'tint', color: tint.color, amount });
    }
    case 'vignette': {
      const vignette = typeof value === 'number' ? { amount: value } : object(value, 'vignette');
      const label = typeof value === 'number' ? 'vignette' : 'vignette.amount';
      return new ShaderEffect({
        type: 'vignette',
        amount: number(vignette.amount, label, 0, 1),
        radius: vignette.radius === undefined ? 0.5 : number(vignette.radius, 'vignette.radius', 0),
        softness: vignette.softness === undefined ? 0.5 : number(vignette.softness, 'vignette.softness', 0),
      });
    }
    default:
      throw new Error(`unknown color filter ${JSON.stringify(name)}`);
  }
}

/** Whether the color filter leaves every pixel as it was. */
export function isIdentityFilter(filter: ColorFilter): boolean {
  switch (filter.type) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      return filter.amount === 1;
    case 'hue':
      return filter.degrees % 360 === 0;
    case 'tint':
      return filter.amount === 0 || /^#[0-9a-fA-F]{6}00$/.test(filter.color);
    default:
      return filter.amount === 0;
  }
}

/**
 * 64-bit FNV-1a over UTF-16 code units, as 16 hex digits. Not
 * cryptographic: the renderer compares the source before reusing a compiled
 * shader, so a collision costs a recompile, not a wrong picture.
 */
function fnv1a64(text: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash ^ BigInt(text.charCodeAt(index))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** `value` as a flat string; see `flatString` in render.ts. */
function flat(value: string): string {
  return value.length < 13 ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Registers a shader definition once: checks its shape, flattens its strings
 * for the per-frame serialization, and computes its id from the source and
 * the parameters' names and types.
 */
export function shaderSource(definition: {
  name?: string;
  wgsl: string;
  params: readonly { name: string; type: ShaderParamType }[];
}): ShaderSourceHandle {
  const { name, wgsl, params } = definition;
  if (typeof wgsl !== 'string' || wgsl.length === 0) {
    throw new Error('shaderSource: wgsl must be a non-empty string');
  }
  if (name !== undefined && typeof name !== 'string') {
    throw new Error('shaderSource: name must be a string');
  }
  if (!Array.isArray(params) || params.length > MAX_PARAMS) {
    throw new Error(`shaderSource: params must be an array of at most ${MAX_PARAMS} parameters`);
  }
  let components = 0;
  for (const param of params) {
    if (typeof param?.name !== 'string' || !Object.prototype.hasOwnProperty.call(COMPONENTS, param.type)) {
      throw new Error('shaderSource: each parameter needs a name and a type of f32, vec2, vec3, or vec4');
    }
    components += COMPONENTS[param.type as ShaderParamType];
  }
  // JSON of an array keeps the encoding unambiguous for any name.
  const id = flat(fnv1a64(JSON.stringify([wgsl, params.map((param) => [param.name, param.type])])));
  return new ShaderSourceHandle(
    {
      id,
      ...(name !== undefined ? { name: flat(name) } : {}),
      wgsl: flat(wgsl),
      ...(params.length > 0
        ? { params: params.map((param) => ({ name: flat(param.name), type: param.type })) }
        : {}),
    },
    components,
  );
}

/** One use of a shader: every parameter's components in declared order, and the padding. */
export function shaderEffect(
  source: ShaderSourceHandle,
  params: readonly number[],
  padding: number,
): ShaderEffect {
  if (!(source instanceof ShaderSourceHandle)) {
    throw new Error('shaderEffect: source must come from shaderSource()');
  }
  if (!Array.isArray(params) || params.length !== source.components) {
    throw new Error(`shaderEffect: expected ${source.components} parameter values`);
  }
  // A dense copy: `every` would skip the holes of a sparse array.
  const values = Array.from(params);
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('shaderEffect: parameter values must be finite numbers');
  }
  if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
    throw new Error('shaderEffect: padding must be a finite number of at least 0');
  }
  return new ShaderEffect(source, values, padding);
}

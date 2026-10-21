import type { FontFeatures } from './scene';

/** A CSS `font-feature-settings` tag: four characters from U+20 to U+7E. */
const FEATURE_TAG = /^[\x20-\x7e]{4}$/;

/**
 * Throws unless `features` maps feature tags to `true`, `false`, or whole
 * numbers from 0 to 2³² − 1, as the renderer reads them; checked here so a
 * bad one fails at the component that set it, not at export.
 */
export function checkFontFeatures(features: unknown, owner: string): asserts features is FontFeatures {
  if (typeof features !== 'object' || features === null || Array.isArray(features)) {
    throw new Error(`${owner} fontFeatures must be an object of feature tags, such as { liga: false }`);
  }
  for (const [tag, value] of Object.entries(features)) {
    if (!FEATURE_TAG.test(tag)) {
      throw new Error(`${owner} fontFeatures tag ${JSON.stringify(tag)} must be four ASCII characters, such as "liga"`);
    }
    if (typeof value !== 'boolean' && !(Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) {
      throw new Error(`${owner} fontFeatures.${tag} must be true, false, or a whole number from 0 up, got ${JSON.stringify(value)}`);
    }
  }
}

// Counting numbers: the progress of a count from frame to frame, and the
// formatting every counting component shares, so a counter, a stat card,
// and a bar chart's values print the same number the same way.

/** How a number is printed. */
export interface NumberFormat {
  /**
   * The BCP 47 locale for digit grouping and the decimal mark. Defaults to
   * `'en-US'` (`1,234.5`), so the output never depends on the machine's
   * locale.
   */
  locale?: string;
  /** Decimal places, always shown: `12.0` with 1. An integer from 0 to 20; defaults to 0. */
  decimals?: number;
  /** Text before the number, such as `'$'`. */
  prefix?: string;
  /** Text after the number, such as `' 件'` or `'%'`. */
  suffix?: string;
  /**
   * Prints the number instead of the locale's formatting: it gets the value
   * rounded to `decimals` and returns its text. `prefix` and `suffix` still
   * go around what it returns.
   */
  formatter?: (value: number) => string;
}

/** When and how a number counts towards its value. */
export interface CountTiming {
  /** Frame counting starts, relative to the enclosing `<Sequence>`. Defaults to 0. */
  delay?: number;
  /** Frames to reach the value; 0 jumps to it at `delay`. Defaults to 30. */
  durationInFrames?: number;
  /** Defaults to `Easings.easeOutExpo`: fast at first, settling on the value. */
  easing?: (t: number) => number;
}

const formats = new Map<string, Intl.NumberFormat>();

function decimalPlaces(decimals: number, caller: string): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) {
    throw new Error(`${caller} decimals must be an integer from 0 to 20, not ${decimals}`);
  }
  return decimals;
}

/** `value` rounded half up to `decimals` places, with -0 as 0 so it never prints a sign. */
function rounded(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return result === 0 ? 0 : result;
}

/**
 * `value` printed as `<Counter>`, `<StatCard>`, and `<BarChart>` print it:
 * rounded half up to `decimals`, grouped and given a decimal mark by
 * `locale` (or printed by `formatter`), between `prefix` and `suffix`. A
 * value that rounds to 0 prints without a minus sign. Throws on a value that
 * is not finite.
 *
 * ```ts
 * formatNumber(1280, { suffix: ' 件' });            // "1,280 件"
 * formatNumber(1234.5, { locale: 'de-DE', decimals: 1 }); // "1.234,5"
 * ```
 */
export function formatNumber(value: number, format: NumberFormat = {}, caller = 'formatNumber()'): string {
  const { locale = 'en-US', decimals = 0, prefix = '', suffix = '', formatter } = format;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${caller} value must be a finite number, not ${value}`);
  }
  const places = decimalPlaces(decimals, caller);
  const number = rounded(value, places);
  if (formatter) return prefix + formatter(number) + suffix;
  const key = `${locale}\u0000${places}`;
  let intl = formats.get(key);
  if (!intl) {
    intl = new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places });
    formats.set(key, intl);
  }
  return prefix + intl.format(number) + suffix;
}

/**
 * How far a count is at `frame`, 0 to 1 through `easing`: 0 before `start`,
 * 1 from `start + durationInFrames` on. A duration of 0 jumps from 0 to 1 at
 * `start`.
 */
export function countProgress(frame: number, start: number, durationInFrames: number, easing: (t: number) => number, caller: string): number {
  if (!Number.isFinite(start)) throw new Error(`${caller} delay must be a finite number, not ${start}`);
  if (!Number.isFinite(durationInFrames) || durationInFrames < 0) {
    throw new Error(`${caller} durationInFrames must be a finite number of 0 or more, not ${durationInFrames}`);
  }
  if (durationInFrames === 0) return frame >= start ? 1 : 0;
  return easing(Math.min(1, Math.max(0, (frame - start) / durationInFrames)));
}

/** `value` checked to be a finite number. */
export function finiteValue(value: number, name: string, caller: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${caller} ${name} must be a finite number, not ${value}`);
  return value;
}

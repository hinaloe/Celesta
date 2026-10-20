// Things shown for a while on a timeline — captions, subtitle pages — as
// half-open frame ranges, checked once and looked up per frame. Captions and
// dialogue subtitles share the rules: where a range starts and ends, what an
// open end means, what counts as overlapping, and what falls outside.

/** Something shown on frames `[from, from + durationInFrames)`. */
export interface TimedItem {
  /** First frame it is shown on, a whole number. */
  from: number;
  /**
   * Frames it is shown, a whole number of at least 1. Omitted, it lasts
   * until the next item's `from`, or for the last item until the `end` the
   * items are resolved against.
   */
  durationInFrames?: number;
}

/** A `TimedItem`'s frames, `[from, end)`, and its index in the list given. */
export interface TimedRange {
  index: number;
  from: number;
  end: number;
}

export interface ResolveTimedRangesOptions {
  /** Names the list in errors, such as `'<CaptionTrack>'`. */
  what: string;
  /** Names one item in errors, such as `cue "intro"`. Defaults to `item <index>`. */
  label?: (index: number) => string;
  /**
   * The frames the items must fit in, `[0, end)`: an item starting before 0
   * or ending after `end` is an error, and an open-ended last item stops
   * there. Omitted, items may sit anywhere, and every item needs a
   * `durationInFrames` unless another follows it.
   */
  end?: number;
  /**
   * What two items sharing frames mean. `'error'` (the default) throws;
   * `'latest'` lets the one starting later (or, starting together, the one
   * later in the list) cut the other short.
   */
  overlap?: 'error' | 'latest';
  /** Requires the items listed in order of `from`. Defaults to false: they are sorted. */
  ordered?: boolean;
}

function wholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Checks timed items and returns their ranges in order of `from`, leaving
 * out items cut to nothing by `overlap: 'latest'`. Throws, naming
 * `options.what` and the item, for a `from` or `durationInFrames` that is
 * not a whole number (or a duration below 1), an open end with nothing to
 * stop it, an item outside `[0, end)`, an item out of order under
 * `ordered`, and overlapping items unless `overlap` is `'latest'`.
 */
export function resolveTimedRanges(
  items: readonly TimedItem[],
  options: ResolveTimedRangesOptions,
): TimedRange[] {
  const { what, end, overlap = 'error', ordered = false } = options;
  const label = options.label ?? ((index: number) => `item ${index}`);
  if (!Array.isArray(items)) throw new Error(`${what} needs a list of { from, durationInFrames }`);
  if (end !== undefined && (!wholeNumber(end) || end < 0)) {
    throw new Error(`${what}: the end frame must be a whole number of 0 or more, got ${String(end)}`);
  }
  items.forEach((item, index) => {
    if (item === null || typeof item !== 'object') throw new Error(`${what}: ${label(index)} is not an object`);
    if (!wholeNumber(item.from)) {
      throw new Error(`${what}: ${label(index)} needs a whole-number \`from\`, got ${String(item.from)}`);
    }
    const duration = item.durationInFrames;
    if (duration !== undefined && (!wholeNumber(duration) || duration < 1)) {
      throw new Error(`${what}: ${label(index)} needs a whole-number \`durationInFrames\` of at least 1, got ${String(duration)}`);
    }
    if (ordered && index > 0 && item.from < items[index - 1].from) {
      throw new Error(
        `${what}: ${label(index)} starts at frame ${item.from}, before ${label(index - 1)} (frame ${items[index - 1].from}); list them in order`,
      );
    }
  });
  const order = items.map((_, index) => index).sort((a, b) => items[a].from - items[b].from || a - b);
  const ranges = order.map((index, position): TimedRange => {
    const item = items[index];
    if (item.durationInFrames !== undefined) {
      return { index, from: item.from, end: item.from + item.durationInFrames };
    }
    const next = order[position + 1];
    if (next !== undefined) {
      if (items[next].from === item.from) {
        throw new Error(
          `${what}: ${label(index)} has no durationInFrames and starts on the same frame as ${label(next)}, so it has no frames`,
        );
      }
      return { index, from: item.from, end: items[next].from };
    }
    if (end === undefined) {
      throw new Error(`${what}: ${label(index)} needs a \`durationInFrames\`; nothing follows it`);
    }
    if (item.from >= end) {
      throw new Error(`${what}: ${label(index)} starts at frame ${item.from}, at or after the end (frame ${end})`);
    }
    return { index, from: item.from, end };
  });
  if (end !== undefined) {
    for (const range of ranges) {
      if (range.from < 0 || range.end > end) {
        throw new Error(
          `${what}: ${label(range.index)} (frames ${range.from}–${range.end}) is outside frames 0–${end}`,
        );
      }
    }
  }
  const kept: TimedRange[] = [];
  for (const range of ranges) {
    const previous = kept[kept.length - 1];
    if (previous && range.from < previous.end) {
      if (overlap !== 'latest') {
        throw new Error(
          `${what}: ${label(range.index)} (frames ${range.from}–${range.end}) overlaps ${label(previous.index)} `
            + `(frames ${previous.from}–${previous.end})`,
        );
      }
      previous.end = range.from;
      if (previous.end <= previous.from) kept.pop();
    }
    kept.push(range);
  }
  return kept;
}

/** The range shown on `frame`, `from <= frame < end`, or null when none is. `ranges` as `resolveTimedRanges()` returns them. */
export function timedRangeAt(ranges: readonly TimedRange[], frame: number): TimedRange | null {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle].from <= frame) low = middle + 1;
    else high = middle;
  }
  const candidate = ranges[low - 1];
  return candidate && frame < candidate.end ? candidate : null;
}

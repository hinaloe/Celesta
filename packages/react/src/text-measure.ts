import { entryRelativePath, isRemoteUrl } from './entry-dir';
import type { ResolvedAsset, TextStyle } from './scene';

/** One shaped glyph cluster (a ligature or combining sequence is one entry). */
export interface GlyphMetrics {
  /** The source text the cluster covers. */
  text: string;
  /** Left edge within its line, in composition pixels, alignment included. */
  x: number;
  /** Advance width. */
  width: number;
  /** Zero-based line the cluster sits on. */
  line: number;
}

export interface TextMetrics {
  /** Advance width of the widest line. */
  width: number;
  /** Height of all lines together. */
  height: number;
  /** First line's top edge to its baseline, half-leading included. */
  ascent: number;
  /** First line's baseline to its bottom edge; `ascent + descent === lineHeight`. */
  descent: number;
  lineHeight: number;
  lines: number;
  glyphs: GlyphMetrics[];
}

export interface MeasureTextOptions {
  /** Wrap at this width, like `<Text maxWidth>`. */
  maxWidth?: number;
  /**
   * Font files to load before measuring, like `<Font src>`. `prepare()` runs
   * before the tree renders, so `<Font>` declarations are not loaded yet.
   */
  fonts?: string[];
}

export type MeasureTextRequest = {
  text: string;
  style: TextStyle;
  maxWidth?: number;
  fonts: ResolvedAsset[];
};

let measure: ((request: MeasureTextRequest) => Promise<TextMetrics>) | undefined;

/** @internal Installed by the Celesta CLI before an entry's `prepare()` runs. */
export function setTextMeasurer(next: (request: MeasureTextRequest) => Promise<TextMetrics>): void {
  measure = next;
}

/**
 * Measures `text` laid out with `style` — the same shaping `<Text>` renders
 * with — during an entry's async `prepare()`. Stash the result in module
 * state for the synchronous render to read.
 */
export async function measureText(
  text: string,
  style: TextStyle = {},
  options: MeasureTextOptions = {},
): Promise<TextMetrics> {
  if (!measure) {
    throw new Error('measureText() requires a Celesta editor or exporter runtime');
  }
  const fonts = (options.fonts ?? []).map((src): ResolvedAsset => {
    const path = isRemoteUrl(src) ? src : entryRelativePath(src);
    return { id: src, location: isRemoteUrl(src) ? { type: 'url', url: src } : { type: 'file', path } };
  });
  return measure({
    text,
    style,
    ...(options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
    fonts,
  });
}

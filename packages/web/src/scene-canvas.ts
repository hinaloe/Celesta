import type { Scene, Layer, Asset, BuiltinFilter, FontRun, LineDash, Paint, PathCommand, TextStyle } from './types';
import { BLEND_MODES, blendPixels, coveredBox } from './blend-modes';
import type { BlendMode } from './blend-modes';
import { applyFilters } from './filters';
import { canvasDrawsAlike, gradientPixels } from './gradients';
import { SampleAverage } from './motion-blur';
import { loadFonts, releaseFonts } from './fonts';
import { checkFontRuns, cssFont, letterSpacingPx, measureLine, runPieces, textLineRanges, textStyle } from './text-layout';
import type { RunPiece } from './text-layout';
import { animationFrame, decodeAnimatedImage } from './animated-image';
import { audioBytes } from './audio-decode';
import type { AnimatedImage } from './animated-image';

type Canvas = HTMLCanvasElement;
type Context = CanvasRenderingContext2D;
type WebLayer = Layer;
type TextContent = Extract<Layer['content'], { type: 'text' }>;
/** Left, top, right, bottom, in scene pixels. */
type Box = [number, number, number, number];

/** The built-in filters whose grids, centres, or `uv` follow the content box. */
const READS_CONTENT_BOX = new Set(['vignette', 'pixelate', 'halftone', 'wave', 'scanlines', 'zoomBlur']);

/** The box of the points `commands` name, control points included, and 0,0 when the first command draws from there. */
function commandBox(commands: PathCommand[]): Box {
  const points = commands[0]?.type === 'moveTo' ? [] : [[0, 0]];
  for (const command of commands) {
    if (command.type === 'cubicTo') points.push([command.x1, command.y1], [command.x2, command.y2], [command.x, command.y]);
    else if (command.type === 'quadTo') points.push([command.x1, command.y1], [command.x, command.y]);
    else if (command.type !== 'close') points.push([command.x, command.y]);
  }
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const grow = ([left, top, right, bottom]: Box, by: number): Box => [left - by, top - by, right + by, bottom + by];

/**
 * A path's dashes for `setLineDash`, as the native renderers draw them: an
 * odd count repeated, an all-zero pattern solid, and the offset brought
 * within one repeat of the pattern first, so one that grows every frame
 * keeps its precision in engines that dash in single precision.
 */
export function canvasDash(dash: LineDash | null | undefined): { pattern: number[]; offset: number } {
  const pattern = dash?.pattern ?? [];
  const lengths = pattern.length % 2 === 1 ? [...pattern, ...pattern] : pattern;
  const period = lengths.reduce((sum, length) => sum + length, 0);
  const offset = dash?.offset ?? 0;
  if (!(period > 0 && Number.isFinite(period) && Number.isFinite(offset))) return { pattern: [], offset: 0 };
  return { pattern: lengths, offset: ((offset % period) + period) % period };
}

type Region = { start: number; end: number; x: number; width: number };
type RunSegment = { text: string; left: number; right: number; rtl: boolean; run?: FontRun };

/**
 * Cuts each run piece where its clusters stop sitting next to each other on
 * the shaped line, so a piece that bidi reordering splits (part of a
 * right-to-left word, say) is drawn as segments that each lie together,
 * left to right or right to left. `regions` are the line's clusters in
 * source order with their shaped extents; `tolerance` allows for letter
 * spacing between neighbors.
 */
function runSegments(text: string, pieces: RunPiece[], regions: Region[], tolerance: number): RunSegment[] {
  const characters = Array.from(text);
  const segments: RunSegment[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  // A lone cluster has no neighbor in its segment to show its direction, so
  // read it from its neighbors on the line: right to left when the cluster
  // after it in the text sits to its left, or the one before to its right.
  // Drawn that way, a mirrored character (a parenthesis) keeps its mirroring.
  const loneDirection = (region: Region): 'ltr' | 'rtl' | undefined => {
    const index = regions.indexOf(region);
    const next = regions[index + 1], previous = regions[index - 1];
    return (next && near(next.x + next.width, region.x)) || (previous && near(region.x + region.width, previous.x))
      ? 'rtl' : undefined;
  };
  for (const piece of pieces) {
    const end = piece.start + Array.from(piece.text).length;
    let current: { start: number; end: number; left: number; right: number; first: Region; last: Region; direction?: 'ltr' | 'rtl' } | undefined;
    const flush = () => {
      if (!current) return;
      const direction = current.direction ?? (current.first === current.last ? loneDirection(current.first) : undefined);
      segments.push({
        text: characters.slice(current.start, current.end).join(''), left: current.left, right: current.right,
        rtl: direction === 'rtl', run: piece.run,
      });
    };
    for (const region of regions) {
      if (region.start < piece.start || region.start >= end) continue;
      if (current) {
        const previous = current.last;
        const after = near(region.x, previous.x + previous.width);
        const before = near(region.x + region.width, previous.x);
        const direction = current.direction
          ? ((current.direction === 'ltr' ? after : before) ? current.direction : undefined)
          : after ? 'ltr' : before ? 'rtl' : undefined;
        if (direction) {
          Object.assign(current, {
            end: region.end, left: Math.min(current.left, region.x), right: Math.max(current.right, region.x + region.width),
            last: region, direction,
          });
          continue;
        }
        flush();
      }
      current = { start: region.start, end: region.end, left: region.x, right: region.x + region.width, first: region, last: region };
    }
    flush();
  }
  return segments;
}

export class SceneCanvas {
  private images = new Map<string, Promise<HTMLImageElement>>();
  private animations = new Map<string, Promise<AnimatedImage | undefined>>();
  private videos = new Map<string, Promise<HTMLVideoElement>>();
  private urls = new Map<File, string>();
  private styledText = new Map<string, HTMLCanvasElement>();
  private textLayouts = new Map<string, { mask: HTMLCanvasElement; stroke?: HTMLCanvasElement; probe?: ImageData; regions: { start: number; end: number; x: number; width: number }[] }>();
  private fontKey = '';
  private usedLayouts = new Set<string>();
  private usedText = new Set<string>();
  /** Gradients computed by `paint`, which a still frame draws again unchanged. */
  private patterns = new Map<string, CanvasPattern>();
  private usedPatterns = new Set<string>();
  /** Where stroked text is composed; see `strokeSurface`. */
  private strokeCanvas?: Context;

  constructor(private assets: Map<string, File> = new Map(), private baseURL?: string) {}

  dispose() {
    this.styledText.clear();
    this.textLayouts.clear();
    this.usedLayouts.clear();
    this.usedText.clear();
    this.patterns.clear();
    this.usedPatterns.clear();
    releaseFonts(this.urls.values());
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const video of this.videos.values()) void video.then(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    for (const animation of this.animations.values()) void animation.then(a => a?.frames.forEach(frame => frame.close()), () => {});
    this.animations.clear();
    this.strokeCanvas = undefined;
  }

  private src(asset: Asset): string {
    const location = asset.location;
    if (location.type === 'url') return location.url;
    const file = this.assets.get(location.path) ?? this.assets.get(location.path.replace(/^\.\//, ''));
    if (!file) {
      if (this.baseURL) return new URL(location.path, this.baseURL).href;
      throw new Error(`Missing media file: ${location.path}. Add it with “Add media”.`);
    }
    let url = this.urls.get(file);
    if (!url) { url = URL.createObjectURL(file); this.urls.set(file, url); }
    return url;
  }

  audioBytes(src: string): Promise<ArrayBuffer> {
    return audioBytes(src, this.assets, this.baseURL);
  }

  private async image(asset: Asset): Promise<HTMLImageElement> {
    const key = JSON.stringify(asset.location);
    let pending = this.images.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load image: ${asset.id}`));
        image.src = this.src(asset);
      });
      this.images.set(key, pending);
    }
    return pending;
  }

  /** An animated image's frames, or `undefined` for a still one, which `image` loads. */
  private animation(asset: Asset): Promise<AnimatedImage | undefined> {
    const key = JSON.stringify(asset.location);
    let pending = this.animations.get(key);
    if (!pending) {
      pending = fetch(this.src(asset))
        .then(response => {
          if (!response.ok) throw new Error(`Could not load image: ${asset.id} (${response.status}).`);
          return response.arrayBuffer();
        })
        .then(decodeAnimatedImage);
      this.animations.set(key, pending);
    }
    return pending;
  }

  /** Shape the complete line once, then apply paint and reveals to its glyph mask. */
  private styledLine(ctx: Context, text: string, style: TextStyle, width: number, height: number, baseline: number, x: number, offset: number, originX: number, originY: number, fontRuns: FontRun[] = []): HTMLCanvasElement {
    const { colorRuns, visibleCharacters, fill, ...geometry } = style;
    const lang = ('lang' in ctx && typeof ctx.lang === 'string' ? ctx.lang : undefined) || style.lang?.trim() || navigator.language;
    // The line's offset decides which font runs apply, so their pieces are
    // part of the layout.
    const pieces = fontRuns.length ? runPieces(text, offset, fontRuns) : undefined;
    const layoutKey = JSON.stringify({ text, geometry, width, height, baseline, x, originX, originY, lang,
      ...(pieces ? { pieces: pieces.map(p => [p.start, p.run?.fontWeight, p.run?.fontFamily]) } : {}) });
    const key = JSON.stringify({ layoutKey, colorRuns, visibleCharacters, fill, offset });
    this.usedLayouts.add(layoutKey);
    this.usedText.add(key);
    const cached = this.styledText.get(key);
    if (cached) return cached;
    let layout = this.textLayouts.get(layoutKey);
    if (!layout) {
      // SVG exposes character extents from the full shaped line, unlike
      // Canvas's prefix-only measurement. Fill changes never touch this node.
      // Font runs are tspans, so their pieces are placed as one paragraph.
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.style.cssText = 'position:fixed;left:-100000px;opacity:0;pointer-events:none';
      const element = document.createElementNS(ns, 'text');
      element.style.font = ctx.font;
      element.style.letterSpacing = ctx.letterSpacing;
      element.style.fontKerning = ctx.fontKerning;
      element.style.whiteSpace = 'pre';
      element.setAttribute('x', String(x));
      element.setAttribute('y', String(baseline));
      element.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', lang);
      if (pieces) {
        for (const piece of pieces) {
          if (!piece.run) { element.append(piece.text); continue; }
          const span = document.createElementNS(ns, 'tspan');
          span.style.font = cssFont(style, piece.run);
          span.textContent = piece.text;
          element.append(span);
        }
      } else element.textContent = text;
      svg.append(element);
      document.body.append(svg);
      const regions: { start: number; end: number; x: number; width: number }[] = [];
      try {
        let point = 0;
        for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
          const extent = element.getExtentOfChar(index);
          const count = Array.from(segment).length;
          const previous = regions.at(-1);
          // SVG reports the same extent for each character of a ligature.
          if (previous && previous.x === extent.x && previous.width === extent.width) previous.end += count;
          else regions.push({ start: point, end: point + count, x: extent.x, width: extent.width });
          point += count;
        }
      } finally { svg.remove(); }
      const segments = pieces ? runSegments(text, pieces, regions, Math.abs(letterSpacingPx(style)) + 0.5) : [];
      // Draws the line, or each run segment in its run's font and direction
      // where the tspans put it.
      const drawText = (target: Context, method: 'fillText' | 'strokeText') => {
        if (!pieces) { target[method](text, x, baseline); return; }
        const { font, direction, textAlign } = target;
        for (const segment of segments) {
          target.font = segment.run ? cssFont(style, segment.run) : font;
          target.direction = segment.rtl ? 'rtl' : 'ltr';
          target.textAlign = segment.rtl ? 'right' : 'left';
          target[method](segment.text, segment.rtl ? segment.right : segment.left, baseline);
        }
        Object.assign(target, { font, direction, textAlign });
      };
      const mask = document.createElement('canvas');
      mask.width = Math.max(1, Math.ceil(width));
      mask.height = Math.max(1, Math.ceil(height));
      const draw = mask.getContext('2d')!;
      draw.font = ctx.font;
      draw.letterSpacing = ctx.letterSpacing;
      draw.fontKerning = ctx.fontKerning;
      draw.textBaseline = 'alphabetic';
      draw.fillStyle = '#fff';
      if ('lang' in draw && 'lang' in ctx) draw.lang = ctx.lang;
      let stroke: HTMLCanvasElement | undefined;
      if (style.stroke?.width) {
        stroke = document.createElement('canvas');
        stroke.width = mask.width;
        stroke.height = mask.height;
        const outline = stroke.getContext('2d')!;
        outline.font = draw.font;
        outline.letterSpacing = draw.letterSpacing;
        outline.fontKerning = draw.fontKerning;
        outline.textBaseline = 'alphabetic';
        if ('lang' in outline) outline.lang = lang;
        outline.lineJoin = 'round';
        outline.lineWidth = style.stroke.width * 2;
        outline.strokeStyle = this.paint(outline, style.stroke.paint, [0, 0, stroke.width, stroke.height], originX, originY);
        drawText(outline, 'strokeText');
      }
      drawText(draw, 'fillText');
      if (stroke) {
        // The stroke stays outside the glyphs; see the direct path in
        // `layer`. Cutting them out with the mask itself, not with text
        // drawn again on the stroke's canvas, makes the two meet exactly.
        const outline = stroke.getContext('2d')!;
        outline.globalCompositeOperation = 'destination-out';
        outline.drawImage(mask, 0, 0);
      }
      // A black/white probe distinguishes actual color glyphs from monochrome
      // emoji fallbacks, including white pixels within color emoji.
      let probe: ImageData | undefined;
      if (/\p{Emoji_Presentation}|\uFE0F|\u20e3/u.test(text)) {
        const pixels = draw.getImageData(0, 0, mask.width, mask.height);
        draw.clearRect(0, 0, mask.width, mask.height);
        draw.fillStyle = '#000';
        drawText(draw, 'fillText');
        probe = draw.getImageData(0, 0, mask.width, mask.height);
        draw.putImageData(pixels, 0, 0);
      }
      layout = { mask, stroke, probe, regions };
      this.textLayouts.set(layoutKey, layout);
    }
    const result = document.createElement('canvas');
    result.width = layout.mask.width;
    result.height = layout.mask.height;
    const draw = result.getContext('2d')!;
    draw.fillStyle = fill ? this.paint(draw, fill, [0, 0, result.width, result.height], originX, originY) : '#fff';
    draw.fillRect(0, 0, result.width, result.height);
    const hidden = new Uint8Array(result.width);
    const leftEdge = layout.regions.reduce((left, region) => Math.min(left, region.x), Infinity);
    const rightEdge = layout.regions.reduce((right, region) => Math.max(right, region.x + region.width), -Infinity);
    let runIndex = 0;
    for (const region of layout.regions) {
      const point = offset + region.start;
      const runs = colorRuns ?? [];
      while (runIndex < runs.length && runs[runIndex].end <= point) runIndex++;
      const run = runs[runIndex];
      // Resolve once per cluster; shaping and rasterization are already cached.
      const color = run && run.start <= point && point < run.end ? run.color : undefined;
      const left = region.x === leftEdge ? 0 : Math.max(0, Math.min(result.width, Math.round(region.x)));
      const right = region.x + region.width === rightEdge ? result.width : Math.max(0, Math.min(result.width, Math.round(region.x + region.width)));
      if (color) {
        draw.clearRect(left, 0, right - left, result.height);
        draw.fillStyle = color;
        draw.fillRect(left, 0, right - left, result.height);
      }
      if (visibleCharacters != null && point >= visibleCharacters) hidden.fill(1, left, right);
    }
    const colors = draw.getImageData(0, 0, result.width, result.height);
    const pixels = layout.mask.getContext('2d')!.getImageData(0, 0, result.width, result.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (hidden[(i / 4) % result.width]) pixels.data.fill(0, i, i + 4);
      else if (pixels.data[i] === 255 && pixels.data[i + 1] === 255 && pixels.data[i + 2] === 255
        && (!layout.probe || layout.probe.data[i] !== 255 || layout.probe.data[i + 1] !== 255 || layout.probe.data[i + 2] !== 255)) {
        pixels.data[i] = colors.data[i];
        pixels.data[i + 1] = colors.data[i + 1];
        pixels.data[i + 2] = colors.data[i + 2];
        pixels.data[i + 3] = Math.round(pixels.data[i + 3] * colors.data[i + 3] / 255);
      }
    }
    draw.putImageData(pixels, 0, 0);
    if (layout.stroke) {
      const outline = layout.stroke.getContext('2d')!.getImageData(0, 0, result.width, result.height);
      for (let i = 0; i < outline.data.length; i += 4) {
        if (hidden[(i / 4) % result.width]) outline.data.fill(0, i, i + 4);
      }
      const stroke = document.createElement('canvas');
      stroke.width = result.width; stroke.height = result.height;
      stroke.getContext('2d')!.putImageData(outline, 0, 0);
      draw.globalCompositeOperation = 'lighter';
      draw.drawImage(stroke, 0, 0);
    }
    if (visibleCharacters === 0) draw.clearRect(0, 0, result.width, result.height);
    this.styledText.set(key, result);
    return result;
  }

  private async video(asset: Asset): Promise<HTMLVideoElement> {
    const key = JSON.stringify(asset.location);
    let pending = this.videos.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        video.muted = true;
        video.onloadeddata = () => resolve(video);
        video.onerror = () => reject(new Error(`Could not load video: ${asset.id}`));
        video.src = this.src(asset);
      });
      this.videos.set(key, pending);
    }
    return pending;
  }

  async draw(canvas: Canvas, scene: Scene): Promise<void> {
    this.usedLayouts.clear();
    this.usedText.clear();
    this.usedPatterns.clear();
    await loadFonts(scene.fonts ?? [], asset => this.src(asset));
    const fontKey = JSON.stringify(scene.fonts ?? []);
    if (fontKey !== this.fontKey) {
      this.styledText.clear();
      this.textLayouts.clear();
      this.fontKey = fontKey;
    }
    if (canvas.width !== scene.width) canvas.width = scene.width;
    if (canvas.height !== scene.height) canvas.height = scene.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, scene.width, scene.height);
    for (const layer of scene.layers) await this.layer(ctx, layer as WebLayer, new DOMMatrix(), 1);
    // Retain the active scene, even when it exceeds the idle-cache limit.
    for (const [cache, used, limit] of [[this.textLayouts, this.usedLayouts, 32], [this.styledText, this.usedText, 64], [this.patterns, this.usedPatterns, 8]] as const) {
      for (const key of cache.keys()) {
        if (cache.size <= Math.max(limit, used.size)) break;
        if (!used.has(key)) cache.delete(key);
      }
    }
  }

  private async layer(ctx: Context, layer: WebLayer, parent: DOMMatrix, opacity: number): Promise<void> {
    const t = layer.transform;
    const matrix = parent.translate(t.position.x, t.position.y).rotate(t.rotation).scale(t.scale.x, t.scale.y);
    const alpha = Math.max(0, Math.min(1, opacity * layer.opacity));
    if (!alpha) return;
    const content = layer.content;
    const mode = layer.blendMode ?? 'normal';
    if (!BLEND_MODES.includes(mode)) throw new Error(`Unsupported blend mode: ${layer.blendMode}`);
    const effects = layer.effects;
    const filters = effects?.filters ?? [];
    // Canvas 2D cannot run WGSL; drawing the layer without it would be wrong.
    if (filters.some(filter => filter.type === 'shader')) throw new Error('custom shaders are not supported in the browser renderer');
    if (mode !== 'normal') {
      // Draw the layer (a group isolated) with its effects, then blend it
      // pixel by pixel as the native renderers do: Canvas's own modes round
      // differently, and its `lighter` is not their `add`.
      const source = this.surface(ctx);
      await this.layer(source, { ...layer, opacity: 1, blendMode: 'normal' }, parent, 1);
      this.blend(ctx, source, alpha, mode);
      source.canvas.width = 0;
      return;
    }
    if (effects && (effects.blur || effects.shadow || effects.glow || filters.length)) {
      const source = this.surface(ctx);
      await this.layer(source, { ...layer, opacity: 1, blendMode: 'normal', effects: undefined }, parent, 1);
      if (filters.length) {
        const { width, height } = source.canvas;
        const pixels = source.getImageData(0, 0, width, height);
        // Surfaces are scene-sized, as a zoom blur's reach expects. Only
        // grids, centres, and `uv` read the box of the layer's shapes.
        const shape = filters.some(filter => READS_CONTENT_BOX.has(filter.type))
          ? await this.shapeBox(source, { ...layer, effects: undefined }, parent, 1)
          : null;
        const box = applyFilters(pixels.data, width, filters as BuiltinFilter[], shape ? { content: shape } : {});
        if (box) source.putImageData(pixels, 0, 0, box[0], box[1], box[2] - box[0], box[3] - box[1]);
      }
      const result = this.surface(ctx);
      // Each effect reads the unmodified source, matching the native renderer.
      for (const effect of [effects.shadow, effects.glow ? { ...effects.glow, offsetX: 0, offsetY: 0 } : null]) {
        if (!effect) continue;
        const mask = this.surface(ctx);
        mask.drawImage(source.canvas, 0, 0);
        mask.globalCompositeOperation = 'source-in';
        mask.fillStyle = effect.color;
        mask.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
        result.filter = effect.blur > 0 ? `blur(${effect.blur}px)` : 'none';
        result.drawImage(mask.canvas, effect.offsetX, effect.offsetY);
        mask.canvas.width = 0;
      }
      result.filter = effects.blur && effects.blur > 0 ? `blur(${effects.blur}px)` : 'none';
      result.drawImage(source.canvas, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.drawImage(result.canvas, 0, 0);
      ctx.restore();
      source.canvas.width = result.canvas.width = 0;
      return;
    }
    if (content.type === 'group') {
      const clip = content.clip;
      const clipTo = (target: Context) => {
        if (!clip) return;
        target.setTransform(matrix);
        target.beginPath();
        target.roundRect(clip.x, clip.y, clip.width, clip.height, clip.cornerRadius ?? 0);
        target.clip();
      };
      if (content.motionBlur) {
        // Each child is one sample: drawn onto a surface of its own, then
        // averaged into one layer that composites like an isolated group.
        const { width, height } = ctx.canvas;
        const average = new SampleAverage(width * height * 4);
        for (const sample of content.layers) {
          const surface = this.surface(ctx);
          clipTo(surface);
          await this.layer(surface, sample as WebLayer, matrix, 1);
          average.add(surface.getImageData(0, 0, width, height).data);
          surface.canvas.width = 0;
        }
        const result = this.surface(ctx);
        const pixels = result.createImageData(width, height);
        average.write(pixels.data);
        result.putImageData(pixels, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.drawImage(result.canvas, 0, 0);
        ctx.restore();
        result.canvas.width = 0;
        return;
      }
      ctx.save();
      clipTo(ctx);
      for (const child of content.layers) await this.layer(ctx, child as WebLayer, matrix, alpha);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    if (content.type === 'rect') {
      const width = content.width, height = content.height;
      const x = -t.anchor.x * width, y = -t.anchor.y * height;
      const radius = Math.max(0, Math.min(content.cornerRadius, width / 2, height / 2));
      const box: Box = [x, y, x + width, y + height];
      ctx.setTransform(matrix);
      if (content.fill) {
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, radius);
        ctx.fillStyle = this.paint(ctx, content.fill, box, x, y);
        ctx.fill();
      }
      if (content.stroke?.width) {
        const inset = content.stroke.width / 2;
        ctx.beginPath();
        ctx.roundRect(x + inset, y + inset, width - 2 * inset, height - 2 * inset, Math.max(0, radius - inset));
        ctx.strokeStyle = this.paint(ctx, content.stroke.paint, box, x, y);
        ctx.lineWidth = content.stroke.width;
        ctx.stroke();
      }
    } else if (content.type === 'path') {
      ctx.setTransform(matrix);
      ctx.beginPath();
      let started = false;
      for (const command of content.commands) {
        if (!started && command.type !== 'moveTo') ctx.moveTo(0, 0);
        if (command.type === 'moveTo') ctx.moveTo(command.x, command.y);
        else if (command.type === 'lineTo') ctx.lineTo(command.x, command.y);
        else if (command.type === 'quadTo') ctx.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
        else if (command.type === 'cubicTo') ctx.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        else ctx.closePath();
        started = true;
      }
      const box = commandBox(content.commands);
      if (content.fill) { ctx.fillStyle = this.paint(ctx, content.fill, box); ctx.fill(); }
      if (content.stroke?.width) {
        ctx.lineWidth = content.stroke.width;
        ctx.lineCap = content.lineCap ?? 'butt';
        ctx.lineJoin = content.lineJoin ?? 'miter';
        ctx.miterLimit = content.miterLimit ?? 4;
        const dash = canvasDash(content.lineDash);
        ctx.setLineDash(dash.pattern);
        ctx.lineDashOffset = dash.offset;
        // A square cap's corner, or a miter up to its limit, reaches past half the width.
        const reach = ctx.lineWidth / 2 * (ctx.lineJoin === 'miter' ? Math.max(ctx.miterLimit, Math.SQRT2) : Math.SQRT2);
        ctx.strokeStyle = this.paint(ctx, content.stroke.paint, grow(box, reach));
        ctx.stroke();
      }
    } else if (content.type === 'text') {
      const style = content.style;
      const count = Array.from(content.text).length;
      let previousEnd = 0;
      for (const run of style.colorRuns ?? []) {
        if (!Number.isSafeInteger(run.start) || !Number.isSafeInteger(run.end) || run.start < previousEnd || run.end < run.start || run.end > count) {
          throw new Error('Invalid text color run range');
        }
        previousEnd = run.end;
      }
      checkFontRuns(style.fontRuns, count);
      const fontRuns = style.fontRuns ?? [];
      if (style.visibleCharacters != null && (!Number.isSafeInteger(style.visibleCharacters) || style.visibleCharacters < 0)) {
        throw new Error('Text visibleCharacters must be a non-negative integer');
      }
      const { lines, lineRuns, measured, width, placed, top, y } = this.textLayout(ctx, content, t.anchor);
      ctx.setTransform(matrix.translate(-t.anchor.x * width, y));
      for (let i = 0; i < lines.length; i++) {
        const baseline = placed[i].baseline - top;
        // The line's ink box, stroke included.
        const pad = Math.ceil(style.stroke?.width ?? 0) + 1;
        const m = measured[i];
        const left = Math.floor(placed[i].x - m.actualBoundingBoxLeft) - pad;
        const inkTop = Math.floor(baseline - m.actualBoundingBoxAscent) - pad;
        const right = Math.ceil(placed[i].x + m.actualBoundingBoxRight) + pad;
        const bottom = Math.ceil(baseline + m.actualBoundingBoxDescent) + pad;
        if (style.colorRuns?.length || style.visibleCharacters != null || lineRuns[i].length) {
          const image = this.styledLine(ctx, lines[i].text, style, right - left, bottom - inkTop, baseline - inkTop, placed[i].x - left, lines[i].start, -left, -inkTop, lineRuns[i]);
          ctx.drawImage(image, left, inkTop);
          continue;
        }
        const box: Box = [left, inkTop, right, bottom];
        if (!style.stroke?.width) {
          ctx.fillStyle = style.fill ? this.paint(ctx, style.fill, box) : '#fff';
          ctx.fillText(lines[i].text, placed[i].x, baseline);
          continue;
        }
        // The stroke stays outside the glyphs, as in the native renderers:
        // it is drawn on a surface of its own, the glyphs are cut out of it
        // and their fill added beside it, so a transparent or translucent
        // fill shows what lies beneath the text. The surface is in this
        // canvas's pixels, so scaled text stays sharp, and only the line's
        // box is cleared and copied.
        const transform = ctx.getTransform();
        const corners = [[left, inkTop], [right, inkTop], [left, bottom], [right, bottom]]
          .map(([x, y]) => transform.transformPoint(new DOMPoint(x, y)));
        const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))));
        const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
        const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...corners.map(p => p.x))));
        const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...corners.map(p => p.y))));
        if (x1 <= x0 || y1 <= y0) continue;
        const outline = this.strokeSurface(ctx);
        outline.resetTransform();
        outline.clearRect(x0, y0, x1 - x0, y1 - y0);
        outline.setTransform(transform);
        outline.font = ctx.font;
        outline.letterSpacing = ctx.letterSpacing;
        outline.fontKerning = ctx.fontKerning;
        outline.direction = ctx.direction;
        outline.textBaseline = 'alphabetic';
        outline.textAlign = 'left';
        if ('lang' in outline && 'lang' in ctx) outline.lang = ctx.lang;
        outline.lineJoin = 'round';
        outline.lineWidth = style.stroke.width * 2;
        outline.strokeStyle = this.paint(outline, style.stroke.paint, box);
        outline.strokeText(lines[i].text, placed[i].x, baseline);
        outline.globalCompositeOperation = 'destination-out';
        outline.fillStyle = '#000';
        outline.fillText(lines[i].text, placed[i].x, baseline);
        // Adding the fill keeps antialiased edges opaque where fill and
        // stroke meet, which drawing it over the cut-out stroke would not.
        outline.globalCompositeOperation = 'lighter';
        outline.fillStyle = style.fill ? this.paint(outline, style.fill, box) : '#fff';
        outline.fillText(lines[i].text, placed[i].x, baseline);
        outline.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.resetTransform();
        ctx.drawImage(outline.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
      }
    } else if (content.type === 'image' || content.type === 'video') {
      let image: HTMLImageElement | HTMLVideoElement | ImageBitmap;
      const animation = content.type === 'image' && content.animation;
      const frames = animation ? await this.animation(content.asset) : undefined;
      if (animation && frames) image = frames.frames[animationFrame(frames.ends, animation.sourceTimeSeconds, animation.loop)];
      else if (content.type === 'image') image = await this.image(content.asset);
      else {
        const video = await this.video(content.asset);
        image = video;
        const looped = content.timing.loop && Number.isFinite(video.duration) && video.duration > 0;
        // A looping clip starts over from the first frame past the end.
        const requested = looped
          ? ((content.timing.sourceTimeSeconds % video.duration) + video.duration) % video.duration
          : Math.max(0, content.timing.sourceTimeSeconds);
        const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : requested;
        const time = Math.min(requested, end);
        if (Math.abs(video.currentTime - time) > 0.001) {
          await new Promise<void>((resolve, reject) => {
            video.addEventListener('seeked', () => resolve(), { once: true });
            video.addEventListener('error', () => reject(new Error(`Could not seek video: ${content.asset.id}`)), { once: true });
            video.currentTime = time;
          });
        }
      }
      const width = 'videoWidth' in image ? image.videoWidth : 'naturalWidth' in image ? image.naturalWidth : image.width;
      const height = 'videoHeight' in image ? image.videoHeight : 'naturalHeight' in image ? image.naturalHeight : image.height;
      const w = content.type === 'image' ? content.width ?? (content.height === undefined ? width : content.height * width / height) : width;
      const h = content.type === 'image' ? content.height ?? w * height / width : height;
      ctx.setTransform(matrix.translate(-t.anchor.x * w, -t.anchor.y * h));
      if (content.type === 'image' && content.fit) {
        const scale = content.fit === 'contain' ? Math.min(w / width, h / height) : Math.max(w / width, h / height);
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        ctx.drawImage(image, (w - width * scale) / 2, (h - height * scale) / 2, width * scale, height * scale);
      } else ctx.drawImage(image, 0, 0, w, h);
    } else {
      throw new Error(`The web renderer does not support ${content.type} layers yet.`);
    }
    ctx.restore();
  }

  /**
   * `value` as a fill or stroke style for what `ctx` draws next inside
   * `box`, in its current coordinates, with the paint's origin at `x, y`.
   * A gradient Canvas draws differently (see `canvasDrawsAlike`) is
   * computed pixel by pixel as the native renderers sample it (see
   * `gradientPixels`), over `box`'s pixels on the canvas, and drawn as a
   * pattern that lands on those pixels texel for texel.
   */
  private paint(ctx: Context, value: Paint, box: Box, x = 0, y = 0): string | CanvasGradient | CanvasPattern {
    if (value.type === 'solid') return value.color;
    if (canvasDrawsAlike(value)) {
      const gradient = value.type === 'linear'
        ? ctx.createLinearGradient(x + value.start.x, y + value.start.y, x + value.end.x, y + value.end.y)
        : ctx.createRadialGradient(x + value.center.x, y + value.center.y, 0, x + value.center.x, y + value.center.y, value.radius);
      for (const stop of value.stops) gradient.addColorStop(stop.offset, stop.color);
      return gradient;
    }
    const transform = ctx.getTransform();
    const corners = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]]
      .map(([px, py]) => transform.transformPoint(new DOMPoint(px, py)));
    // A pixel past the box on each side, which edge antialiasing can reach.
    const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))) - 1);
    const top = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))) - 1);
    const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...corners.map(p => p.x))) + 1);
    const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...corners.map(p => p.y))) + 1);
    if (!(right > left && bottom > top)) return '#00000000';
    const { a, b, c, d, e, f } = transform.translate(x, y).inverse();
    const key = JSON.stringify([value, a, b, c, d, e, f, left, top, right, bottom]);
    this.usedPatterns.add(key);
    let pattern = this.patterns.get(key);
    if (!pattern) {
      const pixels = gradientPixels(value, [a, b, c, d, e, f], [left, top, right, bottom]);
      const image = document.createElement('canvas');
      image.width = right - left;
      image.height = bottom - top;
      image.getContext('2d')!.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
      pattern = ctx.createPattern(image, 'no-repeat')!;
      this.patterns.set(key, pattern);
    }
    // Undoes the transform the pattern is drawn through, so its pixels map
    // to the canvas's by a whole-pixel translation. The same pixels can
    // come from another transform, with the paint's origin moved to match.
    pattern.setTransform(transform.inverse().translate(left, top));
    return pattern;
  }

  /** A `surface` kept for stroked text, which reuses it line after line. */
  private strokeSurface(ctx: Context): Context {
    const surface = this.strokeCanvas;
    if (surface && surface.canvas.width === ctx.canvas.width && surface.canvas.height === ctx.canvas.height) return surface;
    return this.strokeCanvas = this.surface(ctx);
  }

  /**
   * The box of `layer`'s shapes in scene pixels, as the GPU renderer's
   * `PreparedLayer::shape` and a group's union of them give it: what
   * `uv` and a vignette span. Clips and effects do not change it. `null`
   * when the layer draws nothing.
   */
  private async shapeBox(ctx: Context, layer: WebLayer, parent: DOMMatrix, opacity: number): Promise<Box | null> {
    const t = layer.transform;
    const matrix = parent.translate(t.position.x, t.position.y).rotate(t.rotation).scale(t.scale.x, t.scale.y);
    if (!(opacity * layer.opacity > 0)) return null;
    const content = layer.content;
    if (content.type === 'group') {
      let union: Box | null = null;
      for (const child of content.layers) {
        const box = await this.shapeBox(ctx, child as WebLayer, matrix, opacity * layer.opacity);
        if (box) union = union ? [Math.min(union[0], box[0]), Math.min(union[1], box[1]), Math.max(union[2], box[2]), Math.max(union[3], box[3])] : box;
      }
      return union;
    }
    // Corners of a box in the layer's own units, placed by `matrix`.
    const place = (left: number, top: number, right: number, bottom: number, align = false): Box => {
      // A texture drawn texel for texel lands on whole pixels on the GPU,
      // rounded as Rust's `f64::round` does (halves away from zero).
      if (align && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) {
        const round = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
        const x = round(matrix.e + left), y = round(matrix.f + top);
        return [x, y, x + right - left, y + bottom - top];
      }
      const corners = [[left, top], [right, top], [left, bottom], [right, bottom]]
        .map(([x, y]) => matrix.transformPoint(new DOMPoint(x, y)));
      const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    if (content.type === 'rect') {
      const x = -t.anchor.x * content.width, y = -t.anchor.y * content.height;
      return place(x, y, x + content.width, y + content.height);
    }
    if (content.type === 'text') {
      // The GPU draws the text's image: the layout box in whole pixels,
      // grown by the stroke on every side. A single line keeps only its
      // visible rows, stroke included, padded to an even count.
      ctx.save();
      const { width, height, y, multiline } = this.textLayout(ctx, content, t.anchor);
      ctx.restore();
      const pad = Math.round(content.style.stroke?.width ?? 0);
      const rows = multiline ? Math.max(1, Math.ceil(height)) + 2 * pad : Math.ceil(height + 2 * pad);
      const left = -t.anchor.x * width - pad, top = y - pad;
      return place(left, top, left + Math.max(1, Math.ceil(width)) + 2 * pad, top + rows + rows % 2, true);
    }
    if (content.type === 'image' || content.type === 'video') {
      const image = content.type === 'image' ? await this.image(content.asset) : await this.video(content.asset);
      const width = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth;
      const height = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight;
      const w = content.type === 'image' ? content.width ?? (content.height === undefined ? width : content.height * width / height) : width;
      const h = content.type === 'image' ? content.height ?? w * height / width : height;
      const x = -t.anchor.x * w, y = -t.anchor.y * h;
      return place(x, y, x + w, y + h, Number.isInteger(w) && Number.isInteger(h));
    }
    if (content.type === 'path') {
      // The box of the points the commands name (control points included,
      // and 0,0 when the first command draws from there), grown by half the
      // stroke, as `PendingPath::shape_box` gives it.
      const commands = content.commands;
      if (!commands.some(command => command.type !== 'moveTo' && command.type !== 'close')) return null;
      if (!content.fill && !(content.stroke && content.stroke.width > 0)) return null;
      const reach = content.stroke && content.stroke.width > 0 ? content.stroke.width / 2 : 0;
      return place(...grow(commandBox(commands), reach));
    }
    return null;
  }

  /**
   * Lays out a text layer as `layer` draws it: its lines, their font runs
   * and measurements, the layout box's `width` and `height`, each line's
   * place, the box's `top` in line coordinates, and the `y` its anchor
   * moves it by. Sets `ctx`'s text state.
   */
  private textLayout(ctx: Context, content: TextContent, anchor: { x: number; y: number }) {
    const style = content.style;
    const fontRuns = style.fontRuns ?? [];
    // Canvas language selection is available in newer browsers.
    const size = style.fontSize ?? 32;
    const lineHeight = style.lineHeight ?? size * 1.2;
    textStyle(ctx, style);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lines = textLineRanges(ctx, content.text, content.maxWidth, style.lang,
      fontRuns.length ? (text, start) => measureLine(ctx, style, text, start, fontRuns).width : undefined);
    // Only the runs a line reaches; a line none reaches takes the direct path.
    const lineRuns = lines.map(line => {
      const end = line.start + Array.from(line.text).length;
      return fontRuns.filter(run => run.end > line.start && run.start < end);
    });
    const measured = lines.map((line, i) => measureLine(ctx, style, line.text, line.start, lineRuns[i]));
    const width = content.maxWidth ?? Math.max(0, ...measured.map(m => m.width));
    const placed = measured.map((m, i) => ({
      x: style.align === 'center' ? (width - m.width) / 2 : style.align === 'right' ? width - m.width : 0,
      baseline: i * lineHeight + (lineHeight - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent,
    }));
    // Lines wrapped at maxWidth count as several lines too.
    const multiline = /[\r\n]/.test(content.text) || lines.length > 1;
    const top = multiline ? 0 : Math.min(...placed.map((p, i) => p.baseline - measured[i].actualBoundingBoxAscent));
    const bottom = multiline ? lines.length * lineHeight : Math.max(...placed.map((p, i) => p.baseline + measured[i].actualBoundingBoxDescent));
    const height = bottom - top;
    const y = content.baselineAnchor ? -(placed[0].baseline - top) : -anchor.y * height;
    return { lines, lineRuns, measured, width, placed, top, height, y, multiline };
  }

  /**
   * Draws `source`, a surface of `ctx`'s size, onto `ctx` at `alpha`
   * through `mode`: its colors become the blended ones against what `ctx`
   * holds beneath them, then composite source-over (within `ctx`'s clip).
   */
  private blend(ctx: Context, source: Context, alpha: number, mode: BlendMode): void {
    const { width, height } = source.canvas;
    const pixels = source.getImageData(0, 0, width, height);
    const box = coveredBox(pixels.data, width, height);
    if (!box) return;
    const [left, top, right, bottom] = box;
    const backdrop = ctx.getImageData(left, top, right - left, bottom - top);
    blendPixels(mode, pixels.data, width, backdrop.data, box);
    source.putImageData(pixels, 0, 0, left, top, right - left, bottom - top);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.drawImage(source.canvas, 0, 0);
    ctx.restore();
  }

  private surface(ctx: Context): Context {
    const canvas = document.createElement('canvas');
    canvas.width = ctx.canvas.width;
    canvas.height = ctx.canvas.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    return context;
  }
}

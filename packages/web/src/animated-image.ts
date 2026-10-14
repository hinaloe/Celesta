/**
 * Animated GIF, APNG, and WebP frames, picked the way Celesta's Rust
 * renderer picks them (`celesta_renderer::image_source`), so a scene draws
 * the same frame in the browser as in the app.
 */
export interface AnimatedImage {
  /** Every frame, composited onto the ones before it. */
  frames: ImageBitmap[];
  /** When each frame stops showing, in microseconds from the start. */
  ends: number[];
}

/**
 * How long a frame with a delay of `micros` shows. Delays of 10 ms or less
 * show for 100 ms, as browsers show them: GIFs saved with no delay expect it.
 */
export function frameDurationMicros(micros: number): number {
  return micros <= 10_000 ? 100_000 : Math.round(micros);
}

/**
 * The frame showing `seconds` into an animation whose frames end at `ends`.
 * Before the start it is the first frame; past the end the animation starts
 * over with `loop` and holds its last frame otherwise.
 */
export function animationFrame(ends: readonly number[], seconds: number, loop: boolean): number {
  const total = ends.length === 0 ? 0 : ends[ends.length - 1];
  if (total === 0) return 0;
  let micros = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1e6) : 0;
  if (loop) micros %= total;
  else if (micros >= total) return ends.length - 1;
  const index = ends.findIndex(end => end > micros);
  return index < 0 ? ends.length - 1 : index;
}

/** The MIME type of a GIF, PNG, or WebP from its first bytes; anything else cannot animate. */
export function animatableType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/**
 * Decodes every frame of `data` with WebCodecs' `ImageDecoder`, or returns
 * `undefined` for a still image, or where the browser has no `ImageDecoder`
 * (an `<img>` then draws its first frame).
 */
export async function decodeAnimatedImage(data: ArrayBuffer): Promise<AnimatedImage | undefined> {
  const type = animatableType(new Uint8Array(data, 0, Math.min(data.byteLength, 16)));
  if (!type || typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(type)) return undefined;
  const decoder = new ImageDecoder({ data, type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) return undefined;
    await decoder.completed;
    if (track.frameCount < 2) return undefined;
    const animation: AnimatedImage = { frames: [], ends: [] };
    let end = 0;
    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      try {
        animation.frames.push(await createImageBitmap(image));
        end += frameDurationMicros(image.duration ?? 0);
        animation.ends.push(end);
      } finally {
        image.close();
      }
    }
    return animation;
  } finally {
    decoder.close();
  }
}

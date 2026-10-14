/**
 * The average of a motion-blurred group's samples, as the native renderers
 * take it: equal weights on premultiplied, sRGB-encoded values. Samples are
 * added as the straight-alpha RGBA `getImageData` gives, and the average is
 * written back the same way. Summing in floats rather than drawing each
 * sample at `1 / samples` opacity keeps a sample from being rounded to 8 bits
 * before it is added.
 */
export class SampleAverage {
  /** Premultiplied red, green, and blue, then alpha, all in 0–255. */
  private readonly sums: Float32Array;
  private samples = 0;

  constructor(length: number) {
    this.sums = new Float32Array(length);
  }

  add(pixels: Uint8ClampedArray): void {
    const sums = this.sums;
    for (let i = 0; i < sums.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha === 0) continue;
      sums[i] += (pixels[i] * alpha) / 255;
      sums[i + 1] += (pixels[i + 1] * alpha) / 255;
      sums[i + 2] += (pixels[i + 2] * alpha) / 255;
      sums[i + 3] += alpha;
    }
    this.samples += 1;
  }

  /** Writes the average of the samples added so far into the transparent `pixels`. */
  write(pixels: Uint8ClampedArray): void {
    const sums = this.sums;
    for (let i = 0; i < sums.length; i += 4) {
      const alpha = sums[i + 3];
      if (alpha === 0) continue;
      pixels[i] = Math.round((sums[i] * 255) / alpha);
      pixels[i + 1] = Math.round((sums[i + 1] * 255) / alpha);
      pixels[i + 2] = Math.round((sums[i + 2] * 255) / alpha);
      pixels[i + 3] = Math.round(alpha / this.samples);
    }
  }
}

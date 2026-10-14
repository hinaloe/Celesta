import { ALL_FORMATS, AudioSampleSink, BufferSource, Input } from 'mediabunny';

/** An uploaded file by its name, then `baseURL`, then an http(s) URL. */
export async function audioBytes(src: string, assets: Map<string, File>, baseURL?: string): Promise<ArrayBuffer> {
  const file = assets.get(src) ?? assets.get(src.replace(/^\.\//, ''));
  if (file) return file.arrayBuffer();
  if (baseURL) src = new URL(src, baseURL).href;
  if (!/^https?:\/\//i.test(src)) throw new Error(`Missing audio file: ${src}. Add it with “Add media”.`);
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load audio: ${src} (${response.status}).`);
  return response.arrayBuffer();
}

/**
 * Decodes the primary audio track to mono at its own sample rate, as the
 * native runtime does for `loadAudioSpectrum()`: the mean of the channels,
 * placed by timestamp, without what precedes 0 or runs past the track.
 */
export async function decodeAudioBytes(bytes: ArrayBuffer, src: string): Promise<{ sampleRate: number; samples: Float32Array }> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(`could not decode ${src}: it has no audio track`);
    if (!await track.canDecode()) throw new Error(`could not decode ${src}: this browser cannot decode ${track.codec ?? 'its'} audio`);
    const { sampleRate } = track;
    const length = Math.round(await track.computeDuration() * sampleRate);
    const mono = new Float32Array(length);
    let plane = new Float32Array(0);
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        const channels = sample.numberOfChannels;
        const first = Math.round(sample.timestamp * sampleRate);
        if (plane.length < sample.numberOfFrames) plane = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < channels; channel += 1) {
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let i = Math.max(0, -first); i < sample.numberOfFrames && first + i < length; i += 1) {
            mono[first + i] += plane[i] / channels;
          }
        }
      } finally {
        sample.close();
      }
    }
    return { sampleRate, samples: mono };
  } finally {
    input.dispose();
  }
}

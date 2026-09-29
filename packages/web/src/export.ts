import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { AudioClip, CompositionConfig } from './types';
import { SceneCanvas } from './scene-canvas';
import { Engine } from './engine';

async function mixAudio(clips: AudioClip[], renderer: SceneCanvas, duration: number): Promise<AudioBuffer> {
  const sampleRate = 48_000;
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const decoded = new Map<string, AudioBuffer>();
  for (const clip of clips) {
    if (clip.muted || clip.volume === 0) continue;
    if (typeof clip.playbackRate !== 'number' || typeof clip.volume !== 'number') {
      throw new Error('Animated audio volume and playback rate are not supported by browser export yet.');
    }
    if (!(clip.playbackRate > 0)) throw new Error('Audio playback rate must be positive.');
    let buffer = decoded.get(clip.src);
    if (!buffer) {
      buffer = await context.decodeAudioData(await renderer.audioBytes(clip.src));
      decoded.set(clip.src, buffer);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clip.playbackRate;
    const gain = context.createGain();
    gain.gain.value = clip.volume;
    source.connect(gain).connect(context.destination);
    if (clip.start < duration) source.start(Math.max(0, clip.start), clip.sourceStart, Math.min(clip.duration, duration - clip.start) * clip.playbackRate);
  }
  return context.startRendering();
}

export async function exportMp4(
  engine: Engine,
  config: CompositionConfig,
  renderer: SceneCanvas,
  signal: AbortSignal,
  progress: (frame: number, total: number) => void,
): Promise<Blob> {
  const { width, height, durationInFrames, frameRate } = config;
  const fps = frameRate.numerator / frameRate.denominator;
  if (width % 2 || height % 2) throw new Error('MP4 requires even width and height.');
  if (!await canEncodeVideo('avc', { width, height, frameRate: fps })) {
    throw new Error('This browser cannot encode H.264 at the composition size. Try a smaller size or another browser.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
  output.addVideoTrack(video, { frameRate: fps });
  const audioSource = await canEncodeAudio('aac') ? new AudioBufferSource({ codec: 'aac', quality: new Quality('high') }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  const audioClips = new Map<string, AudioClip>();
  try {
    await output.start();
    for (let frame = 0; frame < durationInFrames; frame++) {
      if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
      const { scene, audio } = await engine.frame(frame);
      for (const clip of audio) audioClips.set(JSON.stringify(clip), clip);
      await renderer.draw(canvas, scene);
      await video.add(frame / fps, 1 / fps);
      progress(frame + 1, durationInFrames);
      if (frame % 3 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
    if (audioClips.size && !audioSource) throw new Error('This browser cannot encode AAC audio.');
    if (audioSource) {
      const duration = durationInFrames / fps;
      const audio = audioClips.size
        ? await mixAudio([...audioClips.values()], renderer, duration)
        : new AudioBuffer({ length: Math.ceil(duration * 48_000), numberOfChannels: 2, sampleRate: 48_000 });
      await audioSource.add(audio);
    }
    if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
    await output.finalize();
    if (!output.target.buffer) throw new Error('MP4 export produced no file.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    throw error;
  }
}

import { usage } from './errors.js';
import type { CompositionOptions, SourceOptions, StillsOptions, Timecode, VideoOptions } from './types.js';

/** Whether `options.source` is a React entry: anything but a `.json` file, unless `react` says. */
export function isReactSource(options: SourceOptions): boolean {
  return options.react ?? !options.source.toLowerCase().endsWith('.json');
}

/** The exporter arguments for a video (or subtitles-only) export. */
export function videoArgs(options: VideoOptions): string[] {
  const subtitles = typeof options.subtitles === 'string' ? [options.subtitles] : (options.subtitles ?? []);
  if (options.output === undefined && subtitles.length === 0) {
    throw usage('exportVideo needs an output, or subtitles to write only subtitle files');
  }
  const flags = [
    ...sourceFlags(options),
    ...renderFlags(options),
    ...value('output-format', options.format),
    ...value('from', timecode('from', options.from)),
    ...value('to', timecode('to', options.to)),
    ...subtitles.flatMap((file) => value('subtitles', file)),
    ...value('preset', options.preset),
    ...value('crf', options.crf),
    ...value('bit-depth', options.bitDepth),
    ...value('color-conversion', options.colorConversion),
    ...value('loudness', options.loudness),
    ...value('true-peak', options.truePeak),
    ...value('peak-handling', options.peakHandling),
  ];
  return command(flags, options, options.output);
}

/** The exporter arguments for a still export. */
export function stillsArgs(options: StillsOptions): string[] {
  const frames = typeof options.frames === 'number' ? [options.frames] : options.frames;
  if ((frames === undefined || frames.length === 0) === (options.every === undefined)) {
    throw usage('exportStills needs either frames or every');
  }
  if (frames !== undefined && (options.from !== undefined || options.to !== undefined)) {
    throw usage('from and to select frames with every, not with frames');
  }
  const sheet = options.contactSheet;
  const flags = [
    ...sourceFlags(options),
    ...renderFlags(options),
    ...(frames?.length ? [`--frame=${frames.join(',')}`] : []),
    ...value('every', options.every),
    ...value('from', timecode('from', options.from)),
    ...value('to', timecode('to', options.to)),
    ...value('output-format', options.format),
    ...value('quality', options.quality),
    ...(sheet ? ['--contact-sheet'] : []),
    ...(typeof sheet === 'object' ? [...value('columns', sheet.columns), ...value('tile-width', sheet.tileWidth)] : []),
    ...(options.debugGuides ? ['--debug-guides'] : []),
  ];
  return command(flags, options, options.output);
}

/** The exporter arguments for `--info`. */
export function compositionArgs(options: CompositionOptions): string[] {
  return command(['--info', ...sourceFlags(options)], options);
}

function command(flags: string[], options: SourceOptions & { onProgress?: unknown }, output?: string): string[] {
  const json = ['--json', '--stdin-cancel', ...(options.onProgress ? ['--json-progress'] : [])];
  // `--` keeps a source or output that starts with `-` from reading as a flag.
  return [...json, ...flags, '--', options.source, ...(output === undefined ? [] : [output])];
}

function sourceFlags(options: SourceOptions): string[] {
  return [
    ...(isReactSource(options) ? ['--react'] : []),
    ...value('composition', options.composition),
    ...value('project', options.project),
    ...value('props', options.props === undefined ? undefined : JSON.stringify(options.props)),
    ...value('props-file', options.propsFile),
  ];
}

function renderFlags(options: VideoOptions | StillsOptions): string[] {
  return [
    ...(options.overwrite ? ['--overwrite'] : []),
    ...value('render-quality', options.renderQuality),
    ...value('driver', options.driver),
  ];
}

/** `--name=value`, which keeps a value that starts with `-` from reading as a flag. */
function value(name: string, option: string | number | undefined): string[] {
  return option === undefined ? [] : [`--${name}=${option}`];
}

/** Seconds become an `SS.mmm` timecode; strings are passed on for the exporter to parse. */
function timecode(name: string, time: Timecode | undefined): string | undefined {
  if (typeof time !== 'number') return time;
  if (!Number.isFinite(time) || time < 0) {
    throw usage(`${name} must be a non-negative number of seconds, not ${time}`);
  }
  return (Math.round(time * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
}

import { compositionArgs, stillsArgs, videoArgs } from './args.js';
import { runExporter } from './run.js';
import type {
  CompositionInfo,
  CompositionOptions,
  ExportReport,
  ExportResult,
  StillsOptions,
  VideoOptions,
} from './types.js';

export { isReactSource } from './args.js';
export { CelestaExportError } from './errors.js';
export { EXPORTER_COMMAND, installedExporters, resolveExporter } from './resolve.js';
export type { ResolveExporterOptions } from './resolve.js';
export { CANCEL_TIMEOUT_MS } from './run.js';
export type * from './types.js';

/** Exports a video (MP4, MOV or WebM), or with only `subtitles`, just the subtitle files. */
export async function exportVideo(options: VideoOptions): Promise<ExportResult> {
  return result(await runExporter(videoArgs(options), options));
}

/** Exports still frames (PNG, JPEG or WebP) or one contact sheet. */
export async function exportStills(options: StillsOptions): Promise<ExportResult> {
  return result(await runExporter(stillsArgs(options), options));
}

/** Reports the composition's size, rate and length, and a React entry's roots, without rendering. */
export async function getComposition(options: CompositionOptions): Promise<CompositionInfo> {
  const report = await runExporter(compositionArgs(options), { ...options, onProgress: undefined });
  return {
    source: report.source!,
    ...(report.propsFile === undefined ? {} : { propsFile: report.propsFile, propsFileAuto: report.propsFileAuto }),
    composition: report.composition!,
    ...(report.compositionId === undefined
      ? {}
      : { compositionId: report.compositionId, compositions: report.compositions }),
  };
}

function result(report: ExportReport): ExportResult {
  const { status: _status, error: _error, ...rest } = report;
  return {
    ...rest,
    source: report.source!,
    composition: report.composition!,
    outputs: report.outputs ?? [],
    warnings: report.warnings ?? [],
    stats: report.stats ?? { elapsedSeconds: 0 },
  };
}

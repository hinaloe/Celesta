/** What to export: a React entry or a JSON project, with its inputs. */
export interface SourceOptions {
  /** A React entry (`.tsx`, `.ts`, `.jsx`, `.js`) or a JSON project (`.celesta.json`). */
  source: string;
  /** Whether `source` is a React entry. Defaults to true for anything but a `.json` file. */
  react?: boolean;
  /** The React root composition's ID; defaults to the first declared one. */
  composition?: string;
  /** A companion `.celesta.json` for `<ProjectTimeline />` / `<ProjectTrack />`. */
  project?: string;
  /** Project property values; win over `propsFile`. */
  props?: Record<string, unknown>;
  /** A JSON file of project property values. */
  propsFile?: string;
}

/** How the exporter process is found and run. */
export interface RunOptions {
  /** The `celesta-exporter` executable; see `resolveExporter()` for the default. */
  exporter?: string;
  /** Cancels the export. Files being written are removed, as on any failure. */
  signal?: AbortSignal;
  /** Called with each progress event as it happens. */
  onProgress?: (event: ProgressEvent) => void;
  /** The exporter's working directory; relative paths resolve from it. */
  cwd?: string;
  /** The exporter's environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export type RenderQuality = 'draft' | 'final';
export type GpuDriver = 'auto' | 'vulkan' | 'dx12' | 'metal' | 'gl';
export type EncoderPreset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow';
export type ColorConversion = 'auto' | 'gpu' | 'encoder';
/** What gives where the loudness gain would take a true peak over `truePeak`. */
export type PeakHandling = 'limit' | 'lower';

/**
 * A composition time: seconds (rounded to milliseconds), or a timecode
 * string, `HH:MM:SS(.mmm)`, `MM:SS(.mmm)` or `SS(.mmm)`.
 */
export type Timecode = number | string;

interface RenderOptions {
  /** Replace existing output files. */
  overwrite?: boolean;
  /** `draft` skips re-rasterizing scaled text, for quick timing checks. */
  renderQuality?: RenderQuality;
  /** The graphics API; `auto` takes the first one with a GPU. */
  driver?: GpuDriver;
}

export interface VideoOptions extends SourceOptions, RunOptions, RenderOptions {
  /** The `.mp4`, `.mov` or `.webm` file. Leave it out to write only `subtitles`. */
  output?: string;
  /** The video format; the output's extension implies it. */
  format?: 'mp4' | 'mov' | 'webm';
  /** Export from this time. */
  from?: Timecode;
  /** Export up to (excluding) this time. */
  to?: Timecode;
  /** `.srt` or `.vtt` files to write beside the video; `{lang}` writes one per language. */
  subtitles?: string | string[];
  /** libx264 preset (MP4 only). */
  preset?: EncoderPreset;
  /** Constant rate factor, 0-51 (MP4 only). */
  crf?: number;
  /** 10 encodes H.264 High 10 (MP4 only). */
  bitDepth?: 8 | 10;
  /** Where RGB frames become YUV (MP4 only). */
  colorConversion?: ColorConversion;
  /**
   * Bring the whole mix to this integrated loudness: LUFS from -70 to -5,
   * `streaming` (-14) or `broadcast` (-23). Every video reports its mix's
   * `loudness` either way.
   */
  loudness?: number | 'streaming' | 'broadcast';
  /** The highest true peak `loudness` may leave, -9 to 0 dBTP; default -1. */
  truePeak?: number;
  /** `limit` (default) holds peaks at `truePeak`; `lower` stops the gain short of the target. */
  peakHandling?: PeakHandling;
}

export interface StillsOptions extends SourceOptions, RunOptions, RenderOptions {
  /**
   * The `.png`, `.jpg`/`.jpeg` or `.webp` file. Several frames are written as
   * `name-000090.png` beside it.
   */
  output: string;
  /** Zero-based frames to export. Give this or `every`. */
  frames?: number | readonly number[];
  /** Export every n-th frame of the composition (or `from`/`to`) and its last one. */
  every?: number;
  /** With `every`, start at this time. */
  from?: Timecode;
  /** With `every`, stop before this time. */
  to?: Timecode;
  /** The still format; the output's extension implies it. */
  format?: 'png' | 'jpeg' | 'webp';
  /** JPEG and WebP quality, 1-100. */
  quality?: number;
  /** Write the frames as one labelled grid image. */
  contactSheet?: boolean | { columns?: number; tileWidth?: number };
  /** Draw a React entry's `<DebugOverlay>` and `<DebugBounds>`. */
  debugGuides?: boolean;
}

export type CompositionOptions = SourceOptions & Omit<RunOptions, 'onProgress'>;

/** A rational frame rate. */
export interface FrameRate {
  numerator: number;
  denominator: number;
}

/** The composition an export covers. Times are seconds rounded to milliseconds. */
export interface Composition {
  width: number;
  height: number;
  fps: number;
  /** Total frames; frame numbers are zero-based. */
  frames: number;
  duration: number;
}

/** A root composition a React entry declares. */
export interface ReactComposition {
  id: string;
  width: number;
  height: number;
  frameRate: FrameRate;
  durationInFrames: number;
}

/** An exported mix's loudness, rounded to 0.01. */
export interface Loudness {
  /** Integrated loudness, LUFS; `null` for a silent mix or one shorter than 400 ms. */
  integratedLufs: number | null;
  /** The highest true peak, dBTP; `null` for digital silence. */
  truePeakDbtp: number | null;
  /** The gain a `loudness` target applied to the whole mix, dB. */
  gainDb?: number;
}

/** A written file. Frame numbers are zero-based composition frames. */
export type ExportOutput =
  | {
      type: 'video';
      path: string;
      firstFrame: number;
      frames: number;
      start: number;
      duration: number;
      audio: boolean;
      /** The mix's loudness, when the video has sound. */
      loudness?: Loudness;
      format: 'mp4' | 'mov' | 'webm';
      alpha: boolean;
    }
  | { type: 'frame'; path: string; frame: number; time: number }
  | { type: 'subtitles'; path: string; format: 'srt' | 'vtt'; cues: number; lang?: string }
  | { type: 'contactSheet'; path: string; columns: number; frames: number[] };

/** One validation issue: a project JSON path or a property key, when there is one. */
export interface ExportIssue {
  path?: string;
  message: string;
}

/** The exporter's `--json` error. */
export interface ExportErrorReport {
  /** A stable identifier to branch on. */
  code: string;
  message: string;
  hint?: string;
  issues?: ExportIssue[];
}

/** The exporter's `--json` result. */
export interface ExportReport {
  status: 'ok' | 'error';
  error?: ExportErrorReport;
  /** Absolute paths. */
  source?: string;
  propsFile?: string;
  propsFileAuto?: boolean;
  composition?: Composition;
  compositionId?: string;
  compositions?: ReactComposition[];
  outputs?: ExportOutput[];
  warnings?: string[];
  stats?: { elapsedSeconds: number; renderFps?: number };
}

/** A finished export. */
export interface ExportResult {
  source: string;
  propsFile?: string;
  propsFileAuto?: boolean;
  composition: Composition;
  /** The selected React root and every root the entry declares. */
  compositionId?: string;
  compositions?: ReactComposition[];
  outputs: ExportOutput[];
  warnings: string[];
  stats: { elapsedSeconds: number; renderFps?: number };
}

/** What `getComposition()` reports. */
export interface CompositionInfo {
  source: string;
  propsFile?: string;
  propsFileAuto?: boolean;
  composition: Composition;
  compositionId?: string;
  compositions?: ReactComposition[];
}

/** One `--json-progress` event. */
export type ProgressEvent =
  | { event: 'composition'; composition: Composition }
  | { event: 'compositions'; compositionId: string; compositions: ReactComposition[] }
  /** Frame `frame` of `total` has started, counting from 1. */
  | { event: 'rendering'; frame: number; total: number }
  | { event: 'mixingAudio' }
  | { event: 'muxing' }
  | { event: 'warning'; message: string }
  | { event: 'wrote'; output: ExportOutput };

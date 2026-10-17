import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** The name looked up on `PATH` when nothing else is found. */
export const EXPORTER_COMMAND = 'celesta-exporter';

export interface ResolveExporterOptions {
  /** An explicit executable; returned as is. */
  exporter?: string;
  /** Where `CELESTA_EXPORTER` is read from; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `fs.existsSync`. */
  exists?: (candidate: string) => boolean;
}

/** Where an installed Celesta keeps its exporter on `platform`. */
export function installedExporters(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  switch (platform) {
    case 'darwin':
      // Each platform's own separators, whichever platform this runs on.
      return ['/Applications', path.posix.join(homedir(), 'Applications')].map((apps) =>
        path.posix.join(apps, 'Celesta.app/Contents/MacOS/Celesta-export'),
      );
    case 'win32':
      return env.LOCALAPPDATA
        ? [path.win32.join(env.LOCALAPPDATA, 'Programs', 'Celesta', 'Celesta-export.exe')]
        : [];
    case 'linux':
      // packaging/linux/Dockerfile
      return ['/opt/celesta/celesta-exporter'];
    default:
      return [];
  }
}

/**
 * The exporter to run: `exporter` when given, else `CELESTA_EXPORTER`, else
 * an installed Celesta's, else `celesta-exporter` from `PATH`.
 */
export function resolveExporter(options: ResolveExporterOptions = {}): string {
  if (options.exporter) return options.exporter;
  const env = options.env ?? process.env;
  if (env.CELESTA_EXPORTER) return env.CELESTA_EXPORTER;
  const exists = options.exists ?? existsSync;
  return installedExporters(options.platform, env).find((candidate) => exists(candidate)) ?? EXPORTER_COMMAND;
}

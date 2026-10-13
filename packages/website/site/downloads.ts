import { repository } from './links.ts';

export type Platform = 'macOS' | 'Windows';
export type DownloadLinks = { all: string } & Record<Platform, string>;

/** An empty variable (a CI step that found no asset) counts as unset. */
const pick = (...values: (string | undefined)[]) => values.find(value => value) ?? `${repository}/releases/latest`;

/**
 * Download URLs from `CELESTA_DOWNLOAD_URL`, `CELESTA_DOWNLOAD_URL_MACOS`, and
 * `CELESTA_DOWNLOAD_URL_WINDOWS`. Platform links fall back to the general one, which falls back to
 * the latest GitHub release. Read at build time, in Server Components and the remark plugin.
 */
export function downloadLinks(env: Record<string, string | undefined> = process.env): DownloadLinks {
  const all = pick(env.CELESTA_DOWNLOAD_URL);
  return {
    all,
    macOS: pick(env.CELESTA_DOWNLOAD_URL_MACOS, all),
    Windows: pick(env.CELESTA_DOWNLOAD_URL_WINDOWS, all),
  };
}

// The directory of the composition entry file currently being rendered.
// `cli.ts` sets `CELESTA_REACT_ENTRY_DIR` before running the entry's
// `prepare()`, so helpers that read local files during preparation
// (`loadLipSync`, `loadPsdPreset`) resolve relative paths the same way the
// Rust renderer resolves a relative `<Audio>`/`<Image>` `src` — against the
// entry's own directory.

import * as fs from 'node:fs';
import * as path from 'node:path';

export function entryDir(): string {
  return process.env.CELESTA_REACT_ENTRY_DIR ?? process.cwd();
}

/** Whether `src` is an `http`/`https` URL, which the Rust side downloads and caches. */
export function isRemoteUrl(src: string): boolean {
  return /^https?:\/\/./i.test(src);
}

/** Resolves `src` against the entry directory unless it is already absolute. */
export function entryRelativePath(src: string): string {
  return path.isAbsolute(src) ? src : path.resolve(entryDir(), src);
}

/**
 * A file or directory `prepare()` read, with its state when it was read.
 * The editor reloads the entry when one of these changes on disk, even
 * outside the entry's directory. `mtimeNs` and `size` are null when the
 * path did not exist; `size` is also null for a directory, whose reported
 * size differs between runtimes on Windows.
 */
export interface PrepareDependency {
  path: string;
  /** Nanoseconds since the Unix epoch, as a decimal string. */
  mtimeNs: string | null;
  size: number | null;
}

const dependencies = new Map<string, PrepareDependency>();

/**
 * Records that preparation is about to read `src` (resolved like
 * `entryRelativePath`). Call it before reading, so a change made while
 * reading still differs from the recorded state. A path recorded twice
 * keeps its first state. For a directory, its own modification time moves
 * when an entry is added, removed, or renamed.
 */
export function trackPrepareDependency(src: string): void {
  const resolved = entryRelativePath(src);
  if (dependencies.has(resolved)) {
    return;
  }
  let mtimeNs: string | null = null;
  let size: number | null = null;
  try {
    const stat = fs.statSync(resolved, { bigint: true });
    mtimeNs = stat.mtimeNs.toString();
    size = stat.isDirectory() ? null : Number(stat.size);
  } catch {
    // Missing: creating it later changes the recorded state.
  }
  dependencies.set(resolved, { path: resolved, mtimeNs, size });
}

/** Every path `trackPrepareDependency()` recorded, in the order recorded. */
export function prepareDependencies(): PrepareDependency[] {
  return [...dependencies.values()];
}

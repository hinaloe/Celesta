import type { Definition, Link, Root } from 'mdast';
import type { Transformer } from 'unified';
import { visit } from 'unist-util-visit';
import { downloadLinks, type DownloadLinks } from '../site/downloads.ts';

const prefix = 'celesta:download/';
const targets: Record<string, keyof DownloadLinks> = { macos: 'macOS', windows: 'Windows', all: 'all' };

/**
 * Rewrites `celesta:download/{macos,windows,all}` link URLs to the download links from
 * `site/downloads.ts`, so Markdown follows `CELESTA_DOWNLOAD_URL*` like the pages do. The
 * environment is read on every transform; an unknown target fails the build.
 */
export function remarkDownloadLinks(): Transformer<Root, Root> {
  return (tree: Root) => {
    let links: DownloadLinks | undefined;
    visit(tree, ['link', 'definition'], node => {
      const target = node as Link | Definition;
      if (!target.url.startsWith(prefix)) return;
      const name = target.url.slice(prefix.length);
      if (!Object.hasOwn(targets, name)) throw new Error(`remark-download-links: unknown download link "${target.url}" (expected ${Object.keys(targets).map(name => prefix + name).join(', ')})`);
      links ??= downloadLinks(process.env);
      target.url = links[targets[name]];
    });
  };
}

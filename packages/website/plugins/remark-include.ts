import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Code, Root } from 'mdast';
import { visit } from 'unist-util-visit';

export interface RemarkIncludeOptions {
  /** Directory that `file=` paths resolve against (the package root). */
  root: string;
}

const filePattern = /(?:^|\s)file=(?:"([^"]*)"|(\S+))/;

/**
 * Fills an empty code fence from the file named by its `file=` meta. Paths resolve against `options.root`:
 * Makit's VFile has no path, so the Markdown file's own location is not available.
 */
export function remarkInclude(options: RemarkIncludeOptions) {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const match = node.meta && filePattern.exec(node.meta);
      if (!match || node.value.trim()) return;

      const path = match[1] ?? match[2];
      let contents: string;
      try {
        contents = readFileSync(resolve(options.root, path), 'utf8');
      } catch (error) {
        throw new Error(`remark-include: cannot read "${path}" (resolved from ${options.root}): ${error instanceof Error ? error.message : error}`);
      }

      node.value = contents.replace(/\r?\n$/, '');
      const meta = node.meta!.replace(filePattern, '').trim();
      node.meta = /(?:^|\s)title=/.test(meta) ? meta : `${meta} title="${basename(path)}"`.trim();
    });
  };
}

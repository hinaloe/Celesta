import { readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Code, Root } from 'mdast';
import type { Transformer } from 'unified';
import { visit } from 'unist-util-visit';

export interface RemarkIncludeOptions {
  /** Directory that `file=` paths resolve against (the package root). */
  root: string;
  /** Directory no included file may lie outside (the repository). Defaults to two levels above `root`. */
  repositoryRoot?: string;
}

const filePattern = /(?:^|\s)file=(?:"([^"]*)"|(\S+))/;

/**
 * Fills an empty code fence from the file named by its `file=` meta. Paths resolve against `options.root`:
 * Makit's VFile has no path, so the Markdown file's own location is not available.
 */
export function remarkInclude(options: RemarkIncludeOptions): Transformer<Root, Root> {
  const repositoryRoot = resolve(options.repositoryRoot ?? resolve(options.root, '../..'));
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const match = node.meta && filePattern.exec(node.meta);
      if (!match || node.value.trim()) return;

      const path = match[1] ?? match[2];
      const target = resolve(options.root, path);
      const inside = relative(repositoryRoot, target);
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
        throw new Error(`remark-include: "${path}" resolves outside the repository (${repositoryRoot}): ${target}`);
      }
      let contents: string;
      try {
        contents = readFileSync(target, 'utf8');
      } catch (error) {
        throw new Error(`remark-include: cannot read "${path}" (resolved from ${options.root}): ${error instanceof Error ? error.message : error}`);
      }

      node.value = contents.replace(/\r?\n$/, '');
      const meta = node.meta!.replace(filePattern, '').trim();
      node.meta = /(?:^|\s)title=/.test(meta) ? meta : `${meta} title="${basename(path)}"`.trim();
    });
  };
}

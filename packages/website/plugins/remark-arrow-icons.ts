import type { Root, Text } from 'mdast';
import type { Transformer } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/** Arrow glyphs and the lucide icon each becomes (`.nr-icon-<name>` in `theme/docs.css`). */
const icons: Record<string, string> = { '→': 'arrow-right', '←': 'arrow-left', '↗': 'arrow-up-right', '↓': 'arrow-down', '↑': 'arrow-up' };

const arrow = /[→←↗↓↑]/g;
/** A space (or no-break space) next to a glyph at the edge of its text node. */
const leadingSpace = /^[ \u00a0]/;
const trailingSpace = /[ \u00a0]$/;

/**
 * An empty `<span class="nr-icon nr-icon-<name>" aria-hidden="true">`; CSS draws the icon. `at` marks
 * a glyph that began or ended its text node (`nr-icon-at-start` / `nr-icon-at-end`): its space was
 * dropped, and CSS gives it a margin on the text side instead.
 */
const icon = (glyph: string, at?: 'start' | 'end'): Text => ({
  type: 'text',
  value: '',
  data: {
    hName: 'span',
    hProperties: { className: ['nr-icon', `nr-icon-${icons[glyph]}`, ...(at ? [`nr-icon-at-${at}`] : [])], 'aria-hidden': 'true' },
  },
});

/**
 * Replaces arrow glyphs in prose (`[… on GitHub ↗](…)`, `**Start here →**`, `File → Open…`) with
 * icon spans, in place, so they never render as emoji. Between words the spaces stay, so the text
 * still reads "File Open…" to screen readers, search, and copy-paste; at the very start or end of a
 * text node the adjacent space is dropped. Text nodes only: inline code and code blocks keep their
 * arrows. The Markdown sources, and the `.md` endpoints made from them, keep theirs.
 */
export function remarkArrowIcons(): Transformer<Root, Root> {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      const { value } = node;
      if (!parent || index === undefined || !value.match(arrow)) return;
      const parts: Text[] = [];
      let last = 0;
      for (const match of value.matchAll(arrow)) {
        const start = match.index === 0;
        const end = match.index === value.length - 1;
        const before = value.slice(last, match.index);
        const kept = end ? before.replace(trailingSpace, '') : before;
        if (kept) parts.push({ type: 'text', value: kept });
        parts.push(icon(match[0], start && !end ? 'start' : end && !start ? 'end' : undefined));
        last = match.index + 1 + (start && leadingSpace.test(value.slice(match.index + 1)) ? 1 : 0);
      }
      if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
      parent.children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}
